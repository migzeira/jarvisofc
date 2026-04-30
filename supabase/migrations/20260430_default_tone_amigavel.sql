-- ==================== DEFAULT TONE = AMIGÁVEL ====================
-- Antes: agent_configs.tone tinha default 'profissional', então novos
-- usuários começavam com tom formal/seco. Pra UX de WhatsApp (canal
-- conversacional, casual), o tom natural é amigável.
--
-- Esta migration:
--   1. Muda o default da coluna pra 'amigavel' (afeta apenas novos INSERTs).
--   2. NÃO toca em valores existentes — usuários que escolheram explicitamente
--      'profissional' / 'casual' / 'tecnico' mantêm sua escolha.
--
-- Idempotente: ALTER COLUMN ... SET DEFAULT é seguro de rodar múltiplas vezes.

ALTER TABLE public.agent_configs
  ALTER COLUMN tone SET DEFAULT 'amigavel';
