-- Limpeza automática de lembretes antigos (roda todo dia 1 às 03:00 BRT)
-- Remove lembretes com status sent/failed/cancelled com mais de 30 dias
-- Isso evita crescimento indefinido da tabela reminders

SELECT cron.schedule(
  'cleanup-old-reminders',
  '0 6 1 * *',  -- 1o de cada mês às 06:00 UTC (= 03:00 BRT)
  $$
    DELETE FROM reminders
    WHERE status IN ('sent', 'failed', 'cancelled')
      AND created_at < now() - interval '30 days';
  $$
);

-- Limpeza de sessões WhatsApp inativas há mais de 7 dias (libera espaço e remove LIDs antigos)
SELECT cron.schedule(
  'cleanup-old-sessions',
  '0 6 * * 0',  -- Todo domingo às 06:00 UTC
  $$
    DELETE FROM whatsapp_sessions
    WHERE last_activity < now() - interval '7 days'
      AND pending_action IS NULL;
  $$
);
