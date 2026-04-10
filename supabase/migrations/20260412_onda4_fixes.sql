-- Onda 4: Anotações, Hábitos, Contatos
--
-- Fix 1: Adiciona contacts ao supabase_realtime (estava faltando)
--        Criar contato via WA não refletia no dashboard até refresh
-- Fix 2: ON DELETE CASCADE em reminders.habit_id → quando hábito é deletado,
--        reminders associadas também somem (antes era SET NULL, deixava órfãos)

-- ────────────────────────────────────────────────────────────────
-- (1) Contacts em realtime (idempotente)
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ────────────────────────────────────────────────────────────────
-- (2) Reminders.habit_id CASCADE — deleta reminders quando hábito some
--     Antes: ON DELETE SET NULL → reminders ficam órfãos (habit_id=NULL)
--     e continuam disparando no send-reminder, confundindo o usuário.
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Encontra a constraint de FK atual (nome varia entre ambientes)
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.reminders'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%habit_id%FOREIGN KEY%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reminders DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  -- Recria com ON DELETE CASCADE
  ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_habit_id_fkey
    FOREIGN KEY (habit_id) REFERENCES public.habits(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
  -- Se a coluna habit_id não existe por algum motivo, não quebra
  RAISE NOTICE 'Could not alter reminders.habit_id FK: %', SQLERRM;
END $$;

-- ────────────────────────────────────────────────────────────────
-- (3) Limpeza de reminders órfãos existentes (habit_id=NULL)
--     Só os que foram ORFINADOS por delete de hábitos antigos.
--     Preserva reminders normais que simplesmente não são de hábito
--     (source != 'habit' e habit_id nunca setado).
-- ────────────────────────────────────────────────────────────────
DELETE FROM public.reminders
WHERE source = 'habit' AND habit_id IS NULL;
