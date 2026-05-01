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
-- Wrapped em DO porque alguns ambientes podem não ter a tabela ainda
-- (instalações que pularam migrations antigas).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='recurring_transactions') THEN
    ALTER TABLE public.recurring_transactions
      ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_recurring_transactions_sent_by
      ON public.recurring_transactions (user_id, sent_by_phone)
      WHERE sent_by_phone IS NOT NULL;
    RAISE NOTICE 'recurring_transactions.sent_by_phone OK';
  ELSE
    RAISE NOTICE 'recurring_transactions não existe — pulando';
  END IF;
END $$;

-- installments: parcelamentos. Mesmo raciocínio — "comprei iphone 12x"
-- pelo master ou pelo partner deve ser separável no dashboard.
-- Idempotente: só roda se a tabela existir (nem todo deploy criou ela).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='installments') THEN
    ALTER TABLE public.installments
      ADD COLUMN IF NOT EXISTS sent_by_phone TEXT DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_installments_sent_by
      ON public.installments (user_id, sent_by_phone)
      WHERE sent_by_phone IS NOT NULL;
    RAISE NOTICE 'installments.sent_by_phone OK';
  ELSE
    RAISE NOTICE 'installments não existe — pulando (deploy antigo sem essa tabela)';
  END IF;
END $$;
