-- Garante que novos lembretes sem status explícito entrem como 'pending'
ALTER TABLE reminders
  ALTER COLUMN status SET DEFAULT 'pending';

-- Corrige lembretes que possam ter ficado com status NULL (nunca seriam enviados)
UPDATE reminders
SET status = 'pending'
WHERE status IS NULL
  AND send_at > NOW();
