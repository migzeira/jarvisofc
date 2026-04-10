-- HOTFIX: Adiciona policy ao processed_messages para permitir service_role
--
-- PROBLEMA: migração 20260409_message_dedup.sql habilitou RLS na tabela
-- processed_messages MAS sem nenhuma policy. Isso bloqueia até service_role
-- de fazer INSERT, quebrando a deduplicação de mensagens do WhatsApp.
--
-- Consequência: webhook whatsapp-webhook/index.ts (linhas 3345-3357) falha
-- silenciosamente ao tentar INSERT, impedindo deduplicação atomica.

-- Adiciona policy que permite apenas service_role acessar processed_messages
CREATE POLICY "service_role_only_processed_messages"
  ON public.processed_messages
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
