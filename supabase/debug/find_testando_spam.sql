-- ────────────────────────────────────────────────────────────────────────
-- DEBUG: Bug do "Testando" sendo enviado de hora em hora pra +5527999949998
-- ────────────────────────────────────────────────────────────────────────
-- Sintoma: WhatsApp do Jarvis mandou "Testando" pra um contato uma vez,
-- depois passou a mandar de hora em hora exatamente no :53 de cada hora.
-- Padrão típico de reminder com recurrence='hourly', recurrence_value=1.

-- ─── 1. IDENTIFICAR a row culpada ───
-- Procura reminders ativos com title/message="Testando" OU enviados pra
-- esse número específico. Roda PRIMEIRO pra ver o que tá rolando.
SELECT
  r.id,
  r.user_id,
  r.whatsapp_number,
  r.title,
  r.message,
  r.recurrence,
  r.recurrence_value,
  r.send_at,
  r.source,
  r.status,
  r.created_at,
  p.display_name as user_name,
  p.phone_number as user_phone
FROM reminders r
LEFT JOIN profiles p ON p.id = r.user_id
WHERE r.status = 'pending'
  AND (
    -- Match pelo número de destino (com e sem o '+')
    r.whatsapp_number ILIKE '%5527999949998%'
    OR r.whatsapp_number ILIKE '%27999949998%'
    OR r.whatsapp_number ILIKE '%999949998%'
    -- Match pelo título suspeito
    OR LOWER(r.title) IN ('testando', 'teste', 'testar', 'test')
    OR LOWER(r.message) LIKE '%testando%'
  )
ORDER BY r.created_at DESC;

-- ─── 2. SE encontrar a row, ver TODAS as ocorrências (incluindo enviadas) ───
-- Útil pra confirmar que é mesmo o spam de hora em hora.
-- Substitua <REMINDER_ID> pelo id retornado na query 1.
--
-- SELECT id, send_at, status, sent_at, created_at
-- FROM reminders
-- WHERE id = '<REMINDER_ID>'
--    OR (recurrence = 'hourly' AND title ILIKE '%testando%')
-- ORDER BY send_at DESC
-- LIMIT 20;

-- ─── 3. PARAR o spam — atualiza pra status='cancelled' ───
-- Roda DEPOIS de confirmar pela query 1 que é mesmo o bug.
-- ATENÇÃO: Cancela TODOS os reminders pending com title/message Testando
-- pra qualquer destinatário. Se quiser mais conservador, adicione AND id IN (...).
--
-- UPDATE reminders
-- SET status = 'cancelled',
--     -- preserva trail pra forensics
--     message = COALESCE(message, '') || ' [cancelled by admin 2026-05-15: hourly spam bug]'
-- WHERE status = 'pending'
--   AND (
--     LOWER(title) IN ('testando', 'teste', 'testar', 'test')
--     OR LOWER(message) LIKE '%testando%'
--   )
--   AND recurrence = 'hourly';

-- ─── 4. FORENSICS — quem criou e quando ───
-- Verifica se o user tem outros reminders suspeitos, e quantas mensagens
-- foram enviadas no total pra esse número.
--
-- SELECT
--   p.id, p.display_name, p.phone_number, p.account_status, p.created_at
-- FROM profiles p
-- WHERE p.id = (
--   SELECT user_id FROM reminders
--   WHERE LOWER(title) ILIKE 'testando%'
--     AND recurrence = 'hourly'
--   LIMIT 1
-- );

-- ─── 5. CONTAR quantos lembretes foram enviados ───
-- Mede o estrago. Cada send = 1 mensagem WhatsApp = $ + reputação queimando.
--
-- SELECT
--   COUNT(*) FILTER (WHERE status = 'sent') as enviados,
--   COUNT(*) FILTER (WHERE status = 'pending') as pendentes,
--   MIN(send_at) FILTER (WHERE status = 'sent') as primeira_msg,
--   MAX(sent_at) FILTER (WHERE status = 'sent') as ultima_msg
-- FROM reminders
-- WHERE LOWER(title) ILIKE 'testando%'
--   AND recurrence = 'hourly';
