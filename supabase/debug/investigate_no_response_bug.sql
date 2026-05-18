-- ────────────────────────────────────────────────────────────────────────
-- INVESTIGAÇÃO: Cliente nova mandou mensagem e Jarvis NÃO RESPONDEU
-- ────────────────────────────────────────────────────────────────────────
-- Phone reportado: (19) 98134-6160 → 5519981346160
-- Sintoma: mandou 'Oi', mandou audio, sem resposta
-- ────────────────────────────────────────────────────────────────────────

-- ─── 1. Perfil dela ────────────────────────────────────────────────────
-- Checagem: ela existe? Phone foi normalizado certo? account_status correto?
-- trial_ends_at no futuro?
SELECT
  p.id,
  p.display_name,
  p.phone_number,
  p.email,
  p.account_status,
  p.trial_started_at,
  p.trial_ends_at,
  (p.trial_ends_at::timestamp - NOW())::interval AS trial_remaining,
  p.access_until,
  p.plan,
  p.created_at,
  p.is_admin
FROM profiles p
WHERE p.phone_number IN ('5519981346160', '19981346160', '981346160', '5519981346160')
   OR p.phone_number LIKE '%981346160%';

-- ─── 2. Conta de auth ─────────────────────────────────────────────────
-- Confirma user_id e email
SELECT u.id, u.email, u.phone, u.created_at, u.email_confirmed_at, u.last_sign_in_at
FROM auth.users u
WHERE u.id IN (
  SELECT id FROM profiles WHERE phone_number LIKE '%981346160%'
);

-- ─── 3. Config do agente — esta ativado? ─────────────────────────────
SELECT
  ac.user_id,
  ac.is_active,
  ac.agent_name,
  ac.tone,
  ac.created_at,
  ac.updated_at
FROM agent_configs ac
WHERE ac.user_id IN (
  SELECT id FROM profiles WHERE phone_number LIKE '%981346160%'
);

-- ─── 4. Mensagens recebidas dela no whatsapp_webhook ─────────────────
-- Se nao aparecer nada aqui = webhook NUNCA foi disparado pra ela.
-- Causa provavel: Evolution API nao tem o numero conectado.
SELECT
  c.id as conversation_id,
  c.phone_number,
  c.user_id,
  c.created_at as conv_created,
  c.last_message_at
FROM conversations c
WHERE c.phone_number LIKE '%981346160%'
ORDER BY c.created_at DESC
LIMIT 5;

-- ─── 5. Mensagens individuais dela ────────────────────────────────────
SELECT
  m.id,
  m.conversation_id,
  m.role,
  LEFT(m.content, 200) as content_preview,
  m.message_type,
  m.created_at
FROM messages m
WHERE m.conversation_id IN (
  SELECT id FROM conversations WHERE phone_number LIKE '%981346160%'
)
ORDER BY m.created_at DESC
LIMIT 20;

-- ─── 6. Logs de erro recentes (qualquer um) ──────────────────────────
-- Se a tabela error_logs existe e foi populada por failures do webhook
SELECT
  el.id,
  el.context,
  LEFT(el.message, 300) as msg_preview,
  el.metadata,
  el.created_at
FROM error_logs el
WHERE el.created_at > NOW() - INTERVAL '24 hours'
  AND (
    el.message LIKE '%981346160%'
    OR el.metadata::text LIKE '%981346160%'
    OR el.context LIKE '%webhook%'
  )
ORDER BY el.created_at DESC
LIMIT 10;

-- ─── 7. Processed messages (deduplicação) ─────────────────────────────
-- Webhook pode ter deduplicado msg dela achando que já processou
SELECT *
FROM processed_messages
WHERE message_id LIKE '%981346160%'
   OR sender_phone LIKE '%981346160%'
ORDER BY processed_at DESC
LIMIT 10;

-- ─── 8. Bot_metrics — ela aparece nas metricas? ──────────────────────
SELECT *
FROM bot_metrics
WHERE user_id IN (SELECT id FROM profiles WHERE phone_number LIKE '%981346160%')
ORDER BY created_at DESC
LIMIT 10;
