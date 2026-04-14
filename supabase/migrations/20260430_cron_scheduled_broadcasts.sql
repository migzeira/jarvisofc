-- Cron que executa broadcasts agendados a cada minuto
-- (Depende de pg_net e da função process-scheduled-broadcasts já deployada)

select cron.unschedule('process-scheduled-broadcasts')
  where exists (select 1 from cron.job where jobname = 'process-scheduled-broadcasts');

select cron.schedule(
  'process-scheduled-broadcasts',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/process-scheduled-broadcasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
