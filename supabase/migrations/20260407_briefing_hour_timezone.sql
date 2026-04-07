-- =============================================
-- Adiciona horário do resumo diário ao agent_configs
-- e garante que timezone existe em profiles
-- =============================================

-- Horário preferido do resumo diário (5-10h). Default = 8.
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS briefing_hour integer DEFAULT 8;

-- Garante que timezone existe em profiles (pode já existir)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Sao_Paulo';

-- ─────────────────────────────────────────────────────────────
-- IMPORTANTE: o cron do daily-briefing deve ser atualizado para
-- rodar a cada hora (0 * * * *) em vez de uma vez ao dia.
-- A função agora filtra cada usuário pelo seu briefing_hour
-- no fuso horário configurado em profiles.timezone.
--
-- No Supabase Dashboard → Database → Cron Jobs, altere o job
-- "daily-briefing" de "0 11 * * *" para "0 5-13 * * *"
-- (5h–13h UTC = 2h–10h BRT, cobrindo todos os horários possíveis)
-- ─────────────────────────────────────────────────────────────
