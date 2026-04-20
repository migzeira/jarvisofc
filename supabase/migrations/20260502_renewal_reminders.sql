-- Renewal reminders: 2 mensagens automáticas no WhatsApp pra quem vence
--
-- Fluxo:
--   D+0 (access_until vence) → Lembrete 1: "venceu hoje, renove aqui"
--                              bot segue funcionando (grace de 24h)
--   D+1 (23h depois) → Lembrete 2: "estou sendo desativado"
--   D+1 (24h depois) → expire_stale_accounts suspende a conta
--   Cliente paga → Kirvano dispara activate → handleActivate reativa tudo
--                  e limpa as 2 flags pra permitir novo ciclo.

-- ────────────────────────────────────────────────────────────────
-- (1) Colunas de dedup dos lembretes
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_notice_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.renewal_reminder_sent_at IS
  'Timestamp do "seu plano venceu hoje". Limpa em handleActivate (Kirvano).';
COMMENT ON COLUMN public.profiles.suspension_notice_sent_at IS
  'Timestamp do "estou sendo desativado". Limpa em handleActivate (Kirvano).';

-- Índice parcial: acelera a query do cron (só pega quem tem algum lembrete pendente)
CREATE INDEX IF NOT EXISTS idx_profiles_renewal_watch
  ON public.profiles (access_until)
  WHERE account_status = 'active'
    AND access_source = 'kirvano'
    AND access_until IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- (2) expire_stale_accounts com grace de 24h
--     Só suspende contas cujo access_until já passou há ≥24h.
--     Isso dá tempo do edge-cron mandar os 2 lembretes antes
--     do corte — e preserva access_until/access_source pra audit.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stale_accounts()
RETURNS void AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- Suspende contas Kirvano que ficaram ≥24h sem renovar.
  -- Mantém access_until/access_source como histórico (limpa só ao reativar).
  WITH expired AS (
    UPDATE public.profiles
    SET
      account_status = 'pending'
    WHERE account_status = 'active'
      AND access_until IS NOT NULL
      AND access_until < NOW() - INTERVAL '24 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;

  -- Pausa agentes dos recém-suspensos
  IF v_count > 0 THEN
    UPDATE public.agent_configs ac
    SET is_active = false
    FROM public.profiles p
    WHERE p.id = ac.user_id
      AND p.account_status = 'pending'
      AND ac.is_active = true
      AND p.updated_at > NOW() - INTERVAL '5 minutes';
  END IF;

  RAISE NOTICE 'expire_stale_accounts: % accounts expired after grace', v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ────────────────────────────────────────────────────────────────
-- (3) Seed das configs em app_settings (idempotente)
--     renewal_link → admin preenche no painel (Kirvano checkout URL)
--     renewal_reminders_enabled → "true" liga, "false" desliga
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value) VALUES
  ('renewal_link', ''),
  ('renewal_reminders_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- (4) pg_cron: dispara renewal-reminder-cron a cada hora no minuto :12
--     (desencontra do expire job no :04 e do purge às 03:17).
--     Usa service_role key de current_setting('app.service_role_key').
-- ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('maya-renewal-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'maya-renewal-reminders',
  '12 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/renewal-reminder-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb
  )
  $$
);
