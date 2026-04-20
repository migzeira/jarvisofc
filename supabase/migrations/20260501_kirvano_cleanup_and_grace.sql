-- Kirvano: cleanup de eventos antigos + config de grace period
--
-- 1) purge_old_kirvano_events(): remove eventos não-matcheados com mais
--    de 180 dias. Eventos matcheados (matched_user_id NOT NULL) são
--    preservados pois servem de histórico/auditoria por usuário.
-- 2) pg_cron diário às 03:17 UTC (fora de horários de pico).
-- 3) Seed opcional de `overdue_grace_days` em app_settings (default 7).

-- ────────────────────────────────────────────────────────────────
-- (1) Função de limpeza — remove eventos unmatched > 180 dias
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_kirvano_events()
RETURNS void AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.kirvano_events
    WHERE matched_user_id IS NULL
      AND created_at < NOW() - INTERVAL '180 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM del;

  RAISE NOTICE 'purge_old_kirvano_events: % unmatched events purged', v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.purge_old_kirvano_events() IS
  'Remove eventos Kirvano sem match de usuário com mais de 180 dias. Eventos matcheados são preservados pra auditoria.';

-- ────────────────────────────────────────────────────────────────
-- (2) pg_cron: job diário às 03:17 UTC
-- ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('maya-purge-kirvano-events');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'maya-purge-kirvano-events',
  '17 3 * * *',
  $$ SELECT public.purge_old_kirvano_events(); $$
);

-- ────────────────────────────────────────────────────────────────
-- (3) Seed do default `overdue_grace_days` (idempotente)
--     O webhook kirvano-webhook lê essa chave via getSetting().
--     Admin pode sobrescrever pelo painel em Settings.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('overdue_grace_days', '7')
ON CONFLICT (key) DO NOTHING;
