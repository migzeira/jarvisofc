-- Fix 3: Previne lembretes duplicados quando o cron se sobrepõe
-- Adiciona coluna processing_at e RPC atômica claim_pending_reminders

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ;

-- Índice para acelerar a busca de lembretes presos em "processing"
CREATE INDEX IF NOT EXISTS idx_reminders_processing
  ON reminders (status, processing_at)
  WHERE status = 'processing';

-- RPC atômica: marca lembretes como "processing" e retorna apenas eles.
-- Usa FOR UPDATE SKIP LOCKED para garantir que dois cron runs concorrentes
-- nunca peguem o mesmo lembrete.
CREATE OR REPLACE FUNCTION claim_pending_reminders(p_limit int DEFAULT 50)
RETURNS SETOF reminders
LANGUAGE sql
AS $$
  UPDATE reminders
  SET status = 'processing', processing_at = now()
  WHERE id IN (
    SELECT id FROM reminders
    WHERE status = 'pending'
      AND send_at <= now()
    ORDER BY send_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
