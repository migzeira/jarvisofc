-- ─────────────────────────────────────────────────────────────────────────
-- Plano casal: completa as tabelas user-generated com sent_by_phone
-- ─────────────────────────────────────────────────────────────────────────
-- A migration 20260430_couple_plan_phase1 cobriu as tabelas de uso direto
-- (transactions, events, reminders, notes, lists, list_items, habits,
-- habit_logs). 20260505 adicionou contacts.
--
-- Esta migration adiciona em recurring_transactions e installments —
-- tabelas que armazenam configurações recorrentes que podem ter sido
-- criadas pelo master OU pelo partner. Sem isso, partner-created
-- recurrences ficam não-atribuídas no dashboard.
--
-- IDEMPOTENTE: pode rodar várias vezes sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────

-- recurring_transactions: master pode adicionar "aluguel R$1500 dia 5",
-- partner pode adicionar "academia R$120 dia 10" — ambos viram transações
-- mensais e devem aparecer na visão de cada um no dashboard.
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;

COMMENT ON COLUMN public.recurring_transactions.sent_by_phone IS
  'Plano casal: phone do partner que cadastrou a recorrência. NULL = master ou registro antigo.';

CREATE INDEX IF NOT EXISTS idx_recurring_transactions_sent_by
  ON public.recurring_transactions (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

-- installments: parcelamentos. Mesmo raciocínio — "comprei iphone 12x"
-- pelo master ou pelo partner deve ser separável no dashboard.
ALTER TABLE public.installments
  ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;

COMMENT ON COLUMN public.installments.sent_by_phone IS
  'Plano casal: phone do partner que cadastrou o parcelamento. NULL = master ou registro antigo.';

CREATE INDEX IF NOT EXISTS idx_installments_sent_by
  ON public.installments (user_id, sent_by_phone)
  WHERE sent_by_phone IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Validação pós-migration
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='recurring_transactions' AND column_name='sent_by_phone')
        OR (table_name='installments' AND column_name='sent_by_phone'));
  IF cnt < 2 THEN
    RAISE EXCEPTION 'Faltou criar sent_by_phone em recurring_transactions ou installments (criadas: %)', cnt;
  END IF;
  RAISE NOTICE 'OK — sent_by_phone em recurring_transactions e installments prontos';
END $$;
