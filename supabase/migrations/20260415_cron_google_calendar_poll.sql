-- Cron job que sincroniza eventos do Google Calendar a cada 2 min
-- Importa eventos novos/alterados/cancelados pro dashboard do Jarvis
-- e notifica o usuário no WhatsApp.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job antigo se já existir (idempotência)
SELECT cron.unschedule('google-calendar-poll-every-2min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-poll-every-2min'
);

-- Cria cron job que chama a Edge Function a cada 2 min
SELECT cron.schedule(
  'google-calendar-poll-every-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/google-calendar-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', 'maya-cron-secret-2026'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
