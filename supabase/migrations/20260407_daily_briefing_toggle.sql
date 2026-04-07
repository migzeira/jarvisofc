-- =============================================
-- Adiciona flag de resumo diário ao agent_configs
-- =============================================

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS daily_briefing_enabled boolean DEFAULT true;

-- Índice para a query do daily-briefing (filtra por user_id)
-- Já existe idx primário em user_id, nenhum índice extra necessário
