-- ==================== FIX HABIT MESSAGES ====================
-- Bug pré-existente em src/pages/dashboard/Habitos.tsx: ao togglar
-- "Desativar finais de semana" OU pausar/reativar um hábito, o código
-- recriava reminders com mensagem genérica ('⏰ Hora do seu hábito: *X*'),
-- sobrescrevendo a mensagem humanizada original do preset (ex: sleep →
-- "😴 Hora de descansar! Uma boa noite de sono é essencial...").
--
-- Esta migration corrige reminders PENDENTES desses hábitos preset que
-- ficaram com mensagem genérica. Não toca em hábitos custom (preset_key=null).
--
-- Idempotente: se já tiverem mensagem correta, nada acontece (filtro WHERE).

UPDATE public.reminders r
SET message = CASE h.preset_key
  WHEN 'sleep'        THEN '😴 Hora de descansar! Uma boa noite de sono é essencial. Bom descanso! 🌙'
  WHEN 'breathing'    THEN '🧘 Pausa de 5 minutos para respirar fundo e se alongar. Você merece! ✨'
  WHEN 'bible_verse'  THEN '{{habit:bible_verse}}'
  WHEN 'motivation'   THEN '{{habit:motivation}}'
  WHEN 'water'        THEN '💧 Hora de beber água! Mantenha-se hidratado(a). 🥤'
  WHEN 'medication'   THEN '💊 Hora de tomar seu remédio / vitamina! Não pule! ✅'
  WHEN 'sunscreen'    THEN '🧴 Lembra do protetor solar hoje! ☀️'
  WHEN 'call_parents' THEN '📞 Já ligou pra mãe ou pro pai essa semana? Eles adoram ouvir sua voz! ❤️'
  WHEN 'emotional'    THEN '😊 Como você está se sentindo hoje? Me conta com uma palavra!'
  WHEN 'gratitude'    THEN '🙏 O que você tem a agradecer hoje? Pense em 3 coisas boas que aconteceram.'
  WHEN 'pet_walk'     THEN '🐕 Hora do passeio! Seu pet está te esperando. Bora lá! 🐾'
  WHEN 'plants'       THEN '🌿 Suas plantinhas precisam de água hoje! Não as esqueça. 💚'
  WHEN 'reading'      THEN '📖 Que tal 20 minutinhos de leitura agora? Abra aquele livro que você adora!'
  -- Refeições: depende do horário do reminder (no fuso de São Paulo).
  -- Considera horas convertidas pro TZ local — UTC-3 é o default brasileiro.
  WHEN 'meals'        THEN
    CASE
      WHEN EXTRACT(HOUR FROM (r.send_at AT TIME ZONE 'America/Sao_Paulo')) < 10 THEN
        '☕ Bom dia! Hora do café da manhã. Não pule essa refeição!'
      WHEN EXTRACT(HOUR FROM (r.send_at AT TIME ZONE 'America/Sao_Paulo')) < 15 THEN
        '🍽️ Hora do almoço! Faça uma pausa e se alimente bem.'
      WHEN EXTRACT(HOUR FROM (r.send_at AT TIME ZONE 'America/Sao_Paulo')) < 18 THEN
        '🥗 Lanche da tarde! Hora de repor as energias.'
      ELSE
        '🌙 Hora do jantar! Cuide-se e coma bem esta noite.'
    END
  ELSE r.message  -- preset_key desconhecido: deixa como está
END
FROM public.habits h
WHERE r.habit_id = h.id
  AND r.status = 'pending'
  AND h.preset_key IS NOT NULL
  -- Só toca em mensagens que CONTÊM o template genérico (não estraga customs nem refazes manuais)
  AND r.message LIKE '⏰ Hora do seu hábito:%';
