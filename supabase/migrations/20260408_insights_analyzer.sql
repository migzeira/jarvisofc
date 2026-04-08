-- ============================================================
-- insights-analyzer: suporte ao modulo de insights proativos
-- ============================================================

-- Adiciona flag de insights proativos no agent_configs
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS proactive_insights_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agent_configs.proactive_insights_enabled
  IS 'Se true, Maya envia insights proativos semanais sobre padroes de comportamento';

-- ── pg_cron: roda toda segunda-feira as 11:00 UTC (08:00 BRT) ──
-- Remove job anterior caso exista
SELECT cron.unschedule('insights-analyzer-weekly')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'insights-analyzer-weekly'
  );

SELECT cron.schedule(
  'insights-analyzer-weekly',
  '0 11 * * 1',   -- toda segunda-feira as 11:00 UTC
  $$
  SELECT net.http_post(
    url      := (SELECT value FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/insights-analyzer',
    headers  := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body     := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
