-- ────────────────────────────────────────────────────────────────────────
-- INCIDENT: Cliente real recebeu spam "Testando" hourly por 15+ horas
-- ────────────────────────────────────────────────────────────────────────
-- User: 4f02c7ad-b64c-4da4-b074-8cf070e542e2
-- WhatsApp: 5527999949998 (ES, Brasil)
-- Period: sexta-feira 18:53 BRT em diante
-- ────────────────────────────────────────────────────────────────────────

-- ─── 1. Identificar quem é o cliente ───
SELECT
  p.id,
  p.display_name,
  p.phone_number,
  p.email,  -- se a coluna existir
  p.plan,
  p.account_status,
  p.kirvano_subscription_id,
  p.trial_started_at,
  p.trial_ends_at,
  p.created_at as profile_created_at
FROM profiles p
WHERE p.id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2';

-- Se profiles não tem email, busca em auth.users (precisa role admin):
-- SELECT u.email, u.created_at, u.last_sign_in_at
-- FROM auth.users u
-- WHERE u.id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2';

-- ─── 2. Dimensionar o estrago — quantas mensagens spam foram enviadas ───
SELECT
  COUNT(*) FILTER (WHERE status = 'sent') AS msgs_spam_enviadas,
  COUNT(*) FILTER (WHERE status = 'pending') AS msgs_spam_pendentes,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS msgs_spam_canceladas,
  MIN(sent_at) FILTER (WHERE status = 'sent') AS primeira_msg,
  MAX(sent_at) FILTER (WHERE status = 'sent') AS ultima_msg,
  -- Horas de duração do spam
  EXTRACT(EPOCH FROM (MAX(sent_at) FILTER (WHERE status = 'sent')
                      - MIN(sent_at) FILTER (WHERE status = 'sent'))) / 3600
    AS horas_spam
FROM reminders
WHERE user_id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2'
  AND LOWER(title) IN ('teste', 'testando', 'test', 'testar')
  AND recurrence = 'hourly';

-- ─── 3. Listar TODAS as mensagens enviadas (timeline detalhada) ───
SELECT
  id,
  send_at,
  sent_at,
  status,
  title,
  LEFT(message, 80) as message_preview
FROM reminders
WHERE user_id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2'
  AND LOWER(title) IN ('teste', 'testando', 'test', 'testar')
ORDER BY send_at ASC;

-- ─── 4. Verificar se cliente tem outros lembretes ATIVOS (limpar tudo "test") ───
-- Em caso de dúvida, cancela TODOS reminders de teste do user:
--
-- UPDATE reminders
-- SET status = 'cancelled',
--     message = COALESCE(message, '') || ' [cancelled by admin: client spam incident]'
-- WHERE user_id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2'
--   AND status = 'pending'
--   AND LOWER(title) IN ('teste', 'testando', 'test', 'testar');

-- ─── 5. Gesto de boa-fé — estender trial / dar dias grátis ───
-- Adiciona 30 dias ao trial_ends_at (ou cria se for plano ativo):
--
-- UPDATE profiles
-- SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + INTERVAL '30 days',
--     account_status = 'trial'  -- garante que tá rodando
-- WHERE id = '4f02c7ad-b64c-4da4-b074-8cf070e542e2'
--   AND account_status IN ('trial', 'expired', 'pending');
