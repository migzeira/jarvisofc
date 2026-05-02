-- ─────────────────────────────────────────────────────────────────────────
-- Fix daily-briefing cron auth header
-- ─────────────────────────────────────────────────────────────────────────
-- BUG REPORTADO 02/05/2026: Miguel parou de receber bom dia desde 29/04.
-- Diagnóstico: pg_cron chamava a edge function SEM Authorization header.
-- Quando CRON_SECRET está setado no env, a function retorna 401 mas o
-- pg_cron loga "succeeded" porque a chamada HTTP em si funciona.
--
-- Briefings antes de 28/04 saíam porque (provavelmente) CRON_SECRET não
-- estava setado ainda. Quando foi adicionado, o cron do daily passou a
-- ser rejeitado silenciosamente. O weekly-briefing já tinha o header
-- correto desde sempre.
--
-- Fix: recria o cron com Authorization Bearer matching o env.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove o cron antigo se existir (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-briefing') THEN
    PERFORM cron.unschedule('daily-briefing');
  END IF;
END $$;

-- Reagenda com Authorization correto. Schedule: a cada hora das 05-13 UTC
-- (= 02-10 BRT), cobre todos os briefing_hour configuráveis pelos users.
-- A própria edge function filtra cada user pelo seu briefing_hour no userTz.
SELECT cron.schedule(
  'daily-briefing',
  '0 5-13 * * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/daily-briefing',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer maya-cron-secret-2026"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cmd$
);

-- Validação pós-migration
DO $$
DECLARE
  cnt INT;
  cmd TEXT;
BEGIN
  SELECT count(*), max(command) INTO cnt, cmd FROM cron.job WHERE jobname = 'daily-briefing';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'daily-briefing cron não foi criado (count=%)', cnt;
  END IF;
  IF cmd NOT LIKE '%Authorization%' THEN
    RAISE EXCEPTION 'daily-briefing cron criado mas sem Authorization header';
  END IF;
  RAISE NOTICE 'OK — daily-briefing cron com Authorization header';
END $$;
