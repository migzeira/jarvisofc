-- ==================== REMINDERS DELIVERY TRACKING ====================
-- Rastreia entrega real (DELIVERY_ACK do WhatsApp via webhook MESSAGES_UPDATE).
-- Usado pra detectar usuários offline e evitar mandar bom dia stale na próxima
-- recorrência (motivo: Baileys retry gera 3 msgs em branco quando destino tá
-- offline por longos períodos).
--
-- Idempotente: roda múltiplas vezes sem erro (IF NOT EXISTS).
-- Default NULL nos novos campos = comportamento legado (não quebra reminders existentes).

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS evolution_message_id TEXT DEFAULT NULL;

-- Index pra lookup rápido por message_id (vindo do webhook MESSAGES_UPDATE).
-- Partial index só em rows que TÊM evolution_message_id reduz tamanho do index.
CREATE INDEX IF NOT EXISTS idx_reminders_evolution_message_id
  ON public.reminders(evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;

-- Index pra pre-flight check: pega último daily_briefing enviado por user
-- e verifica delivered_at. Cobertura: status=sent + source filtrado em runtime.
CREATE INDEX IF NOT EXISTS idx_reminders_user_source_sent
  ON public.reminders(user_id, source, sent_at DESC)
  WHERE status = 'sent';
