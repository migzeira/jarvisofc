-- 1) Adiciona coluna meeting_url à tabela events (Google Meet, Zoom, Teams, etc.)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS meeting_url TEXT;

-- 2) Reagenda o cron de Google Calendar pra rodar a cada 1 min (em vez de 2)
SELECT cron.unschedule('google-calendar-poll-every-2min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-poll-every-2min'
);

SELECT cron.unschedule('google-calendar-poll-every-1min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-poll-every-1min'
);

SELECT cron.schedule(
  'google-calendar-poll-every-1min',
  '* * * * *',
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
