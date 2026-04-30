-- ==================== PLANO CASAL — FASE 1 (SCHEMA) ====================
-- Migration aditiva. Zero impacto em clientes existentes:
--   - Adiciona tabela nova (profile_partners) — não existe hoje
--   - Adiciona colunas nullable com default NULL — queries antigas continuam idênticas
--   - RLS policies mantêm isolamento por user
--
-- Fluxo de uso:
--   1. Master (dono da conta) tem profile.plan='casal' (será setado via Kirvano webhook na Fase 3)
--   2. Master cadastra até 2 partners (slot 1 e slot 2) com nome + telefone
--   3. Webhook reconhece phone do partner → resolve master_user_id → grava sent_by_phone
--   4. Dashboards usam sent_by_phone pra filtrar/mostrar quem registrou
--
-- Seguro de rodar múltiplas vezes (IF NOT EXISTS em tudo).

-- ─────────── 1. Tabela PROFILE_PARTNERS ───────────
CREATE TABLE IF NOT EXISTS public.profile_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  partner_name TEXT NOT NULL,
  partner_phone TEXT NOT NULL,
  partner_nickname TEXT,             -- como o Jarvis chama a pessoa (ex: "Sibele")
  partner_whatsapp_lid TEXT,         -- LID resolvido após primeira msg (cache pra performance)
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_name_length CHECK (char_length(partner_name) BETWEEN 1 AND 60),
  CONSTRAINT partner_phone_length CHECK (char_length(partner_phone) BETWEEN 8 AND 20)
);

-- ─────────── 2. Índices únicos pra integridade ───────────
-- Cada master pode ter no máx 1 partner por slot ATIVO
CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_master_slot_active
  ON public.profile_partners (master_user_id, slot)
  WHERE is_active = true;

-- 1 phone só pode ser partner de UM master ativamente (evita conflito)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_phone_active
  ON public.profile_partners (partner_phone)
  WHERE is_active = true;

-- Index de lookup do webhook (busca por phone normalizado)
CREATE INDEX IF NOT EXISTS idx_partner_phone_lookup
  ON public.profile_partners (partner_phone, is_active)
  WHERE is_active = true;

-- LID lookup (mais rápido após primeira msg do partner)
CREATE INDEX IF NOT EXISTS idx_partner_lid_lookup
  ON public.profile_partners (partner_whatsapp_lid)
  WHERE partner_whatsapp_lid IS NOT NULL AND is_active = true;

-- ─────────── 3. RLS pra profile_partners ───────────
ALTER TABLE public.profile_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own partners"   ON public.profile_partners;
DROP POLICY IF EXISTS "Users insert own partners" ON public.profile_partners;
DROP POLICY IF EXISTS "Users update own partners" ON public.profile_partners;
DROP POLICY IF EXISTS "Users delete own partners" ON public.profile_partners;
DROP POLICY IF EXISTS "Service role manages partners" ON public.profile_partners;

CREATE POLICY "Users view own partners"   ON public.profile_partners FOR SELECT USING (auth.uid() = master_user_id);
CREATE POLICY "Users insert own partners" ON public.profile_partners FOR INSERT WITH CHECK (auth.uid() = master_user_id);
CREATE POLICY "Users update own partners" ON public.profile_partners FOR UPDATE USING (auth.uid() = master_user_id);
CREATE POLICY "Users delete own partners" ON public.profile_partners FOR DELETE USING (auth.uid() = master_user_id);
CREATE POLICY "Service role manages partners" ON public.profile_partners FOR ALL USING (true);

-- ─────────── 4. Trigger updated_at ───────────
DROP TRIGGER IF EXISTS update_profile_partners_updated_at ON public.profile_partners;
CREATE TRIGGER update_profile_partners_updated_at
  BEFORE UPDATE ON public.profile_partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────── 5. Coluna sent_by_phone nas tabelas de dados ───────────
-- Indica QUEM (master ou partner) gerou o registro. NULL = registro antigo
-- ou criado pelo master sem distinção (compatível 100% com fluxo solo).
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.events       ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.reminders    ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.notes        ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.lists        ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.list_items   ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.habits       ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
ALTER TABLE public.habit_logs   ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;

-- ─────────── 6. Toggle de share do Google Calendar ───────────
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS gcal_share_with_partners BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_configs.gcal_share_with_partners IS
  'Plano casal: se true, eventos criados pelos partners também sincronizam com o Google Calendar do master.';

-- ─────────── 7. Índices de performance pra filtros "quem registrou" ───────────
-- Partial index — só rows com sent_by_phone preenchido (ignora os NULL legados).
CREATE INDEX IF NOT EXISTS idx_transactions_sent_by
  ON public.transactions (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_sent_by
  ON public.events (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_sent_by
  ON public.reminders (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_sent_by
  ON public.notes (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_habits_sent_by
  ON public.habits (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

-- ─────────── 8. Realtime pro frontend ouvir mudanças em partners ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profile_partners'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profile_partners;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- VALIDAÇÕES PÓS-MIGRATION (não destrutivas)
-- ────────────────────────────────────────────────────────────
-- Confirma que tudo foi criado corretamente.
DO $$
DECLARE
  cnt INT;
BEGIN
  -- Tabela existe
  SELECT count(*) INTO cnt FROM information_schema.tables
    WHERE table_schema='public' AND table_name='profile_partners';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'profile_partners não foi criada';
  END IF;

  -- Colunas adicionadas em todas as tabelas alvo
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='public'
      AND column_name='sent_by_phone'
      AND table_name IN ('transactions','events','reminders','notes','lists','list_items','habits','habit_logs');
  IF cnt < 8 THEN
    RAISE EXCEPTION 'sent_by_phone não foi adicionada em todas as 8 tabelas (encontrado em %)', cnt;
  END IF;

  -- gcal_share_with_partners em agent_configs
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agent_configs'
      AND column_name='gcal_share_with_partners';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'gcal_share_with_partners não foi adicionada';
  END IF;

  RAISE NOTICE 'Migration FASE 1 do Plano Casal: ✅ aplicada com sucesso';
END $$;
