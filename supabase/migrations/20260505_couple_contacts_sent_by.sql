-- ─────────────────────────────────────────────────────────────────────────
-- Plano casal: contacts.sent_by_phone
-- ─────────────────────────────────────────────────────────────────────────
-- A migration original do plano casal (20260430_couple_plan_phase1) cobriu
-- transactions, events, reminders, notes, lists, list_items, habits e
-- habit_logs — mas esqueceu contacts. Resultado: quando Cibele mandava um
-- contato no whatsapp, salvava no dashboard SEM identificar quem registrou,
-- e a aba Contatos não tinha como filtrar/separar.
--
-- Esta migration corrige isso. NULL = registro antigo OU master (compat
-- 100% com fluxo solo). Phone do partner = registrado pelo partner.
--
-- IDEMPOTENTE: pode rodar várias vezes sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;

COMMENT ON COLUMN public.contacts.sent_by_phone IS
  'Plano casal: phone do partner que cadastrou o contato. NULL = master ou registro antigo.';

-- Índice parcial pra filtros "quem registrou" (mesmo padrão das outras tabelas).
-- Só indexa rows com sent_by_phone preenchido — ignora os NULL legados.
CREATE INDEX IF NOT EXISTS idx_contacts_sent_by
  ON public.contacts (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Validação pós-migration
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_col INT;
  has_idx INT;
BEGIN
  SELECT count(*) INTO has_col FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contacts' AND column_name='sent_by_phone';
  IF has_col <> 1 THEN
    RAISE EXCEPTION 'contacts.sent_by_phone não foi criada';
  END IF;

  SELECT count(*) INTO has_idx FROM pg_indexes
    WHERE schemaname='public' AND tablename='contacts' AND indexname='idx_contacts_sent_by';
  IF has_idx <> 1 THEN
    RAISE EXCEPTION 'idx_contacts_sent_by não foi criado';
  END IF;

  RAISE NOTICE 'OK — contacts.sent_by_phone + idx_contacts_sent_by prontos';
END $$;
