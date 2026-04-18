import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendImage, sendButtons, extractPhone, downloadMediaBase64, resolveLidToPhone } from "../_shared/evolution.ts";
import { generateExpenseChartUrl } from "../_shared/chart.ts";
import { syncGoogleCalendar, syncGoogleSheets, syncNotion, createCalendarEventWithMeet } from "../_shared/integrations.ts";
import {
  chat,
  extractTransactions,
  extractEvent,
  parseAgendaQuery,
  extractAgendaEdit,
  assistantChat,
  transcribeAudio,
  extractReceiptFromImage,
  extractStatementFromImage,
  parseReminderIntent,
  analyzeForwardedContent,
  type ChatMessage,
  type ExtractedEvent,
  type StatementExtraction,
  type ShadowAnalysis,
} from "../_shared/openai.ts";
import { logError, fromThrown } from "../_shared/logger.ts";
import { type Intent, classifyIntent, isReminderDecline, isReminderAtTime, isReminderAccept, parseMinutes } from "../_shared/classify.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────
// LOCALIZATION HELPERS
// ─────────────────────────────────────────────

/** Retorna o offset UTC do fuso (ex: "-03:00") calculado em runtime */
function getTzOffset(tz: string): string {
  const now = new Date();
  const utcMs = now.getTime();
  const tzMs = new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
  const totalMins = Math.round((tzMs - utcMs) / 60000);
  const sign = totalMins >= 0 ? "+" : "-";
  const abs = Math.abs(totalMins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Retorna a data de hoje (YYYY-MM-DD) no fuso do usuário */
function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: tz });
}

/**
 * Sanitiza texto pra uso seguro em PostgREST .or() e .ilike() filters.
 * Remove caracteres que poderiam quebrar o parser do PostgREST:
 *   - vírgulas (,)  → separador de filtros
 *   - parênteses    → grupo de filtros
 *   - ponto (.)     → separador coluna.operador
 *   - asteriscos    → LIKE wildcards (só * que vira %)
 *   - aspas         → injection clássico
 *   - null bytes    → postgres quebra
 * Mantém letras, números, espaço, acentos, hífen, underscore.
 */
function sanitizeForFilter(s: string): string {
  if (!s) return "";
  return String(s)
    .replace(/[\x00]/g, "")         // null bytes
    .replace(/[,.()"'*\\]/g, " ")   // caracteres que podem quebrar PostgREST
    .replace(/\s+/g, " ")           // colapsa espaços
    .trim()
    .slice(0, 80);                  // limita tamanho pra não explodir query
}

/**
 * Normaliza phone number pra uso seguro em .or() filters.
 * Aceita somente dígitos. Retorna string vazia se input inválido.
 * Previne injection e garante que o input seja sempre digits-only.
 */
function sanitizePhone(phone: string): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  // Phones válidos: 8-15 dígitos (E.164 permite até 15)
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

function langToLocale(lang: string): string {
  const map: Record<string, string> = { "pt-BR": "pt-BR", "en": "en-US", "es": "es-ES" };
  return map[lang] ?? "pt-BR";
}

function fmtDateLong(dateStr: string, lang: string): string {
  const locale = langToLocale(lang);
  const d = new Date(dateStr + "T12:00:00");
  const raw = d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function fmtTimeLang(timeStr: string, lang: string): string {
  const [h, m] = timeStr.split(":");
  if (lang === "en") {
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  }
  return `${h.padStart(2, "0")}:${m}`;
}

function fmtAdvanceLabel(minutes: number, lang: string): string {
  if (minutes >= 60) {
    const hrs = minutes / 60;
    const rounded = Math.round(hrs * 10) / 10;
    if (lang === "en") return `${rounded} hour${rounded !== 1 ? "s" : ""}`;
    if (lang === "es") return `${rounded} hora${rounded !== 1 ? "s" : ""}`;
    return `${rounded} hora${rounded !== 1 ? "s" : ""}`;
  }
  if (lang === "en") return `${minutes} min`;
  if (lang === "es") return `${minutes} min`;
  return `${minutes} min`;
}

/** Translates a response text to the target language if needed (non-pt-BR). */
async function translateIfNeeded(text: string, lang: string): Promise<string> {
  if (!text || lang === "pt-BR") return text;
  const targetLang = lang === "en" ? "English" : "Spanish";
  try {
    const result = await chat(
      [{
        role: "user",
        content: `Translate the following WhatsApp message to ${targetLang}. Rules:\n- Keep ALL emojis exactly as they are\n- Keep WhatsApp formatting (*bold*, _italic_) exactly as is\n- Only translate the text content\n- Return ONLY the translated message, nothing else\n\n${text}`,
      }],
      `You are an expert translator. Translate accurately to ${targetLang}. Never add explanations or notes.`,
    );
    return result?.trim() || text;
  } catch {
    return text; // fallback to original on error
  }
}

/** Enfileira mensagem para retry quando o Evolution API falha */
async function queueMessage(phone: string, content: string, userId?: string): Promise<void> {
  try {
    await supabase.from("message_queue").insert({
      user_id: userId ?? null,
      phone,
      message_type: "text",
      content,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    });
    console.log(`[message_queue] Enqueued for ${phone}`);
  } catch (err) {
    console.error("[message_queue] Failed to queue:", err);
  }
}

// ─────────────────────────────────────────────
// MODULE GATE — mensagem quando módulo está off
// ─────────────────────────────────────────────

type ModuleMap = { finance: boolean; agenda: boolean; notes: boolean; chat: boolean };

function getModuleDisabledMsg(
  intent: Intent,
  lang: string,
  modules: ModuleMap
): string {
  const INTENT_TO_MODULE: Partial<Record<Intent, keyof ModuleMap>> = {
    finance_record:    "finance",
    finance_report:    "finance",
    budget_set:        "finance",
    budget_query:      "finance",
    recurring_create:  "finance",
    // habit_create e habit_checkin nao mapeados = sempre disponivel
    agenda_create:   "agenda",
    agenda_query:    "agenda",
    agenda_lookup:   "agenda",
    agenda_edit:     "agenda",
    agenda_delete:   "agenda",
    event_followup:  "agenda",
    notes_save:      "notes",
    reminder_set:    "notes",
    reminder_list:   "notes",
    reminder_cancel: "notes",
    reminder_edit:   "notes",
    reminder_snooze: "notes",
    ai_chat:         "chat",
  };

  const module = INTENT_TO_MODULE[intent] ?? "chat";

  // Monta lista dos módulos ativos para mostrar no "chat desativado"
  const activeLabels = {
    "pt-BR": [
      modules.finance && "💰 Financeiro",
      modules.agenda  && "📅 Agenda",
      modules.notes   && "📝 Anotações e Lembretes",
    ],
    "en": [
      modules.finance && "💰 Finances",
      modules.agenda  && "📅 Agenda",
      modules.notes   && "📝 Notes & Reminders",
    ],
    "es": [
      modules.finance && "💰 Finanzas",
      modules.agenda  && "📅 Agenda",
      modules.notes   && "📝 Notas y Recordatorios",
    ],
  };
  const lk = (["pt-BR","en","es"].includes(lang) ? lang : "pt-BR") as "pt-BR"|"en"|"es";
  const activeList = (activeLabels[lk].filter(Boolean) as string[]).join(", ");

  const path = {
    "pt-BR": "Painel → *Config. do Agente* → *Módulos ativos*",
    "en":    "Dashboard → *Agent Config* → *Active Modules*",
    "es":    "Panel → *Config. del Agente* → *Módulos activos*",
  }[lk];

  const noneLabel = {
    "pt-BR": "nenhum módulo ativo",
    "en":    "no modules are currently active",
    "es":    "no hay módulos activos en este momento",
  }[lk];

  const MSGS: Record<"pt-BR"|"en"|"es", Record<keyof ModuleMap, string>> = {
    "pt-BR": {
      finance: `💰 O módulo *Financeiro* está desativado.\nNão consigo registrar gastos ou receitas agora.\n\n➡️ Para ativar acesse: ${path} e ligue o *Financeiro*.`,
      agenda:  `📅 O módulo *Agenda* está desativado.\nNão consigo gerenciar compromissos ou lembretes de eventos agora.\n\n➡️ Para ativar acesse: ${path} e ligue a *Agenda*.`,
      notes:   `📝 O módulo *Anotações e Lembretes* está desativado.\nNão consigo salvar notas nem criar lembretes agora.\n\n➡️ Para ativar acesse: ${path} e ligue as *Anotações*.`,
      chat:    `💬 A *Conversa livre* está desativada.\nPosso te ajudar com: ${activeList || noneLabel}.\n\n➡️ Para ativar acesse: ${path} e ligue a *Conversa livre*.`,
    },
    "en": {
      finance: `💰 The *Finance* module is disabled.\nI can't record expenses or income right now.\n\n➡️ To enable it, go to: ${path} and turn on *Finance*.`,
      agenda:  `📅 The *Agenda* module is disabled.\nI can't manage your calendar or event reminders right now.\n\n➡️ To enable it, go to: ${path} and turn on *Agenda*.`,
      notes:   `📝 The *Notes & Reminders* module is disabled.\nI can't save notes or create reminders right now.\n\n➡️ To enable it, go to: ${path} and turn on *Notes*.`,
      chat:    `💬 *Free Conversation* is disabled.\nI can help you with: ${activeList || noneLabel}.\n\n➡️ To enable it, go to: ${path} and turn on *Free Conversation*.`,
    },
    "es": {
      finance: `💰 El módulo *Financiero* está desactivado.\nNo puedo registrar gastos ni ingresos ahora.\n\n➡️ Para activarlo ve a: ${path} y activa el *Financiero*.`,
      agenda:  `📅 El módulo *Agenda* está desactivado.\nNo puedo gestionar tu calendario ni recordatorios de eventos ahora.\n\n➡️ Para activarlo ve a: ${path} y activa la *Agenda*.`,
      notes:   `📝 El módulo *Notas y Recordatorios* está desactivado.\nNo puedo guardar notas ni crear recordatorios ahora.\n\n➡️ Para activarlo ve a: ${path} y activa las *Notas*.`,
      chat:    `💬 La *Conversación libre* está desactivada.\nPuedo ayudarte con: ${activeList || noneLabel}.\n\n➡️ Para activarla ve a: ${path} y activa la *Conversación libre*.`,
    },
  };

  return MSGS[lk][module];
}

// ─────────────────────────────────────────────
// RATE LIMITER — max 20 msgs/min, 200 msgs/hour
// ─────────────────────────────────────────────
const RATE_LIMIT_PER_MINUTE = 20;
const RATE_LIMIT_PER_HOUR   = 200;
const BLOCK_DURATION_MS     = 60 * 60 * 1000; // 1h block after burst

async function checkRateLimit(phone: string): Promise<{ allowed: boolean; reason?: string }> {
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();

  const { data: row } = await supabase
    .from("rate_limits")
    .select("count, hour_count, window_start, hour_window_start, blocked_until")
    .eq("phone_number", phone)
    .maybeSingle();

  // Blocked?
  if (row?.blocked_until && new Date(row.blocked_until) > now) {
    return { allowed: false, reason: "blocked" };
  }

  // Contadores por minuto
  const windowStart = row?.window_start ?? now.toISOString();
  const isNewMinuteWindow = !row || new Date(windowStart) < new Date(minuteAgo);
  const minuteCount = isNewMinuteWindow ? 1 : (row?.count ?? 0) + 1;

  // Contadores por hora
  const hourWindowStart = row?.hour_window_start ?? now.toISOString();
  const isNewHourWindow = !row?.hour_window_start || new Date(hourWindowStart) < new Date(hourAgo);
  const hourCount = isNewHourWindow ? 1 : (row?.hour_count ?? 0) + 1;

  // Bloqueia se excedeu minuto OU hora
  if (minuteCount > RATE_LIMIT_PER_MINUTE || hourCount > RATE_LIMIT_PER_HOUR) {
    const blockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS).toISOString();
    await supabase.from("rate_limits").upsert({
      phone_number: phone,
      count: minuteCount,
      window_start: isNewMinuteWindow ? now.toISOString() : windowStart,
      hour_count: hourCount,
      hour_window_start: isNewHourWindow ? now.toISOString() : hourWindowStart,
      blocked_until: blockedUntil,
    }, { onConflict: "phone_number" });
    return { allowed: false, reason: "rate_exceeded" };
  }

  // Atualiza contadores
  await supabase.from("rate_limits").upsert({
    phone_number: phone,
    count: minuteCount,
    window_start: isNewMinuteWindow ? now.toISOString() : windowStart,
    hour_count: hourCount,
    hour_window_start: isNewHourWindow ? now.toISOString() : hourWindowStart,
    blocked_until: null,
  }, { onConflict: "phone_number" });

  return { allowed: true };
}

// ─────────────────────────────────────────────
// Intent classification and parser helpers are imported from ../_shared/classify.ts

// ─────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────

function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v),
    template
  );
  // Converte \n literal (vindo do banco) em newline real
  result = result.replace(/\\n/g, "\n");
  return result;
}

// ─────────────────────────────────────────────
// HABIT HANDLERS
// ─────────────────────────────────────────────

async function handleHabitCreate(userId: string, phone: string, message: string, userTz = "America/Sao_Paulo"): Promise<string> {
  const prompt = `Extraia de uma frase em português os dados para criar um hábito diário.
Retorne JSON puro: {"name":"nome curto","description":"descricao","reminder_time":"HH:MM","icon":"emoji"}

Exemplos:
- "quero criar habito de beber agua a cada 2h" → {"name":"Beber agua","description":"Beber agua regularmente","reminder_time":"08:00","icon":"💧"}
- "habito de exercicio todo dia as 7h" → {"name":"Exercicio","description":"Treino diario","reminder_time":"07:00","icon":"🏃"}
- "criar rotina de leitura" → {"name":"Leitura","description":"Ler todos os dias","reminder_time":"21:00","icon":"📚"}

Frase: "${message}"`;

  const aiResponse = await chat([{ role: "user", content: prompt }], "Voce extrai dados de habitos. Responda APENAS com JSON valido.");
  let parsed: any;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return "Nao entendi. Exemplo: *quero habito de exercicio todo dia as 7h*";
  }

  if (!parsed.name) return "Nao consegui identificar o habito. Exemplo: *habito de beber agua*";

  const { error, data } = await supabase
    .from("habits")
    .insert({
      user_id: userId,
      name: parsed.name,
      description: parsed.description || null,
      reminder_times: JSON.stringify([parsed.reminder_time || "08:00"]),
      target_days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
      icon: parsed.icon || "🎯",
      color: "#6366f1",
      is_active: true,
      current_streak: 0,
      best_streak: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Habit create error:", error);
    return "Erro ao criar habito. Tente novamente.";
  }

  // Cria lembrete recorrente diario para o habito (respeita timezone do usuario)
  const [hours, mins] = (parsed.reminder_time || "08:00").split(":").map(Number);
  // Calcula send_at no timezone do usuario convertendo para UTC
  const todayLocal = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });
  const tzOff = getTzOffset(userTz);
  const sendAt = new Date(`${todayLocal}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00${tzOff}`);
  if (sendAt <= new Date()) sendAt.setDate(sendAt.getDate() + 1);

  await supabase.from("reminders").insert({
    user_id: userId,
    whatsapp_number: phone,
    title: `Habito: ${parsed.name}`,
    message: `${parsed.icon || "🎯"} Hora do habito: *${parsed.name}*!\n\nQuando terminar, responda *feito* para registrar.`,
    send_at: sendAt.toISOString(),
    recurrence: "daily",
    source: "habit",
    status: "pending",
  });

  return `✅ *Habito criado!*\n\n${parsed.icon || "🎯"} *${parsed.name}*\n${parsed.description ? `📝 ${parsed.description}\n` : ""}⏰ Lembrete diario as ${parsed.reminder_time || "08:00"}\n\nQuando completar, responda *feito* e eu registro seu progresso!`;
}

async function handleHabitCheckin(
  userId: string,
  message: string,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: any }> {
  // Usa timezone do usuario para determinar "hoje" corretamente
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });

  // Busca habitos ativos do usuario
  const { data: habits } = await supabase
    .from("habits")
    .select("id, name, icon, current_streak, best_streak")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!habits?.length) {
    return { response: "Voce nao tem habitos ativos. Crie um: *quero habito de exercicio todo dia as 7h*" };
  }

  // Verifica quais ainda nao foram feitos hoje
  const { data: todayLogs } = await supabase
    .from("habit_logs")
    .select("habit_id")
    .eq("user_id", userId)
    .eq("logged_date", today);

  const doneIds = new Set((todayLogs ?? []).map((l: any) => l.habit_id));
  const pending = habits.filter((h: any) => !doneIds.has(h.id));

  if (pending.length === 0) {
    return { response: "🎉 Todos os habitos de hoje ja foram registrados! Continue assim!" };
  }

  // Desambiguação: se múltiplos pendentes, tenta match por nome na mensagem
  let habit: any = null;
  if (pending.length > 1) {
    const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const matched = pending.find((h: any) => {
      const habitName = String(h.name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return normalized.includes(habitName);
    });
    if (matched) {
      habit = matched;
    } else {
      // Sem match claro → mostra lista numerada e pede pra escolher
      const lines = pending.slice(0, 9).map((h: any, i: number) =>
        `*${i + 1}.* ${h.icon ?? "✅"} ${h.name}`
      ).join("\n");
      return {
        response: `Qual hábito você concluiu?\n\n${lines}\n\nResponda com o *número* (1 a ${Math.min(9, pending.length)}) ou o nome do hábito.`,
        pendingAction: "habit_checkin_choose",
        pendingContext: {
          options: pending.slice(0, 9).map((h: any) => ({
            id: h.id,
            name: h.name,
            icon: h.icon,
            current_streak: h.current_streak,
            best_streak: h.best_streak,
          })),
          total_pending: pending.length,
        },
      };
    }
  } else {
    // Só 1 pendente → comportamento antigo (direto)
    habit = pending[0];
  }
  const { error } = await supabase.from("habit_logs").insert({
    habit_id: habit.id,
    user_id: userId,
    logged_date: today,
  });

  if (error) {
    if (error.code === "23505") return { response: "Ja registrado hoje! 👍" };
    console.error("Habit checkin error:", error);
    return { response: "Erro ao registrar. Tente novamente." };
  }

  // Verifica se o dia anterior tinha check-in para validar streak consecutivo
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("sv-SE", { timeZone: userTz });
  const { data: yesterdayLog } = await (supabase.from("habit_logs") as any)
    .select("id")
    .eq("habit_id", habit.id)
    .eq("logged_date", yesterdayStr)
    .maybeSingle();

  // Se ontem nao teve check-in, reseta streak para 1; senao incrementa
  const newStreak = yesterdayLog ? (habit.current_streak || 0) + 1 : 1;
  const bestStreak = Math.max(newStreak, habit.best_streak || 0);
  await supabase.from("habits").update({
    current_streak: newStreak,
    best_streak: bestStreak,
  }).eq("id", habit.id);

  // Mensagem motivacional baseada no streak
  let motivation = "";
  if (newStreak === 1) motivation = "\n\n💪 Primeiro dia! O começo de algo grande.";
  else if (newStreak === 7) motivation = "\n\n🔥 *1 semana seguida!* Incrivel!";
  else if (newStreak === 30) motivation = "\n\n🏆 *30 dias!* Voce e uma maquina!";
  else if (newStreak === 100) motivation = "\n\n👑 *100 DIAS!* Lendario!";
  else if (newStreak % 10 === 0) motivation = `\n\n🎯 *${newStreak} dias seguidos!* Impressionante!`;
  else if (newStreak >= 3) motivation = `\n\n🔥 ${newStreak} dias seguidos!`;

  const remaining = pending.length - 1;
  const remainingText = remaining > 0 ? `\n\n📋 Ainda ${remaining === 1 ? "falta 1 habito" : `faltam ${remaining} habitos`} hoje.` : "\n\n🎉 *Todos os habitos de hoje concluidos!*";

  return { response: `✅ *${habit.icon} ${habit.name}* — registrado!${motivation}${remainingText}` };
}

// ─────────────────────────────────────────────
// RECURRING TRANSACTION HANDLER
// ─────────────────────────────────────────────

/**
 * Calcula a próxima ocorrência de um dia do mês a partir de uma data de referência.
 * Se o dia desejado não existe no mês (ex: 31 em fevereiro), usa o último dia do mês.
 * Garante que nunca pula um mês — corrige o bug do Math.min(day, 28).
 */
function computeNextMonthlyDate(from: Date, dayOfMonth: number): Date {
  // Candidato no mês atual
  const lastDayThisMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  const effectiveDayThis = Math.min(dayOfMonth, lastDayThisMonth);
  const candidateThis = new Date(from.getFullYear(), from.getMonth(), effectiveDayThis);

  // Se o candidato é estritamente futuro, usa ele
  if (candidateThis > from) return candidateThis;

  // Senão, próximo mês (com último-dia-válido como fallback)
  const nextMonthFirstDay = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const lastDayNext = new Date(nextMonthFirstDay.getFullYear(), nextMonthFirstDay.getMonth() + 1, 0).getDate();
  const effectiveDayNext = Math.min(dayOfMonth, lastDayNext);
  return new Date(nextMonthFirstDay.getFullYear(), nextMonthFirstDay.getMonth(), effectiveDayNext);
}

async function handleRecurringCreate(userId: string, message: string): Promise<string> {
  // Busca categorias do usuário (default + custom)
  const { data: userCatsData } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", userId);
  const userCatNames = (userCatsData ?? [])
    .map((c: any) => String(c.name ?? "").toLowerCase().trim())
    .filter(Boolean);
  const DEFAULT_CATS = ["alimentacao", "transporte", "moradia", "saude", "lazer", "educacao", "trabalho", "outros"];
  const seen = new Set<string>();
  const allCats: string[] = [];
  for (const c of [...userCatNames, ...DEFAULT_CATS]) {
    if (!seen.has(c)) { seen.add(c); allCats.push(c); }
  }
  const catList = allCats.map(c => `"${c}"`).join("|");

  // Usa IA pra extrair dados da mensagem
  const prompt = `Extraia de uma frase em português os dados de uma transação financeira recorrente.
Retorne JSON puro (sem markdown): {"description":"nome curto","amount":número,"type":"expense"|"income","category":${catList},"frequency":"daily"|"weekly"|"monthly"|"yearly","day_of_month":número|null}

Exemplos:
- "aluguel 1500 todo dia 5" → {"description":"Aluguel","amount":1500,"type":"expense","category":"moradia","frequency":"monthly","day_of_month":5}
- "salário 8000 todo mês" → {"description":"Salário","amount":8000,"type":"income","category":"trabalho","frequency":"monthly","day_of_month":1}
- "netflix 55.90 mensal" → {"description":"Netflix","amount":55.90,"type":"expense","category":"lazer","frequency":"monthly","day_of_month":null}

Frase: "${message}"`;

  const aiResponse = await chat([{ role: "user", content: prompt }], "Voce extrai dados de transacoes recorrentes. Responda APENAS com JSON valido.");
  let parsed: any;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return "Não entendi. Exemplo: *aluguel 1500 todo dia 5* ou *Netflix 55 reais mensal*";
  }

  if (!parsed.amount || parsed.amount <= 0) {
    return "Não consegui identificar o valor. Exemplo: *aluguel 1500 todo dia 5*";
  }

  // Safety net: se AI retornar categoria não reconhecida, usa "outros"
  if (parsed.category && !seen.has(String(parsed.category).toLowerCase().trim())) {
    parsed.category = "outros";
  }

  // Calcula próxima data — preserva dia 31 usando último dia do mês como fallback
  const now = new Date();
  let nextDate: string;
  let dayOfMonthToSave: number | null = null;

  if (parsed.frequency === "monthly" && parsed.day_of_month) {
    dayOfMonthToSave = parsed.day_of_month;
    const next = computeNextMonthlyDate(now, parsed.day_of_month);
    nextDate = next.toISOString().split("T")[0];
  } else if (parsed.frequency === "weekly") {
    const next = new Date(now);
    next.setDate(now.getDate() + (7 - now.getDay()) % 7 || 7);
    nextDate = next.toISOString().split("T")[0];
  } else if (parsed.frequency === "yearly") {
    const next = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    nextDate = next.toISOString().split("T")[0];
  } else {
    // daily ou fallback
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    nextDate = next.toISOString().split("T")[0];
  }

  const { error } = await supabase.from("recurring_transactions").insert({
    user_id: userId,
    description: parsed.description || "Recorrente",
    amount: parsed.amount,
    type: parsed.type || "expense",
    category: parsed.category || "outros",
    frequency: parsed.frequency || "monthly",
    next_date: nextDate,
    day_of_month: dayOfMonthToSave,
    active: true,
  } as any);

  if (error) {
    console.error("Recurring create error:", error);
    return "⚠️ Erro ao criar transação recorrente. Tente novamente.";
  }

  const freqLabels: Record<string, string> = { daily: "diária", weekly: "semanal", monthly: "mensal", yearly: "anual" };
  const emoji = parsed.type === "income" ? "🟢" : "🔴";
  const typeLabel = parsed.type === "income" ? "Receita" : "Gasto";
  const nextFormatted = new Date(nextDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

  return `✅ *${typeLabel} recorrente criado!*\n\n${emoji} ${parsed.description}\n💰 R$ ${parsed.amount.toFixed(2).replace(".", ",")}\n🔁 Frequência: ${freqLabels[parsed.frequency] || parsed.frequency}\n📅 Próxima cobrança: ${nextFormatted}\n\nSerá registrado automaticamente. Gerencie no app Hey Jarvis.`;
}

// ─────────────────────────────────────────────
// BUDGET HANDLERS
// ─────────────────────────────────────────────

async function handleBudgetSet(userId: string, message: string): Promise<string> {
  const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Extrai valor
  const valueMatch = m.match(/(\d+[\.,]?\d*)\s*(reais|real|r\$|conto|pila)?/);
  if (!valueMatch) return "Não entendi o valor. Exemplo: *quero gastar no máximo 2000 em alimentação*";
  const amount = parseFloat(valueMatch[1].replace(",", "."));
  if (amount <= 0) return "O valor precisa ser positivo.";

  // Extrai categoria
  const catSynonyms: Record<string, string[]> = {
    alimentacao: ["alimentacao", "alimentação", "comida", "restaurante", "mercado", "alimento"],
    transporte: ["transporte", "gasolina", "uber", "onibus", "combustivel"],
    moradia: ["moradia", "aluguel", "casa", "condominio", "luz", "agua"],
    saude: ["saude", "saúde", "remedio", "farmacia", "medico", "hospital"],
    lazer: ["lazer", "diversao", "cinema", "bar", "viagem", "entretenimento"],
    educacao: ["educacao", "educação", "curso", "faculdade", "livro", "escola"],
    trabalho: ["trabalho", "escritorio", "material", "ferramenta"],
    outros: ["outros", "geral"],
  };
  let category = "outros";
  for (const [cat, synonyms] of Object.entries(catSynonyms)) {
    if (synonyms.some(s => m.includes(s))) { category = cat; break; }
  }

  // Upsert no banco
  const { error } = await supabase
    .from("budgets")
    .upsert({
      user_id: userId,
      category,
      amount_limit: amount,
      period: "monthly",
      alert_at_percent: 80,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,category,period" });

  if (error) {
    console.error("Budget set error:", error);
    return "⚠️ Erro ao salvar orçamento. Tente novamente.";
  }

  const catEmojis: Record<string, string> = {
    alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
    lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
  };
  const emoji = catEmojis[category] ?? "📌";
  const catName = category.charAt(0).toUpperCase() + category.slice(1);

  return `✅ *Meta definida!*\n\n${emoji} *${catName}*: máximo *R$ ${amount.toFixed(2).replace(".", ",")}* por mês\n\nVou te avisar quando atingir 80% do limite.`;
}

async function handleBudgetQuery(userId: string, message: string): Promise<string> {
  const { data: budgets } = await supabase
    .from("budgets")
    .select("*")
    .eq("user_id", userId)
    .order("category");

  if (!budgets?.length) {
    return "📊 Você ainda não definiu nenhuma meta de gastos.\n\nExemplo: *quero gastar no máximo 2000 em alimentação*";
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const catEmojis: Record<string, string> = {
    alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
    lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
  };

  let report = "📊 *Seus orçamentos — este mês*\n";

  for (const b of budgets) {
    const { data: monthTx } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "expense")
      .eq("category", b.category)
      .gte("transaction_date", monthStart);

    const spent = (monthTx ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0);
    const limit = Number(b.amount_limit);
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const remaining = limit - spent;
    const emoji = catEmojis[b.category] ?? "📌";
    const catName = b.category.charAt(0).toUpperCase() + b.category.slice(1);

    const bar = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
    report += `\n${emoji} *${catName}*: R$ ${spent.toFixed(2).replace(".", ",")} / R$ ${limit.toFixed(2).replace(".", ",")} ${bar}`;
    if (remaining > 0) {
      report += `\n   Resta: R$ ${remaining.toFixed(2).replace(".", ",")} (${pct.toFixed(0)}%)`;
    } else {
      report += `\n   Estourou: +R$ ${Math.abs(remaining).toFixed(2).replace(".", ",")}`;
    }
  }

  return report;
}

// ─────────────────────────────────────────────
// BUDGET ALERTS — Verifica orçamentos após registrar gasto
// ─────────────────────────────────────────────
async function checkBudgetAlerts(
  userId: string,
  phone: string,
  newTransactions: Array<{ amount: number; type: string; category: string }>
): Promise<void> {
  // Só verifica gastos (não receitas)
  const expenseCategories = [...new Set(newTransactions.filter(t => t.type === "expense").map(t => t.category))];
  if (expenseCategories.length === 0) return;

  // Busca budgets do usuário para as categorias afetadas
  const { data: budgets } = await supabase
    .from("budgets")
    .select("*")
    .eq("user_id", userId)
    .in("category", expenseCategories);

  if (!budgets?.length) return;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const todayStr = now.toISOString().split("T")[0];

  for (const budget of budgets) {
    // Não enviar alerta repetido no mesmo dia
    if (budget.last_alert_date === todayStr) continue;

    // Total gasto no mês nessa categoria
    const { data: monthTx } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "expense")
      .eq("category", budget.category)
      .gte("transaction_date", monthStart);

    const totalSpent = (monthTx ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0);
    const limit = Number(budget.amount_limit);
    const pct = limit > 0 ? (totalSpent / limit) * 100 : 0;
    const alertThreshold = Number(budget.alert_at_percent) || 80;

    const catEmojis: Record<string, string> = {
      alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
      lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
    };
    const emoji = catEmojis[budget.category] ?? "📌";
    const catName = budget.category.charAt(0).toUpperCase() + budget.category.slice(1);

    let alertMsg = "";
    if (pct >= 100) {
      const excess = totalSpent - limit;
      alertMsg = `🚨 *Orçamento estourado!*\n\n${emoji} *${catName}*: R$ ${totalSpent.toFixed(2).replace(".", ",")} de R$ ${limit.toFixed(2).replace(".", ",")}\n💸 Excedeu *R$ ${excess.toFixed(2).replace(".", ",")}*\n\nConsidere ajustar seus gastos ou a meta no app.`;
    } else if (pct >= alertThreshold) {
      const remaining = limit - totalSpent;
      alertMsg = `⚠️ *Atenção com o orçamento!*\n\n${emoji} *${catName}*: R$ ${totalSpent.toFixed(2).replace(".", ",")} de R$ ${limit.toFixed(2).replace(".", ",")} (*${pct.toFixed(0)}%*)\n💰 Resta *R$ ${remaining.toFixed(2).replace(".", ",")}* este mês.`;
    }

    if (alertMsg) {
      await sendText(phone, alertMsg);
      // Marca que já alertou hoje para não repetir
      await supabase
        .from("budgets")
        .update({ last_alert_date: todayStr })
        .eq("id", budget.id);
    }
  }
}

async function handleFinanceRecord(
  userId: string,
  phone: string,
  message: string,
  config: Record<string, unknown> | null,
  userTz = "America/Sao_Paulo"
): Promise<string> {
  // Busca categorias do usuário (default + custom criadas via app)
  // pra que o Jarvis reconheça categorias personalizadas como "Pet", "Criptomoedas" etc
  const { data: userCatsData } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", userId);
  const userCategories = (userCatsData ?? [])
    .map((c: any) => String(c.name ?? "").toLowerCase().trim())
    .filter(Boolean);

  const transactions = await extractTransactions(message, userCategories);

  if (!transactions.length) {
    return "Não consegui identificar os valores. Pode repetir? Ex: *gastei 200 reais de gasolina*";
  }

  // "Hoje" no fuso do usuário (usa profile.timezone — default São Paulo como fallback)
  const todayUserTz = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });

  // ── Separa transações normais das parceladas ──
  const normalTxs = transactions.filter(t => !t.installments || t.installments < 2);
  const installmentTxs = transactions.filter(t => t.installments && t.installments >= 2 && t.installments <= 48);

  // ── INSERT transações normais (comportamento original inalterado) ──
  if (normalTxs.length > 0) {
    const inserts = normalTxs.map((t) => ({
      user_id: userId,
      description: t.description,
      amount: t.amount,
      type: t.type,
      category: t.category,
      source: "whatsapp",
      transaction_date: todayUserTz,
    }));

    const { error } = await supabase.from("transactions").insert(inserts);
    if (error) throw error;

    // Sync Google Sheets (fire-and-forget)
    for (const t of normalTxs) {
      syncGoogleSheets(userId, {
        date: todayUserTz,
        description: t.description,
        amount: t.amount,
        type: t.type,
        category: t.category,
      }).catch(() => {});
    }
  }

  // ── INSERT transações PARCELADAS ──
  const installmentResponses: string[] = [];
  for (const t of installmentTxs) {
    const numInstallments = t.installments!;
    const perInstallment = Math.round((t.amount / numInstallments) * 100) / 100;
    const group = crypto.randomUUID();

    const inserts = [];
    const monthNames: string[] = [];
    for (let i = 0; i < numInstallments; i++) {
      const d = new Date(todayUserTz + "T12:00:00");
      d.setDate(1); // vai pro dia 1 pra evitar overflow de mês
      d.setMonth(d.getMonth() + i);
      // Volta pro dia original (ou último dia do mês se não existir)
      const originalDay = new Date(todayUserTz + "T12:00:00").getDate();
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, lastDay));
      const futureDate = d.toISOString().split("T")[0];

      inserts.push({
        user_id: userId,
        description: `${t.description} (${i + 1}/${numInstallments})`,
        amount: perInstallment,
        type: t.type,
        category: t.category,
        source: "whatsapp",
        transaction_date: futureDate,
        installment_group: group,
        installment_number: i + 1,
        installment_total: numInstallments,
      });

      monthNames.push(d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""));
    }

    const { error } = await (supabase.from("transactions").insert(inserts) as any);
    if (error) throw error;

    // Sync Google Sheets da primeira parcela
    syncGoogleSheets(userId, {
      date: todayUserTz,
      description: `${t.description} (1/${numInstallments})`,
      amount: perInstallment,
      type: t.type,
      category: t.category,
    }).catch(() => {});

    installmentResponses.push(
      `💳 *Compra parcelada registrada!*\n\n` +
      `📝 ${t.description}\n` +
      `💰 Total: R$ ${t.amount.toFixed(2).replace(".", ",")}\n` +
      `🔢 ${numInstallments}x de R$ ${perInstallment.toFixed(2).replace(".", ",")}\n` +
      `📅 ${monthNames[0]} a ${monthNames[monthNames.length - 1]}`
    );
  }

  // ── Verifica orçamentos e envia alertas proativos (fire-and-forget) ──
  checkBudgetAlerts(userId, phone, transactions).catch(err =>
    console.error("[budget-alert] Error:", err)
  );

  // ── Monta resposta ──
  // Se tem SÓ parcelas e nenhuma normal → resposta de parcela
  if (normalTxs.length === 0 && installmentResponses.length > 0) {
    return installmentResponses.join("\n\n");
  }

  // Se tem SÓ normais e nenhuma parcela → resposta original
  if (installmentResponses.length === 0) {
    if (normalTxs.length === 1) {
      const t = normalTxs[0];
      const tpl = t.type === "expense"
        ? (config?.template_expense as string) ?? "🔴 *Gasto registrado{{name_tag}}!*\n📝 {{description}}\n💰 R$ {{amount}}"
        : (config?.template_income as string) ?? "🟢 *Receita registrada{{name_tag}}!*\n📝 {{description}}\n💰 R$ {{amount}}";
      const nick = (config?.user_nickname as string) || "";
      return applyTemplate(tpl, {
        description: t.description,
        amount: t.amount.toFixed(2).replace(".", ","),
        category: t.category,
        type: t.type,
        user_name: nick,
        name_tag: nick ? `, ${nick}` : "",
      });
    }

    const lines = normalTxs.map((t) => {
      const emoji = t.type === "expense" ? "🔴" : "🟢";
      return `${emoji} ${t.description}: *R$ ${t.amount.toFixed(2).replace(".", ",")}*`;
    });
    const total = normalTxs
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);

    const tplMulti = (config?.template_expense_multi as string)
      ?? "✅ *{{count}} gastos registrados{{name_tag}}!*\n\n{{lines}}\n\n💸 *Total: R$ {{total}}*";

    const nickMulti = (config?.user_nickname as string) || "";
    return applyTemplate(tplMulti, {
      count: String(normalTxs.length),
      lines: lines.join("\n"),
      total: total.toFixed(2).replace(".", ","),
      name_tag: nickMulti ? `, ${nickMulti}` : "",
    });
  }

  // Mix de parcelas + normais → combina as respostas
  const normalLine = normalTxs.map((t) => {
    const emoji = t.type === "expense" ? "🔴" : "🟢";
    return `${emoji} ${t.description}: *R$ ${t.amount.toFixed(2).replace(".", ",")}*`;
  }).join("\n");
  return `${normalLine}\n\n${installmentResponses.join("\n\n")}`;
}

// Mapa de sinônimos para categorias
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  alimentacao: ["almoco", "almoço", "comida", "lanche", "janta", "jantar", "cafe", "café", "cafezinho", "restaurante", "mercado", "supermercado", "padaria", "pizza", "hamburguer", "acai", "açaí", "ifood", "delivery", "refeicao", "refeição", "marmita", "sushi", "churrasco", "snack"],
  transporte: ["gasolina", "combustivel", "combustível", "uber", "99", "taxi", "táxi", "onibus", "ônibus", "metro", "metrô", "estacionamento", "pedagio", "pedágio", "carro", "moto", "bicicleta", "patinete"],
  moradia: ["aluguel", "condominio", "condomínio", "luz", "energia", "agua", "água", "internet", "gas", "gás", "iptu", "reforma", "reparo", "faxina"],
  saude: ["remedio", "remédio", "farmacia", "farmácia", "medico", "médico", "consulta", "dentista", "academia", "gym", "plano de saude", "plano", "hospital", "exame"],
  lazer: ["cinema", "netflix", "spotify", "youtube", "jogo", "game", "viagem", "passeio", "show", "teatro", "festa", "bar", "balada", "streaming", "disney", "hbo"],
  educacao: ["escola", "faculdade", "curso", "livro", "material", "apostila", "udemy", "alura", "mensalidade"],
  trabalho: ["escritorio", "escritório", "ferramenta", "equipamento", "software", "assinatura"],
};

function detectCategory(m: string, customCategories: string[] = []): string | null {
  // Normaliza e tokeniza pra evitar falsos positivos (ex: "moto" != "moradia")
  const normalized = m
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = normalized.split(/\s+/);

  // 1) Match direto com categorias custom do usuário (ex: "pet", "criptomoedas")
  //    Prioridade sobre sinônimos hardcoded.
  for (const cat of customCategories) {
    const catNorm = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (!catNorm) continue;
    // Pula categorias que são iguais às defaults (serão cobertas pelos sinônimos)
    if (CATEGORY_SYNONYMS[catNorm]) continue;
    // Match por token exato ou substring multi-word
    if (catNorm.includes(" ") ? normalized.includes(catNorm) : tokens.includes(catNorm)) {
      return cat;
    }
  }

  // 2) Match via sinônimos das categorias default
  for (const [cat, keywords] of Object.entries(CATEGORY_SYNONYMS)) {
    const normalizedKeywords = keywords.map((k) =>
      k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    );
    // Multi-word keywords: substring match. Single-word: exact token match.
    const found = normalizedKeywords.some((k) =>
      k.includes(" ")
        ? normalized.includes(k)
        : tokens.includes(k)
    );
    if (found) return cat;
  }
  return null;
}

async function handleFinanceReport(
  userId: string,
  message: string,
  userTz = "America/Sao_Paulo"
): Promise<{ text: string; chartUrl: string | null }> {
  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Busca categorias custom do usuário para reconhecer em filtros
  const { data: userCatsData } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", userId);
  const userCategoryNames = (userCatsData ?? [])
    .map((c: any) => String(c.name ?? "").toLowerCase().trim())
    .filter(Boolean);

  // Detecta categoria específica na pergunta
  const filterCategory = detectCategory(m, userCategoryNames);

  // Determina período — sempre em BRT para bater com transaction_date salvo
  let startDate: string;
  let endDate: string | null = null;
  let periodLabel: string;
  const now = new Date();
  const nowBRT = now.toLocaleDateString("sv-SE", { timeZone: userTz }); // YYYY-MM-DD em BRT
  const [nowY, nowM] = nowBRT.split("-").map(Number);

  // Nomes de mês → número (0-indexed quando usado com Date)
  const MONTH_NAMES: Record<string, number> = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  const matchedMonth = Object.keys(MONTH_NAMES).find(name => m.includes(name));

  const lastDayOfMonth = (y: number, monthOneIndexed: number) =>
    new Date(y, monthOneIndexed, 0).getDate();

  if (/\b(tudo|todos|total|geral|completo|completa|hist[oó]rico|sempre)\b/.test(m)) {
    // Sem filtro — tudo desde o início
    startDate = "1970-01-01";
    periodLabel = "desde o início";
  } else if (/\bhoje\b/.test(m)) {
    startDate = nowBRT;
    endDate = nowBRT;
    periodLabel = "hoje";
  } else if (/\b(ontem)\b/.test(m)) {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    startDate = y.toLocaleDateString("sv-SE", { timeZone: userTz });
    endDate = startDate;
    periodLabel = "ontem";
  } else if (/\b(semana\s+passada|semana\s+anterior)\b/.test(m)) {
    // Semana passada: 7-13 dias atrás
    const start = new Date(now); start.setDate(now.getDate() - 13);
    const end = new Date(now); end.setDate(now.getDate() - 7);
    startDate = start.toLocaleDateString("sv-SE", { timeZone: userTz });
    endDate = end.toLocaleDateString("sv-SE", { timeZone: userTz });
    periodLabel = "semana passada";
  } else if (/\bsemana\b/.test(m)) {
    // Início da semana atual em BRT
    const startOfWeek = new Date(now);
    const dayNameLong = now.toLocaleDateString("en-US", { timeZone: userTz, weekday: "long" });
    const weekdayMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const dayOfWeek = weekdayMap[dayNameLong] ?? now.getDay();
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startDate = startOfWeek.toLocaleDateString("sv-SE", { timeZone: userTz });
    periodLabel = "esta semana";
  } else if (/\b(m[eê]s\s+passado|m[eê]s\s+anterior)\b/.test(m)) {
    // Mês passado completo
    const prevMonth = nowM === 1 ? 12 : nowM - 1;
    const prevYear = nowM === 1 ? nowY - 1 : nowY;
    startDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    endDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${lastDayOfMonth(prevYear, prevMonth)}`;
    periodLabel = "mês passado";
  } else if (matchedMonth) {
    // Mês específico por nome (ex: "em março", "gastos de abril")
    const monthNum = MONTH_NAMES[matchedMonth];
    const isFuture = monthNum > nowM;
    const year = isFuture ? nowY - 1 : nowY;
    startDate = `${year}-${String(monthNum).padStart(2, "0")}-01`;
    endDate = `${year}-${String(monthNum).padStart(2, "0")}-${lastDayOfMonth(year, monthNum)}`;
    periodLabel = matchedMonth.charAt(0).toUpperCase() + matchedMonth.slice(1) + (year !== nowY ? `/${year}` : "");
  } else if (/\b(ano\s+passado|ano\s+anterior)\b/.test(m)) {
    startDate = `${nowY - 1}-01-01`;
    endDate = `${nowY - 1}-12-31`;
    periodLabel = "ano passado";
  } else if (/\b(ano|anual)\b/.test(m)) {
    startDate = `${nowY}-01-01`;
    periodLabel = "este ano";
  } else if (/\b(m[eê]s)\b/.test(m)) {
    const [year, month] = nowBRT.split("-");
    startDate = `${year}-${month}-01`;
    periodLabel = "este mês";
  } else {
    // Default: este mês
    const [year, month] = nowBRT.split("-");
    startDate = `${year}-${month}-01`;
    periodLabel = "este mês";
  }

  let query = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .gte("transaction_date", startDate)
    .order("transaction_date", { ascending: false });

  // Para "hoje" usa limite superior exato para evitar trazer datas futuras
  if (endDate) {
    query = query.lte("transaction_date", endDate);
  }

  if (filterCategory) {
    query = query.eq("category", filterCategory);
  }

  const { data: transactions, error } = await query;

  console.log(`[finance_report] userId=${userId} startDate=${startDate} endDate=${endDate} filterCat=${filterCategory} rows=${transactions?.length ?? "ERR"} error=${JSON.stringify(error)}`);

  if (error) throw error;

  // Se filtrou por categoria e não achou, mostra categorias que têm dados
  if (!transactions || transactions.length === 0) {
    if (filterCategory) {
      const { data: allTx } = await supabase
        .from("transactions")
        .select("category, amount")
        .eq("user_id", userId)
        .gte("transaction_date", startDate);

      const cats = [...new Set((allTx ?? []).map((t) => t.category))];
      const catEmojis: Record<string, string> = { alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊", lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦" };

      if (cats.length === 0) {
        return { text: `📊 Nenhum gasto registrado para *${periodLabel}* ainda.`, chartUrl: null };
      }
      const catList = cats.map((c) => `${catEmojis[c] ?? "📌"} ${c}`).join(", ");
      return { text: `📊 Não encontrei gastos com *${filterCategory}* em *${periodLabel}*.\n\nCategorias que você tem registros: ${catList}`, chartUrl: null };
    }
    return { text: `📊 Nenhum registro encontrado para *${periodLabel}*.`, chartUrl: null };
  }

  // Relatório de categoria específica
  if (filterCategory) {
    const total = transactions.reduce((s, t) => s + Number(t.amount), 0);
    const catEmoji: Record<string, string> = { alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊", lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦" };
    const emoji = catEmoji[filterCategory] ?? "📌";
    const lines = transactions.slice(0, 5).map((t) =>
      `• ${t.description}: *R$ ${Number(t.amount).toFixed(2).replace(".", ",")}*`
    );
    let r = `${emoji} *${filterCategory.charAt(0).toUpperCase() + filterCategory.slice(1)} — ${periodLabel}*\n\n`;
    r += lines.join("\n");
    if (transactions.length > 5) r += `\n_...e mais ${transactions.length - 5} registro(s)_`;
    r += `\n\n💸 *Total: R$ ${total.toFixed(2).replace(".", ",")}*`;
    return { text: r, chartUrl: null };
  }

  const expenses = transactions.filter((t) => t.type === "expense");
  const incomes = transactions.filter((t) => t.type === "income");

  const totalExpense = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = incomes.reduce((s, t) => s + Number(t.amount), 0);

  // Agrupa por categoria
  const byCategory: Record<string, number> = {};
  for (const t of expenses) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + Number(t.amount);
  }

  const categoryEmojis: Record<string, string> = {
    alimentacao: "🍔",
    transporte: "🚗",
    moradia: "🏠",
    saude: "💊",
    lazer: "🎮",
    educacao: "📚",
    trabalho: "💼",
    outros: "📦",
  };

  const catLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([cat, val]) =>
        `${categoryEmojis[cat] ?? "📌"} ${cat}: *R$ ${val.toFixed(2).replace(".", ",")}*`
    )
    .join("\n");

  let report =
    `📊 *Relatório — ${periodLabel}*\n\n` +
    `🔴 Total de gastos: *R$ ${totalExpense.toFixed(2).replace(".", ",")}*\n`;

  if (totalIncome > 0) {
    report += `🟢 Total de receitas: *R$ ${totalIncome.toFixed(2).replace(".", ",")}*\n`;
    const balance = totalIncome - totalExpense;
    const balanceSign = balance >= 0 ? "+" : "";
    report += `💰 Saldo: *${balanceSign}R$ ${balance.toFixed(2).replace(".", ",")}*\n`;
  }

  if (catLines) {
    report += `\n📂 *Por categoria:*\n${catLines}`;
  }

  // Adiciona status de orçamentos (se houver)
  try {
    const { data: userBudgets } = await supabase
      .from("budgets")
      .select("category, amount_limit")
      .eq("user_id", userId);

    if (userBudgets?.length) {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      let budgetLines = "";
      for (const b of userBudgets) {
        const spent = byCategory[b.category] ?? 0;
        if (spent <= 0) continue;
        const limit = Number(b.amount_limit);
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        const bar = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        budgetLines += `\n${bar} ${b.category}: ${pct.toFixed(0)}% do limite`;
      }
      if (budgetLines) {
        report += `\n\n🎯 *Orçamentos:*${budgetLines}`;
      }
    }
  } catch { /* silently skip budget info */ }

  report += `\n\n📱 Ver detalhes completos no app Hey Jarvis`;

  // Gera URL do grafico doughnut (nao-bloqueante: se falhar, envia so texto)
  let chartUrl: string | null = null;
  try {
    chartUrl = await generateExpenseChartUrl({
      byCategory,
      periodLabel,
      totalExpense,
    });
  } catch (err) {
    console.error("Chart generation failed:", err);
  }

  return { text: report, chartUrl };
}

// ─────────────────────────────────────────────
// CATEGORY LIST + FINANCE DELETE HANDLERS (Onda 2)
// ─────────────────────────────────────────────

/** Lista categorias do usuário com totais gastos neste mês */
/** Lista compras parceladas ativas (com parcelas restantes) */
async function handleInstallmentQuery(userId: string): Promise<string> {
  // Busca parcelas futuras (pendentes) agrupadas por installment_group
  const today = new Date().toLocaleDateString("sv-SE");
  const { data: parcelas } = await (supabase
    .from("transactions")
    .select("installment_group, description, amount, installment_number, installment_total, transaction_date")
    .eq("user_id", userId)
    .not("installment_group", "is", null)
    .gte("transaction_date", today)
    .order("transaction_date", { ascending: true }) as any);

  if (!parcelas || parcelas.length === 0) {
    return "💳 Você não tem parcelas ativas no momento.";
  }

  // Agrupa por installment_group
  const groups: Record<string, typeof parcelas> = {};
  for (const p of parcelas) {
    const g = p.installment_group;
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  }

  const lines: string[] = [];
  for (const [, items] of Object.entries(groups)) {
    const first = items[0];
    // Extrai nome base (sem "1/3")
    const baseName = first.description.replace(/\s*\(\d+\/\d+\)\s*$/, "");
    const total = first.installment_total;
    const remaining = items.length;
    const paid = total - remaining;
    const perInstallment = Number(first.amount).toFixed(2).replace(".", ",");
    const totalAmount = (Number(first.amount) * total).toFixed(2).replace(".", ",");
    const nextDate = new Date(items[0].transaction_date + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

    lines.push(
      `💳 *${baseName}*\n` +
      `   R$ ${totalAmount} em ${total}x de R$ ${perInstallment}\n` +
      `   ✅ ${paid} paga${paid !== 1 ? "s" : ""} · ⏳ ${remaining} restante${remaining !== 1 ? "s" : ""}\n` +
      `   📅 Próxima: ${nextDate}`
    );
  }

  return `💳 *Suas parcelas ativas:*\n\n${lines.join("\n\n")}`;
}

async function handleCategoryList(userId: string): Promise<string> {
  const { data: cats } = await supabase
    .from("categories")
    .select("name, icon")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (!cats || cats.length === 0) {
    return "📂 Você ainda não tem categorias cadastradas. Elas são criadas automaticamente quando você registra gastos.\n\nTente: _gastei 50 reais no mercado_";
  }

  // Totais do mês por categoria (usa BRT)
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: txs } = await supabase
    .from("transactions")
    .select("category, amount")
    .eq("user_id", userId)
    .eq("type", "expense")
    .gte("transaction_date", monthStart);

  const totals: Record<string, number> = {};
  for (const t of txs ?? []) {
    const k = String(t.category ?? "").toLowerCase();
    totals[k] = (totals[k] ?? 0) + Number(t.amount);
  }

  const lines = cats.map((c: any) => {
    const icon = c.icon ?? "📂";
    const total = totals[String(c.name).toLowerCase()] ?? 0;
    const totalStr = total > 0
      ? ` — R$ ${total.toFixed(2).replace(".", ",")}`
      : "";
    return `${icon} *${c.name}*${totalStr}`;
  });

  return `📂 *Suas categorias*\n\n${lines.join("\n")}\n\n_Totais referentes a este mês_`;
}

/** Primeira etapa: tenta achar a transação a deletar. Se há múltiplas, mostra lista pra escolher. */
async function handleFinanceDelete(
  userId: string,
  message: string,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: any }> {
  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Extrai valor explícito: "50 reais", "R$ 200", "150.50"
  const amountMatch = m.match(/\b(\d+(?:[.,]\d{1,2})?)\s*(reais?|r\$|rs|\$)?/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(",", ".")) : null;

  // Detecta "última"/"ultimo"/"recente"
  const wantsLast = /\b(ultima?|ultimo|ultimas?|ultimos|recente|mais recente)\b/.test(m);

  // Busca transações do usuário
  let query = supabase
    .from("transactions")
    .select("id, description, amount, type, category, transaction_date, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (amount !== null && !isNaN(amount)) {
    // Busca por valor exato (tolerância de 1 centavo para lidar com float)
    query = query.gte("amount", amount - 0.01).lte("amount", amount + 0.01);
  }

  const { data: txs, error } = await query;

  if (error || !txs || txs.length === 0) {
    if (amount !== null) {
      return { response: `🔍 Não encontrei nenhuma transação de *R$ ${amount.toFixed(2).replace(".", ",")}*. Pode verificar no app e tentar de novo?` };
    }
    return { response: "🔍 Não encontrei transações pra apagar. Você ainda não registrou nada ou já apagou tudo." };
  }

  // Se só tem 1, ou usuário pediu "a última" → deleta direto
  if (txs.length === 1 || (wantsLast && txs.length > 0)) {
    const t: any = txs[0];
    // Armazena no pending_context pra confirmar antes de deletar
    const emoji = t.type === "expense" ? "🔴" : "🟢";
    return {
      response: `Quer mesmo apagar essa transação?\n\n${emoji} *${t.description}*\n💰 R$ ${Number(t.amount).toFixed(2).replace(".", ",")}\n📂 ${t.category}\n📅 ${new Date(t.transaction_date + "T12:00:00").toLocaleDateString("pt-BR")}\n\nResponda *sim* pra apagar ou *não* pra cancelar.`,
      pendingAction: "finance_delete_confirm",
      pendingContext: { transaction_ids: [t.id], single: true },
    };
  }

  // Múltiplas transações → mostra lista numerada pra escolher
  const lines = txs.slice(0, 5).map((t: any, i: number) => {
    const emoji = t.type === "expense" ? "🔴" : "🟢";
    const dateStr = new Date(t.transaction_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    return `*${i + 1}.* ${emoji} ${t.description} — R$ ${Number(t.amount).toFixed(2).replace(".", ",")} (${dateStr})`;
  });

  const extraMsg = txs.length > 5 ? `\n\n_Mostrando 5 mais recentes de ${txs.length} encontradas._` : "";

  return {
    response: `🔍 Encontrei *${txs.length}* transação(ões). Qual você quer apagar?\n\n${lines.join("\n")}${extraMsg}\n\nResponda com o *número* da transação (1 a ${Math.min(5, txs.length)}).`,
    pendingAction: "finance_delete_confirm",
    pendingContext: {
      transaction_ids: txs.slice(0, 5).map((t: any) => t.id),
      options: txs.slice(0, 5).map((t: any) => ({
        id: t.id,
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
      })),
      single: false,
    },
  };
}

/** Segunda etapa: confirma (sim/não) ou escolhe número da lista */
async function handleFinanceDeleteConfirm(
  userId: string,
  message: string,
  session: Record<string, unknown>
): Promise<{ response: string; pendingAction: string | null; pendingContext: any }> {
  const ctx = (session.pending_context ?? {}) as any;
  const m = message.toLowerCase().trim();

  // Cancelar o fluxo
  if (/^(nao|n|cancela|cancelar|deixa|esquece|nope|nada)\b/.test(m)) {
    return { response: "✅ Ok, não apaguei nada.", pendingAction: null, pendingContext: null };
  }

  // Caso "single": confirma com sim/ok → deleta
  if (ctx.single) {
    if (/^(sim|s|ok|confirmar|pode|pode ser|apaga|apagar|deleta|deletar|isso|confirma)\b/.test(m)) {
      const [idToDelete] = ctx.transaction_ids ?? [];
      if (!idToDelete) return { response: "⚠️ Erro: transação não encontrada.", pendingAction: null, pendingContext: null };
      const { error } = await supabase.from("transactions").delete().eq("id", idToDelete).eq("user_id", userId);
      if (error) return { response: "⚠️ Erro ao apagar. Tente de novo.", pendingAction: null, pendingContext: null };
      return { response: "🗑️ *Transação apagada!*", pendingAction: null, pendingContext: null };
    }
    // Resposta ambígua → mantém o pending
    return {
      response: "Não entendi. Responda *sim* pra apagar ou *não* pra cancelar.",
      pendingAction: "finance_delete_confirm",
      pendingContext: ctx,
    };
  }

  // Caso "múltiplas": usuário escolhe número
  const numMatch = m.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    const options = (ctx.options ?? []) as Array<{ id: string; description: string; amount: number; type: string }>;
    if (idx < 0 || idx >= options.length) {
      return {
        response: `Número inválido. Escolha entre 1 e ${options.length}.`,
        pendingAction: "finance_delete_confirm",
        pendingContext: ctx,
      };
    }
    const chosen = options[idx];
    const { error } = await supabase.from("transactions").delete().eq("id", chosen.id).eq("user_id", userId);
    if (error) return { response: "⚠️ Erro ao apagar. Tente de novo.", pendingAction: null, pendingContext: null };
    const emoji = chosen.type === "expense" ? "🔴" : "🟢";
    return {
      response: `🗑️ *Transação apagada!*\n\n${emoji} ${chosen.description} — R$ ${chosen.amount.toFixed(2).replace(".", ",")}`,
      pendingAction: null,
      pendingContext: null,
    };
  }

  // Cancelar com texto não-numérico
  if (/^(nao|n|cancela|cancelar|deixa|esquece)/.test(m)) {
    return { response: "✅ Ok, não apaguei nada.", pendingAction: null, pendingContext: null };
  }

  return {
    response: `Escolha o *número* da transação que quer apagar (1 a ${(ctx.options ?? []).length}) ou diga *cancela*.`,
    pendingAction: "finance_delete_confirm",
    pendingContext: ctx,
  };
}

// ─────────────────────────────────────────────
// NOTES DELETE HANDLERS (Onda 4)
// ─────────────────────────────────────────────

/** Primeira etapa: tenta achar a nota a deletar. Se há múltiplas, mostra lista. */
/** Lista as últimas anotações do usuário */
async function handleNotesList(userId: string): Promise<string> {
  const { data: notes } = await supabase
    .from("notes")
    .select("id, title, content, created_at, source")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!notes || notes.length === 0) {
    return "📝 Você ainda não tem anotações salvas.\n\nPra criar uma, me diga algo como:\n_\"anota que preciso comprar leite\"_\n_\"salva isso: reunião com João dia 15\"_";
  }

  const lines = notes.map((n: any, i: number) => {
    const dateStr = new Date(n.created_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    const sourceBadge = (n.source === "whatsapp" || n.source === "whatsapp_forward") ? " 📱" : "";

    let display = "";
    if (n.title) {
      display = `*${n.title}*`;
      if (n.content && n.content !== n.title) {
        display += `\n${n.content}`;
      }
    } else if (n.content) {
      display = n.content;
    } else {
      display = "_Sem conteúdo_";
    }

    return `*${i + 1}.* ${display}${sourceBadge} — ${dateStr}`;
  });

  return `📝 *Suas anotações (${notes.length} mais recentes):*\n\n${lines.join("\n\n")}\n\n_Pra apagar, diga "apaga a nota sobre X"._`;
}

async function handleNotesDelete(
  userId: string,
  message: string,
): Promise<{ response: string; pendingAction?: string; pendingContext?: any }> {
  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Detecta "última" pra pegar a mais recente sem ambiguidade
  const wantsLast = /\b(ultima?|ultimo|ultimas?|ultimos|recente|mais recente)\b/.test(m);

  // Extrai keyword após "sobre", "de", "da", "do" ou direto após "nota/anotacao"
  const keywordMatch = m.match(/(?:sobre|de|da|do)\s+([a-z0-9\s\-]+?)(?:\s*$|\s+(?:a|o|que|isso))/) ||
    m.match(/(?:nota|anotacao)\s+([a-z0-9\s\-]{3,})$/);
  const keyword = keywordMatch ? keywordMatch[1].trim() : null;

  // Palavras significativas (>2 chars, sem stop words)
  const STOP = new Set(["de","da","do","dos","das","um","uma","que","pra","pro","para","com","sem","por","sobre","isso","esse","essa","meu","minha","meus","minhas","nos","nas","num","numa"]);
  const keyWords = keyword
    ? keyword.split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, "")).filter(w => w.length > 2 && !STOP.has(w))
    : [];

  let query = supabase
    .from("notes")
    .select("id, title, content, created_at, source")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  // Busca pela primeira palavra significativa para trazer candidatos
  if (keyWords.length > 0) {
    const anchor = sanitizeForFilter(keyWords[0]);
    if (anchor) {
      query = query.or(`title.ilike.%${anchor}%,content.ilike.%${anchor}%`);
    }
  }

  const { data: rawNotes, error } = await query;

  // Filtra client-side: mantém só notas que contenham TODAS as palavras-chave em title+content
  const notes = (rawNotes ?? []).filter((n: any) => {
    if (keyWords.length <= 1) return true;
    const haystack = `${n.title ?? ""} ${n.content ?? ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
    return keyWords.every(w => haystack.includes(w));
  });

  if (error || notes.length === 0) {
    if (keyword) {
      return { response: `🔍 Não encontrei nenhuma anotação com "${keyword}". Verifique no app e tente de novo.` };
    }
    return { response: "🔍 Você ainda não tem anotações pra apagar." };
  }

  // Se só tem 1, ou usuário pediu "a última" → confirma direto
  if (notes.length === 1 || (wantsLast && notes.length > 0)) {
    const n: any = notes[0];
    const dateStr = new Date(n.created_at).toLocaleDateString("pt-BR");
    const preview = (n.content ?? "").slice(0, 80);
    return {
      response: `Quer mesmo apagar essa anotação?\n\n📝 *${n.title || "Anotação"}*\n${preview}${preview.length >= 80 ? "..." : ""}\n📅 ${dateStr}\n\nResponda *sim* pra apagar ou *não* pra cancelar.`,
      pendingAction: "notes_delete_confirm",
      pendingContext: { note_ids: [n.id], single: true },
    };
  }

  // Múltiplas notas → lista numerada
  const lines = notes.slice(0, 5).map((n: any, i: number) => {
    const dateStr = new Date(n.created_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    const preview = (n.title || n.content || "").slice(0, 50);
    return `*${i + 1}.* 📝 ${preview} (${dateStr})`;
  });

  const extraMsg = notes.length > 5 ? `\n\n_Mostrando 5 de ${notes.length}._` : "";

  return {
    response: `🔍 Encontrei *${notes.length}* anotação(ões). Qual apagar?\n\n${lines.join("\n")}${extraMsg}\n\nResponda com o *número* (1 a ${Math.min(5, notes.length)}).`,
    pendingAction: "notes_delete_confirm",
    pendingContext: {
      note_ids: notes.slice(0, 5).map((n: any) => n.id),
      options: notes.slice(0, 5).map((n: any) => ({
        id: n.id,
        title: n.title || "Anotação",
        preview: (n.content ?? "").slice(0, 50),
      })),
      single: false,
    },
  };
}

/** Segunda etapa: confirma (sim/não) ou escolhe número da lista */
async function handleNotesDeleteConfirm(
  userId: string,
  message: string,
  session: Record<string, unknown>,
): Promise<{ response: string; pendingAction: string | null; pendingContext: any }> {
  const ctx = (session.pending_context ?? {}) as any;
  const m = message.toLowerCase().trim();

  // Cancelar
  if (/^(nao|n|cancela|cancelar|deixa|esquece|nope|nada)\b/.test(m)) {
    return { response: "✅ Ok, não apaguei nada.", pendingAction: null, pendingContext: null };
  }

  // Caso "single": sim/ok → deleta
  if (ctx.single) {
    if (/^(sim|s|ok|confirmar|pode|pode ser|apaga|apagar|deleta|deletar|isso|confirma)\b/.test(m)) {
      const [id] = ctx.note_ids ?? [];
      if (!id) return { response: "⚠️ Erro: nota não encontrada.", pendingAction: null, pendingContext: null };
      const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
      if (error) return { response: "⚠️ Erro ao apagar. Tente de novo.", pendingAction: null, pendingContext: null };
      return { response: "🗑️ *Anotação apagada!*", pendingAction: null, pendingContext: null };
    }
    return {
      response: "Não entendi. Responda *sim* pra apagar ou *não* pra cancelar.",
      pendingAction: "notes_delete_confirm",
      pendingContext: ctx,
    };
  }

  // Caso "múltiplas": número da lista
  const numMatch = m.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    const options = (ctx.options ?? []) as Array<{ id: string; title: string; preview: string }>;
    if (idx < 0 || idx >= options.length) {
      return {
        response: `Número inválido. Escolha entre 1 e ${options.length}.`,
        pendingAction: "notes_delete_confirm",
        pendingContext: ctx,
      };
    }
    const chosen = options[idx];
    const { error } = await supabase.from("notes").delete().eq("id", chosen.id).eq("user_id", userId);
    if (error) return { response: "⚠️ Erro ao apagar. Tente de novo.", pendingAction: null, pendingContext: null };
    return {
      response: `🗑️ *Anotação apagada!*\n\n📝 ${chosen.title}`,
      pendingAction: null,
      pendingContext: null,
    };
  }

  return {
    response: `Escolha o *número* da anotação que quer apagar (1 a ${(ctx.options ?? []).length}) ou diga *cancela*.`,
    pendingAction: "notes_delete_confirm",
    pendingContext: ctx,
  };
}

// Mapa de cores por tipo de evento
const EVENT_TYPE_COLORS: Record<string, string> = {
  compromisso: "#3b82f6",
  reuniao: "#8b5cf6",
  consulta: "#22c55e",
  evento: "#f97316",
  tarefa: "#14b8a6",
};

// Mapa de emojis por tipo de evento
const EVENT_TYPE_EMOJIS: Record<string, string> = {
  compromisso: "📌",
  reuniao: "🤝",
  consulta: "🏥",
  evento: "🎉",
  tarefa: "✏️",
};

// Detecta recorrência a partir de texto normalizado (sem acentos, lowercase)
// Retorna { recurrence, recurrence_value } ou null se não detectar
function detectRecurrenceFromText(
  normMsg: string,
  remindAt: Date
): { recurrence: string; recurrence_value: number | null } | null {
  if (/todo dia\b|todos os dias|diariamente|cada dia|sempre que|todo dia de/.test(normMsg))
    return { recurrence: "daily", recurrence_value: null };
  if (/toda segunda|toda segunda.feira/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 1 };
  if (/toda terca|toda terca.feira/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 2 };
  if (/toda quarta|toda quarta.feira/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 3 };
  if (/toda quinta|toda quinta.feira/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 4 };
  if (/toda sexta|toda sexta.feira/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 5 };
  if (/todo sabado|todo fim de semana/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 6 };
  if (/todo domingo/.test(normMsg)) return { recurrence: "weekly", recurrence_value: 0 };
  if (/toda semana|semanalmente|todas as semanas/.test(normMsg))
    return { recurrence: "weekly", recurrence_value: remindAt.getDay() };
  if (/todo mes|mensalmente|todos os meses/.test(normMsg)) {
    const dayMatch = normMsg.match(/dia (\d{1,2})/);
    if (dayMatch) return { recurrence: "day_of_month", recurrence_value: parseInt(dayMatch[1]) };
    return { recurrence: "monthly", recurrence_value: null };
  }
  const dayOfMonthMatch = normMsg.match(/todo dia (\d{1,2})\b/);
  if (dayOfMonthMatch) return { recurrence: "day_of_month", recurrence_value: parseInt(dayOfMonthMatch[1]) };
  // "a cada X horas" / "de X em X horas" / "todo X horas"
  const hourlyMatch = normMsg.match(/a cada (\d+)\s*hora|de (\d+) em \2\s*hora|todo (\d+)\s*hora|a cada hora\b/);
  if (hourlyMatch) {
    const hours = parseInt(hourlyMatch[1] ?? hourlyMatch[2] ?? hourlyMatch[3] ?? "1");
    return { recurrence: "hourly", recurrence_value: isNaN(hours) ? 1 : hours };
  }
  return null;
}

// isReminderDecline, isReminderAtTime, isReminderAccept, parseMinutes imported from ../_shared/classify.ts

// Converte "HH:MM" em minutos totais desde meia-noite
function timeToMinutes(time: string): number {
  const parts = time.slice(0, 5).split(":");
  return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
}

// Verifica se há conflito de horário com eventos existentes
async function checkTimeConflict(
  userId: string,
  date: string,
  time: string,
  endTime: string | null | undefined
): Promise<{ title: string; event_time: string } | null> {
  const { data: existing } = await supabase
    .from("events")
    .select("id, title, event_time, end_time, event_type")
    .eq("user_id", userId)
    .eq("event_date", date)
    .eq("status", "pending")
    .not("event_time", "is", null);

  if (!existing || existing.length === 0) return null;

  const newStart = timeToMinutes(time);
  // Assume 60 min de duração se end_time não fornecido
  const newEnd = endTime ? timeToMinutes(endTime) : newStart + 60;

  for (const ev of existing) {
    const evStart = timeToMinutes(ev.event_time.slice(0, 5));
    const evEnd = ev.end_time ? timeToMinutes(ev.end_time.slice(0, 5)) : evStart + 60;

    // Verificação de sobreposição: start1 < end2 AND start2 < end1
    if (newStart < evEnd && evStart < newEnd) {
      return { title: ev.title, event_time: ev.event_time.slice(0, 5) };
    }
  }

  return null;
}

// Detecta se o usuário quer um evento recorrente ("todo dia", "toda segunda", etc.)
function detectEventRecurrence(msg: string): { type: string; weekday?: number } | null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/todo(s)?\s*(os)?\s*dia(s)?|diariamente|todo\s+dia/.test(m)) return { type: "daily" };
  const weekdayMap: Record<string, number> = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  };
  for (const [day, num] of Object.entries(weekdayMap)) {
    if (new RegExp(`toda(s)?\\s*(as)?\\s*${day}`).test(m)) return { type: "weekly", weekday: num };
  }
  if (/toda\s+semana|semanalmente/.test(m)) return { type: "weekly" };
  if (/todo\s+mes|mensalmente/.test(m)) return { type: "monthly" };
  return null;
}

// Gera as datas de ocorrência futuras para um evento recorrente
function generateRecurrenceDates(startDate: string, type: string, weekday?: number, count = 1): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T12:00:00");

  if (type === "daily") {
    for (let i = 1; i <= 29; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
  } else if (type === "weekly") {
    const targetDay = weekday ?? start.getDay();
    let d = new Date(start);
    d.setDate(start.getDate() + 7);
    for (let i = 0; i < 7; i++) {
      // Ensure correct weekday
      while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
      dates.push(d.toISOString().split("T")[0]);
      d = new Date(d);
      d.setDate(d.getDate() + 7);
    }
  } else if (type === "monthly") {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
  }
  return dates;
}

async function handleAgendaCreate(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null,
  language = "pt-BR",
  userNickname: string | null = null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = todayInTz(userTz);

  // Recupera contexto pendente de follow-up
  const context = (session?.pending_context as Record<string, unknown>) ?? {};
  const partial = (context.partial as Record<string, unknown>) ?? {};
  const step = (context.step as string) ?? null;

  // ─── STEP: waiting_reminder_answer ───
  // Usuário está respondendo à oferta de lembrete
  if (step === "waiting_reminder_answer") {
    const recurrenceFromCtx = context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : undefined;
    const msgLowRem = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Mapeamento de button IDs para minutos (agenda)
    const agendaButtonMap: Record<string, number | null> = {
      "button:advance_15min": 15,
      "button:advance_30min": 30,
      "button:advance_1h":    60,
      "button:advance_confirm_no": 0,   // "Só na hora"
      "1": 15, "2": 30, "3": 60,        // fallback para texto numerado (Baileys)
    };
    if (agendaButtonMap[msgLowRem] !== undefined) {
      const mins = agendaButtonMap[msgLowRem];
      const finalDataBtn = { ...partial, reminder_minutes: mins } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalDataBtn, recurrenceFromCtx, language, userNickname, userTz);
    }
    if (msgLowRem === "button:advance_confirm_yes" || msgLowRem === "1" || isReminderAccept(message)) {
      // Aceitou — envia botões de tempo
      sendButtons(
        phone,
        "Com quanto tempo antes? ⏱️",
        `Lembrete para: "${(partial as Record<string,unknown>).title ?? "evento"}"`,
        [
          { id: "advance_15min", text: "15 minutos" },
          { id: "advance_30min", text: "30 minutos" },
          { id: "advance_1h",    text: "1 hora" },
        ]
      ).catch(() => {});
      return {
        response: "",
        pendingAction: "agenda_create",
        pendingContext: { partial, step: "waiting_reminder_minutes" },
      };
    }
    // "só na hora" ou "não precisa"
    if (isReminderAtTime(message)) {
      const finalData = { ...partial, reminder_minutes: 0 } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname, userTz);
    }
    if (isReminderDecline(message)) {
      const finalData = { ...partial, reminder_minutes: null } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname, userTz);
    }
    // Já veio com tempo especificado (ex: "30 minutos antes", "2 horas antes")
    const minutesInAnswer = parseMinutes(message);
    if (minutesInAnswer !== null && message.match(/\d|hora|minuto|meia/)) {
      const finalData = { ...partial, reminder_minutes: minutesInAnswer } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname, userTz);
    }
    // Resposta ambígua — reenvia botões
    sendButtons(
      phone,
      "Quer que eu te lembre antes? ⏱️",
      `Evento: "${(partial as Record<string,unknown>).title ?? "evento"}"`,
      [
        { id: "advance_confirm_yes", text: "⏰ Sim, me avisa" },
        { id: "advance_confirm_no",  text: "✅ Só na hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_create",
      pendingContext: { partial, step: "waiting_reminder_answer" },
    };
  }

  // ─── STEP: waiting_reminder_minutes ───
  // Usuário está informando com quanto tempo de antecedência quer o lembrete
  if (step === "waiting_reminder_minutes") {
    const msgLowMin = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const buttonMinMap: Record<string, number> = {
      "button:advance_15min": 15,
      "button:advance_30min": 30,
      "button:advance_1h":    60,
      "button:advance_2h":    120,
      "1": 15, "2": 30, "3": 60,   // fallback para texto numerado (Baileys)
    };
    const btnMin = buttonMinMap[msgLowMin];
    if (btnMin !== undefined) {
      const recurrenceFromCtxMin2 = context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : undefined;
      const finalDataBtn2 = { ...partial, reminder_minutes: btnMin } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalDataBtn2, recurrenceFromCtxMin2, language, userNickname, userTz);
    }
    const minutes = parseMinutes(message);
    if (minutes !== null) {
      const recurrenceFromCtxMin = context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : undefined;
      const finalData = { ...partial, reminder_minutes: minutes } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtxMin, language, userNickname, userTz);
    }
    // Não entendeu — reenvia botões
    sendButtons(
      phone,
      "Com quanto tempo antes? ⏱️",
      `Lembrete para: "${(partial as Record<string,unknown>).title ?? "evento"}"`,
      [
        { id: "advance_15min", text: "15 minutos" },
        { id: "advance_30min", text: "30 minutos" },
        { id: "advance_1h",    text: "1 hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_create",
      pendingContext: { partial, step: "waiting_reminder_minutes" },
    };
  }

  // ─── STEP: waiting_title ───
  // Usuário está fornecendo o título do evento
  if (step === "waiting_title") {
    const titleProvided = message.trim();
    if (!titleProvided || titleProvided.length < 2) {
      return {
        response: "Preciso de um nome para o evento. Ex: _Reunião com João_, _Dentista_, _Academia_",
        pendingAction: "agenda_create",
        pendingContext: { partial, step: "waiting_title" },
      };
    }
    // Injeta o título no partial e prossegue com a criação
    const recurrenceFromCtxTitle = context._recurrence
      ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined }
      : undefined;
    const dataWithTitle = { ...partial, title: titleProvided } as unknown as ExtractedEvent;
    // Se ainda falta horário, pede
    if (!dataWithTitle.time) {
      return {
        response: `Certo! *${titleProvided}* — qual o horário? ⏰\n_Ex: 14h, 14:30, às 15h_`,
        pendingAction: "agenda_create",
        pendingContext: {
          partial: dataWithTitle,
          step: "waiting_time",
          _recurrence: recurrenceFromCtxTitle?.type,
          _recurrence_weekday: recurrenceFromCtxTitle?.weekday,
        },
      };
    }
    // Verifica conflito antes de criar
    const conflict = await checkTimeConflict(userId, dataWithTitle.date, dataWithTitle.time, dataWithTitle.end_time);
    if (conflict) {
      return {
        response: `⚠️ *Conflito de horário!*\nVocê já tem *${conflict.title}* às ${conflict.event_time}.\n\nO que prefere?\n1️⃣ Marcar assim mesmo\n2️⃣ Mudar o horário\n3️⃣ Cancelar`,
        pendingAction: "agenda_create",
        pendingContext: { partial: dataWithTitle, step: "conflict_resolution" },
      };
    }
    return await createEventAndConfirm(userId, phone, dataWithTitle, recurrenceFromCtxTitle, language, userNickname, userTz);
  }

  // ─── STEP: conflict_resolution ───
  // Usuário está resolvendo um conflito de horário
  if (step === "conflict_resolution") {
    const savedPartial = context.partial as ExtractedEvent;
    const m = message
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    // Opção 1: Marcar assim mesmo
    if (/^1$|marcar assim|deixa assim|pode marcar|cria assim|manter|sim|claro|pode/.test(m)) {
      // Se ainda precisa perguntar sobre lembrete
      if (context.reminder_pending) {
        sendButtons(
          phone,
          "Quer que eu te lembre antes? ⏱️",
          `Evento: "${(savedPartial as Record<string,unknown>).title ?? "evento"}"`,
          [
            { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
            { id: "advance_confirm_no",  text: "✅ Só na hora" },
          ]
        ).catch(() => {});
        return {
          response: "",
          pendingAction: "agenda_create",
          pendingContext: { partial: savedPartial, step: "waiting_reminder_answer" },
        };
      }
      return await createEventAndConfirm(userId, phone, savedPartial, undefined, language, userNickname, userTz);
    }

    // Opção 2: Mudar horário
    if (/^2$|mudar|trocar|outro hor|alterar hor|novo hor|muda|troca/.test(m)) {
      return {
        response: "Qual o novo horário? ⏰\n_Ex: 15:00 ou 15h30_",
        pendingAction: "agenda_create",
        pendingContext: {
          partial: { ...savedPartial, time: undefined, end_time: undefined },
          step: "waiting_time",
          reminder_pending: context.reminder_pending,
        },
      };
    }

    // Opção 3: Cancelar
    if (/^3$|^nao$|^não$|^cancelar?$|^desist|^nao quero/.test(m)) {
      return { response: "Ok! Evento não criado. Se quiser agendar outro horário, é só me dizer. 👍" };
    }

    // Usuário digitou um horário diretamente
    const timeMatch = message.match(/(\d{1,2})[h:](\d{0,2})/);
    if (timeMatch) {
      const hh = timeMatch[1].padStart(2, "0");
      const mm = (timeMatch[2] || "00").padStart(2, "0");
      const newTime = `${hh}:${mm}`;
      const newData = { ...savedPartial, time: newTime, end_time: undefined } as ExtractedEvent;

      // Verifica conflito para o novo horário também
      const conflict = await checkTimeConflict(userId, newData.date, newTime, null);
      if (conflict) {
        return {
          response: `⚠️ Esse horário também conflita com *${conflict.title}* às ${conflict.event_time}.\n\nQuer:\n1️⃣ Marcar assim mesmo\n2️⃣ Tentar outro horário\n3️⃣ Cancelar`,
          pendingAction: "agenda_create",
          pendingContext: { partial: newData, step: "conflict_resolution", reminder_pending: context.reminder_pending },
        };
      }

      if (context.reminder_pending) {
        sendButtons(
          phone,
          "Horário atualizado! Quer que eu te lembre? ⏱️",
          `Evento: "${(newData as Record<string,unknown>).title ?? "evento"}"`,
          [
            { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
            { id: "advance_confirm_no",  text: "✅ Só na hora" },
          ]
        ).catch(() => {});
        return {
          response: "",
          pendingAction: "agenda_create",
          pendingContext: { partial: newData, step: "waiting_reminder_answer" },
        };
      }
      return await createEventAndConfirm(userId, phone, newData, undefined, language, userNickname, userTz);
    }

    // Resposta ambígua
    return {
      response: "Por favor escolha:\n1️⃣ Marcar assim mesmo\n2️⃣ Mudar o horário\n3️⃣ Cancelar",
      pendingAction: "agenda_create",
      pendingContext: { ...context },
    };
  }

  // ─── EXTRAÇÃO PRINCIPAL (step null ou waiting_time) ───
  // Detecta recorrência da mensagem original (apenas no step inicial)
  const recurrence = step === null ? detectEventRecurrence(message) : (
    context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : null
  );

  // Combina contexto parcial com nova mensagem para a IA
  let combinedMessage: string;
  if (Object.keys(partial).length > 0) {
    combinedMessage = `Dados parciais já extraídos: ${JSON.stringify(partial)}\nResposta do usuário: ${message}`;
  } else {
    combinedMessage = message;
  }

  let extracted: Awaited<ReturnType<typeof extractEvent>>;
  try {
    extracted = await extractEvent(combinedMessage, today, language);
  } catch (err) {
    console.error("extractEvent failed:", err);
    return {
      response: "Não consegui entender o evento. Pode repetir com mais detalhes?\n\nEx: _Reunião amanhã às 15h_ ou _Médico dia 10 às 9h_",
    };
  }

  // Se a IA pede clarificação de título ou horário → continua o fluxo
  if (extracted.needs_clarification && extracted.clarification_type === "title") {
    return {
      response: extracted.needs_clarification,
      pendingAction: "agenda_create",
      pendingContext: { partial: extracted, step: "waiting_title" },
    };
  }

  if (extracted.needs_clarification && extracted.clarification_type === "time") {
    return {
      response: extracted.needs_clarification,
      pendingAction: "agenda_create",
      pendingContext: { partial: extracted, step: "waiting_time" },
    };
  }

  // ─── Verificação de conflito de horário ───
  if (extracted.date && extracted.time && step !== "conflict_resolution") {
    const conflict = await checkTimeConflict(userId, extracted.date, extracted.time, extracted.end_time);
    if (conflict) {
      const reminderPending = !extracted.needs_clarification
        ? false
        : extracted.clarification_type === "reminder_offer";
      return {
        response: `⚠️ *Conflito de horário!*\nVocê já tem *${conflict.title}* às ${conflict.event_time}.\n\nO que prefere?\n1️⃣ Marcar assim mesmo\n2️⃣ Mudar o horário\n3️⃣ Cancelar`,
        pendingAction: "agenda_create",
        pendingContext: { partial: extracted, step: "conflict_resolution", reminder_pending: reminderPending },
      };
    }
  }

  // Se a IA oferece lembrete (horário já existe, lembrete não discutido)
  if (extracted.needs_clarification && extracted.clarification_type === "reminder_offer") {
    sendButtons(
      phone,
      "Quer que eu te lembre antes? ⏱️",
      `Evento: "${extracted.title ?? "evento"}"`,
      [
        { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
        { id: "advance_confirm_no",  text: "✅ Só na hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_create",
      pendingContext: { partial: extracted, step: "waiting_reminder_answer", _recurrence: recurrence?.type, _recurrence_weekday: recurrence?.weekday },
    };
  }

  // Se a IA pede quantidade de minutos para lembrete
  if (extracted.needs_clarification && extracted.clarification_type === "reminder_minutes") {
    return {
      response: extracted.needs_clarification,
      pendingAction: "agenda_create",
      pendingContext: { partial: extracted, step: "waiting_reminder_minutes", _recurrence: recurrence?.type, _recurrence_weekday: recurrence?.weekday },
    };
  }

  // Tudo preenchido — criar evento
  return await createEventAndConfirm(userId, phone, extracted, recurrence ?? undefined, language, userNickname, userTz);
}

/** Cria o evento no banco e retorna a confirmação formatada */
async function createEventAndConfirm(
  userId: string,
  phone: string,
  extracted: ExtractedEvent,
  recurrence?: { type: string; weekday?: number },
  lang = "pt-BR",
  userNickname: string | null = null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string }> {
  const tzOffset = getTzOffset(userTz);
  const color = EVENT_TYPE_COLORS[extracted.event_type] ?? "#3b82f6";
  const emoji = EVENT_TYPE_EMOJIS[extracted.event_type] ?? "📌";

  const eventData: Record<string, unknown> = {
    user_id: userId,
    title: extracted.title,
    event_date: extracted.date,
    event_time: extracted.time,
    end_time: extracted.end_time ?? null,
    location: extracted.location ?? null,
    event_type: extracted.event_type ?? "compromisso",
    priority: extracted.priority ?? "media",
    color,
    source: "whatsapp",
    status: "pending",
  };

  if (extracted.reminder_minutes != null) {
    eventData.reminder = true;
    eventData.reminder_minutes_before = extracted.reminder_minutes;
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert(eventData)
    .select()
    .single();

  if (error) throw error;

  // Sync Google Calendar — await pra capturar google_event_id, meeting_url e logar erros
  // Pra reuniao com horário, cria com Google Meet automaticamente
  let createdMeetLink: string | null = null;
  const shouldCreateMeet = (extracted.event_type === "reuniao" || extracted.event_type === "meeting" || extracted.event_type === "call") && !!extracted.time;
  try {
    if (shouldCreateMeet) {
      const { eventId: googleEventId, meetLink } = await createCalendarEventWithMeet(
        userId,
        extracted.title,
        extracted.date,
        extracted.time,
        extracted.end_time ?? null,
        null,
        null,
        userTz,
      );
      if (googleEventId) {
        await supabase
          .from("events")
          .update({ google_event_id: googleEventId, meeting_url: meetLink })
          .eq("id", event.id);
        createdMeetLink = meetLink;
        console.log("[gcal-sync] reuniao com Meet criada:", { event_id: event.id, google_event_id: googleEventId, meet: meetLink });
      } else {
        console.warn("[gcal-sync] Meet create returned null — integration not connected ou API error. user_id:", userId);
      }
    } else {
      const googleEventId = await syncGoogleCalendar(
        userId,
        extracted.title,
        extracted.date,
        extracted.time,
        extracted.end_time ?? null,
        null,
        extracted.location ?? null,
        userTz,
      );
      if (googleEventId) {
        await supabase
          .from("events")
          .update({ google_event_id: googleEventId })
          .eq("id", event.id);
        console.log("[gcal-sync] event synced to Google Calendar:", { event_id: event.id, google_event_id: googleEventId });
      } else {
        console.warn("[gcal-sync] returned null — integration not connected, token expired, or API error. user_id:", userId);
      }
    }
  } catch (gcalErr) {
    console.error("[gcal-sync] threw exception:", gcalErr);
  }

  // Cria lembrete se solicitado (reminder_minutes >= 0 significa lembrete ativo)
  if (extracted.reminder_minutes != null && extracted.time) {
    // Interpreta o horário no fuso do usuário usando offset dinâmico
    const timeStr = extracted.time.length === 5 ? extracted.time : extracted.time.slice(0, 5);
    const eventDateTime = new Date(`${extracted.date}T${timeStr}:00${tzOffset}`);
    const reminderTime = new Date(
      eventDateTime.getTime() - extracted.reminder_minutes * 60 * 1000
    );

    const reminderMsgPt = extracted.reminder_minutes === 0
      ? `⏰ *Hora do seu compromisso!*\n${emoji} *${extracted.title}* está marcado agora às ${extracted.time}`
      : `⏰ *Lembrete!*\nEm ${extracted.reminder_minutes} min você tem: *${extracted.title}* às ${extracted.time}`;
    const reminderMsgEn = extracted.reminder_minutes === 0
      ? `⏰ *It's time!*\n${emoji} *${extracted.title}* is now at ${fmtTimeLang(extracted.time!, lang)}`
      : `⏰ *Reminder!*\nIn ${extracted.reminder_minutes} min you have: *${extracted.title}* at ${fmtTimeLang(extracted.time!, lang)}`;
    const reminderMsgEs = extracted.reminder_minutes === 0
      ? `⏰ *¡Es la hora!*\n${emoji} *${extracted.title}* está programado ahora a las ${fmtTimeLang(extracted.time!, lang)}`
      : `⏰ *¡Recordatorio!*\nEn ${extracted.reminder_minutes} min tienes: *${extracted.title}* a las ${fmtTimeLang(extracted.time!, lang)}`;
    const reminderMsg = lang === "en" ? reminderMsgEn : lang === "es" ? reminderMsgEs : reminderMsgPt;

    if (reminderTime > new Date()) {
      await supabase.from("reminders").insert({
        user_id: userId,
        event_id: event.id,
        whatsapp_number: phone,
        title: extracted.title,
        message: reminderMsg,
        send_at: reminderTime.toISOString(),
        recurrence: "none",
        source: "whatsapp",
        status: "pending",
      });
    }
  }

  // ─── Cria ocorrências futuras se evento for recorrente ───
  const RECURRENCE_LABELS_EVENT: Record<string, string> = {
    daily: "todo dia",
    weekly: "toda semana",
    monthly: "todo mês",
  };
  if (recurrence) {
    const futureDates = generateRecurrenceDates(extracted.date, recurrence.type, recurrence.weekday);
    const futureInserts = futureDates.map(d => ({
      user_id: userId,
      title: extracted.title,
      event_date: d,
      event_time: extracted.time ?? null,
      end_time: extracted.end_time ?? null,
      location: extracted.location ?? null,
      event_type: extracted.event_type ?? "compromisso",
      priority: extracted.priority ?? "media",
      color,
      source: "whatsapp",
      status: "pending",
      reminder: extracted.reminder_minutes != null,
      reminder_minutes_before: extracted.reminder_minutes ?? null,
      recurrence_parent_id: event.id,
    }));
    if (futureInserts.length > 0) {
      await supabase.from("events").insert(futureInserts);
    }
  }

  // ─── Cria lembrete pós-evento (followup) para eventos que precisam de confirmação ───
  const FOLLOWUP_TYPES = ["consulta", "reuniao", "compromisso"];
  const eventType = extracted.event_type ?? "compromisso";
  if (FOLLOWUP_TYPES.includes(eventType) && extracted.time && !recurrence) {
    const timeStr = extracted.time.length === 5 ? extracted.time : extracted.time.slice(0, 5);
    const eventDateTime = new Date(`${extracted.date}T${timeStr}:00${tzOffset}`);
    const followupTime = new Date(eventDateTime.getTime() + 15 * 60 * 1000); // 15 min após o evento

    if (followupTime > new Date()) {
      const followupMessages: Record<string, string> = {
        consulta: `🏥 Sua *${extracted.title}* era agora! Conseguiu ir?\n\nResponda:\n✅ *sim* — marco como feito\n🔄 *adiar* — reagendo pra outro dia`,
        reuniao: `🤝 *${extracted.title}* era agora! A reunião aconteceu?\n\nResponda:\n✅ *aconteceu* — marco como concluída\n🔄 *adiar* — vamos reagendar`,
        compromisso: `📌 *${extracted.title}* era agora! Deu certo?\n\nResponda:\n✅ *feito* — marco como concluído\n🔄 *adiar* — me diz o novo horário`,
      };
      const followupMsg = followupMessages[eventType] ?? followupMessages.compromisso;

      await supabase.from("reminders").insert({
        user_id: userId,
        event_id: event.id,
        whatsapp_number: phone,
        title: extracted.title,
        message: followupMsg,
        send_at: followupTime.toISOString(),
        recurrence: "none",
        source: "event_followup",
        status: "pending",
      });
    }
  }

  const dateFormatted = fmtDateLong(extracted.date, lang);
  const nameGreet = userNickname ? `, ${userNickname}` : "";

  let response = `✅ *Agendado${nameGreet}!*\n${emoji} ${extracted.title}\n🗓 ${dateFormatted}`;
  if (extracted.time) response += `\n⏰ ${extracted.time}`;
  if (extracted.end_time) response += ` - ${extracted.end_time}`;
  if (extracted.location) response += `\n📍 ${extracted.location}`;
  if (createdMeetLink) response += `\n🔗 *Google Meet:*\n${createdMeetLink}`;
  if (extracted.reminder_minutes === 0) {
    response += `\n🔔 Te aviso na hora do evento`;
  } else if (extracted.reminder_minutes != null && extracted.reminder_minutes > 0) {
    const mins = extracted.reminder_minutes;
    const reminderLabel = mins >= 60
      ? `${mins / 60 === Math.floor(mins / 60) ? mins / 60 + " hora" + (mins / 60 > 1 ? "s" : "") : mins + " min"}`
      : `${mins} min`;
    response += `\n🔔 Te lembro ${reminderLabel} antes`;
  }

  if (recurrence) {
    const recLabel = recurrence.type === "weekly" && recurrence.weekday != null
      ? `toda ${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][recurrence.weekday]}`
      : RECURRENCE_LABELS_EVENT[recurrence.type] ?? recurrence.type;
    response += `\n🔁 *Recorrente:* ${recLabel}`;
  }

  return { response };
}

// ─────────────────────────────────────────────
// AGENDA LOOKUP — encontra um evento específico
// ─────────────────────────────────────────────

async function handleAgendaLookup(
  userId: string,
  message: string,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = todayInTz(userTz);

  // Extrai palavra-chave usando padrões contextuais (meu X, do X, sobre X, etc.)
  const msgNorm = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let keyword = "";

  // Tenta padrão contextual primeiro: "meu/minha/do/da/o/a/sobre X"
  const contextMatch = msgNorm.match(
    /(meu|minha|do|da|de|o|a|sobre)\s+([a-z\s]{2,30}?)(?:\s+dia|\s+no|\s+na|\s*\?|$)/i
  );
  if (contextMatch) {
    keyword = contextMatch[2].trim();
  }

  // Fallback: remove stopwords e usa o primeiro token longo restante
  if (!keyword) {
    keyword = msgNorm
      .replace(/voce lembra|lembra|do|da|de|meu|minha|tem|qual|e|quando|marcado|agendado|dia|no|para|sobre|esta|esse|essa/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 2)[0] ?? "";
  }

  // Tenta extrair um intervalo de datas da mensagem (ignora fallback de 7 dias genérico)
  let startDate: string | null = null;
  let endDate: string | null = null;
  try {
    const parsed = await parseAgendaQuery(message, today);
    // Só usa o intervalo se parecer uma data específica (start diferente de hoje)
    if (parsed.start_date && parsed.end_date && parsed.start_date !== today) {
      startDate = parsed.start_date;
      endDate = parsed.end_date;
    }
  } catch {
    // ignora — fará busca só por keyword
  }

  // Monta query combinando keyword + datas; exclui apenas cancelados
  let query = supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .order("event_date", { ascending: true })
    .limit(3);

  // Sanitiza keyword pra evitar PostgREST injection em .or()/.ilike()
  const safeKeyword = keyword ? sanitizeForFilter(keyword) : "";
  if (safeKeyword && startDate && endDate) {
    query = query.or(
      `title.ilike.%${safeKeyword}%,and(event_date.gte.${startDate},event_date.lte.${endDate})`
    );
  } else if (safeKeyword) {
    query = query.ilike("title", `%${safeKeyword}%`);
  } else if (startDate && endDate) {
    query = query.gte("event_date", startDate).lte("event_date", endDate);
  }

  const { data: events, error } = await query;
  if (error) throw error;

  if (!events || events.length === 0) {
    return {
      response: "Não encontrei nenhum compromisso com esse nome. 🔍 Quer ver sua agenda completa?",
    };
  }

  if (events.length === 1) {
    const e = events[0];
    const dateStr = new Date(e.event_date + "T12:00:00").toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const dateFormatted = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const typeEmoji = EVENT_TYPE_EMOJIS[e.event_type] ?? "📌";
    const statusLabel = e.status === "done" ? " ✅ *Concluído*" : "";

    let response = `${typeEmoji} *${e.title}*${statusLabel}\n🗓 ${dateFormatted}`;
    if (e.event_time) response += `\n⏰ ${e.event_time.slice(0, 5)}`;
    if (e.end_time) response += ` - ${e.end_time.slice(0, 5)}`;
    if (e.location) response += `\n📍 ${e.location}`;

    // Verifica se há lembrete real pendente na tabela reminders
    if (e.reminder && e.reminder_minutes_before != null) {
      const reminderLabel = e.reminder_minutes_before === 0
        ? "na hora do evento"
        : `${e.reminder_minutes_before} min antes`;

      const { data: activeReminder } = await supabase
        .from("reminders")
        .select("status, send_at")
        .eq("event_id", e.id)
        .eq("user_id", userId)
        .eq("status", "pending")
        .maybeSingle();

      if (activeReminder) {
        response += `\n🔔 Lembrete: ${reminderLabel} _(ativo)_`;
      } else {
        response += `\n🔔 Lembrete: ${reminderLabel} _(já disparado ou removido)_`;
      }
    }

    if (e.status !== "done") {
      response += `\n\nQuer fazer alguma alteração? Pode me dizer a nova data, horário, ou "cancela" se quiser excluir.`;
    }

    return {
      response,
      pendingAction: e.status !== "done" ? "agenda_edit" : undefined,
      pendingContext: e.status !== "done" ? {
        event_id: e.id,
        event_title: e.title,
        event_date: e.event_date,
        event_time: e.event_time ?? null,
        reminder_minutes: e.reminder_minutes_before ?? null,
        step: "awaiting_change",
      } : undefined,
    };
  }

  // Múltiplos eventos — lista e pede confirmação
  const lines = events.map((e, i) => {
    const dateStr = new Date(e.event_date + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
    });
    const time = e.event_time ? ` às ${e.event_time.slice(0, 5)}` : "";
    const doneTag = e.status === "done" ? " ✅" : "";
    return `${i + 1}. *${e.title}*${doneTag} — ${dateStr}${time}`;
  });

  return {
    response: `Encontrei ${events.length} compromissos:\n\n${lines.join("\n")}\n\nQual deles você quer ver ou editar?`,
  };
}

// ─────────────────────────────────────────────
// APPLY EVENT UPDATE — aplica alterações no BD
// ─────────────────────────────────────────────

async function applyEventUpdate(
  userId: string,
  phone: string,
  eventId: string,
  updates: { event_date?: string; event_time?: string; end_time?: string },
  reminderMinutes: number | null | undefined,
  originalData: {
    title: string;
    event_date: string;
    event_time: string | null;
    reminder_minutes: number | null;
  },
  userTz = "America/Sao_Paulo"
): Promise<string> {
  // 1. Atualiza o evento
  const { error: updateErr } = await supabase
    .from("events")
    .update(updates)
    .eq("id", eventId)
    .eq("user_id", userId);

  if (updateErr) throw updateErr;

  // 2. Cancela lembretes pendentes se reminderMinutes foi explicitamente informado
  if (reminderMinutes !== undefined) {
    await supabase
      .from("reminders")
      .update({ status: "cancelled" })
      .eq("event_id", eventId)
      .eq("status", "pending");
  }

  // 3. Cria novo lembrete se solicitado
  if (reminderMinutes != null && reminderMinutes >= 0) {
    const finalDate = updates.event_date ?? originalData.event_date;
    const finalTime = updates.event_time ?? originalData.event_time;

    if (finalTime) {
      // Interpreta o horário no fuso do usuário
      const finalTimeStr = finalTime.length >= 5 ? finalTime.slice(0, 5) : finalTime;
      const tzOffsetEdit = getTzOffset(userTz);
      const eventDt = new Date(`${finalDate}T${finalTimeStr}:00${tzOffsetEdit}`);
      const remindDt = new Date(eventDt.getTime() - reminderMinutes * 60 * 1000);

      if (remindDt > new Date()) {
        const reminderMsg = reminderMinutes === 0
          ? `⏰ *Hora do seu compromisso!*\n📌 *${originalData.title}* está marcado agora às ${finalTime.slice(0, 5)}`
          : `⏰ *Lembrete!*\nEm ${reminderMinutes} min você tem: *${originalData.title}* às ${finalTime.slice(0, 5)}`;

        await supabase.from("reminders").insert({
          user_id: userId,
          event_id: eventId,
          whatsapp_number: phone,
          title: originalData.title,
          message: reminderMsg,
          send_at: remindDt.toISOString(),
          recurrence: "none",
          source: "whatsapp",
          status: "pending",
        });
      }
    }
  }

  // 4. Sync Google Calendar (fire-and-forget) — passa userTz pra não forçar BRT
  const gcalDate = updates.event_date ?? originalData.event_date;
  const gcalTime = updates.event_time ?? originalData.event_time;
  syncGoogleCalendar(userId, originalData.title, gcalDate, gcalTime ?? null, updates.end_time ?? null, null, null, userTz).catch(() => {});

  // 5. Formata confirmação
  const dateStr = new Date(gcalDate + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const dateFormatted = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  let response = `✅ *Compromisso atualizado!*\n📌 ${originalData.title}\n🗓 ${dateFormatted}`;
  if (gcalTime) response += `\n⏰ ${gcalTime.slice(0, 5)}`;
  if (reminderMinutes === 0) {
    response += `\n🔔 Te aviso na hora do evento`;
  } else if (reminderMinutes != null && reminderMinutes > 0) {
    const label = reminderMinutes >= 60
      ? `${reminderMinutes / 60 === Math.floor(reminderMinutes / 60) ? reminderMinutes / 60 + " hora" + (reminderMinutes / 60 > 1 ? "s" : "") : reminderMinutes + " min"}`
      : `${reminderMinutes} min`;
    response += `\n🔔 Te lembro ${label} antes`;
  }

  return response;
}

// ─────────────────────────────────────────────
// AGENDA EDIT — edita evento via conversa
// ─────────────────────────────────────────────

async function handleAgendaEdit(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = todayInTz(userTz);
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const step = (ctx.step as string) ?? "awaiting_change";

  // ─── STEP: waiting_time ───
  if (step === "waiting_time") {
    const timeMatch = message.match(/(\d{1,2})[h:](\d{0,2})/);
    let newTime: string | null = null;
    if (timeMatch) {
      const hh = timeMatch[1].padStart(2, "0");
      const mm = (timeMatch[2] || "00").padStart(2, "0");
      newTime = `${hh}:${mm}`;
    } else {
      return {
        response: "Não entendi o horário. Pode me dizer no formato *14:00* ou *14h30*? 🕐",
        pendingAction: "agenda_edit",
        pendingContext: ctx,
      };
    }

    return await offerReminderAfterEdit(userId, phone, {
      ...(ctx as Record<string, unknown>),
      pending_new_time: newTime,
    }, userTz);
  }

  // ─── STEP: waiting_reminder_answer (followup/edit) ───
  if (step === "waiting_reminder_answer") {
    const msgLowFU = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const fuBtnMap: Record<string, number | null> = {
      "button:advance_15min": 15, "button:advance_30min": 30,
      "button:advance_1h": 60,   "button:advance_confirm_no": 0,
      "1": 15, "2": 30, "3": 60,  // fallback para texto numerado (Baileys)
    };
    if (fuBtnMap[msgLowFU] !== undefined) {
      return await finalizeEdit(userId, phone, ctx, fuBtnMap[msgLowFU], userTz);
    }
    if (msgLowFU === "button:advance_confirm_yes" || msgLowFU === "1" || isReminderAccept(message)) {
      sendButtons(
        phone,
        "Com quanto tempo antes? ⏱️",
        `Evento: "${(ctx as Record<string,unknown>).event_title ?? "evento"}"`,
        [
          { id: "advance_15min", text: "15 minutos" },
          { id: "advance_30min", text: "30 minutos" },
          { id: "advance_1h",    text: "1 hora" },
        ]
      ).catch(() => {});
      return {
        response: "",
        pendingAction: "agenda_edit",
        pendingContext: { ...ctx, step: "waiting_reminder_minutes" },
      };
    }
    if (isReminderAtTime(message)) {
      return await finalizeEdit(userId, phone, ctx, 0, userTz);
    }
    if (isReminderDecline(message)) {
      return await finalizeEdit(userId, phone, ctx, null, userTz);
    }
    const minutesInAnswer = parseMinutes(message);
    if (minutesInAnswer !== null && message.match(/\d|hora|minuto|meia/)) {
      return await finalizeEdit(userId, phone, ctx, minutesInAnswer, userTz);
    }
    // Reenvia botões
    sendButtons(
      phone,
      "Quer que eu te lembre antes? ⏱️",
      `Evento: "${(ctx as Record<string,unknown>).event_title ?? "evento"}"`,
      [
        { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
        { id: "advance_confirm_no",  text: "✅ Só na hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_answer" },
    };
  }

  // ─── STEP: waiting_reminder_minutes (followup/edit) ───
  if (step === "waiting_reminder_minutes") {
    const msgLowMinFU = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const fuMinMap: Record<string, number> = {
      "button:advance_15min": 15, "button:advance_30min": 30,
      "button:advance_1h": 60,   "button:advance_2h": 120,
      "1": 15, "2": 30, "3": 60,  // fallback para texto numerado (Baileys)
    };
    const btnMinFU = fuMinMap[msgLowMinFU];
    if (btnMinFU !== undefined) return await finalizeEdit(userId, phone, ctx, btnMinFU, userTz);
    const minutes = parseMinutes(message);
    if (minutes !== null) {
      return await finalizeEdit(userId, phone, ctx, minutes, userTz);
    }
    sendButtons(
      phone,
      "Com quanto tempo antes? ⏱️",
      `Evento: "${(ctx as Record<string,unknown>).event_title ?? "evento"}"`,
      [
        { id: "advance_15min", text: "15 minutos" },
        { id: "advance_30min", text: "30 minutos" },
        { id: "advance_1h",    text: "1 hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_minutes" },
    };
  }

  // ─── STEP: awaiting_change (ou direto sem sessão anterior) ───

  // Se não há event_id na sessão, tenta encontrar evento pelo texto
  if (!ctx.event_id) {
    const keyword = message
      .toLowerCase()
      .replace(/mudei|muda|mude|alterei|altera|altere|remarca|remarcar|atualiza|cancela|cancelar|excluir|deletar|mover|dia|hora|horario|data|evento|compromisso|reuniao|consulta|para|pro|pra|com|meu|minha|meus|minhas|o|a/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 2)[0] ?? "";

    if (keyword) {
      // Busca até 5 eventos futuros com o keyword — se há múltiplos, pede pra escolher
      const { data: matches } = await supabase
        .from("events")
        .select("id, title, event_date, event_time, reminder_minutes_before")
        .eq("user_id", userId)
        .eq("status", "pending")
        .gte("event_date", today) // só eventos futuros ou de hoje
        .ilike("title", `%${keyword}%`)
        .order("event_date", { ascending: true })
        .limit(5);

      if (!matches || matches.length === 0) {
        return {
          response: `Não encontrei nenhum compromisso com "${keyword}". 🔍\n\nComo está o nome do compromisso que você quer editar?`,
        };
      }

      // Múltiplos matches → desambiguação
      if (matches.length > 1) {
        const lines = matches.map((ev: any, i: number) => {
          const dateStr = new Date(ev.event_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short", weekday: "short" });
          const timeStr = ev.event_time ? ` às ${ev.event_time.slice(0, 5)}` : "";
          return `*${i + 1}.* ${ev.title} — ${dateStr}${timeStr}`;
        }).join("\n");

        return {
          response: `Encontrei *${matches.length}* compromissos com "${keyword}". Qual você quer editar?\n\n${lines}\n\nResponda com o *número* (1 a ${matches.length}) e depois me diga o que mudar.`,
          pendingAction: "agenda_edit_choose",
          pendingContext: {
            step: "choosing_event",
            keyword,
            pending_edit_text: message,
            options: matches.map((ev: any) => ({
              id: ev.id,
              title: ev.title,
              event_date: ev.event_date,
              event_time: ev.event_time,
              reminder_minutes: ev.reminder_minutes_before,
            })),
          },
        };
      }

      // Único match → usa direto
      const found = matches[0];
      ctx.event_id = found.id;
      ctx.event_title = found.title;
      ctx.event_date = found.event_date;
      ctx.event_time = found.event_time ?? null;
      ctx.reminder_minutes = found.reminder_minutes_before ?? null;
    } else {
      return {
        response: "Qual compromisso você quer editar? 📅",
      };
    }
  }

  // Extrai o que mudou
  let edit: Awaited<ReturnType<typeof extractAgendaEdit>>;
  try {
    edit = await extractAgendaEdit(message, today);
  } catch (err) {
    console.error("extractAgendaEdit failed:", err);
    return {
      response: "Não entendi o que alterar. Pode repetir?\n\nEx: _muda para dia 15 às 10h_ ou _cancela esse evento_",
    };
  }

  // Cancelamento
  if (edit.cancel) {
    const { error } = await supabase
      .from("events")
      .update({ status: "cancelled" })
      .eq("id", ctx.event_id as string)
      .eq("user_id", userId);
    if (error) throw error;

    // Cancela lembretes pendentes
    await supabase
      .from("reminders")
      .update({ status: "cancelled" })
      .eq("event_id", ctx.event_id as string)
      .eq("status", "pending");

    return { response: `🗑️ Compromisso *${ctx.event_title}* cancelado. ✅` };
  }

  // Nada identificado
  if (edit.fields_changed.length === 0 && !edit.needs_clarification) {
    return {
      response: "Não entendi o que você quer mudar. Pode me dizer a nova data, novo horário, ou \"cancela\"? 📝",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "awaiting_change" },
    };
  }

  // Precisa de esclarecimento (ex: deu data mas não horário e evento tinha horário)
  const hasOriginalTime = !!(ctx.event_time as string | null);
  if (edit.new_date && !edit.new_time && hasOriginalTime && edit.needs_clarification) {
    return {
      response: edit.needs_clarification,
      pendingAction: "agenda_edit",
      pendingContext: {
        ...ctx,
        pending_new_date: edit.new_date,
        step: "waiting_time",
      },
    };
  }

  // Tem tudo para aplicar — oferece lembrete antes
  return await offerReminderAfterEdit(userId, phone, {
    ...ctx,
    pending_new_date: edit.new_date ?? ctx.event_date,
    pending_new_time: edit.new_time ?? ctx.event_time,
  }, userTz);
}

/** Depois de coletar data/hora novos, oferece atualização de lembrete */
async function offerReminderAfterEdit(
  userId: string,
  phone: string,
  ctx: Record<string, unknown>,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  // Se o evento tinha lembrete, pergunta se quer manter/alterar
  const hadReminder = (ctx.reminder_minutes as number | null) != null;
  if (hadReminder) {
    sendButtons(
      phone,
      "Quer atualizar o lembrete? ⏱️",
      `Evento: "${(ctx as Record<string,unknown>).event_title ?? "evento"}"`,
      [
        { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
        { id: "advance_confirm_no",  text: "✅ Só na hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_answer" },
    };
  }

  // Sem lembrete anterior — aplica direto sem perguntar
  return await finalizeEdit(userId, phone, ctx, undefined, userTz);
}

/** Aplica as alterações acumuladas e retorna a mensagem de confirmação */
async function finalizeEdit(
  userId: string,
  phone: string,
  ctx: Record<string, unknown>,
  reminderMinutes: number | null | undefined,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string }> {
  const updates: { event_date?: string; event_time?: string } = {};
  if (ctx.pending_new_date && ctx.pending_new_date !== ctx.event_date) {
    updates.event_date = ctx.pending_new_date as string;
  }
  if (ctx.pending_new_time !== undefined && ctx.pending_new_time !== ctx.event_time) {
    updates.event_time = (ctx.pending_new_time as string | null) ?? undefined;
  }

  const response = await applyEventUpdate(
    userId,
    phone,
    ctx.event_id as string,
    updates,
    reminderMinutes,
    {
      title: ctx.event_title as string,
      event_date: ctx.event_date as string,
      event_time: (ctx.event_time as string | null) ?? null,
      reminder_minutes: (ctx.reminder_minutes as number | null) ?? null,
    },
    userTz
  );

  return { response };
}

// ─────────────────────────────────────────────
// AGENDA DELETE — cancela/exclui evento direto
// ─────────────────────────────────────────────

async function handleAgendaDelete(
  userId: string,
  message: string
): Promise<string> {
  // Extrai palavra-chave do pedido de exclusão
  const msgNorm = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Remove verbos de exclusão e artigos para isolar o nome do evento
  const keyword = msgNorm
    .replace(/cancela|exclui|apaga|deleta|remove|desmarca|nao vou mais|vou mais|o evento|a reuniao|o compromisso|a consulta|meu|minha|o\b|a\b|ao\b|para o|para a/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");

  if (!keyword) {
    return "Qual compromisso você quer cancelar? Me diga o nome.";
  }

  // Busca o evento por keyword (somente pending — não faz sentido cancelar done)
  const { data: found, error } = await supabase
    .from("events")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "pending")
    .ilike("title", `%${keyword}%`)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!found) {
    return `Não encontrei nenhum compromisso pendente com "${keyword}". Qual você quer cancelar?`;
  }

  // Cancela o evento
  const { error: updateErr } = await supabase
    .from("events")
    .update({ status: "cancelled" })
    .eq("id", found.id)
    .eq("user_id", userId);

  if (updateErr) throw updateErr;

  // Cancela lembretes pendentes associados
  await supabase
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("event_id", found.id)
    .eq("status", "pending");

  return `✅ *${found.title}* cancelado e removido da sua agenda.`;
}

async function handleAgendaQuery(userId: string, message: string, userTz = "America/Sao_Paulo"): Promise<string> {
  const today = todayInTz(userTz);

  // Usa IA para interpretar o período desejado
  let startDate: string;
  let endDate: string;
  let periodDescription: string;

  try {
    const parsed = await parseAgendaQuery(message, today);
    startDate = parsed.start_date;
    endDate = parsed.end_date;
    periodDescription = parsed.description;
  } catch {
    // Fallback: próximos 7 dias
    startDate = today;
    endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    periodDescription = "próximos 7 dias";
  }

  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .gte("event_date", startDate)
    .lte("event_date", endDate)
    .neq("status", "cancelled")
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });

  if (error) throw error;

  if (!events || events.length === 0) {
    return `📅 Nenhum compromisso para *${periodDescription}*!`;
  }

  // Agrupa eventos por data
  const grouped: Record<string, typeof events> = {};
  for (const e of events) {
    const dateKey = e.event_date;
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(e);
  }

  const sections: string[] = [];

  for (const [dateKey, dayEvents] of Object.entries(grouped)) {
    const dateStr = new Date(dateKey + "T12:00:00").toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    // Capitaliza primeira letra do dia da semana
    const dateHeader = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const lines: string[] = [`📆 *${dateHeader}*`];

    for (const e of dayEvents) {
      const typeEmoji = EVENT_TYPE_EMOJIS[e.event_type] ?? "📌";
      const time = e.event_time ? `${e.event_time.slice(0, 5)}` : "Sem horário";
      const endTime = e.end_time ? ` - ${e.end_time.slice(0, 5)}` : "";
      const location = e.location ? `\n   📍 ${e.location}` : "";
      const reminder = e.reminder ? " 🔔" : "";
      const statusLabel = e.status === "done" ? " ✅" : "";
      lines.push(`  ${typeEmoji} *${e.title}*${statusLabel}\n   🕐 ${time}${endTime}${reminder}${location}`);
    }

    sections.push(lines.join("\n"));
  }

  const doneCount = events.filter((e) => e.status === "done").length;
  const totalCount = events.length;
  const countLabel = totalCount === 1 ? "1 compromisso" : `${totalCount} compromissos`;
  const doneNote = doneCount > 0 ? ` _(${doneCount} concluído${doneCount > 1 ? "s" : ""} ✅)_` : "";

  return `📅 *Sua agenda — ${periodDescription}*\n_(${countLabel})_${doneNote}\n\n${sections.join("\n\n")}`;
}

// ─────────────────────────────────────────────
// SMART NOTE PROCESSING — classifica e limpa com IA
// ─────────────────────────────────────────────

interface NoteAnalysis {
  cleanContent: string;
  suggestedTitle: string;
  looksLikeEvent: boolean;
  needsMoreInfo: boolean;
  moreInfoQuestion: string | null;
}

async function analyzeNoteContent(rawMessage: string): Promise<NoteAnalysis> {
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
  const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";

  const prompt = `Analise esta mensagem de WhatsApp enviada para um assistente pessoal: "${rawMessage}"

Responda SOMENTE com JSON válido (sem texto extra):
{
  "cleanContent": "conteúdo limpo sem verbos como 'anota'/'salva'/'registra' e sem 'pra mim que'/'que'/'isso'. Corrija capitalização.",
  "suggestedTitle": "título curto e objetivo (máx 50 chars)",
  "looksLikeEvent": true ou false (contém médico/dentista/reunião/consulta + data ou horário específico?),
  "needsMoreInfo": true ou false (é consulta médica/dentista onde perguntar especialidade ou local seria útil?),
  "moreInfoQuestion": "pergunta natural para obter especialidade/local/mais detalhes se needsMoreInfo=true, caso contrário null"
}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // fallback
  }

  // Fallback: limpeza básica por regex
  const cleanContent = rawMessage
    .replace(/^(anota|anotacao|anote|salva|escreve|registra|guarda|cria (uma )?nota)[\s:,]+(pra mim que|pra mim|que\s+)?/i, "")
    .replace(/^(preciso lembrar|lembrar de)[\s:,]+/i, "")
    .replace(/^(pra mim que|pra mim|que)\s+/i, "")
    .trim();

  return {
    cleanContent: cleanContent || rawMessage,
    suggestedTitle: cleanContent.slice(0, 50),
    looksLikeEvent: false,
    needsMoreInfo: false,
    moreInfoQuestion: null,
  };
}

async function handleNotesSave(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null,
  config: Record<string, unknown> | null = null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const userNickname = (config?.user_nickname as string) || "";
  const noteLang = (config?.language as string) || "pt-BR";
  const tplNote = (config?.template_note as string) || '📝 *Anotado, {{user_name}}!*\n"{{content}}"';
  const buildNoteResponse = (content: string): string => {
    const noteLine = applyTemplate(tplNote, { content, user_name: userNickname });
    return `${noteLine}\n\nQuer que eu te lembre sobre isso mais tarde? ⏰\n_Diga o horário ou "não precisa"_`;
  };
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const step = (ctx.step as string) ?? null;

  // ─── STEP: note_or_reminder_choice ───
  // Usuário respondendo "anotações" ou "lembrete" à pergunta de disambiguação
  if (step === "note_or_reminder_choice") {
    const m2 = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const cleanContent = ctx.cleanContent as string;
    const suggestedTitle = ctx.suggestedTitle as string;

    const wantsReminder =
      /^2$|^lembrete|^lembrar|^avisa|^aviso|^lembre|^quero lembrete|^criar lembrete/.test(m2) ||
      m2 === "button:note_reminder";

    if (wantsReminder) {
      // Guarda o conteúdo e pede o horário
      return {
        response: `⏰ *Certo!* Em qual momento você quer ser lembrado sobre:\n_"${cleanContent}"_?\n\n_Ex: amanhã às 14h, sexta às 10h, daqui 2 horas_`,
        pendingAction: "notes_save",
        pendingContext: {
          step: "note_reminder_time_pending",
          cleanContent,
          suggestedTitle,
        },
      };
    }

    // Escolheu anotações (ou qualquer outra resposta = padrão)
    const { error: noteErr } = await supabase.from("notes").insert({
      user_id: userId,
      title: suggestedTitle || null,
      content: cleanContent,
      source: "whatsapp",
    });
    if (noteErr) throw noteErr;
    syncNotion(userId, cleanContent).catch(() => {});

    return {
      response: buildNoteResponse(cleanContent),
      pendingAction: "notes_save",
      pendingContext: { step: "note_reminder_offer", noteTitle: suggestedTitle || cleanContent.slice(0, 40) },
    };
  }

  // ─── STEP: note_reminder_time_pending ───
  // Usuário escolheu "lembrete" e está informando o horário
  if (step === "note_reminder_time_pending") {
    const cleanContent = ctx.cleanContent as string;
    const suggestedTitle = ctx.suggestedTitle as string;
    const tzOff2 = getTzOffset(userTz);
    const nowIso2 = new Date().toLocaleString("sv-SE", { timeZone: userTz }).replace(" ", "T") + tzOff2;
    const parsed2 = await parseReminderIntent(message, nowIso2, noteLang);

    if (!parsed2) {
      return {
        response: `Não entendi o horário. Pode repetir?\n\n_Ex: amanhã às 14h, sexta às 10h, daqui 2 horas_`,
        pendingAction: "notes_save",
        pendingContext: ctx,
      };
    }

    const remindAt2 = new Date(parsed2.remind_at);
    if (isNaN(remindAt2.getTime()) || remindAt2 <= new Date()) {
      return {
        response: `Esse horário já passou ou não entendi. Tente novamente:\n\n_Ex: amanhã às 14h, próxima sexta às 9h_`,
        pendingAction: "notes_save",
        pendingContext: ctx,
      };
    }

    const { data: profileRow2 } = await supabase.from("profiles").select("phone_number").eq("id", userId).maybeSingle();
    const reminderPhone = phone || profileRow2?.phone_number || "";

    await supabase.from("reminders").insert({
      user_id: userId,
      whatsapp_number: reminderPhone,
      title: suggestedTitle || cleanContent.slice(0, 60),
      message: `🔔 *Lembrete!*\n📋 ${suggestedTitle || cleanContent.slice(0, 60)}`,
      send_at: remindAt2.toISOString(),
      recurrence: "none",
      source: "whatsapp",
      status: "pending",
    });

    const timeStr2 = remindAt2.toLocaleTimeString("pt-BR", { timeZone: userTz, hour: "2-digit", minute: "2-digit" });
    const dateStr2 = remindAt2.toLocaleDateString("pt-BR", { timeZone: userTz, weekday: "long", day: "numeric", month: "long" });
    const greetName = userNickname ? `, ${userNickname}` : "";

    return {
      response: `⏰ *Lembrete criado${greetName}!*\nVou te avisar sobre _"${suggestedTitle || cleanContent.slice(0, 60)}"_ em ${dateStr2} às ${timeStr2}. ✅`,
    };
  }

  // ─── STEP: note_or_event_choice ───
  if (step === "note_or_event_choice") {
    const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const cleanContent = ctx.cleanContent as string;
    const suggestedTitle = ctx.suggestedTitle as string;
    const needsMoreInfo = ctx.needsMoreInfo as boolean;
    const moreInfoQuestion = ctx.moreInfoQuestion as string | null;
    const originalMessage = ctx.originalMessage as string;

    // Cancelar
    if (m === "button:note_cancel" || /^(cancelar?|nao|nope|desistir|esquece)$/.test(m)) {
      return { response: "Ok, descartado! Qualquer coisa é só me chamar. 😊" };
    }

    // Usuário quer colocar na agenda
    if (/^1$|^agenda$|^agendar|^marcar|^compromisso|^sim$|^quero agenda/.test(m) || m === "button:note_agenda") {
      if (needsMoreInfo && moreInfoQuestion) {
        return {
          response: moreInfoQuestion,
          pendingAction: "notes_save",
          pendingContext: { ...ctx, step: "agenda_more_info" },
        };
      }
      // Redireciona para criação de evento com a mensagem original
      return await handleAgendaCreate(userId, phone, originalMessage, null, noteLang, userNickname || null, userTz);
    }

    // Usuário quer salvar como nota (opção 2, ou qualquer outra resposta = fallback)
    // Salva a nota com conteúdo limpo
    const { error } = await supabase.from("notes").insert({
      user_id: userId,
      title: suggestedTitle || null,
      content: cleanContent,
      source: "whatsapp",
    });
    if (error) throw error;
    syncNotion(userId, cleanContent).catch(() => {});

    return {
      response: buildNoteResponse(cleanContent),
      pendingAction: "notes_save",
      pendingContext: { step: "note_reminder_offer", noteTitle: suggestedTitle || cleanContent.slice(0, 40) },
    };
  }

  // ─── STEP: agenda_more_info ───
  if (step === "agenda_more_info") {
    // Combina detalhes extras com a mensagem original e cria evento
    const originalMessage = ctx.originalMessage as string;
    const combinedMessage = `${originalMessage} — ${message}`;
    return await handleAgendaCreate(userId, phone, combinedMessage, null, noteLang, userNickname || null, userTz);
  }

  // ─── STEP: note_extra_info ───
  // Usuário respondeu à pergunta de mais detalhes (especialidade, local, etc.)
  if (step === "note_extra_info") {
    const noteTitle = ctx.noteTitle as string;
    const cleanContent = ctx.cleanContent as string;
    const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Se recusou dar mais info → vai direto para oferecer lembrete
    if (/^(nao|não|n|dispenso|nao precisa|ta bom|tudo bem|sem detalhes|pula|pular)$/.test(m)) {
      return {
        response: `Ok! Nota salva como: _"${cleanContent}"_\n\nQuer que eu te lembre sobre isso mais tarde? ⏰\n_Diga o horário ou "não precisa"_`,
        pendingAction: "notes_save",
        pendingContext: { step: "note_reminder_offer", noteTitle },
      };
    }

    // Enriquece o título com a info extra
    const enrichedTitle = `${noteTitle} — ${message.trim()}`;

    // Atualiza a nota mais recente do usuário (a que acabou de ser salva)
    const { data: lastNote } = await supabase
      .from("notes")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastNote?.id) {
      await supabase.from("notes")
        .update({ title: enrichedTitle.slice(0, 100) })
        .eq("id", lastNote.id);
    }

    return {
      response: `Perfeito! Anotei: _"${enrichedTitle}"_ 📝\n\nQuer que eu te lembre sobre isso mais tarde? ⏰\n_Diga o horário ou "não precisa"_`,
      pendingAction: "notes_save",
      pendingContext: { step: "note_reminder_offer", noteTitle: enrichedTitle.slice(0, 60) },
    };
  }

  // ─── STEP: note_reminder_offer ───
  if (step === "note_reminder_offer") {
    const noteTitle = ctx.noteTitle as string;
    const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Se o usuário enviou um novo "guarda X" enquanto aguardava resposta sobre lembrete,
    // ignora o contexto pendente e salva como nota nova diretamente
    if (/^(guarda(r)?|bota\s+ai|grava)\s*[:!,\s]/i.test(message)) {
      const newContent = message.replace(/^(guarda(r)?|bota\s+ai|grava(r)?)\s*[:!,]?\s*/i, "").trim();
      const { error: ne } = await supabase.from("notes").insert({
        user_id: userId,
        title: newContent.slice(0, 80),
        content: newContent,
        source: "whatsapp",
      });
      if (ne) throw ne;
      syncNotion(userId, newContent).catch(() => {});
      const noteLine = applyTemplate(tplNote, { content: newContent, user_name: userNickname });
      return { response: noteLine };
    }

    if (isReminderDecline(m) || /^(nao|não|n|dispenso|nao precisa|ta bom|tudo bem)$/.test(m)) {
      return {
        response: `Ok! A anotação está salva. 📝\nQuando precisar é só pedir: _"busca minha anotação sobre ${noteTitle}"_ 🔍`,
      };
    }

    // Tenta extrair horário diretamente da resposta
    const noteTzOff = getTzOffset(userTz);
    const nowIso = new Date().toLocaleString("sv-SE", { timeZone: userTz }).replace(" ", "T") + noteTzOff;
    const parsed = await parseReminderIntent(message, nowIso);
    if (parsed) {
      const remindAt = new Date(parsed.remind_at);
      if (!isNaN(remindAt.getTime()) && remindAt > new Date()) {
        const { data: profileRow } = await supabase.from("profiles").select("phone_number").eq("id", userId).maybeSingle();
        const whatsappPhone = phone || profileRow?.phone_number || "";
        await supabase.from("reminders").insert({
          user_id: userId,
          whatsapp_number: whatsappPhone,
          title: noteTitle,
          message: `⏰ *Lembrete!*\n📝 ${noteTitle}`,
          send_at: remindAt.toISOString(),
          recurrence: "none",
          source: "whatsapp",
          status: "pending",
        });
        const timeStr = remindAt.toLocaleTimeString("pt-BR", { timeZone: userTz, hour: "2-digit", minute: "2-digit" });
        const dateStr = remindAt.toLocaleDateString("pt-BR", { timeZone: userTz, weekday: "long", day: "numeric", month: "long" });
        const noteNameGreet = userNickname ? `, ${userNickname}` : "";
        return { response: `⏰ *Lembrete criado${noteNameGreet}!*\nVou te avisar sobre _"${noteTitle}"_ em ${dateStr} às ${timeStr}. ✅` };
      }
    }

    // Usuário disse sim mas sem horário — pede quando
    if (isReminderAccept(m)) {
      return {
        response: `Quando você quer ser lembrado? 📅\n\n_Ex: amanhã às 10h, sexta às 15h, daqui 2 horas_`,
        pendingAction: "notes_save",
        pendingContext: { step: "note_reminder_offer", noteTitle },
      };
    }

    // Não entendeu — segue sem lembrete
    return {
      response: `Ok, nota salva! Quando quiser ser lembrado é só dizer: _"me lembra de ${noteTitle} às Xh"_ 📝`,
    };
  }

  // ─── FLUXO PRINCIPAL ───
  // Analisa e classifica a nota com IA
  const analysis = await analyzeNoteContent(message);

  // Comandos diretos de "guarda" → salva como nota imediatamente, sem perguntar sobre lembrete
  if (/^(guarda(r)?|salva(r)?|anota(r)?|registra(r)?|escreve(r)?|coloca(r)?|bota(\s+ai)?|grava(r)?|fixa(r)?|memoriza(r)?|nota|copia(r)?)\s*[:!,\s]/i.test(message)) {
    const { error: ge } = await supabase.from("notes").insert({
      user_id: userId,
      title: analysis.suggestedTitle || null,
      content: analysis.cleanContent,
      source: "whatsapp",
    });
    if (ge) throw ge;
    syncNotion(userId, analysis.cleanContent).catch(() => {});
    const noteLine = applyTemplate(tplNote, { content: analysis.cleanContent, user_name: userNickname });
    return { response: noteLine };
  }

  // Detecta se a mensagem tem referência de tempo (indica lembrete)
  const hasTimeRef = /\b(amanha|amanhã|hoje|às \d|as \d|dia \d|\d+h\b|\d+ horas|proxim[ao]|semana|mes|daqui \d|em \d+ (min|hora|dia)|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i.test(message);

  // Se não tem referência de tempo e não parece evento → pergunta notas ou lembrete
  if (!hasTimeRef && !analysis.looksLikeEvent) {
    const pendingCtx = {
      step: "note_or_reminder_choice",
      cleanContent: analysis.cleanContent,
      suggestedTitle: analysis.suggestedTitle,
      originalMessage: message,
    };
    // Envia botões interativos (fire-and-forget; resposta vazia para não duplicar sendText)
    sendButtons(
      phone,
      "Salvar como...",
      `"${analysis.cleanContent.slice(0, 80)}"`,
      [
        { id: "note_note",     text: "📝 Anotação" },
        { id: "note_reminder", text: "🔔 Lembrete" },
        { id: "note_cancel",   text: "❌ Cancelar" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "notes_save",
      pendingContext: pendingCtx,
    };
  }

  // Se parece um evento → pergunta o que fazer
  if (analysis.looksLikeEvent) {
    const pendingCtxEvent = {
      step: "note_or_event_choice",
      cleanContent: analysis.cleanContent,
      suggestedTitle: analysis.suggestedTitle,
      needsMoreInfo: analysis.needsMoreInfo,
      moreInfoQuestion: analysis.moreInfoQuestion,
      originalMessage: message,
    };
    sendButtons(
      phone,
      "Isso parece um compromisso! 📅",
      `"${analysis.suggestedTitle || analysis.cleanContent.slice(0, 60)}"`,
      [
        { id: "note_agenda",  text: "📅 Adicionar à agenda" },
        { id: "note_note",    text: "📝 Salvar como nota" },
        { id: "note_cancel",  text: "❌ Cancelar" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "notes_save",
      pendingContext: pendingCtxEvent,
    };
  }

  // Se precisa de mais info mas é nota mesmo → salva e pergunta detalhes
  const { error } = await supabase.from("notes").insert({
    user_id: userId,
    title: analysis.suggestedTitle || null,
    content: analysis.cleanContent,
    source: "whatsapp",
  });
  if (error) throw error;
  syncNotion(userId, analysis.cleanContent).catch(() => {});

  // Pergunta se quer lembrete (usando template personalizado do usuário)
  let responseText = buildNoteResponse(analysis.cleanContent);

  // Se tem mais info a perguntar, adiciona após confirmar lembrete
  if (analysis.needsMoreInfo && analysis.moreInfoQuestion) {
    const noteLine = applyTemplate(tplNote, { content: analysis.cleanContent, user_name: userNickname });
    responseText = `${noteLine}\n\n${analysis.moreInfoQuestion}\n\n_Ou diga "não precisa" para pular_`;
    // Vai aguardar resposta de mais info e depois oferecer lembrete
    return {
      response: responseText,
      pendingAction: "notes_save",
      pendingContext: {
        step: "note_extra_info",
        noteId: null, // already saved
        noteTitle: analysis.suggestedTitle || analysis.cleanContent.slice(0, 40),
        cleanContent: analysis.cleanContent,
      },
    };
  }

  return {
    response: responseText,
    pendingAction: "notes_save",
    pendingContext: {
      step: "note_reminder_offer",
      noteTitle: analysis.suggestedTitle || analysis.cleanContent.slice(0, 40),
    },
  };
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── Validação de origem: Evolution API envia seu apikey no header ────────
  const incomingKey = req.headers.get("apikey") ?? "";
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
  if (evolutionKey && incomingKey && incomingKey !== evolutionKey) {
    console.warn("[webhook] Rejected request with invalid apikey header");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Apenas mensagens recebidas (não enviadas pelo bot)
  const event = body.event as string;
  if (event !== "messages.upsert") {
    return new Response("OK");
  }

  // Suporta data como objeto ou array (diferentes versões do Evolution API)
  const rawData = body.data;
  const data = (Array.isArray(rawData) ? rawData[0] : rawData) as Record<string, unknown>;
  const key = data?.key as Record<string, unknown>;

  if (key?.fromMe) {
    return new Response("OK");
  }

  // ── Deduplicação atômica ─────────────────────────────────────────────────
  // Usa INSERT com PRIMARY KEY para garantir que apenas UMA invocação processa
  // o mesmo messageId, mesmo que o Evolution/Baileys dispare o webhook 2x
  // simultaneamente (race condition que o antigo SELECT+UPSERT não cobria).
  const messageId = key?.id as string;
  if (messageId) {
    const { error: dedupErr } = await (supabase as any)
      .from("processed_messages")
      .insert({ message_id: messageId });

    if (dedupErr) {
      // Código 23505 = unique_violation → mensagem já foi processada
      if (dedupErr.code === "23505") {
        console.log("[dedup] messageId já processado, ignorando:", messageId);
        return new Response("OK");
      }
      // Outro erro de DB — loga mas não bloqueia (evita perder mensagens)
      console.warn("[dedup] erro ao inserir processed_message:", dedupErr.message);
    }
  }

  const remoteJid = key?.remoteJid as string;

  if (!remoteJid || remoteJid.endsWith("@g.us")) {
    return new Response("OK");
  }

  // ── Rate Limiting ────────────────────────────────────────────────────────
  const phoneForLimit = remoteJid.replace(/@.*$/, "");
  const rateCheck = await checkRateLimit(phoneForLimit);
  if (!rateCheck.allowed) {
    if (rateCheck.reason === "rate_exceeded") {
      // Send one-time warning (fire-and-forget, don't await to avoid loop)
      sendText(remoteJid, "⚠️ Muitas mensagens em pouco tempo. Sua conta foi temporariamente limitada por 1 hora.").catch(() => {});
      await logError({
        context: "whatsapp-webhook/rate-limit",
        message: `Rate limit exceeded for ${phoneForLimit}`,
        phone_number: phoneForLimit,
      });
    }
    return new Response("OK"); // silent drop for "blocked" state
  }

  // Determina o identificador: LID (@lid) ou telefone (@s.whatsapp.net)
  const isLid = remoteJid.endsWith("@lid");
  const lid = isLid ? remoteJid : null;
  // Para enviar respostas, usamos o remoteJid direto (Evolution aceita LID no sendText)
  const replyTo = remoteJid;

  const messageData = data?.message as Record<string, unknown>;

  // Detecta resposta de botao interativo (buttonsResponseMessage do Evolution API v2)
  const buttonResp = messageData?.buttonsResponseMessage as Record<string, unknown> | undefined;
  const buttonId = buttonResp?.selectedButtonId as string | undefined;

  const extTextMsg = messageData?.extendedTextMessage as Record<string, unknown> | undefined;
  const text =
    (buttonId ? `BUTTON:${buttonId}` : null) ||
    (messageData?.conversation as string) ||
    (extTextMsg?.text as string);

  const pushName = (data?.pushName as string) || "";

  // ─── Detecção de tipos de mídia ─────────────────────────────────────────
  // Evolution API v2 pode empacotar imagens em viewOnceMessage, viewOnceMessageV2 etc.
  // Estratégia: tenta messageData.imageMessage direto primeiro, depois desembrulha wrappers
  const _imgDirect = messageData?.imageMessage as Record<string, unknown> | undefined;
  const _viewOnce = (messageData?.viewOnceMessage as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const _viewOnceV2 = ((messageData?.viewOnceMessageV2 as Record<string, unknown>)?.message as Record<string, unknown>)?.imageMessage as Record<string, unknown> | undefined;
  const _ephemeral = (messageData?.ephemeralMessage as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const imgMsg =
    _imgDirect ??
    (_viewOnce?.imageMessage as Record<string, unknown> | undefined) ??
    _viewOnceV2 ??
    (_ephemeral?.imageMessage as Record<string, unknown> | undefined);

  // Fallback: Evolution API sinaliza tipo no campo messageType
  const _messageType = (data?.messageType as string | undefined) ?? "";
  const isImageByType = _messageType === "imageMessage" || _messageType === "viewOnceMessageV2";

  const audioMsgRaw = (messageData?.audioMessage ?? messageData?.pttMessage) as Record<string, unknown> | undefined;
  const docMsg = messageData?.documentMessage as Record<string, unknown> | undefined;

  const ctxInfo =
    (extTextMsg?.contextInfo as Record<string, unknown>) ??
    (imgMsg?.contextInfo as Record<string, unknown>) ??
    (audioMsgRaw?.contextInfo as Record<string, unknown>) ??
    (docMsg?.contextInfo as Record<string, unknown>);

  const isForwarded = !!(ctxInfo?.isForwarded) || ((ctxInfo?.forwardingScore as number ?? 0) > 0);

  // ─── Detecção de reply em mensagem cross-Jarvis ────────────────────────────
  // Quando um usuário Jarvis recebe msg enviada pelo Jarvis de outro cliente e
  // responde via botão de reply, o quotedMessage vai conter nossa assinatura.
  const quotedMsg = ctxInfo?.quotedMessage as Record<string, unknown> | undefined;
  const quotedText: string =
    (quotedMsg?.conversation as string) ??
    ((quotedMsg?.extendedTextMessage as Record<string, unknown>)?.text as string) ??
    "";
  // ── ORDER SESSION CHECK (top-level) — intercepta QUALQUER mensagem de estabelecimento ──
  // Roda ANTES de tudo porque o estabelecimento NÃO é cliente Jarvis.
  // Resolve LID→telefone via conversations e tenta o match.
  if (text?.trim()) {
    try {
      const senderRaw = remoteJid.replace(/@.*$/, "");
      const senderDigits = senderRaw.replace(/[:\D]/g, "");
      let resolvedPhone = senderDigits;

      // Se veio como @lid, resolve pra telefone real via conversations
      if (remoteJid.endsWith("@lid")) {
        const lidBase = senderRaw.replace(/:.*$/, "");
        const { data: convRow } = await supabase
          .from("conversations")
          .select("phone_number")
          .like("whatsapp_lid", `${lidBase}%`)
          .limit(1)
          .maybeSingle();
        if (convRow?.phone_number) {
          resolvedPhone = (convRow.phone_number as string).replace(/\D/g, "");
        }
      }

      if (resolvedPhone.length >= 10) {
        const orderHandled = await handleActiveOrderSession(resolvedPhone, text.trim());
        if (orderHandled) {
          return new Response(JSON.stringify({ ok: true, order_session: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } catch (e) {
      console.error("[order-toplevel] error:", e);
    }
  }

  const isCrossJarvisReply =
    quotedText.includes("heyjarvis.com.br") ||
    quotedText.includes("assistente virtual do") ||
    quotedText.includes("assistente virtual de");

  if (isCrossJarvisReply) {
    // Checa se o remetente é um usuário registrado do Hey Jarvis
    const { profile: senderProfile } = await resolveProfileForShadow(replyTo, lid);
    if (senderProfile) {
      // É um cliente Jarvis! Manda a mensagem especial e encerra sem processar como intent normal
      const firstName = pushName?.split(" ")[0] || "você";
      await sendText(replyTo,
        `Que coincidência, *${firstName}*! 😄\n\n` +
        `Você acabou de receber uma mensagem enviada pelo agente de outro cliente do *Hey Jarvis*! 🤖✨\n\n` +
        `Somos todos família por aqui! haha\n\n` +
        `Posso te ajudar com mais alguma coisa? 😊`
      );
      return new Response("OK");
    }
    // Não é usuário Jarvis e não tem order_session → ignora silenciosamente
    return new Response("OK");
  }

  // ─── Áudio (ptt = push-to-talk / audioMessage) ───────────────────────────
  if (audioMsgRaw) {
    const media = await downloadMediaBase64(data);
    if (media) {
      let transcription = "";
      try {
        transcription = await transcribeAudio(media.base64, media.mimetype);
      } catch (e) {
        console.error("Transcription error:", e);
        await sendText(replyTo, "⚠️ Não consegui transcrever o áudio. Tente enviar uma mensagem de texto.");
        return new Response("OK");
      }
      if (!transcription) {
        await sendText(replyTo, "⚠️ Não entendi o áudio. Pode repetir por texto?");
        return new Response("OK");
      }

      // Se audio encaminhado → Modo Sombra: classificar via analyzeForwardedContent
      if (isForwarded) {
        const shadowResult = await handleShadowMode(replyTo, transcription, null, lid, messageId, pushName);
        return new Response(JSON.stringify({ ok: true, shadow: true, debug: shadowResult }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const debugResult = await processMessage(replyTo, transcription, lid, messageId, pushName, transcription);
      return new Response(JSON.stringify({ ok: true, transcription, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      console.error("[audio] Failed to download media from Evolution API");
      await sendText(replyTo, "⚠️ Não consegui baixar o áudio. Pode tentar enviar de novo?");
    }
    return new Response("OK");
  }

  // ─── Imagem (nota fiscal / recibo / foto encaminhada) ────────────────────
  if (imgMsg || isImageByType) {
    console.log("[image] detected — imgMsg:", !!imgMsg, "isImageByType:", isImageByType, "messageType:", _messageType);
    const media = await downloadMediaBase64(data);
    if (media) {
      const caption = (imgMsg?.caption as string | undefined) || "";
      const debugResult = await processImageMessage(
        replyTo, media.base64, media.mimetype, lid, messageId, pushName, isForwarded, caption
      );
      return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // Download falhou — avisa o usuário em vez de silêncio
    console.error("[image] downloadMediaBase64 returned null for", replyTo, "messageType:", _messageType);
    await sendText(replyTo, "⚠️ Não consegui processar a imagem. Pode tentar enviar de novo? Se o problema persistir, descreva a transação por texto: _gastei R$X em Y_");
    return new Response("OK");
  }

  // ─── Documento (PDF / boleto) ────────────────────────────────────────────
  if (docMsg) {
    const debugResult = await handleDocumentMessage(replyTo, data, docMsg, lid, messageId, pushName, isForwarded);
    return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ─── Contato vCard compartilhado ─────────────────────────────────────────
  const messageType = data?.messageType as string | undefined;
  const contactMsg = messageData?.contactMessage as Record<string, unknown> | undefined;
  const contactsArrayMsg = messageData?.contactsArrayMessage as Record<string, unknown> | undefined;

  // Log SEMPRE quando não tem texto — ajuda a diagnosticar tipos desconhecidos
  if (!text?.trim()) {
    console.log("[no-text] messageType:", messageType,
      "| keys:", Object.keys(messageData ?? {}),
      "| contactMsg:", !!contactMsg,
      "| contactsArrayMsg:", !!contactsArrayMsg,
      "| raw messageData:", JSON.stringify(messageData ?? {}).slice(0, 300));
  }

  const isContactMsg =
    !!contactMsg ||
    !!contactsArrayMsg ||
    messageType === "contactMessage" ||
    messageType === "contactsArrayMessage";

  if (isContactMsg) {
    const payload = contactMsg ?? contactsArrayMsg ?? messageData ?? {};
    console.log("[contact-detect] matched! payload keys:", Object.keys(payload));
    const debugResult = await handleContactMessage(payload, replyTo, lid);
    return new Response(JSON.stringify({ ok: true, contact: true, debug: debugResult }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!text?.trim()) {
    return new Response("OK");
  }

  // ─── Detecção de contato enviado como texto (Nome + número) ──────────────
  // Ex: "João Silva\n11 99999-9999" ou "Cibele: 11988887777"
  // Só dispara se a mensagem for curta (não é chat normal) e tiver nome + número
  if (!isForwarded && text.trim().length < 120) {
    const hasPhone = /\b\d[\d\s\-().]{7,}\d\b/.test(text);
    const hasName = /[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]{2,}/.test(text);
    const looksLikeContact = hasPhone && hasName &&
      !/\b(gasto|receita|pix|transferencia|reais|r\$|\d+:\d+|hoje|amanha|agenda|lembrete|tarefa)\b/i.test(text);

    if (looksLikeContact) {
      // Trata como contact_save — redireciona para processMessage que tem o handler
      const debugResult = await processMessage(replyTo, `salva o contato ${text.trim()}`, lid, messageId, pushName);
      return new Response(JSON.stringify({ ok: true, auto_contact: true, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ─── Modo Sombra: texto encaminhado ──────────────────────────────────────
  if (isForwarded && text.trim()) {
    // Se usuario encaminhou + digitou algo que classifyIntent reconhece → usa fluxo normal
    const forwardedIntent = classifyIntent(text.trim());
    if (forwardedIntent !== "ai_chat" && forwardedIntent !== "greeting") {
      // Usuario deu comando explicito junto com o encaminhamento → fluxo normal
      const debugResult = await processMessage(replyTo, text.trim(), lid, messageId, pushName);
      return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // Texto encaminhado puro → Modo Sombra
    const shadowResult = await handleShadowMode(replyTo, text.trim(), null, lid, messageId, pushName);
    return new Response(JSON.stringify({ ok: true, shadow: true, debug: shadowResult }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Processa e responde (síncrono para garantir execução)
  // Passa o quotedText se for reply — assim o Jarvis sabe a qual mensagem dele o usuário está respondendo
  const debugResult = await processMessage(replyTo, text.trim(), lid, messageId, pushName, undefined, quotedText);

  return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ─────────────────────────────────────────────
// LISTAR LEMBRETES
// ─────────────────────────────────────────────
async function handleReminderList(
  userId: string,
  lang = "pt-BR",
  userTz = "America/Sao_Paulo"
): Promise<string> {
  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, title, message, send_at, recurrence, recurrence_value, status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("send_at", { ascending: true })
    .limit(8);

  if (!reminders || reminders.length === 0) {
    return lang === "en"
      ? "📭 You have no pending reminders.\n\nTo create one: _\"remind me of X tomorrow at 10am\"_ ⏰"
      : "📭 Você não tem lembretes pendentes no momento.\n\nPara criar: _\"me lembra de X amanhã às 10h\"_ ⏰";
  }

  const locale = langToLocale(lang);
  const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const lines = reminders.map((r, i) => {
    const dt = new Date(r.send_at);
    const dateStr = dt.toLocaleDateString(locale, { timeZone: userTz, weekday: "short", day: "numeric", month: "short" });
    const timeStr = dt.toLocaleTimeString(locale, { timeZone: userTz, hour: "2-digit", minute: "2-digit" });
    const title = (r.title || r.message || "").slice(0, 50);
    let recLabel = "";
    if (r.recurrence === "daily") recLabel = " 🔁 todo dia";
    else if (r.recurrence === "weekly") recLabel = ` 🔁 toda ${r.recurrence_value != null ? WEEKDAYS_PT[r.recurrence_value] : "semana"}`;
    else if (r.recurrence === "monthly") recLabel = " 🔁 todo mês";
    else if (r.recurrence === "day_of_month") recLabel = ` 🔁 dia ${r.recurrence_value} do mês`;
    else if (r.recurrence === "hourly") recLabel = ` 🔁 a cada ${r.recurrence_value ?? 1}h`;
    return `${i + 1}. *${title}*\n   📅 ${dateStr} às ${timeStr}${recLabel}`;
  });

  const header = lang === "en" ? "⏰ *Your pending reminders:*\n\n" : "⏰ *Seus lembretes pendentes:*\n\n";
  const footer = lang === "en"
    ? "\n\n_To cancel: \"cancel reminder [name]\"_\n_To edit: \"change reminder [name] to [time]\"_"
    : "\n\n_Para cancelar: \"cancela o lembrete de [nome]\"_\n_Para editar: \"muda o lembrete de [nome] para [hora]\"_";
  return header + lines.join("\n\n") + footer;
}

// ─────────────────────────────────────────────
// CANCELAR LEMBRETE
// ─────────────────────────────────────────────
async function handleReminderCancel(
  userId: string,
  message: string,
  lang = "pt-BR"
): Promise<string> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const m = norm(message);

  // Extrai o que quer cancelar (tudo depois de "cancela o lembrete de ...")
  const searchMatch = m.match(
    /(?:cancela(?:r)?|remove(?:r)?|apaga(?:r)?|deleta(?:r)?|exclui(?:r)?)(?:\s+o)?(?:\s+lembrete)?(?:\s+d[eo])?\s+(.+)/
  );
  const searchTerm = searchMatch?.[1]?.trim();

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, title, message, send_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("send_at", { ascending: true });

  if (!reminders || reminders.length === 0) {
    return lang === "en"
      ? "📭 You have no pending reminders to cancel."
      : "📭 Você não tem lembretes pendentes para cancelar.";
  }

  // Helper local: formata lista de lembretes pendentes (evita redeclarar const)
  const fmtPendingList = () => reminders.slice(0, 4).map(r => `• ${r.title || r.message.slice(0, 40)}`).join("\n");

  if (!searchTerm) {
    return `Qual lembrete quer cancelar? Seus lembretes pendentes:\n\n${fmtPendingList()}\n\nEx: _"cancela o lembrete de pagar aluguel"_`;
  }

  // Busca melhor match — 3 estratégias em cascata:
  // 1) Contém o searchTerm exato no título
  let match = reminders.find(r => {
    const t = norm(r.title ?? r.message ?? "");
    return t.includes(searchTerm) || searchTerm.includes(t.slice(0, 12));
  });

  // 2) Qualquer palavra com 4+ letras do searchTerm aparece no título
  if (!match) {
    const keywords = searchTerm.split(/\s+/).filter(w => w.length >= 4);
    match = reminders.find(r => {
      const t = norm(r.title ?? r.message ?? "");
      return keywords.some(w => t.includes(w));
    });
  }

  // 3) Para lembretes "Mensagem para X": testa se o nome do contato está no searchTerm
  if (!match) {
    match = reminders.find(r => {
      const t = norm(r.title ?? r.message ?? "");
      if (!t.startsWith("mensagem para ")) return false;
      const contactName = t.replace("mensagem para ", "").trim();
      return searchTerm.includes(contactName) ||
        contactName.split(" ").some(w => w.length >= 3 && searchTerm.includes(w));
    });
  }

  if (!match) {
    return `Não encontrei esse lembrete. Seus pendentes:\n\n${fmtPendingList()}\n\nTente o nome exato.`;
  }

  // Cancela este e todas as recorrências futuras com o mesmo título (ou só pelo id se título nulo)
  if (match.title) {
    await supabase.from("reminders")
      .update({ status: "cancelled" })
      .eq("user_id", userId)
      .eq("title", match.title)
      .eq("status", "pending");
  } else {
    await supabase.from("reminders")
      .update({ status: "cancelled" })
      .eq("id", match.id);
  }

  const title = match.title || match.message.slice(0, 40);
  return lang === "en"
    ? `✅ Reminder *"${title}"* cancelled! All future recurrences were also removed.`
    : `✅ Lembrete *"${title}"* cancelado! Todas as recorrências futuras também foram removidas.`;
}

// ─────────────────────────────────────────────
// EDITAR LEMBRETE (mudar horário/dia)
// ─────────────────────────────────────────────
async function handleReminderEdit(
  userId: string,
  message: string,
  lang = "pt-BR",
  userTz = "America/Sao_Paulo"
): Promise<string> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const tzOff = getTzOffset(userTz);
  const nowIso = new Date().toLocaleString("sv-SE", { timeZone: userTz, hour12: false }).replace(" ", "T") + tzOff;

  // Extrai o nome do lembrete e novo horário com IA
  const parsed = await parseReminderIntent(message, nowIso, lang);

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, title, message, send_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("send_at", { ascending: true });

  if (!reminders || reminders.length === 0) {
    return lang === "en"
      ? "📭 You have no pending reminders to edit."
      : "📭 Você não tem lembretes pendentes para editar.";
  }

  // Tenta achar o lembrete pelo título na mensagem
  const m = norm(message);
  let match = reminders.find(r => {
    const t = norm(r.title ?? r.message ?? "");
    return t.split(" ").some(word => word.length > 4 && m.includes(word));
  });
  // Fallback: o mais próximo em tempo
  if (!match) match = reminders[0];

  if (!parsed) {
    return `Não entendi o novo horário. Ex: _"muda o lembrete de ${match.title?.slice(0, 20) ?? "X"} para 19h"_`;
  }

  const newDate = new Date(parsed.remind_at);
  if (isNaN(newDate.getTime())) {
    return "Não consegui identificar o novo horário. Pode repetir?";
  }

  const { error } = await supabase.from("reminders")
    .update({ send_at: newDate.toISOString(), status: "pending" })
    .eq("id", match.id);

  if (error) throw error;

  const locale = langToLocale(lang);
  const dateStr = newDate.toLocaleDateString(locale, { timeZone: userTz, weekday: "long", day: "numeric", month: "long" });
  const timeStr = newDate.toLocaleTimeString(locale, { timeZone: userTz, hour: "2-digit", minute: "2-digit" });
  const title = match.title || match.message.slice(0, 40);

  return lang === "en"
    ? `✅ Reminder *"${title}"* rescheduled!\n📅 ${dateStr} at ${timeStr}`
    : `✅ Lembrete *"${title}"* reagendado!\n📅 ${dateStr} às ${timeStr}`;
}

// ─────────────────────────────────────────────
// LEMBRETE AVULSO (com recorrência)
// ─────────────────────────────────────────────
async function handleReminderSet(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null = null,
  lang = "pt-BR",
  userNickname: string | null = null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const tzOff = getTzOffset(userTz);
  const nowIso = new Date().toLocaleString("sv-SE", {
    timeZone: userTz,
    hour12: false,
  }).replace(" ", "T") + tzOff;

  // ── Recupera contexto pendente (fluxo de antecedência) ──
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const step = (ctx.step as string) ?? null;

  // ─── STEP: reminder_advance_confirm ───
  // Usuário respondeu ao botão "Quer que eu te avise antes?"
  if (step === "reminder_advance_confirm") {
    const parsed = ctx.parsed as Record<string, unknown>;
    const remindAt = new Date(parsed.remind_at as string);
    const msgLow = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    const wantsAdvance =
      msgLow === "button:advance_confirm_yes" ||
      msgLow === "1" ||
      /^(sim|quero|pode|s|yes|claro|ok|confirma|obrigad)/.test(msgLow);
    // Note: "2" ("Só na hora") falls through naturally to saveReminder(0) below

    if (wantsAdvance) {
      // Envia botões de opções de tempo (fire-and-forget)
      sendButtons(
        phone,
        "Com quanto tempo antes?",
        `Vou te avisar antes de: "${parsed.title}"`,
        [
          { id: "advance_15min", text: "15 minutos" },
          { id: "advance_30min", text: "30 minutos" },
          { id: "advance_1h",    text: "1 hora" },
        ]
      ).catch(() => {});
      return {
        response: "",
        pendingAction: "reminder_set",
        pendingContext: { step: "reminder_advance", parsed },
      };
    }

    // Não quer aviso antecipado → salva na hora exata
    return await saveReminder(userId, phone, parsed, remindAt, 0, lang, userNickname, userTz);
  }

  // ─── STEP: reminder_advance ───
  // Usuário está respondendo com quanto tempo antes quer ser avisado
  if (step === "reminder_advance") {
    const parsed = ctx.parsed as Record<string, unknown>;
    const remindAt = new Date(parsed.remind_at as string);
    const msgLow = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Mapeamento de button IDs para minutos
    const buttonAdvanceMap: Record<string, number> = {
      "button:advance_15min": 15,
      "button:advance_30min": 30,
      "button:advance_1h":    60,
      "button:advance_2h":    120,
      "1": 15, "2": 30, "3": 60,   // fallback para texto numerado (Baileys)
    };
    if (buttonAdvanceMap[msgLow] !== undefined) {
      const advMin = buttonAdvanceMap[msgLow];
      const advancedTime = new Date(remindAt.getTime() - advMin * 60 * 1000);
      return await saveReminder(userId, phone, parsed, advancedTime, advMin, lang, userNickname, userTz);
    }

    // ── Detecta se usuário está especificando recorrência na resposta ──
    const msgNorm = msgLow;
    const recurrenceUpdate = detectRecurrenceFromText(msgNorm, remindAt);
    if (recurrenceUpdate) {
      const updatedParsed = {
        ...parsed,
        recurrence: recurrenceUpdate.recurrence,
        recurrence_value: recurrenceUpdate.recurrence_value,
      };
      return await saveReminder(userId, phone, updatedParsed, remindAt, 0, lang, userNickname, userTz);
    }

    // "só na hora" / "na hora" → 0 min de antecedência (avisa exatamente no horário)
    if (isReminderAtTime(message)) {
      return await saveReminder(userId, phone, parsed, remindAt, 0, lang, userNickname, userTz);
    }
    // "não precisa" → avisa na hora mesmo (sem antecedência adicional)
    if (isReminderDecline(message)) {
      return await saveReminder(userId, phone, parsed, remindAt, 0, lang, userNickname, userTz);
    }
    // Tenta extrair minutos de antecedência
    const advanceMin = parseMinutes(message);
    if (advanceMin !== null && advanceMin > 0) {
      const advancedTime = new Date(remindAt.getTime() - advanceMin * 60 * 1000);
      return await saveReminder(userId, phone, parsed, advancedTime, advanceMin, lang, userNickname, userTz);
    }
    // Não entendeu → reenvia botões
    sendButtons(
      phone,
      "Com quanto tempo antes?",
      `Vou te avisar antes de: "${(parsed as Record<string, unknown>).title}"`,
      [
        { id: "advance_15min", text: "15 minutos" },
        { id: "advance_30min", text: "30 minutos" },
        { id: "advance_1h",    text: "1 hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "reminder_set",
      pendingContext: ctx,
    };
  }

  // ── Extrai intenção do lembrete com IA ──
  const parsed = await parseReminderIntent(message, nowIso, lang);

  if (!parsed) {
    return { response: "⚠️ Não entendi o lembrete. Tente: *me lembra de ligar pro João amanhã às 14h*" };
  }

  const remindAt = new Date(parsed.remind_at);
  if (isNaN(remindAt.getTime())) {
    return { response: "⚠️ Não consegui identificar a data/hora. Pode repetir com mais detalhes?" };
  }

  if (remindAt <= new Date()) {
    remindAt.setDate(remindAt.getDate() + 1);
  }

  // ── Garante que recorrência detectada via regex prevaleça sobre IA ──
  // Evita que o Haiku retorne "none" para mensagens recorrentes claras
  const msgNormFull = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const regexRecurrence = detectRecurrenceFromText(msgNormFull, remindAt);
  if (regexRecurrence && parsed.recurrence === "none") {
    parsed.recurrence = regexRecurrence.recurrence as typeof parsed.recurrence;
    parsed.recurrence_value = regexRecurrence.recurrence_value;
  }

  // ── Pergunta com quanto tempo de antecedência ──
  // Só pergunta se o lembrete NÃO é recorrente nem tem "na hora" explícito
  // Para recorrentes: salva direto sem perguntar (não faz sentido perguntar antecedência para lembrete diário)
  const msgLower = message.toLowerCase();
  const mentionedAdvance = /antes|antecedência|antecipado|minutos? antes|horas? antes/.test(msgLower);
  const atTimeNow = isReminderAtTime(msgLower);

  // Pergunta antecedência só se: sem recorrência, sem "na hora" explícito,
  // sem "antes" na mensagem, E o lembrete é para daqui mais de 45 minutos
  // (não faz sentido perguntar antecedência de "daqui 5 minutos")
  const minutesUntilReminder = (remindAt.getTime() - Date.now()) / 60000;
  const isSoonReminder = minutesUntilReminder < 45;

  if (!mentionedAdvance && !atTimeNow && !isSoonReminder && parsed.recurrence === "none") {
    const locale = langToLocale(lang);
    const timeStr = remindAt.toLocaleTimeString(locale, {
      timeZone: userTz,
      hour: "2-digit", minute: "2-digit",
    });
    const dateStr = remindAt.toLocaleDateString(locale, {
      timeZone: userTz,
      weekday: "long", day: "numeric", month: "long",
    });
    // Pergunta via botões: Quer aviso antecipado?
    sendButtons(
      phone,
      "Quer que eu te avise antes? ⏱️",
      `Lembrete: "${parsed.title}" — ${dateStr} às ${timeStr}`,
      [
        { id: "advance_confirm_yes", text: "⏰ Sim, me avisa antes" },
        { id: "advance_confirm_no",  text: "✅ Só na hora" },
      ]
    ).catch(() => {});
    return {
      response: "",
      pendingAction: "reminder_set",
      pendingContext: { step: "reminder_advance_confirm", parsed },
    };
  }

  // Tem antecedência explícita na mensagem → salva direto
  return await saveReminder(userId, phone, parsed, remindAt, 0, lang, userNickname, userTz);
}

/** Salva o lembrete no banco e retorna confirmação formatada */
async function saveReminder(
  userId: string,
  phone: string,
  parsed: Record<string, unknown>,
  remindAt: Date,
  advanceMin: number,
  lang = "pt-BR",
  userNickname: string | null = null,
  userTz = "America/Sao_Paulo"
): Promise<{ response: string }> {
  // ── Limite de lembretes pendentes por usuário (evita abuso) ──
  const { count: pendingCount } = await supabase
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending") as any;

  if ((pendingCount ?? 0) >= 50) {
    return {
      response: lang === "en"
        ? "⚠️ You've reached the limit of 50 pending reminders. Cancel some before creating new ones.\n\nSay: _\"show my reminders\"_ to see them."
        : "⚠️ Você tem muitos lembretes pendentes (máximo 50). Cancele alguns antes de criar novos.\n\nDiga: _\"meus lembretes\"_ para ver a lista.",
    };
  }

  const { error } = await supabase.from("reminders").insert({
    user_id: userId,
    whatsapp_number: phone,
    title: parsed.title,
    message: parsed.message,
    send_at: remindAt.toISOString(),
    recurrence: parsed.recurrence,
    recurrence_value: parsed.recurrence_value,
    source: "whatsapp",
    status: "pending",
  });

  if (error) throw error;

  const locale = langToLocale(lang);
  const dateRaw = remindAt.toLocaleDateString(locale, {
    timeZone: userTz,
    weekday: "long", day: "numeric", month: "long",
  });
  const dateStr = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  const timeStr = remindAt.toLocaleTimeString(locale, {
    timeZone: userTz,
    hour: "2-digit", minute: "2-digit",
  });

  const rv = parsed.recurrence_value as number | null;
  const recurrenceLabel: Record<string, string> = lang === "en" ? {
    none: "",
    hourly: `\n🔁 *Recurring:* every ${rv === 1 || rv == null ? "hour" : `${rv} hours`}`,
    daily: "\n🔁 *Recurring:* every day",
    weekly: "\n🔁 *Recurring:* every week",
    monthly: "\n🔁 *Recurring:* every month",
    day_of_month: `\n🔁 *Recurring:* every ${rv ?? ""} of the month`,
  } : lang === "es" ? {
    none: "",
    hourly: `\n🔁 *Recurrente:* cada ${rv === 1 || rv == null ? "hora" : `${rv} horas`}`,
    daily: "\n🔁 *Recurrente:* todos los días",
    weekly: "\n🔁 *Recurrente:* todas las semanas",
    monthly: "\n🔁 *Recurrente:* todos los meses",
    day_of_month: `\n🔁 *Recurrente:* cada día ${rv ?? ""} del mes`,
  } : {
    none: "",
    hourly: `\n🔁 *Recorrente:* a cada ${rv === 1 || rv == null ? "hora" : `${rv} horas`}`,
    daily: "\n🔁 *Recorrente:* todo dia",
    weekly: "\n🔁 *Recorrente:* toda semana",
    monthly: "\n🔁 *Recorrente:* todo mês",
    day_of_month: `\n🔁 *Recorrente:* todo dia ${rv ?? ""} do mês`,
  };

  const advanceNote = advanceMin > 0
    ? (lang === "en"
        ? `\n🔔 Alert ${fmtAdvanceLabel(advanceMin, lang)} before`
        : lang === "es"
        ? `\n🔔 Aviso ${fmtAdvanceLabel(advanceMin, lang)} antes`
        : `\n🔔 Aviso ${fmtAdvanceLabel(advanceMin, lang)} antes`)
    : (lang === "en" ? "\n🔔 Alert at reminder time" : lang === "es" ? "\n🔔 Aviso en el horario" : "\n🔔 Aviso na hora");

  const nameGreetReminder = userNickname ? `, ${userNickname}` : "";
  return {
    response: `⏰ *Lembrete criado${nameGreetReminder}!*\n📌 ${parsed.title}\n📅 ${dateStr} às ${timeStr}${advanceNote}${recurrenceLabel[String(parsed.recurrence)] ?? ""}\n\n_Vou te avisar aqui no WhatsApp!_`,
  };
}

// ─────────────────────────────────────────────
// SNOOZE — adia o último lembrete enviado
// ─────────────────────────────────────────────
async function handleReminderSnooze(
  userId: string,
  phone: string,
  message: string,
  userTz = "America/Sao_Paulo"
): Promise<string> {
  // Busca o lembrete enviado mais recentemente (nos últimos 30 min)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: lastReminder } = await supabase
    .from("reminders")
    .select("id, title, message, event_id, whatsapp_number")
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("sent_at", thirtyMinAgo)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastReminder) {
    return "Não encontrei nenhum lembrete recente para adiar. 🔍\n\n_O snooze funciona quando enviado em até 30 minutos após um lembrete._";
  }

  // Extrai duração do snooze da mensagem (padrão: 30 min)
  const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let snoozeMin = 30;

  const hoursMatch = m.match(/(\d+(?:[.,]\d+)?)\s*hora/);
  if (hoursMatch) {
    snoozeMin = Math.round(parseFloat(hoursMatch[1].replace(",", ".")) * 60);
  } else if (/meia hora/.test(m)) {
    snoozeMin = 30;
  } else {
    const minsMatch = m.match(/(\d+)\s*(?:min|minutos?)?/);
    if (minsMatch && parseInt(minsMatch[1]) > 0 && parseInt(minsMatch[1]) <= 480) {
      snoozeMin = parseInt(minsMatch[1]);
    }
  }

  // Garante snooze razoável: entre 5 e 8h
  snoozeMin = Math.max(5, Math.min(snoozeMin, 480));

  const newSendAt = new Date(Date.now() + snoozeMin * 60 * 1000);

  await supabase.from("reminders").insert({
    user_id: userId,
    whatsapp_number: lastReminder.whatsapp_number ?? phone,
    title: lastReminder.title,
    message: lastReminder.message,
    send_at: newSendAt.toISOString(),
    event_id: lastReminder.event_id ?? null,
    recurrence: "none",
    source: "snooze",
    status: "pending",
  });

  const timeStr = newSendAt.toLocaleTimeString("pt-BR", {
    timeZone: userTz,
    hour: "2-digit",
    minute: "2-digit",
  });

  const label =
    snoozeMin >= 60
      ? `${snoozeMin / 60 === Math.floor(snoozeMin / 60) ? snoozeMin / 60 + " hora" + (snoozeMin / 60 > 1 ? "s" : "") : snoozeMin + " min"}`
      : `${snoozeMin} min`;

  return `⏰ *Lembrete adiado por ${label}!*\nVou te avisar novamente às *${timeStr}*.\n\n_"${lastReminder.title}"_`;
}

// ─────────────────────────────────────────────
// EVENT FOLLOWUP — confirma se o evento aconteceu
// ─────────────────────────────────────────────
async function handleEventFollowup(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown>
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const eventId = ctx?.event_id as string | undefined;
  const eventTitle = (ctx?.event_title as string) || "seu compromisso";

  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // ✅ Confirmação positiva
  if (/^(sim|s|feito|foi|aconteceu|consegui|concluido|ok|yes|fui|rolou|deu certo|certo|boa|foi sim|sim fui)$/.test(m)) {
    if (eventId) {
      await supabase
        .from("events")
        .update({ status: "done" })
        .eq("id", eventId)
        .eq("user_id", userId);
    }
    return { response: `✅ *${eventTitle}* marcado como concluído! Ótimo trabalho! 💪` };
  }

  // 🔄 Quer adiar/reagendar
  if (/^(adiar|nao|não|n|nope|nao fui|nao consegui|nao rolou|reagendar|remarcar|cancelar)$/.test(m) ||
      /nao (fui|consegui|foi|rolou|aconteceu)/.test(m)) {
    // Busca data/hora do evento no banco para passar ao edit flow
    let eventDate = ctx.event_date as string | undefined;
    let eventTime = ctx.event_time as string | undefined;
    if (eventId && (!eventDate || !eventTime)) {
      const { data: ev } = await supabase
        .from("events")
        .select("event_date, event_time")
        .eq("id", eventId)
        .maybeSingle();
      if (ev) {
        eventDate = ev.event_date ?? undefined;
        eventTime = ev.event_time ?? undefined;
      }
    }
    // Mantém evento como pending (não cancela, apenas não confirma)
    return {
      response: `Tudo bem! Para quando vou remarcar *${eventTitle}*? 📅\n\n_Ex: amanhã às 15h, sexta às 10h_`,
      pendingAction: "agenda_edit",
      pendingContext: {
        event_id: eventId,
        event_title: eventTitle,
        event_date: eventDate,
        event_time: eventTime,
        reminder_minutes: null,
        step: "awaiting_change",
      },
    };
  }

  // Resposta ambígua
  return {
    response: `*${eventTitle}* aconteceu?\n\n✅ *sim* — marco como feito\n🔄 *adiar* — vamos reagendar`,
    pendingAction: "event_followup",
    pendingContext: ctx,
  };
}

// ─────────────────────────────────────────────
// STATEMENT IMPORT HELPERS — Feature #15
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// MODO SOMBRA: handlers para mensagens encaminhadas
// ─────────────────────────────────────────────

/**
 * Resolve perfil do usuario a partir de replyTo e lid.
 * Reutiliza o padrao multi-fallback (LID → phone → phone com +).
 */
async function resolveProfileForShadow(
  replyTo: string,
  lid: string | null
): Promise<{
  profile: { id: string; phone_number: string; timezone: string | null } | null;
  sendPhone: string;
}> {
  const rawPhone = replyTo.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/:\d+$/, "");
  const phone = sanitizePhone(rawPhone);
  let profile: { id: string; phone_number: string; timezone: string | null } | null = null;

  if (lid) {
    const { data } = await supabase.from("profiles").select("id, phone_number, timezone").eq("whatsapp_lid", lid).maybeSingle();
    profile = data;
  }
  if (!profile && phone) {
    const { data } = await supabase.from("profiles").select("id, phone_number, timezone")
      .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`).maybeSingle();
    profile = data;
  }

  const sendPhone = profile?.phone_number?.replace(/\D/g, "") || phone;
  return { profile, sendPhone };
}

/**
 * Handler principal do Modo Sombra.
 * Classifica conteudo textual encaminhado e roteia para a acao correta.
 */
async function handleShadowMode(
  replyTo: string,
  content: string,
  base64Media: string | null,
  lid: string | null,
  messageId: string | undefined,
  pushName: string
): Promise<string[]> {
  const log: string[] = ["shadow_mode"];

  try {
    const { profile, sendPhone } = await resolveProfileForShadow(replyTo, lid);
    if (!profile) { log.push("unknown_profile"); return log; }

    const { data: config } = await supabase.from("agent_configs").select("*").eq("user_id", profile.id).maybeSingle();
    if (config?.is_active === false) { log.push("agent_inactive"); return log; }

    // Verifica se ha sessao pendente — shadow mode NAO interrompe fluxos em andamento
    const sessionId = profile.phone_number?.replace(/\D/g, "") || "";
    const { data: session } = await supabase.from("whatsapp_sessions").select("pending_action")
      .eq("phone_number", sessionId).maybeSingle();
    if (session?.pending_action) {
      log.push("pending_session_active");
      // Redireciona para processMessage normal para manter fluxo
      await processMessage(replyTo, content, lid, messageId, pushName);
      return log;
    }

    const moduleFinance = config?.module_finance !== false;
    const moduleAgenda = config?.module_agenda !== false;
    const moduleNotes = config?.module_notes !== false;
    const userTz = profile.timezone || "America/Sao_Paulo";
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });

    // Textos muito curtos → nota automatica (sem gastar API)
    if (content.length < 10) {
      if (moduleNotes) {
        await supabase.from("notes").insert({
          user_id: profile.id, title: content.slice(0, 50), content, source: "whatsapp_forward",
        });
        await sendText(sendPhone || replyTo, `📝 Anotei: "${content}" [📨 encaminhado]`);
      }
      log.push("short_text_note");
      return log;
    }

    // Regex pre-filter: textos claramente financeiros (economiza API call)
    const financialPattern = /R\$\s?\d|pix|transfer[eê]ncia|comprovante|boleto|pagamento.*confirm|valor\s*:?\s*R?\$?\s*\d/i;
    let analysis: ShadowAnalysis;

    if (financialPattern.test(content)) {
      // Alta probabilidade financeira → ainda usa API para extrair dados precisos
      analysis = await analyzeForwardedContent(content, today, userTz);
      if (analysis.action === "unknown") analysis = { action: "finance_record", confidence: 0.6, data: {} };
    } else {
      analysis = await analyzeForwardedContent(content, today, userTz);
    }

    log.push(`classified: ${analysis.action} (${analysis.confidence})`);

    // ── Roteamento por acao classificada ──
    if (analysis.action === "finance_record" && analysis.confidence >= 0.7 && moduleFinance) {
      const d = analysis.data;
      const amount = d.amount ?? 0;

      if (amount > 0) {
        if (amount >= 1000) {
          // Alto valor → confirma com botoes
          await sendButtons(
            sendPhone || replyTo,
            "💸 Transação detectada",
            `R$ ${fmtBRL(amount)} — ${d.description || "encaminhado"}\nRegistrar como ${d.type === "income" ? "receita" : "gasto"}?`,
            [
              { id: "SHADOW_FIN_YES", text: "✅ Registrar" },
              { id: "SHADOW_FIN_NO",  text: "❌ Ignorar" },
            ]
          );
          await supabase.from("whatsapp_sessions").upsert({
            user_id: profile.id, phone_number: sessionId,
            pending_action: "shadow_finance_confirm",
            pending_context: { ...d, today },
            last_activity: new Date().toISOString(), last_processed_id: messageId ?? null,
          }, { onConflict: "phone_number" });
          log.push("finance_high_value_confirm");
        } else {
          // Valor normal → auto-registra
          await supabase.from("transactions").insert({
            user_id: profile.id, type: d.type || "expense", amount,
            category: d.category || "outros", description: d.description || "Encaminhado",
            transaction_date: d.date || today, source: "whatsapp_forward",
          });
          const emoji = d.type === "income" ? "🟢" : "🔴";
          const catEm = CATEGORY_EMOJI[d.category ?? "outros"] ?? "📦";
          await sendText(sendPhone || replyTo, `${emoji} Registrei: R$ ${fmtBRL(amount)} — ${d.description || "encaminhado"} (${catEm} ${d.category || "outros"}) [📨 encaminhado]`);
          log.push("finance_auto_saved");
        }
        return log;
      }
    }

    if (analysis.action === "event_create" && analysis.confidence >= 0.6 && moduleAgenda) {
      const d = analysis.data;
      const dateLabel = d.event_date || "data indefinida";
      const timeLabel = d.event_time || "";
      await sendButtons(
        sendPhone || replyTo,
        "📅 Evento detectado!",
        `*${d.title || "Compromisso"}*\n${dateLabel}${timeLabel ? " às " + timeLabel : ""}\n\nCriar na agenda?`,
        [
          { id: "SHADOW_EVT_YES",  text: "✅ Criar" },
          { id: "SHADOW_EVT_NO",   text: "❌ Ignorar" },
        ]
      );
      await supabase.from("whatsapp_sessions").upsert({
        user_id: profile.id, phone_number: sessionId,
        pending_action: "shadow_event_confirm",
        pending_context: { title: d.title, date: d.event_date, time: d.event_time, duration: d.duration_minutes },
        last_activity: new Date().toISOString(), last_processed_id: messageId ?? null,
      }, { onConflict: "phone_number" });
      log.push("event_confirm");
      return log;
    }

    if (analysis.action === "reminder_create" && analysis.confidence >= 0.6 && moduleNotes) {
      const d = analysis.data;
      await sendButtons(
        sendPhone || replyTo,
        "⏰ Lembrete detectado!",
        `*${d.reminder_title || "Lembrete"}*\nData: ${d.remind_at || "indefinida"}\n\nCriar lembrete?`,
        [
          { id: "SHADOW_REM_YES", text: "✅ Criar" },
          { id: "SHADOW_REM_NO",  text: "❌ Ignorar" },
        ]
      );
      await supabase.from("whatsapp_sessions").upsert({
        user_id: profile.id, phone_number: sessionId,
        pending_action: "shadow_reminder_confirm",
        pending_context: { title: d.reminder_title, remind_at: d.remind_at },
        last_activity: new Date().toISOString(), last_processed_id: messageId ?? null,
      }, { onConflict: "phone_number" });
      log.push("reminder_confirm");
      return log;
    }

    // Default: salva como nota
    if (moduleNotes) {
      const noteTitle = analysis.data?.note_title || content.slice(0, 50);
      const noteContent = analysis.data?.note_content || content;
      await supabase.from("notes").insert({
        user_id: profile.id, title: noteTitle, content: noteContent, source: "whatsapp_forward",
      });
      syncNotion(profile.id, noteContent).catch(() => {});
      await sendText(sendPhone || replyTo, `📝 Anotei: "${noteTitle}" [📨 encaminhado]`);
      log.push("note_saved");
    }

    return log;
  } catch (err) {
    console.error("[shadow_mode] Error:", err);
    log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return log;
  }
}

/**
 * Handler para documentos (PDF, etc.) recebidos via WhatsApp.
 */
async function handleDocumentMessage(
  replyTo: string,
  data: Record<string, unknown>,
  docMsg: Record<string, unknown>,
  lid: string | null,
  messageId: string | undefined,
  pushName: string,
  isForwarded: boolean
): Promise<string[]> {
  const log: string[] = ["document_processing"];
  const mimetype = (docMsg.mimetype as string) || "";
  const fileName = (docMsg.fileName as string) || "documento";

  try {
    const media = await downloadMediaBase64(data);
    if (!media) {
      log.push("download_failed");
      return log;
    }

    // Se e imagem embutida → processa como imagem
    if (mimetype.startsWith("image/")) {
      return await processImageMessage(replyTo, media.base64, media.mimetype, lid, messageId, pushName, isForwarded) as string[];
    }

    // PDF: o Vision API não processa PDF binário diretamente.
    // Orienta o usuário a enviar como screenshot/foto para melhor resultado.
    if (mimetype === "application/pdf") {
      const { profile: pdfProfile } = await resolveProfileForShadow(replyTo, lid);
      const sendPhone = pdfProfile?.phone_number ?? replyTo;
      await sendText(sendPhone, `📄 Recebi o PDF "${fileName}"!\n\nPara registrar as transações automaticamente, tire um *screenshot* da tela do comprovante e envie como foto — o Vision funciona melhor com imagem do que com PDF.\n\nOu me diga por texto: _gastei R$X em Y_`);
      log.push("pdf_guided_to_screenshot");
      return log;
    }

    // Fallback: salva como nota com metadata
    const { profile } = await resolveProfileForShadow(replyTo, lid);
    if (profile) {
      await supabase.from("notes").insert({
        user_id: profile.id,
        title: fileName,
        content: `Documento recebido: ${fileName}\nTipo: ${mimetype}\nRecebido em: ${new Date().toISOString()}`,
        source: isForwarded ? "whatsapp_forward" : "whatsapp",
      });
      const fwdLabel = isForwarded ? " [📨 encaminhado]" : "";
      await sendText(profile.phone_number ?? replyTo, `📄 Recebi "${fileName}" — salvei como anotação.${fwdLabel}`);
    }
    log.push("saved_as_note");
    return log;
  } catch (err) {
    console.error("[document_processing] Error:", err);
    log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return log;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTATOS — vCard, envio de mensagem e reuniões
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processa contactMessage/contactsArrayMessage recebido via WhatsApp.
 * Extrai nome + telefone do vCard e pede confirmação via botões antes de salvar.
 */
async function handleContactMessage(
  contactData: Record<string, unknown>,
  replyTo: string,
  lid: string | null,
): Promise<string[]> {
  const log: string[] = [];

  // ── Resolve perfil do usuário ───────────────────────────────────────────
  const { profile, sendPhone } = await resolveProfileForShadow(replyTo, lid);
  const dest = sendPhone || replyTo;
  console.log("[handleContactMessage] replyTo:", replyTo, "| lid:", lid, "| profile:", !!profile, "| dest:", dest);

  if (!profile) {
    log.push("profile_not_found");
    // Não envia erro — usuário não cadastrado, ignora silenciosamente
    return log;
  }

  // ── Extrai lista de contatos do payload (vários formatos possíveis) ──────
  let rawList: Array<Record<string, unknown>> = [];

  if (Array.isArray(contactData.contacts)) {
    rawList = contactData.contacts as Array<Record<string, unknown>>;
  } else if (contactData.displayName || contactData.vcard) {
    rawList = [contactData];
  } else {
    // Tenta subchaves (evolutionAPI aninha de formas diferentes)
    const sub = (
      contactData.contactMessage ??
      contactData.message ??
      contactData
    ) as Record<string, unknown>;
    rawList = [sub];
  }

  console.log("[handleContactMessage] rawList count:", rawList.length, "| keys[0]:", Object.keys(rawList[0] ?? {}));

  // ── Parseia cada contato e monta lista com nome + telefone ───────────────
  type ParsedContact = { name: string; phone: string };
  const parsed: ParsedContact[] = [];

  for (const c of rawList) {
    const name = String(c.displayName ?? c.fullName ?? c.name ?? "").trim();
    const vcard = String(c.vcard ?? "");

    // Extrai telefone: waid= é mais confiável, fallback TEL:, fallback campo phone
    let phone = "";
    const waidMatch = vcard.match(/waid=(\d+)/i);
    if (waidMatch) {
      phone = waidMatch[1];
    } else {
      const telMatch = vcard.match(/TEL[^:\n]*:\s*([+\d\s\-().]+)/i);
      if (telMatch) phone = telMatch[1].replace(/\D/g, "");
    }
    if (!phone && c.phone) phone = String(c.phone).replace(/\D/g, "");

    if (!phone) { log.push(`skip_no_phone: ${name || "?"}`); continue; }

    // Normaliza para código Brasil
    if (!phone.startsWith("55") && phone.length <= 11) phone = `55${phone}`;

    const nameToUse = name || `Contato ${phone.slice(-4)}`;
    parsed.push({ name: nameToUse, phone });
  }

  console.log("[handleContactMessage] parsed contacts:", parsed.map(p => `${p.name}(${p.phone})`));

  if (parsed.length === 0) {
    log.push("no_contacts_parsed");
    await sendText(dest, "📇 Recebi um contato mas não consegui extrair o número. Tente compartilhar novamente.");
    return log;
  }

  // ── Para cada contato, pede confirmação com botão ───────────────────────
  const sessionId = profile.phone_number?.replace(/\D/g, "") || dest.replace(/\D/g, "");

  for (const p of parsed) {
    const phoneDisplay = phoneForDisplay(p.phone);
    await sendButtons(
      dest,
      "📇 Novo contato detectado!",
      `*${p.name}*\n📱 ${phoneDisplay}\n\nSalvar nos seus contatos?`,
      [
        { id: `CONTACT_SAVE_YES|${p.name}|${p.phone}`, text: "💾 Salvar" },
        { id: "CONTACT_SAVE_NO",                        text: "❌ Ignorar" },
      ]
    );

    // Armazena na sessão para confirmar
    await supabase.from("whatsapp_sessions").upsert({
      user_id: profile.id,
      phone_number: sessionId,
      pending_action: "contact_save_confirm",
      pending_context: { name: p.name, phone: p.phone },
      last_activity: new Date().toISOString(),
    }, { onConflict: "phone_number" });

    log.push(`prompted_save: ${p.name} (${p.phone})`);
  }

  return log;
}

/**
 * Monta o rodapé de apresentação do Jarvis enviado a contatos externos.
 * Inclui número do usuário (para responder diretamente) + CTA heyjarvis.com.br.
 */
function buildJarvisCTA(userName: string, userPhone: string): string {
  return (
    `\n\n_——————————_\n` +
    `Para falar diretamente com *${userName}*, o número é: *${userPhone}*\n\n` +
    `Quer ter um assistente virtual igual a mim? 🤖✨\n` +
    `Acesse 👉 *heyjarvis.com.br* e descubra tudo que posso fazer por você diretamente no WhatsApp — agendamentos, finanças, lembretes e muito mais!\n\n` +
    `Até mais! 🤍\n*— Jarvis*`
  );
}

/** Formata número de telefone para exibição humana (+55 11 99999-9999) */
function phoneForDisplay(raw: string): string {
  const n = raw.replace(/@.*$/, "").replace(/\D/g, "");
  if (n.startsWith("55") && n.length === 13) {
    return `+55 (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  }
  if (n.startsWith("55") && n.length === 12) {
    return `+55 (${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`;
  }
  return n.length > 0 ? `+${n}` : raw;
}

/**
 * Envia mensagem para um contato salvo, imediatamente ou com atraso.
 * Ex: "manda pra Cibele dizendo pegar pão" / "daqui 30min manda pra João que..."
 */
// ─────────────────────────────────────────────
// RELAY DE MENSAGEM — repassa resposta do contato de volta ao usuario
// ─────────────────────────────────────────────

/**
 * Verifica se a mensagem entrante é resposta a um relay_request ativo.
 * Retorna true se o relay foi tratado (para o fluxo normal).
 * Retorna false se não é relay (continua o fluxo normal do Jarvis).
 *
 * Fluxo:
 *  1. Contato recebe mensagem via Jarvis e responde ao bot
 *  2. Se perguntar "pode responder?" → Jarvis coleta resposta em uma mensagem
 *  3. Se mandar mensagem direta → Jarvis repassa imediatamente ao usuario
 *  4. Usuario recebe: "📨 Cibele respondeu: '...'"
 *  5. Relay encerrado — contato nao recebe mais respostas do bot
 */
/**
 * Detecta o gatilho "Responder: [mensagem]" enviado pelo contato.
 * Retorna true se o relay foi tratado, false caso contrario.
 *
 * Fluxo: contato recebe mensagem com instrucao "Responder: ..."
 * → digita "Responder: deu certo!"
 * → Jarvis repassa ao usuario original e confirma ao contato
 */
async function handleIncomingRelay(
  incomingPhone: string,
  text: string,
): Promise<boolean> {
  // Gatilho obrigatorio: mensagem deve comecar com "Responder:"
  if (!/^responder\s*:/i.test(text.trim())) return false;

  const replyContent = text.replace(/^responder\s*:\s*/i, "").trim();
  if (!replyContent) return false; // "Responder:" sem conteudo — ignora

  const now = new Date().toISOString();

  // Normaliza o telefone em multiplos formatos para busca robusta
  // Evolution pode enviar "5519..." ou "19..." dependendo da configuracao
  const rawDigits  = incomingPhone.replace(/\D/g, "");
  const phone55    = rawDigits.startsWith("55") ? rawDigits : `55${rawDigits}`;
  const phoneNo55  = rawDigits.startsWith("55") ? rawDigits.slice(2) : rawDigits;
  const phoneOrFilter = `to_phone.eq.${phone55},to_phone.eq.${phoneNo55},to_phone.eq.+${phone55}`;

  // Busca relay ativo para este telefone (tenta todos os formatos de numero)
  const { data: relay } = await supabase
    .from("relay_requests")
    .select("*")
    .or(phoneOrFilter)
    .eq("status", "sent")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!relay) return false; // nao ha relay ativo — nao trata

  const fromPhone  = (relay.from_phone  as string);
  const senderName = (relay.sender_name as string) || "seu contato";

  // Busca nome do contato nos contatos do usuario (para a notificacao ao usuario)
  const { data: ctFound } = await supabase
    .from("contacts")
    .select("name")
    .eq("user_id", relay.from_user_id)
    .or(`phone.eq.${phone55},phone.eq.${phoneNo55},phone.eq.+${phone55}`)
    .limit(1)
    .maybeSingle();
  const contactFirstName = ctFound?.name?.split(" ")[0] || "Seu contato";

  // Marca relay como completo
  await supabase
    .from("relay_requests")
    .update({ status: "completed", relay_reply: replyContent })
    .eq("id", relay.id);

  // Envia resposta ao usuario original (Miguel)
  await sendText(
    fromPhone,
    `📨 *${contactFirstName} respondeu:*\n\n💬 _"${replyContent}"_`
  ).catch(() => {});

  // Confirma ao contato que a resposta foi enviada
  await sendText(
    incomingPhone,
    `✅ Resposta enviada para *${senderName}*!`
  ).catch(() => {});

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER ON BEHALF — Jarvis faz pedidos em estabelecimentos pelo usuario
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encerra uma order_session e CANCELA qualquer reminder de follow-up pendente
 * pra evitar que o Jarvis pergunte "já chegou?" depois que o usuário já encerrou.
 */
async function closeOrderSession(
  sessionId: string,
  userId: string,
  userPhone: string,
): Promise<void> {
  // 1. Marca a sessão como completed
  try {
    await supabase.from("order_sessions")
      .update({ status: "completed" } as any)
      .eq("id", sessionId);
  } catch (e) {
    console.error("[closeOrderSession] update session:", e);
  }

  // 2. Cancela reminders de follow-up pendentes desse usuário
  try {
    await supabase.from("reminders")
      .update({ status: "cancelled" } as any)
      .eq("user_id", userId)
      .eq("whatsapp_number", userPhone)
      .eq("source", "order_followup")
      .eq("status", "pending");
  } catch (e) {
    console.error("[closeOrderSession] cancel followups:", e);
  }
}

/**
 * Intercepta mensagens vindas de estabelecimentos durante uma sessao de pedido ativa.
 * Se encontrar sessao ativa → usa IA pra decidir se responde sozinho ou escala pro usuario.
 * Retorna true se tratou a mensagem, false para continuar fluxo normal.
 */
async function handleActiveOrderSession(
  businessPhone: string,
  text: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const rawDigits = businessPhone.replace(/\D/g, "");
  const phone55   = rawDigits.startsWith("55") ? rawDigits : `55${rawDigits}`;
  const phoneNo55 = rawDigits.startsWith("55") ? rawDigits.slice(2) : rawDigits;

  // Busca sessão ativa por QUALQUER formato do telefone do estabelecimento
  // Gera todas as variações possíveis para cobrir diferenças de formatação
  const variants = new Set([rawDigits, phone55, phoneNo55, `+${phone55}`]);
  // Também sem o 9 (formato antigo): 5519xxxxxxxx → 551xxxxxxxxx
  if (phoneNo55.length === 11 && phoneNo55[2] === "9") {
    variants.add(`55${phoneNo55.slice(0, 2)}${phoneNo55.slice(3)}`);
  }
  const orFilter = [...variants].map(v => `business_phone.eq.${v}`).join(",");

  console.log(`[order] checking session for businessPhone variants: ${[...variants].join(", ")}`);

  const { data: session } = await supabase
    .from("order_sessions")
    .select("*")
    .or(orFilter)
    .in("status", ["active", "waiting_user"])
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return false;

  const userPhone    = session.user_phone as string;
  const businessName = session.business_name as string;
  const textLow      = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Detecta se a pizzaria disse que o pedido foi entregue/enviado/saiu
  const isDeliveryMsg = /\b(pedido\s*(enviado|entregue|saiu|a caminho|despachado)|ja\s*saiu|entregador|motoboy|saiu\s*(pra|para)\s*entrega|estamos\s*entregando|delivery\s*saiu|a\s*caminho|pedido\s*em\s*rota)\b/i.test(textLow);

  if (isDeliveryMsg) {
    // Mensagem especial: confirma entrega com o usuário
    await sendText(
      userPhone,
      `🛵 *${businessName}* disse:\n\n_"${text}"_\n\n` +
      `Parece que seu pedido está a caminho! Já chegou? Posso encerrar o atendimento?\n\n` +
      `_Me avisa quando chegar (ex: "já chegou", "recebi o pedido")_`
    );
  } else {
    // Mensagem normal: repassa e pede resposta
    await sendText(
      userPhone,
      `📞 *${businessName}* disse:\n\n_"${text}"_\n\n💬 O que eu respondo? Manda aqui e eu repasso.\n\n_Quando o pedido chegar, me avisa (ex: "já chegou", "recebi o pedido") que eu encerro._`
    );
  }

  await supabase.from("order_sessions")
    .update({ status: "waiting_user" } as any)
    .eq("id", session.id);

  return true;
}

// handleOrderUserRelay REMOVIDA — relay do usuário é 100% tratado pela Seção 4c
// (antes do classify), eliminando duplicação e race conditions.

/**
 * Detecta se o conteúdo do pedido é vago (só uma categoria, sem detalhes).
 * Ex: "pizza", "um lanche", "comida" → vago.
 * Ex: "pizza de calabresa", "2 hambúrgueres com bacon" → detalhado.
 */
function isVagueOrder(orderContent: string): boolean {
  const clean = orderContent.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = clean.split(/\s+/).filter(Boolean);
  // Menos de 3 palavras E sem número/quantidade → vago
  if (words.length <= 2 && !/\d/.test(orderContent)) return true;
  // Só palavras genéricas de categoria → vago
  const generic = /^(um[a]?\s+)?(pizza|lanche|hamburguer|sushi|acai|comida|pedido|delivery|remedio|medicamento|produto|item|coisa|algo)$/i;
  if (generic.test(clean)) return true;
  // Frases que indicam que o usuario ainda não disse O QUE quer
  if (/^(fazer?\s+(um\s+)?pedido|um\s+pedido|pedido|quero\s+pedir|quero\s+fazer)$/i.test(clean)) return true;
  return false;
}

/**
 * Detecta se o texto do pedido já menciona bebidas.
 */
function hasDrinksInOrder(text: string): boolean {
  return /\b(coca[- ]?cola|guarana|fanta|sprite|pepsi|refrigerante|suco|cerveja|agua|água|litro|lata|long neck|h2o|schweppes|dolly|itubaína|kuat|antarctic|brahma|skol|heineken|budweiser|vinho|energetico|monster|red bull|ice tea|chá|mate|limonada|milkshake|soda|tonica|tônica)\b/i.test(text);
}

/**
 * Detecta se o texto do pedido já menciona observações especiais.
 */
function hasObsInOrder(text: string): boolean {
  return /\b(borda recheada|borda de|sem cebola|sem tomate|sem alface|sem maionese|sem ketchup|sem mostarda|sem picles|extra queijo|bem passad[oa]|mal passad[oa]|ao ponto|ponto da carne|sem gelo|com gelo|troco para?|sem sal|pouco sal|sem pimenta|com pimenta|gluten|sem lactose|vegano|vegetariano|sem azeitona|dobro de|extra de)\b/i.test(text);
}

/**
 * Monta a mensagem de confirmação final antes de enviar ao estabelecimento.
 */
function buildOrderConfirmMsg(
  businessName: string,
  orderContent: string,
  drinks: string,
  obs: string,
  addressLine: string,
  payment: string,
  scheduledAt?: string | null,
): string {
  const isEmptyDrinks = !drinks || /^(nao|não|n|nope|no|sem|nada|\(já incluído no pedido\))$/i.test(drinks.trim());
  const isEmptyObs    = !obs    || /^(nao|não|n|nope|no|sem|nada|nenhum[a]?|\(já incluído no pedido\))$/i.test(obs.trim());
  const drinksLine = isEmptyDrinks ? "" : `🥤 *Bebidas/extras:* ${drinks}\n`;
  const obsLine    = isEmptyObs    ? "" : `📌 *Observações:* ${obs}\n`;

  // Cabeçalho muda se for agendado
  let header: string;
  let footer: string;
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const nowBrt = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dateStr = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dayLabel = dateStr === nowBrt ? "hoje" : dateStr;
    header = `⏰ *Vou agendar seu pedido para ${dayLabel} às ${timeStr}*\n\n`;
    footer = `Responda *sim* para agendar ou *não* para cancelar.`;
  } else {
    header = `🛵 Confirma o pedido?\n\n`;
    footer = `Responda *sim* para eu enviar ou *não* para cancelar.`;
  }

  return (
    header +
    `🏪 *${businessName}*\n` +
    `📝 *Pedido:* ${orderContent}\n` +
    `${drinksLine}` +
    `${obsLine}` +
    `📍 *Entrega:* ${addressLine}\n` +
    `💳 *Pagamento:* ${payment}\n\n` +
    footer
  );
}

/**
 * Normaliza variações comuns de transcrição de áudio (Whisper) em português.
 * Maya↔Maia, Kadalora↔Cadalora, etc.
 */
function phoneticNorm(s: string): string {
  return s
    .replace(/y/g, "i")       // maya → maia
    .replace(/w/g, "u")       // william → uilliam
    .replace(/ph/g, "f")      // pharmacy → farmacia
    .replace(/th/g, "t")      // thomas → tomas
    .replace(/ck/g, "k")      // nick → nik
    .replace(/sh/g, "x")      // sushi → suxi
    .replace(/ch/g, "x")      // churrasco → xurrasco
    .replace(/ss/g, "s")      // pizzaria transcrita
    .replace(/zz/g, "z")      // pizza → piza
    .replace(/ll/g, "l")      // mozzarella → mozarela
    .replace(/rr/g, "r")      // barra → bara
    .replace(/([aeiou])\1/g, "$1"); // aa→a, ee→e
}

/**
 * Compara duas palavras com tolerância a variações de transcrição.
 * Retorna true se são iguais, foneticamente iguais, ou Levenshtein ≤ 1.
 */
function fuzzyWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Comparação fonética
  if (phoneticNorm(a) === phoneticNorm(b)) return true;
  // Levenshtein ≤ 1 para palavras de tamanho similar
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++;
      if (diffs > 1) return false;
    }
    return true;
  }
  // Comprimentos diferem por 1 — checa inserção/deleção
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let diffs = 0, si = 0;
  for (let li = 0; li < longer.length; li++) {
    if (si < shorter.length && shorter[si] === longer[li]) {
      si++;
    } else {
      diffs++;
      if (diffs > 1) return false;
    }
  }
  return true;
}

/**
 * Processa pedido do usuario em um estabelecimento.
 * Se o pedido for vago, inicia coleta multi-etapa (o que? → bebidas? → obs?).
 * Só confirma quando tem detalhes suficientes.
 */
async function handleOrderOnBehalf(
  userId: string,
  userPhone: string,
  text: string,
  agentName: string,
  userNickname: string | null,
  pushName: string,
  userTz: string = "America/Sao_Paulo",
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  // Busca todos os contatos do tipo business do usuario
  const { data: businesses } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "business");

  if (!businesses || businesses.length === 0) {
    return {
      response:
        "Você ainda não tem estabelecimentos salvos nos seus contatos.\n\n" +
        "Adicione um na aba *Contatos*, escolha o tipo *Estabelecimento* e salve o número. " +
        "Depois é só pedir: _\"Jarvis, pede uma pizza de calabresa na Pizzaria Kadalora\"_ 🍕",
    };
  }

  // Palavras genéricas de categoria — NÃO servem para distinguir entre estabelecimentos
  const categoryWords = new Set([
    "pizzaria", "restaurante", "farmacia", "mercado", "padaria", "lanchonete",
    "hamburgueria", "sushi", "acai", "loja", "bar", "cafe", "sorveteria",
    "doceria", "churrascaria", "pastelaria", "petshop", "supermercado",
    "academia", "clinica", "hospital", "laboratorio", "oficina", "barbearia",
    "delivery", "express", "gourmet", "house", "food", "burger",
  ]);

  // Tenta identificar qual estabelecimento o usuario mencionou
  // Usa sistema de pontuação com matching fuzzy para tolerar variações de áudio
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const textLower = norm(text);
  const textWords = textLower.split(/\s+/).filter(w => w.length > 1);

  let bestMatch: Record<string, any> | null = null;
  let bestScore = 0;

  for (const b of businesses) {
    const bName = norm(b.name as string);
    const bWords = bName.split(/\s+/).filter((w: string) => w.length > 2);

    let score = 0;
    const textPhonetic = phoneticNorm(textLower);
    for (const bw of bWords) {
      // Camada 1: matching fuzzy palavra-a-palavra (exata, fonética ou Levenshtein ≤1)
      const wordMatch = textWords.some(tw => fuzzyWordMatch(tw, bw));
      // Camada 2: fallback substring fonético (pega variações mesmo se tokenização diferir)
      const substringMatch = !wordMatch && textPhonetic.includes(phoneticNorm(bw));
      // Camada 3: substring exato no texto original (caso mais simples)
      const exactSubstring = !wordMatch && !substringMatch && textLower.includes(bw);

      if (wordMatch || substringMatch || exactSubstring) {
        score += categoryWords.has(bw) ? 1 : 10;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = b as Record<string, any>;
    }
  }

  // Exige ao menos 1 palavra distinta (10pts) OU nome inteiro da categoria (ex: "padaria")
  // Se só matchou palavras de categoria, é ambíguo → pede pra especificar
  const found = bestScore >= 10 ? bestMatch : null;

  // Se só matchou categoria (ex: "pizzaria" sem nome), mostra opções filtradas
  if (!found) {
    // Tenta filtrar por categoria mencionada
    const matchedByCategory = businesses.filter((b: any) => {
      const bWords = norm(b.name as string).split(/\s+/);
      return bWords.some((w: string) => categoryWords.has(w) && textLower.includes(w));
    });

    if (matchedByCategory.length === 1) {
      // Só tem 1 estabelecimento dessa categoria → usa ele
      (bestMatch as any) = matchedByCategory[0];
    } else if (matchedByCategory.length > 1) {
      const lista = matchedByCategory.map((b: any) => `• ${b.name}`).join("\n");
      return {
        response:
          `Encontrei mais de um estabelecimento desse tipo:\n\n${lista}\n\n` +
          `Qual deles? Me diz o nome.`,
        pendingAction: "order_disambiguate",
        pendingContext: {
          original_text: text,
          candidates: matchedByCategory.map((b: any) => ({ name: b.name, phone: b.phone })),
          agent_name: agentName,
          sender_name: userNickname || pushName || "seu usuário",
          user_phone: userPhone,
        },
      };
    } else {
      const lista = businesses.map((b: any) => `• ${b.name}`).join("\n");
      return {
        response:
          `Não identifiquei o estabelecimento no seu pedido. Seus estabelecimentos salvos:\n\n${lista}\n\n` +
          `Qual deles? Me diz o nome.`,
        pendingAction: "order_disambiguate",
        pendingContext: {
          original_text: text,
          candidates: businesses.map((b: any) => ({ name: b.name, phone: b.phone })),
          agent_name: agentName,
          sender_name: userNickname || pushName || "seu usuário",
          user_phone: userPhone,
        },
      };
    }
  }

  const matched = found || bestMatch as Record<string, any>;
  if (!matched) {
    const lista = businesses.map((b: any) => `• ${b.name}`).join("\n");
    return {
      response:
        `Não identifiquei o estabelecimento. Seus estabelecimentos salvos:\n\n${lista}\n\n` +
        `Qual deles? Me diz o nome.`,
      pendingAction: "order_disambiguate",
      pendingContext: {
        original_text: text,
        candidates: businesses.map((b: any) => ({ name: b.name, phone: b.phone })),
        agent_name: agentName,
        sender_name: userNickname || pushName || "seu usuário",
        user_phone: userPhone,
      },
    };
  }

  // Busca dados de entrega do perfil
  const { data: profileData } = await supabase
    .from("profiles")
    .select("delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_reference, payment_preference, cpf_orders, display_name")
    .eq("id", userId)
    .maybeSingle();

  const senderName = userNickname || profileData?.display_name || pushName || "seu usuário";

  const street       = profileData?.delivery_street ?? "";
  const number       = profileData?.delivery_number ?? "";
  const complement   = profileData?.delivery_complement ?? "";
  const neighborhood = profileData?.delivery_neighborhood ?? "";
  const city         = profileData?.delivery_city ?? "";
  const reference    = profileData?.delivery_reference ?? "";
  const payment      = profileData?.payment_preference ?? "débito";

  const hasAddress = street && number;
  const addressLine = hasAddress
    ? `${street}, ${number}${complement ? `, ${complement}` : ""}${neighborhood ? ` — ${neighborhood}` : ""}${city ? `, ${city}` : ""}${reference ? ` (${reference})` : ""}`
    : null;

  if (!hasAddress) {
    return {
      response:
        `Antes de fazer o pedido na *${matched.name}*, preciso do seu endereço de entrega.\n\n` +
        `Você ainda não cadastrou. Acesse *Meu Perfil → Dados de Entrega* e salve seu endereço. 📍\n\n` +
        `Depois é só repetir o pedido e eu envio direto!`,
    };
  }

  // ── Detecção de horário agendado ("hoje 18h", "daqui 2h", "amanhã às 12h") ──
  const normForTime = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let scheduledAt: string | null = null;

  // Relativo: "daqui X minutos/horas"
  const delayMatch = normForTime.match(/daqui\s+(\d+)\s*(minuto|hora)/i);
  if (delayMatch) {
    const num = parseInt(delayMatch[1]);
    const unit = delayMatch[2].toLowerCase();
    const delayMs = unit.startsWith("min") ? num * 60_000 : num * 3_600_000;
    scheduledAt = new Date(Date.now() + delayMs).toISOString();
  }

  // Absoluto: "às 17h", "hoje 18h", "amanhã às 9h"
  if (!scheduledAt && /\b(hoje|amanha|[àa]s?\s+\d{1,2}[h:]\d*)\b/i.test(normForTime)) {
    try {
      const tzOff = getTzOffset(userTz);
      const nowIso = new Date().toLocaleString("sv-SE", { timeZone: userTz }).replace(" ", "T") + tzOff;
      const parsedTime = await parseReminderIntent(text, nowIso);
      if (parsedTime?.remind_at) {
        const parsedDate = new Date(parsedTime.remind_at);
        // Só agenda se for no futuro (>5min)
        if (parsedDate.getTime() > Date.now() + 5 * 60_000) {
          scheduledAt = parsedDate.toISOString();
        }
      }
    } catch (_) { /* falhou — envia imediatamente */ }
  }

  // ── Extração inteligente do pedido via IA ──
  // Usa Claude pra extrair APENAS os itens do pedido, corrigir nome do estabelecimento,
  // e detectar bebidas/extras/obs — tudo limpo, sem lixo de transcrição.
  let rawOrder = "";
  let explicitNoExtras = false;
  let explicitNoObs = false;
  let aiExtractedDrinks = false;
  let aiExtractedObs = false;

  try {
    const orderSystemPrompt = `Você extrai pedidos de delivery de mensagens de voz transcritas.
O estabelecimento é "${matched.name}".

Retorne APENAS um JSON (sem markdown, sem crases, sem explicação):
{"items":"lista dos itens","has_drinks":true,"has_obs":false,"no_extras":true}

Campo "items": APENAS os itens do pedido, limpos e formatados.
Exemplos de entrada → saída:
- "Jarvis quero fazer um pedido na pizzaria Maia quero uma pizza de calabresa com requeijão e uma Coca-Cola 2 litros eu não quero borda recheada nem algo a mais" → "1 pizza de calabresa com requeijão, 1 Coca-Cola 2 litros"
- "pede pra mim uma pizza de 4 queijos e uma de frango com borda de catupiry" → "1 pizza de 4 queijos, 1 pizza de frango, borda de catupiry"
- "Jarvis fazer um pedido na Maia eu quero uma pizza de calabresa com queijo borda recheada de catupiry e uma Coca-Cola Zero 2 litros por favor" → "1 pizza de calabresa com queijo, borda recheada de catupiry, 1 Coca-Cola Zero 2 litros"

REMOVA do items: nome do assistente (Jarvis), nome do estabelecimento, "fazer um pedido", "pra mim", "por favor", "tá bom", "está bom", horários, saudações, qualquer frase que não seja item do pedido.
has_drinks: true se mencionou bebida (coca, suco, cerveja, água, etc.)
has_obs: true se mencionou observação (borda recheada, sem cebola, etc.)
no_extras: true se disse que NÃO quer extras/nada mais/só isso`;

    const extractionResult = await chat(
      [{ role: "user", content: text }],
      orderSystemPrompt
    );

    // Parse robusto — remove markdown/crases se a IA incluiu
    const cleanJson = (extractionResult ?? "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleanJson || "{}");
    if (parsed.items && typeof parsed.items === "string" && parsed.items.length > 3) {
      rawOrder = parsed.items;
    }
    if (parsed.has_drinks) aiExtractedDrinks = true;
    if (parsed.has_obs) aiExtractedObs = true;
    if (parsed.no_extras) { explicitNoExtras = true; explicitNoObs = true; }
  } catch (aiErr) {
    console.error("[order-extract] AI extraction failed:", aiErr);
  }

  // Fallback: extração por regex se IA falhou
  if (!rawOrder) {
    // Remove o nome do estabelecimento e verbos de pedido
    const bizNameNorm = matched.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const bizWords = bizNameNorm.split(/\s+/).filter((w: string) => w.length > 3);
    let fallbackText = text;
    // Remove nome do estabelecimento (todas as variações)
    for (const bw of bizWords) {
      fallbackText = fallbackText.replace(new RegExp(bw, "gi"), "");
    }
    rawOrder = fallbackText
      .replace(/^.*?(quero|pede|pedir|faz(?:er)?(?:\s+um)?\s+pedido)\s*/i, "")
      .replace(/\s*(n[ao]|na|pra|para)\s+(pizzaria|restaurante|farmacia|mercado|lanchonete)\s*/i, "")
      .replace(/^(um pedido de|um pedido|pedido de|pedido)\s*/i, "")
      .replace(/^(quero|eu quero|pra mim|por favor|jarvis)\s*/i, "")
      .replace(/\s*(por favor|pra mim|ta bom|tá bom|ok|ne|né)\s*[\?\.]?\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    // Detecção por regex como fallback
    const textLowFull = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!explicitNoExtras) {
      explicitNoExtras = /\b(nao quero|sem|nenhum)\s*(itens?\s*)?extras?/i.test(textLowFull) ||
        /\b(nao quero|sem)\s*(nada\s*)?(a\s*)?mais\b/i.test(textLowFull) ||
        /\b(nao quero|nem)\s*(algo|nada)\s*(a\s*)?mais\b/i.test(textLowFull) ||
        /\b(so\s*isso|e\s*so)\b/i.test(textLowFull);
    }
    if (!explicitNoObs) explicitNoObs = explicitNoExtras;
  }

  // Se o pedido é vago → inicia coleta de detalhes (step: what)
  if (isVagueOrder(rawOrder)) {
    const baseCtx = {
      business_name:      matched.name,
      business_phone:     (matched.phone as string).replace(/\D/g, ""),
      delivery_address:   addressLine,
      payment_preference: payment,
      sender_name:        senderName,
      agent_name:         agentName,
      user_phone:         userPhone,
      scheduled_at:       scheduledAt,
    };
    return {
      response: `Claro! O que você quer pedir na *${matched.name}*? 🍽️\n\nMe conta os itens com sabores, quantidades e qualquer detalhe.`,
      pendingAction: "order_collecting",
      pendingContext: { ...baseCtx, step: "what", order_content: "", drinks: "", obs: "" },
    };
  }

  // Pedido já tem detalhes → analisa o que já foi mencionado e só pergunta o que falta
  const alreadyHasDrinks = aiExtractedDrinks || hasDrinksInOrder(rawOrder) || hasDrinksInOrder(text);
  const alreadyHasObs    = aiExtractedObs    || hasObsInOrder(rawOrder)    || hasObsInOrder(text);

  const baseCtxFull = {
    business_name:      matched.name,
    business_phone:     (matched.phone as string).replace(/\D/g, ""),
    order_content:      rawOrder,
    drinks:             alreadyHasDrinks ? "(já incluído no pedido)" : "",
    obs:                alreadyHasObs    ? "(já incluído no pedido)" : "",
    delivery_address:   addressLine,
    payment_preference: payment,
    sender_name:        senderName,
    agent_name:         agentName,
    user_phone:         userPhone,
    scheduled_at:       scheduledAt,
  };

  // Já tem tudo (bebida + obs mencionados OU negados explicitamente) → direto pra confirmação
  if ((alreadyHasDrinks || explicitNoExtras) && (alreadyHasObs || explicitNoObs)) {
    const confirmMsg = buildOrderConfirmMsg(matched.name, rawOrder, "", "", addressLine!, payment, scheduledAt);
    return {
      response: confirmMsg,
      pendingAction: "order_confirm",
      pendingContext: { ...baseCtxFull, drinks: "", obs: "" },
    };
  }

  // Falta bebida (e não negou explicitamente) → pergunta bebida
  if (!alreadyHasDrinks && !explicitNoExtras) {
    return {
      response: `Anotado: *${rawOrder}* na *${matched.name}*! 🍕\n\nVai querer bebida ou algum extra junto? (refrigerante, suco, sobremesa...)\n\nSe não, responda *não*.`,
      pendingAction: "order_collecting",
      pendingContext: { ...baseCtxFull, step: "drinks" },
    };
  }

  // Tem bebida (ou negou extras), falta obs (e não negou) → pergunta obs
  if (!alreadyHasObs && !explicitNoObs) {
    return {
      response: `Anotado: *${rawOrder}* na *${matched.name}*! 🍕\n\nTem alguma observação especial? (ex: borda recheada, sem cebola, ponto da carne...)\n\nSe não, responda *não*.`,
      pendingAction: "order_collecting",
      pendingContext: { ...baseCtxFull, step: "obs" },
    };
  }

  // Fallback: direto pra confirmação
  const confirmMsg = buildOrderConfirmMsg(matched.name, rawOrder, "", "", addressLine!, payment, scheduledAt);
  return {
    response: confirmMsg,
    pendingAction: "order_confirm",
    pendingContext: { ...baseCtxFull, drinks: "", obs: "" },
  };
}

/**
 * Resolve desambiguação quando o usuário escolhe entre vários estabelecimentos.
 * Recebe a resposta do usuário (ex: "Maya") e busca qual candidato bate.
 * Se encontrou → inicia o fluxo de pedido (step: what).
 * Se não encontrou → repete a pergunta.
 */
async function handleOrderDisambiguate(
  userId: string,
  userPhone: string,
  text: string,
  ctx: Record<string, unknown>,
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const candidates = ctx.candidates as Array<{ name: string; phone: string }>;
  const inputNorm = norm(text);

  // Cancelamento
  if (/^(cancela(r)?|esquece|deixa|não quero|desiste)\b/i.test(text.trim())) {
    return { response: `Ok, pedido cancelado! 👍`, pendingAction: undefined, pendingContext: undefined };
  }

  // Busca o candidato que melhor bate com a resposta do usuario (com fuzzy matching)
  let chosen: { name: string; phone: string } | null = null;
  let bestScore = 0;
  const inputWords = inputNorm.split(/\s+/).filter(w => w.length > 1);

  for (const c of candidates) {
    const cNorm = norm(c.name);
    const cWords = cNorm.split(/\s+/).filter(w => w.length > 1);
    // Match exato do nome completo
    if (inputNorm === cNorm) { chosen = c; bestScore = 999; break; }
    // Match fuzzy: cada palavra do candidato que bate com alguma do input
    let score = 0;
    for (const cw of cWords) {
      if (inputWords.some(iw => fuzzyWordMatch(iw, cw))) score += 10;
    }
    if (score > bestScore) { bestScore = score; chosen = c; }
  }

  if (!chosen || bestScore === 0) {
    const lista = candidates.map(c => `• ${c.name}`).join("\n");
    return {
      response: `Não entendi. Qual desses?\n\n${lista}`,
      pendingAction: "order_disambiguate",
      pendingContext: ctx,
    };
  }

  // Busca dados de entrega do perfil
  const { data: profileData } = await supabase
    .from("profiles")
    .select("delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_reference, payment_preference, cpf_orders, display_name")
    .eq("id", userId)
    .maybeSingle();

  const senderName = (ctx.sender_name as string) || profileData?.display_name || "seu usuário";
  const agentName  = (ctx.agent_name  as string) || "Jarvis";
  const street     = profileData?.delivery_street ?? "";
  const number     = profileData?.delivery_number ?? "";
  const complement = profileData?.delivery_complement ?? "";
  const neighborhood = profileData?.delivery_neighborhood ?? "";
  const city       = profileData?.delivery_city ?? "";
  const reference  = profileData?.delivery_reference ?? "";
  const payment    = profileData?.payment_preference ?? "débito";

  const hasAddress = street && number;
  const addressLine = hasAddress
    ? `${street}, ${number}${complement ? `, ${complement}` : ""}${neighborhood ? ` — ${neighborhood}` : ""}${city ? `, ${city}` : ""}${reference ? ` (${reference})` : ""}`
    : null;

  if (!hasAddress) {
    return {
      response:
        `Antes de pedir na *${chosen.name}*, cadastre seu endereço em *Meu Perfil → Dados de Entrega*. 📍\n\nDepois é só repetir o pedido!`,
    };
  }

  // Inicia coleta do pedido (step: what)
  return {
    response: `Boa! O que você quer pedir na *${chosen.name}*? 🍽️\n\nMe conta os itens com sabores, quantidades e qualquer detalhe.`,
    pendingAction: "order_collecting",
    pendingContext: {
      business_name:      chosen.name,
      business_phone:     chosen.phone.replace(/\D/g, ""),
      delivery_address:   addressLine,
      payment_preference: payment,
      sender_name:        senderName,
      agent_name:         agentName,
      user_phone:         userPhone,
      step:               "what",
      order_content:      "",
      drinks:             "",
      obs:                "",
    },
  };
}

/**
 * Gerencia as etapas de coleta do pedido.
 * Etapas: what → drinks → obs → confirmação
 * Em qualquer etapa, "cancela/esquece/não quero mais" aborta o fluxo.
 */
async function handleOrderCollecting(
  ctx: Record<string, unknown>,
  text: string,
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const step         = ctx.step as string;
  const businessName = ctx.business_name as string;
  const addressLine  = ctx.delivery_address as string;
  const payment      = ctx.payment_preference as string;

  // Cancelamento em qualquer etapa
  const isCanceled = /^(cancela(r)?|esquece|deixa|não quero mais|desiste|para|stop)\b/i.test(text.trim());
  if (isCanceled) {
    return {
      response: `Ok, pedido cancelado! Pode pedir de novo quando quiser. 👍`,
      pendingAction: undefined,
      pendingContext: undefined,
    };
  }

  const updatedCtx = { ...ctx };

  if (step === "what") {
    updatedCtx.order_content = text.trim();
    const gotDrinks = hasDrinksInOrder(text);
    const gotObs    = hasObsInOrder(text);

    if (gotDrinks) updatedCtx.drinks = "(já incluído no pedido)";
    if (gotObs)    updatedCtx.obs    = "(já incluído no pedido)";

    // Já tem tudo → direto pra confirmação
    if (gotDrinks && gotObs) {
      const confirmMsg = buildOrderConfirmMsg(businessName, text.trim(), "", "", addressLine, payment, ctx.scheduled_at as string | null);
      return {
        response: confirmMsg,
        pendingAction: "order_confirm",
        pendingContext: { ...updatedCtx, step: undefined, drinks: "", obs: "" },
      };
    }
    // Falta bebida → pergunta
    if (!gotDrinks) {
      updatedCtx.step = "drinks";
      return {
        response: `Anotado: *${text.trim()}* na *${businessName}*! 🍕\n\nVai querer bebida ou algum extra? (refrigerante, suco, sobremesa...)\n\nSe não, responda *não*.`,
        pendingAction: "order_collecting",
        pendingContext: updatedCtx,
      };
    }
    // Tem bebida, falta obs → pergunta obs
    updatedCtx.step = "obs";
    return {
      response: `Anotado: *${text.trim()}* na *${businessName}*! 🍕\n\nTem alguma observação especial? (ex: borda recheada, sem cebola, ponto da carne...)\n\nSe não, responda *não*.`,
      pendingAction: "order_collecting",
      pendingContext: updatedCtx,
    };
  }

  if (step === "drinks") {
    updatedCtx.drinks = text.trim();
    updatedCtx.step = "obs";
    return {
      response: `Beleza! Tem alguma observação especial? (ex: borda recheada, sem cebola, ponto da carne...)\n\nSe não, responda *não*.`,
      pendingAction: "order_collecting",
      pendingContext: updatedCtx,
    };
  }

  if (step === "obs") {
    const orderContent = updatedCtx.order_content as string;
    const drinks       = updatedCtx.drinks as string;
    const obs          = text.trim();

    const confirmMsg = buildOrderConfirmMsg(businessName, orderContent, drinks, obs, addressLine, payment, ctx.scheduled_at as string | null);
    return {
      response: confirmMsg,
      pendingAction: "order_confirm",
      pendingContext: { ...updatedCtx, step: undefined, obs },
    };
  }

  // Estado inesperado → recomeça
  return {
    response: `Não entendi. Me conta o que você quer pedir na *${businessName}*? 🍽️`,
    pendingAction: "order_collecting",
    pendingContext: { ...ctx, step: "what", order_content: "", drinks: "", obs: "" },
  };
}

/**
 * Executa o pedido apos confirmacao do usuario ("sim").
 * Envia mensagem profissional ao estabelecimento e cria a order_session.
 */
async function executeOrder(
  userId: string,
  userPhone: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  const businessName    = ctx.business_name    as string;
  const businessPhone   = ctx.business_phone   as string;
  const orderContent    = ctx.order_content    as string;
  const deliveryAddress = ctx.delivery_address as string;
  const payment         = ctx.payment_preference as string;
  const senderName      = ctx.sender_name      as string;
  const agentName       = (ctx.agent_name as string) || "Jarvis";

  const drinks = (ctx.drinks as string) ?? "";
  const obs    = (ctx.obs    as string) ?? "";

  const drinksHaValue = drinks && !/^(nao|não|n|nope|no|sem|nada|\(já incluído no pedido\))$/i.test(drinks.trim());
  const obsHasValue   = obs    && !/^(nao|não|n|nope|no|sem|nada|nenhum[a]?|\(já incluído no pedido\))$/i.test(obs.trim());

  const outgoing =
    `Olá! Meu nome é *${agentName}*, assistente virtual do *${senderName}*.\n\n` +
    `Gostaria de fazer um pedido:\n\n` +
    `📝 *Pedido:* ${orderContent}\n` +
    (drinksHaValue ? `🥤 *Extras/Bebidas:* ${drinks}\n` : "") +
    (obsHasValue   ? `📌 *Observações:* ${obs}\n`        : "") +
    `📍 *Endereço de entrega:* ${deliveryAddress}\n` +
    `💳 *Pagamento:* ${payment}\n\n` +
    `Pode confirmar o recebimento, o valor total e o tempo estimado de entrega?\n\n` +
    `——————————————\n` +
    `Para falar diretamente com *${senderName}*, o número é: *${userPhone}*`;

  // 1. Limpa pending_action PRIMEIRO — evita re-execução se der timeout
  await supabase.from("whatsapp_sessions")
    .update({ pending_action: null, pending_context: null } as any)
    .eq("user_id", userId).then(undefined, () => {});

  // 2. Confirmação pro usuário — envia ANTES da pizzaria pra garantir que chega
  await sendText(userPhone,
    `✅ Pedido enviado para *${businessName}*!\n\nVou te avisar assim que eles responderem. 🍕`
  ).catch(() => {});

  // 3. Cria order_session de 3h
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const { error: sessionErr } = await supabase.from("order_sessions").insert({
    user_id:            userId,
    user_phone:         userPhone,
    business_phone:     businessPhone,
    business_name:      businessName,
    order_summary:      orderContent,
    delivery_address:   deliveryAddress,
    payment_preference: payment,
    status:             "active",
    expires_at:         expiresAt,
  } as any);
  if (sessionErr) console.error("[executeOrder] order_session insert error:", sessionErr);

  // 4. Envia pedido pro estabelecimento
  try {
    await sendText(businessPhone, outgoing);
  } catch (sendErr) {
    console.error("[executeOrder] sendText to business failed:", sendErr);
    await sendText(userPhone, `⚠️ O pedido não chegou na *${businessName}*. Tente de novo.`).catch(() => {});
  }

  // 5. Follow-up automático (1h30)
  const followupAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const firstName = senderName.split(" ")[0] || "você";
  await supabase.from("reminders").insert({
    user_id:          userId,
    whatsapp_number:  userPhone,
    title:            `Follow-up pedido ${businessName}`,
    message:          `Oi ${firstName}! 🍕 Seu pedido na *${businessName}* já chegou?\n\nSe sim, me avisa (ex: _"já chegou"_, _"recebi o pedido"_) que eu encerro o atendimento com eles!`,
    send_at:          followupAt,
    recurrence:       "none",
    recurrence_value: null,
    source:           "order_followup",
    status:           "pending",
  } as any).then(undefined, () => {});

  return ""; // vazio — confirmação já enviada acima
}

/**
 * Agenda o pedido pra um horário futuro via sistema de reminders.
 * Pré-monta a mensagem pro estabelecimento e salva o contexto completo.
 * O send-reminder dispara no horário: envia a msg, cria order_session e follow-up.
 */
async function scheduleOrder(
  userId: string,
  userPhone: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  const businessName    = ctx.business_name    as string;
  const businessPhone   = ctx.business_phone   as string;
  const orderContent    = ctx.order_content    as string;
  const deliveryAddress = ctx.delivery_address as string;
  const payment         = ctx.payment_preference as string;
  const senderName      = ctx.sender_name      as string;
  const agentName       = (ctx.agent_name as string) || "Jarvis";
  const scheduledAt     = ctx.scheduled_at     as string;

  const drinks = (ctx.drinks as string) ?? "";
  const obs    = (ctx.obs    as string) ?? "";

  const drinksHaValue = drinks && !/^(nao|não|n|nope|no|sem|nada|\(já incluído no pedido\))$/i.test(drinks.trim());
  const obsHasValue   = obs    && !/^(nao|não|n|nope|no|sem|nada|nenhum[a]?|\(já incluído no pedido\))$/i.test(obs.trim());

  // Pré-monta a mensagem que será enviada ao estabelecimento no horário
  const outgoingMsg =
    `Olá! Meu nome é *${agentName}*, assistente virtual do *${senderName}*.\n\n` +
    `Gostaria de fazer um pedido:\n\n` +
    `📝 *Pedido:* ${orderContent}\n` +
    (drinksHaValue ? `🥤 *Extras/Bebidas:* ${drinks}\n` : "") +
    (obsHasValue   ? `📌 *Observações:* ${obs}\n`        : "") +
    `📍 *Endereço de entrega:* ${deliveryAddress}\n` +
    `💳 *Pagamento:* ${payment}\n\n` +
    `Pode confirmar o recebimento, o valor total e o tempo estimado de entrega?\n\n` +
    `——————————————\n` +
    `Para falar diretamente com *${senderName}*, o número é: *${userPhone}*`;

  // Salva o contexto completo pra send-reminder criar order_session + follow-up
  const orderContext = {
    user_id:            userId,
    user_phone:         userPhone,
    business_phone:     businessPhone,
    business_name:      businessName,
    order_summary:      orderContent,
    delivery_address:   deliveryAddress,
    payment_preference: payment,
    sender_name:        senderName,
    agent_name:         agentName,
  };

  // Cria reminder agendado
  await supabase.from("reminders").insert({
    user_id:          userId,
    whatsapp_number:  businessPhone,
    title:            `Pedido agendado: ${businessName}`,
    message:          outgoingMsg,
    send_at:          scheduledAt,
    recurrence:       "none",
    recurrence_value: null,
    source:           "scheduled_order",
    status:           "pending",
    order_context:    orderContext,
  } as any).then(undefined, () => {});

  // Formata horário pra exibir pro usuario
  const scheduledDate = new Date(scheduledAt);
  const timeStr = scheduledDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    `⏰ Pedido agendado para *${timeStr}*!\n\n` +
    `🏪 *${businessName}*\n` +
    `📝 *Pedido:* ${orderContent}\n\n` +
    `Vou enviar automaticamente no horário. Depois te aviso quando eles responderem! 🍕`
  );
}

async function handleSendToContact(
  userId: string,
  replyTo: string,
  text: string,
  userTz: string,
  agentName: string,
  userNickname: string | null,
  pushName: string,
): Promise<string> {
  const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // ─── Detecta agendamento APENAS na parte de entrega (antes do conteúdo) ──
  // "daqui 30min manda pra João dizendo amanhã vai chover" → "amanhã" é conteúdo, não entrega
  // Isola o trecho antes de "dizendo/falando/que/:" para não confundir com o corpo da mensagem
  let scheduledAt: string | null = null;
  const contentSepIdx = norm.search(/\b(dizendo|dizer|falando|que\s|:\s)/i);
  const normDelivery  = contentSepIdx > 0 ? norm.slice(0, contentSepIdx) : norm;
  const textDelivery  = contentSepIdx > 0 ? text.slice(0, contentSepIdx) : text;

  // Relativo: "daqui X minutos/horas"
  const delayMatch = normDelivery.match(/daqui\s+(\d+)\s*(minuto|hora)/i);
  if (delayMatch) {
    const num = parseInt(delayMatch[1]);
    const unit = delayMatch[2].toLowerCase();
    const delayMs = unit.startsWith("min") ? num * 60_000 : num * 3_600_000;
    scheduledAt = new Date(Date.now() + delayMs).toISOString();
  }

  // Absoluto: "às 17h", "as 18:30", "amanhã às 9h" — só na parte de entrega
  if (!scheduledAt && /\b([àa]s?\s+\d{1,2}[h:]\d*|amanha|amanha\s+as|amanha\s+[àa]s)\b/i.test(normDelivery)) {
    try {
      const tzOff = getTzOffset(userTz);
      const nowIso = new Date().toLocaleString("sv-SE", { timeZone: userTz }).replace(" ", "T") + tzOff;
      const parsedTime = await parseReminderIntent(textDelivery, nowIso);
      if (parsedTime?.remind_at) {
        scheduledAt = new Date(parsedTime.remind_at).toISOString();
      }
    } catch (_) { /* falhou — envia imediatamente */ }
  }

  // Extrai nome do contato — "pra/para/pro [Nome]"
  // Capitaliza o primeiro char após o prefixo para aceitar "pra cibele" e "pra Cibele"
  const prefixMatch = /\b(?:pra|para|pro|ao?)\s+/i.exec(text);
  if (!prefixMatch) {
    return "Não identifiquei para quem enviar. Tente: _Manda pra [Nome] dizendo [mensagem]_";
  }
  const rawAfterPrefix = text.slice(prefixMatch.index + prefixMatch[0].length);
  // Normaliza para Title Case: "cibele" → "Cibele", "CIBELE" → "Cibele", "CIBELE SILVA" → "Cibele Silva"
  // Só é usado para extração de nome (tokenRe); a mensagem é extraída do `text` original na linha abaixo
  const afterPrefix = rawAfterPrefix.split(/\s+/).map(w =>
    w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  ).join(" ");
  // Coleta tokens que começam com maiúscula (nomes próprios) — para no primeiro minúsculo
  const nameTokens: string[] = [];
  const tokenRe = /^([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)\s*/;
  let remaining = afterPrefix;
  while (remaining.length > 0) {
    const t = tokenRe.exec(remaining);
    if (!t) break;
    nameTokens.push(t[1]);
    remaining = remaining.slice(t[0].length);
  }
  if (nameTokens.length === 0) {
    return "Não identifiquei para quem enviar. Tente: _Manda pra [Nome] dizendo [mensagem]_";
  }
  const contactName = nameTokens.join(" ");

  // ── Busca contato no banco ─────────────────────────────────────────────────
  // Estratégia: nome completo primeiro → primeiro nome → lista para disambiguação
  let found: Record<string, unknown> | null = null;

  // 1) Busca por nome completo extraído
  const { data: f1 } = await supabase
    .from("contacts").select("*").eq("user_id", userId)
    .ilike("name", `%${contactName}%`).limit(1).maybeSingle();
  found = f1 ?? null;

  if (!found) {
    // 2) Fallback: primeiro token (ex: "Miguel" de "Miguel Fernandes")
    const firstName = nameTokens[0];
    const { data: allFirstNameMatches } = await supabase
      .from("contacts").select("*").eq("user_id", userId)
      .ilike("name", `${firstName}%`).limit(5);

    if (allFirstNameMatches && allFirstNameMatches.length === 1) {
      // Apenas um resultado com esse primeiro nome → usa direto
      found = allFirstNameMatches[0] as Record<string, unknown>;
    } else if (allFirstNameMatches && allFirstNameMatches.length > 1) {
      // Múltiplos contatos com o mesmo primeiro nome → pede para o usuário escolher
      const lista = allFirstNameMatches
        .map((c, i) => `*${i + 1}.* ${c.name}`)
        .join("\n");
      return (
        `Encontrei ${allFirstNameMatches.length} contatos com o nome *${firstName}*:\n\n` +
        `${lista}\n\n` +
        `Para qual deles você quer enviar? Responda com o número ou o nome completo.`
      );
    }
  }

  if (!found) {
    // Lista os contatos disponíveis para ajudar o usuário
    const { data: allContacts } = await supabase
      .from("contacts").select("name").eq("user_id", userId).limit(10);
    const lista = allContacts?.map(c => `• ${c.name}`).join("\n") || "_Nenhum contato salvo_";
    return `Não encontrei *${contactName}* nos seus contatos.\n\n*Seus contatos:*\n${lista}\n\nPara adicionar: compartilhe o contato ou diga _"Salva o contato [Nome]: [número]"_ 📇`;
  }

  // Extrai conteúdo da mensagem
  // 1ª tentativa: depois de palavra-gatilho ("dizendo", "falando", "que", ":")
  const msgMatch = text.match(/(?:dizendo|dizer|falando|que\s+(?!tal\b)|:\s*)(.+)/i);
  let msgContent = msgMatch ? msgMatch[1].trim() : "";

  // 2ª tentativa (fallback): tudo depois do último token do nome extraído
  // Ex: "Enviar pro Caio confirmar horário" → tira "Enviar pro Caio " → "confirmar horário"
  if (!msgContent) {
    const nameInText = new RegExp(
      `(?:pra|para|pro|ao?)\\s+${nameTokens.join("\\s+")}\\s+`,
      "i"
    );
    const afterName = text.replace(nameInText, "");
    msgContent = afterName !== text ? afterName.trim() : text.trim();
  }

  // Nome e saudação com horário do dia
  const senderName = userNickname || pushName || "seu contato";
  const contactFirstName = found.name.split(" ")[0];
  const hour = new Date().toLocaleString("en-US", { timeZone: userTz, hour: "numeric", hour12: false });
  const h = parseInt(hour);
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

  // Busca telefone real do usuário para o CTA
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", userId)
    .maybeSingle();
  const userPhone = phoneForDisplay(userProfile?.phone_number ?? replyTo);

  const outgoing =
    `${greeting}, *${contactFirstName}*! 😊\n\n` +
    `Aqui é o *${agentName}*, assistente virtual do *${senderName}*.\n\n` +
    `Ele(a) me pediu para te passar um recado:\n\n` +
    `💬 _"${msgContent}"_\n\n` +
    `——————————————\n📩 *Para responder esta mensagem, envie:*\n` +
    `*Responder:* [sua mensagem]\n` +
    `_Ex: Responder: Ok, estarei lá!_` +
    buildJarvisCTA(senderName, userPhone);

  if (scheduledAt) {
    await supabase.from("reminders").insert({
      user_id: userId,
      whatsapp_number: found.phone,
      title: `Mensagem para ${found.name}`,
      message: outgoing,
      send_at: scheduledAt,
      recurrence: "none",
      source: "send_to_contact",
      status: "pending",
    });
    const sendAtDate = new Date(scheduledAt);
    const timeLabel = sendAtDate.toLocaleString("pt-BR", {
      timeZone: userTz,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    return `✅ Agendado! Vou mandar a mensagem pra *${found.name}* ${timeLabel}. 📅`;
  }

  await sendText(found.phone, outgoing);

  // Registra relay_request: se o contato responder, Jarvis repassa automaticamente
  const fromPhoneDigits = userProfile?.phone_number?.replace(/\D/g, "") ?? replyTo.replace(/\D/g, "");
  const toPhoneDigits   = (found.phone as string).replace(/\D/g, "");
  if (fromPhoneDigits && toPhoneDigits) {
    supabase.from("relay_requests").insert({
      from_user_id:     userId,
      from_phone:       fromPhoneDigits,
      to_phone:         toPhoneDigits,
      original_message: msgContent,
      status:           "sent",
      sender_name:      senderName,
      agent_name:       agentName,
      expires_at:       new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }).then(() => {}).catch(() => {}); // fire-and-forget — nao bloqueia o fluxo
  }

  return `✅ Mensagem enviada pra *${found.name}*!`;
}

/** Formata data YYYY-MM-DD em português legível */
function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d} de ${months[m - 1]}`;
}

/**
 * Cria reunião com Google Meet para um contato salvo.
 * Notifica o contato via WhatsApp e agenda lembretes 10 min antes para ambos.
 */
async function handleScheduleMeeting(
  userId: string,
  replyTo: string,
  text: string,
  userTz: string,
  agentName: string,
  userNickname: string | null,
  pushName: string,
  language: string,
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });

  // Extrai nome do contato — "com [o/a/os/as] NomeProprio"
  // Aceita artigos opcionais: "com o Guilherme", "com a Maria", "com guilherme" (minúsculo)
  const contactMatch = text.match(/com\s+(?:o|a|os|as)\s+([A-Za-záéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+[A-Za-záéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*)/i)
    ?? text.match(/com\s+([A-Za-záéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+[A-Za-záéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*)/i);
  if (!contactMatch) {
    // Sem nome após "com" → trata como agenda_create normal
    const fallback = await handleAgendaCreate(userId, replyTo, text, null, language, userNickname, userTz);
    return { response: fallback.response, pendingAction: fallback.pendingAction, pendingContext: fallback.pendingContext };
  }
  // Normaliza para Title Case
  const contactName = contactMatch[1].split(/\s+/).map(w =>
    w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  ).join(" ");

  const { data: found } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", `%${contactName}%`)
    .limit(1)
    .maybeSingle();

  // Contato NÃO está salvo → cria evento de agenda normalmente, sem perguntar nada
  if (!found) {
    const fallback = await handleAgendaCreate(userId, replyTo, text, null, language, userNickname, userTz);
    return { response: fallback.response, pendingAction: fallback.pendingAction, pendingContext: fallback.pendingContext };
  }

  // Extrai data/hora usando extractEvent (IA)
  let extracted: Awaited<ReturnType<typeof extractEvent>>;
  try {
    extracted = await extractEvent(text, today, language);
  } catch {
    return { response: "Não consegui entender a data. Tente: _Marca reunião com [Nome] amanhã às 14h_" };
  }

  if (!extracted?.date) {
    return { response: `Para marcar com *${found.name}*, me diga a data e hora. Ex: _amanhã às 14h_ ou _sexta às 10h_` };
  }

  // Extrai assunto/motivo da reunião — "sobre X", "tema X", "assunto X", "pra falar de X"
  const subjectMatch = text.match(/\b(?:sobre|tema|assunto|motivo|pra falar (?:de|sobre)|pra tratar(?: de)?|para falar (?:de|sobre)|para tratar(?: de)?)\s+([^.!?]+?)(?:\s*[.!?]|$)/i);
  const subject = subjectMatch?.[1]?.trim() ?? null;

  const title = subject
    ? `Reunião com ${found.name} — ${subject}`
    : `Reunião com ${found.name}`;
  const description = subject
    ? `Reunião sobre: ${subject}\nAgendada pelo ${agentName} — assistente de ${userNickname || pushName}`
    : `Reunião agendada pelo ${agentName} — assistente de ${userNickname || pushName}`;

  // Cria evento no Google Calendar com Google Meet
  const { eventId, meetLink } = await createCalendarEventWithMeet(
    userId, title, extracted.date, extracted.time ?? null, null, description, null, userTz
  );

  // Salva na tabela events (incluindo meeting_url pra evitar false positives no poll)
  await supabase.from("events").insert({
    user_id: userId,
    title,
    event_date: extracted.date,
    event_time: extracted.time ?? null,
    description,
    status: "confirmed",
    google_event_id: eventId ?? null,
    meeting_url: meetLink ?? null,
    source: "whatsapp_meeting",
  });

  // Agenda lembrete 10 min antes pro usuário (NÃO pro contato — só envia se ele confirmar)
  if (extracted.time) {
    try {
      const meetingDt = new Date(`${extracted.date}T${extracted.time}:00`);
      const reminderAt = new Date(meetingDt.getTime() - 10 * 60_000).toISOString();
      const meetSuffix = meetLink ? `\n\n🔗 ${meetLink}` : "";

      await supabase.from("reminders").insert({
        user_id: userId,
        whatsapp_number: replyTo,
        title: `Reunião com ${found.name} em 10 min`,
        message: `⏰ *Lembrete!*\nDaqui 10 minutos você tem reunião com *${found.name}*${subject ? ` sobre _${subject}_` : ""}${meetSuffix}`,
        send_at: reminderAt,
        recurrence: "none",
        status: "pending",
        source: "meeting_reminder",
      });
    } catch (e) {
      console.error("[schedule_meeting] reminder insert error:", e);
    }
  }

  const dateLabel = formatDateBR(extracted.date);
  const timeLabel = extracted.time ? ` às *${extracted.time}*` : "";
  const nameGreet = userNickname ? `, ${userNickname}` : "";

  // 1ª mensagem: confirmação pro usuário
  let confirmation =
    `✅ *Reunião agendada${nameGreet}!*\n\n` +
    `📌 ${title}\n` +
    `📅 ${dateLabel}${timeLabel}`;
  if (meetLink) confirmation += `\n🔗 *Google Meet:*\n${meetLink}`;
  if (extracted.time) confirmation += `\n🔔 Te lembro 10 min antes`;

  await sendText(replyTo, confirmation).catch((e) =>
    console.error("[schedule_meeting] confirmation sendText failed:", e)
  );

  // 2ª mensagem: pergunta se quer enviar pro contato (só faz sentido se tiver horário definido)
  if (extracted.time) {
    await sendButtons(
      replyTo,
      `Quer que eu envie o convite pra ${found.name.split(" ")[0]}? 📨`,
      `Vou mandar uma mensagem no WhatsApp dela com o link Meet, data e hora.`,
      [
        { id: "MEETING_INVITE_YES", text: "✅ Sim, envia" },
        { id: "MEETING_INVITE_NO", text: "❌ Não, deixa" },
      ],
    ).catch((e) => console.error("[schedule_meeting] sendButtons failed:", e));

    return {
      response: "", // já enviamos tudo via sendText/sendButtons
      pendingAction: "meeting_invite_confirm",
      pendingContext: {
        contact_phone: found.phone,
        contact_name: found.name,
        contact_first: found.name.split(" ")[0],
        meet_link: meetLink ?? null,
        date_label: dateLabel,
        time_label: extracted.time,
        subject,
        sender_name: userNickname || pushName || "seu contato",
        agent_name: agentName,
      },
    };
  }

  // Sem horário → não pergunta sobre invite (não daria pra mandar lembrete pro contato)
  return { response: "" };
}

const CATEGORY_EMOJI: Record<string, string> = {
  alimentacao: "🍔",
  transporte: "🚗",
  moradia: "🏠",
  saude: "💊",
  lazer: "🎮",
  educacao: "📚",
  trabalho: "💼",
  outros: "📦",
};

function fmtBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function docTypeLabel(dt: StatementExtraction["document_type"]): string {
  switch (dt) {
    case "extrato":    return "Extrato Bancário";
    case "fatura":     return "Fatura do Cartão";
    case "nota_fiscal": return "Nota Fiscal";
    case "comprovante": return "Comprovante";
    default:           return "Documento";
  }
}

function buildStatementPreview(extraction: StatementExtraction): string {
  const { document_type, institution, period, transactions, total_expense, total_income } = extraction;
  const count = transactions.length;
  const header = `📊 *${docTypeLabel(document_type)}${institution ? ` — ${institution}` : ""}${period ? ` ${period}` : ""}*\nEncontrei *${count} transação(ões)*:\n`;

  const preview = transactions.slice(0, 8).map(t => {
    const dot = t.type === "expense" ? "🔴" : "🟢";
    const catEmoji = CATEGORY_EMOJI[t.category] ?? "📦";
    return `${dot} ${t.description} R$ ${fmtBRL(t.amount)} (${catEmoji} ${t.category})`;
  }).join("\n");

  const remaining = count > 8 ? `\n_+ ${count - 8} mais..._` : "";

  const totals = [
    `\n💸 Total gastos: *R$ ${fmtBRL(total_expense)}*`,
    total_income > 0 ? `💰 Total receitas: *R$ ${fmtBRL(total_income)}*` : "",
  ].filter(Boolean).join("\n");

  return `${header}\n${preview}${remaining}\n${totals}\n\nConfirmar registro de *todas as ${count} transações*?\nResponda *sim* para salvar ou *não* para cancelar.`;
}

async function handleStatementConfirm(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown>
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
  const transactions = (ctx.transactions ?? []) as StatementExtraction["transactions"];
  const total_expense = (ctx.total_expense ?? 0) as number;
  const total_income = (ctx.total_income ?? 0) as number;

  const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (/^(sim|confirmar|salvar|ok|yes|pode|confirmo|salvo)/.test(m)) {
    if (transactions.length === 0) {
      return { response: "Não há transações para salvar. Envie uma nova imagem." };
    }

    const today = new Date().toLocaleDateString("sv-SE");
    const rows = transactions.map(t => ({
      user_id: userId,
      type: t.type,
      amount: t.amount,
      category: t.category,
      description: t.description,
      transaction_date: t.date || today,
      source: "whatsapp_image",
    }));

    const { error } = await supabase.from("transactions").insert(rows);
    if (error) {
      console.error("handleStatementConfirm insert error:", error);
      return { response: "⚠️ Erro ao salvar as transações. Tente novamente enviando a imagem." };
    }

    const count = transactions.length;
    const net = total_income - total_expense;
    const netSign = net >= 0 ? "+" : "-";
    const netFormatted = `${netSign}R$ ${fmtBRL(Math.abs(net))}`;

    const successMsg = [
      `✅ *${count} transação(ões) registrada(s) com sucesso!*`,
      ``,
      `💸 Gastos: R$ ${fmtBRL(total_expense)}`,
      total_income > 0 ? `💰 Receitas: R$ ${fmtBRL(total_income)}` : null,
      `💵 Líquido: ${netFormatted}`,
      ``,
      `Tudo salvo! Para ver o resumo completo, acesse o dashboard ou me peça: _"relatório financeiro"_ 📊`,
    ].filter(line => line !== null).join("\n");

    return { response: successMsg, pendingAction: undefined, pendingContext: undefined };

  } else if (/^(nao|não|cancela|cancelar|cancel|no\b)/.test(m)) {
    return { response: "Ok, cancelado! Nada foi registrado. 🗑️", pendingAction: undefined, pendingContext: undefined };
  } else {
    return {
      response: "Responda *sim* para confirmar o registro ou *não* para cancelar.",
      pendingAction: "statement_import",
      pendingContext: ctx,
    };
  }
}

async function processImageMessage(
  replyTo: string,
  base64: string,
  mimetype: string,
  lid: string | null,
  messageId: string | undefined,
  pushName: string,
  isForwarded = false,
  caption = ""
): Promise<unknown> {
  const log: string[] = ["image_processing"];
  if (isForwarded) log.push("forwarded");
  if (caption) log.push(`caption: ${caption.slice(0, 60)}`);
  try {
    // 1. Normalize phone for profile lookup (sanitizado pra digits-only, prev\u00eam injection em .or())
    const rawPhone = replyTo.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/:\d+$/, "");
    const phone = sanitizePhone(rawPhone);

    // 2. Resolve full profile PRIMEIRO (antes de qualquer sendText!)
    //    Padrão multi-fallback idêntico ao processMessage — inclui resolveLidToPhone
    let profile: { id: string; phone_number: string; account_status: string; whatsapp_lid?: string | null } | null = null;

    if (lid) {
      const { data } = await supabase
        .from("profiles")
        .select("id, phone_number, account_status, whatsapp_lid")
        .eq("whatsapp_lid", lid)
        .maybeSingle();
      profile = data;
    }
    if (!profile && phone) {
      const { data } = await supabase
        .from("profiles")
        .select("id, phone_number, account_status, whatsapp_lid")
        .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`)
        .maybeSingle();
      profile = data;
    }

    // Auto-link: perfil encontrado por phone mas LID ainda não salvo → vincula agora
    if (profile && lid && !profile.whatsapp_lid) {
      supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", profile.id).then(() => {}).catch(() => {});
      log.push(`lid_auto_linked_by_phone: ${lid} → ${profile.id}`);
    }

    // Fallback crítico: resolve LID → telefone real via Evolution API
    // Sem isso, sendText falha com 400 quando o usuário manda imagem via LID
    if (!profile && lid) {
      const resolvedRaw = await resolveLidToPhone(lid);
      const resolvedPhone = sanitizePhone(resolvedRaw ?? "");
      if (resolvedPhone) {
        const { data } = await supabase
          .from("profiles")
          .select("id, phone_number, account_status")
          .or(`phone_number.eq.${resolvedPhone},phone_number.eq.+${resolvedPhone},phone_number.eq.55${resolvedPhone}`)
          .maybeSingle();
        if (data) {
          profile = data;
          supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", data.id).then(() => {}).catch(() => {});
          log.push(`lid_auto_linked: ${lid} → ${resolvedPhone}`);
        }
      }
    }

    // Sem profile → silêncio total (não tenta sendText para LID inválido)
    if (!profile) {
      log.push("unknown_number_silent");
      return log;
    }

    // Determina o destino válido para TODAS as respostas
    const profilePhone = profile.phone_number?.replace(/\D/g, "") ?? "";
    const sendPhone = profilePhone || phone;
    const sessionId = profilePhone || phone;

    // 3. Extrai com Vision (com profile já resolvido)
    const extraction = await extractStatementFromImage(base64, mimetype, caption);
    log.push(`doc_type: ${extraction.document_type}, tx_count: ${extraction.transactions.length}`);

    // 4. Unknown or no transactions
    if (extraction.document_type === "unknown" || extraction.transactions.length === 0) {
      log.push("not_a_financial_doc");
      // Se encaminhada e nao financeira → salva como nota silenciosa
      if (isForwarded) {
        await supabase.from("notes").insert({
          user_id: profile.id,
          title: "Imagem encaminhada",
          content: "[Imagem recebida via encaminhamento — não identificada como documento financeiro]",
          source: "whatsapp_forward",
        });
        await sendText(sendPhone, "📷 Recebi a imagem encaminhada — salvei como anotação. [📨 encaminhado]");
        return log;
      }
      await sendText(
        sendPhone,
        "📷 Recebi a imagem! Não identifiquei um extrato ou nota fiscal.\n\nPosso registrar:\n• 📄 *Extrato bancário* — foto do app ou PDF\n• 💳 *Fatura do cartão* — com lista de compras\n• 🧾 *Nota fiscal / cupom*\n• 📱 *Comprovante* de PIX, TED ou boleto\n\nOu me diga por texto: _gastei R$50 de almoço_"
      );
      return log;
    }

    // 5. Single transaction (nota_fiscal or comprovante with 1 item) — save directly
    if (extraction.transactions.length === 1) {
      const t = extraction.transactions[0];
      const today = new Date().toLocaleDateString("sv-SE");
      await supabase.from("transactions").insert({
        user_id: profile.id,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
        transaction_date: t.date || today,
        source: "whatsapp_image",
      });
      const dot = t.type === "expense" ? "🔴" : "🟢";
      const catEmoji = CATEGORY_EMOJI[t.category] ?? "📦";
      const confirmMsg = `✅ *${docTypeLabel(extraction.document_type)} registrado!*\n\n${dot} ${t.description}\n${catEmoji} Categoria: ${t.category}\n💵 Valor: R$ ${fmtBRL(t.amount)}\n\nSalvo com sucesso! 🎉`;
      await sendText(sendPhone, confirmMsg);
      log.push("single_tx_saved");
      return log;
    }

    // 6. Multiple transactions — build preview and store pending confirmation
    const preview = buildStatementPreview(extraction);

    await supabase.from("whatsapp_sessions").upsert(
      {
        user_id: profile.id,
        phone_number: sessionId,
        pending_action: "statement_import",
        pending_context: {
          step: "statement_confirm",
          transactions: extraction.transactions,
          document_type: extraction.document_type,
          institution: extraction.institution,
          period: extraction.period,
          total_expense: extraction.total_expense,
          total_income: extraction.total_income,
        },
        last_activity: new Date().toISOString(),
        last_processed_id: messageId ?? null,
      },
      { onConflict: "phone_number" }
    );

    await sendText(sendPhone, preview);
    log.push("preview_sent");
    return log;

  } catch (err) {
    log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    console.error("processImageMessage error:", err);
    return log;
  }
}

function getHumanizedError(intent: string): string {
  switch (intent) {
    case "reminder_set":    return "⚠️ Não consegui salvar seu lembrete. Pode tentar de novo? Ex: _Me lembra de ligar amanhã às 10h_";
    case "reminder_cancel": return "⚠️ Não consegui cancelar o lembrete agora. Tente de novo em instantes.";
    case "reminder_edit":   return "⚠️ Não consegui editar o lembrete. Tente de novo com mais detalhes.";
    case "reminder_list":   return "⚠️ Não consegui buscar seus lembretes. Tente de novo em instantes.";
    case "agenda_create":   return "⚠️ Não consegui salvar esse compromisso. Pode repetir com data e horário? Ex: _Reunião amanhã às 15h_";
    case "agenda_query":    return "⚠️ Não consegui consultar sua agenda agora. Tente de novo em instantes.";
    case "agenda_edit":     return "⚠️ Não consegui alterar o compromisso. Tente de novo com mais detalhes.";
    case "agenda_delete":   return "⚠️ Não consegui remover o compromisso. Tente de novo em instantes.";
    case "notes_save":      return "⚠️ Não consegui salvar sua anotação. Pode tentar de novo?";
    case "finance_record":  return "⚠️ Não consegui registrar essa transação. Tente de novo. Ex: _Gastei 50 reais de almoço_";
    case "budget_set":       return "⚠️ Não consegui definir o orçamento. Ex: _quero gastar no máximo 2000 em alimentação_";
    case "budget_query":     return "⚠️ Não consegui consultar seus orçamentos. Tente de novo.";
    case "recurring_create": return "⚠️ Não consegui criar a recorrente. Ex: _aluguel 1500 todo dia 5_";
    case "habit_create":     return "⚠️ Não consegui criar o hábito. Ex: _quero hábito de exercício todo dia às 7h_";
    case "habit_checkin":    return "⚠️ Não consegui registrar. Tente enviar _feito_ quando completar um hábito.";
    case "finance_report":  return "⚠️ Não consegui gerar o relatório financeiro agora. Tente de novo em instantes.";
    default:                return "⚠️ Ops, algo deu errado por aqui. Pode tentar de novo? 🙏";
  }
}

/** Registra metrica de performance do bot (fire-and-forget, nunca lanca erro) */
async function logMetric(
  userId: string,
  intent: string,
  processingTimeMs: number,
  success: boolean,
  errorType?: string,
  messageLength?: number
): Promise<void> {
  try {
    await (supabase.from("bot_metrics" as any) as any).insert({
      user_id: userId,
      intent,
      processing_time_ms: processingTimeMs,
      success,
      error_type: errorType ?? null,
      message_length: messageLength ?? null,
    });
  } catch { /* silencioso — nao deve quebrar o fluxo principal */ }
}

async function processMessage(replyTo: string, text: string, lid: string | null = null, messageId?: string, pushName = "", _originalText?: string, quotedText = ""): Promise<unknown> {
  const log: string[] = [];
  const t0 = Date.now(); // timing para bot_metrics
  let currentIntent = "";
  try {
    // ── Fluxo de vinculação: usuário enviou código JARVIS-XXXXXX ──
    const linkMatch = text.trim().match(/^JARVIS[-\s]?([A-Z0-9]{6})$/i);
    if (linkMatch) {
      const code = linkMatch[1].toUpperCase();
      log.push(`link_attempt: ${code}`);

      // Pega o phone_number também pra responder no canal correto
      // (replyTo pode ser @lid opaco que o Evolution não aceita)
      const { data: profileByCode } = await supabase
        .from("profiles")
        .select("id, link_code_expires_at, phone_number")
        .eq("link_code", code)
        .maybeSingle();

      // Helper pra enviar resposta sem quebrar se @lid falhar
      const replyToUser = async (text: string) => {
        const phoneForReply = profileByCode?.phone_number?.replace(/\D/g, "") || replyTo;
        try {
          await sendText(phoneForReply, text);
        } catch (err) {
          // Último recurso: tenta pelo replyTo direto
          try { await sendText(replyTo, text); } catch { /* silent */ }
        }
      };

      if (!profileByCode) {
        await replyToUser("❌ Código inválido. Gere um novo código no app Hey Jarvis em *heyjarvis.com.br/dashboard/perfil*.");
        return log;
      }

      if (profileByCode.link_code_expires_at && new Date(profileByCode.link_code_expires_at) < new Date()) {
        await replyToUser("⏰ Código expirado. Gere um novo no app Hey Jarvis.");
        return log;
      }

      // Salva LID e limpa código
      await supabase.from("profiles").update({
        whatsapp_lid: lid ?? replyTo,
        link_code: null,
        link_code_expires_at: null,
      }).eq("id", profileByCode.id);

      await replyToUser("✅ *WhatsApp vinculado com sucesso!*\n\nAgora pode usar o Hey Jarvis normalmente. Tente:\n• _gastei 50 reais de almoço_\n• _reunião amanhã às 14h_\n• _me lembra de ligar pro Pedro segunda_");
      log.push("linked!");
      return log;
    }

    // ── Busca perfil por LID (novo WhatsApp) ou telefone (fallback) ──
    let profile: { id: string; plan: string; messages_used: number; messages_limit: number; phone_number: string; account_status: string; timezone: string | null; access_until: string | null; display_name?: string | null; whatsapp_lid?: string | null } | null = null;

    if (lid) {
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name, whatsapp_lid")
        .eq("whatsapp_lid", lid)
        .maybeSingle();
      profile = data;
    }

    // Extrai phone UMA vez pra reusar nos fallbacks abaixo (evita redeclarar const)
    const fallbackRawPhone = replyTo
      .replace(/@s\.whatsapp\.net$/, "")
      .replace(/@lid$/, "")
      .replace(/:\d+$/, "");
    const fallbackPhone = sanitizePhone(fallbackRawPhone);

    if (!profile && fallbackPhone) {
      // Fallback: tenta por telefone (@s.whatsapp.net ou @lid → extrai dígitos)
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name, whatsapp_lid")
        .or(`phone_number.eq.${fallbackPhone},phone_number.eq.+${fallbackPhone}`)
        .maybeSingle();
      profile = data;
    }

    // Auto-link: perfil encontrado por phone mas LID ainda não salvo → vincula agora
    if (profile && lid && !profile.whatsapp_lid) {
      supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", profile.id).then(() => {}).catch(() => {});
      log.push(`lid_auto_linked_by_phone: ${lid} → ${profile.id}`);
    }

    // Fallback adicional: busca em user_phone_numbers (múltiplos números - plano business)
    if (!profile && fallbackPhone) {
      {
        const { data: extraNum } = await supabase
          .from("user_phone_numbers")
          .select("user_id")
          .or(`phone_number.eq.${fallbackPhone},phone_number.eq.+${fallbackPhone}`)
          .maybeSingle();
        if (extraNum?.user_id) {
          const { data } = await supabase
            .from("profiles")
            .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name")
            .eq("id", extraNum.user_id)
            .maybeSingle();
          profile = data;
        }
      }
    }

    // Fallback por resolução de LID → telefone real via Evolution API
    // Útil quando o usuário tem WhatsApp Multi-Device e ainda não vinculou o LID
    if (!profile && lid) {
      const resolvedRaw = await resolveLidToPhone(lid);
      const resolvedPhone = sanitizePhone(resolvedRaw ?? "");
      if (resolvedPhone) {
        const { data } = await supabase
          .from("profiles")
          .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name")
          .or(
            `phone_number.eq.${resolvedPhone},phone_number.eq.+${resolvedPhone},phone_number.eq.55${resolvedPhone}`
          )
          .maybeSingle();
        if (data) {
          profile = data;
          // Salva o LID no perfil automaticamente para lookups futuros (sem precisar de código JARVIS)
          supabase
            .from("profiles")
            .update({ whatsapp_lid: lid })
            .eq("id", data.id)
            .then(() => {})
            .catch(() => {});
          log.push(`lid_auto_linked: ${lid} → ${resolvedPhone}`);
        }
      }
    }

    // Flag: se vinculamos neste request, mandamos mensagem de boas-vindas
    // em vez de processar a mensagem original (geralmente "oi" que o Jarvis não entenderia)
    let justLinkedViaPending = false;

    // Fallback PRINCIPAL pra clientes com LID opaco: pending_whatsapp_link ativo
    // Quando cliente cadastra phone no MeuPerfil, whatsapp-link-init grava um
    // pending_link com janela de 15 min. Se houver EXATAMENTE 1 pending ativo
    // quando esta mensagem chega, vinculamos automaticamente — cliente só
    // precisa responder "oi" ou qualquer coisa, sem precisar de código JARVIS.
    if (!profile && lid) {
      const { data: pendingLinks } = await (supabase as any)
        .from("pending_whatsapp_links")
        .select("user_id, phone_number, push_name_hint, created_at")
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(5);

      if (pendingLinks && pendingLinks.length > 0) {
        let chosen: any = null;

        if (pendingLinks.length === 1) {
          // Caso feliz: só 1 pending ativo → bate com certeza
          chosen = pendingLinks[0];
        } else if (pushName) {
          // Múltiplos pending ativos → desempata por pushName vs push_name_hint
          const firstName = pushName.split(/[|\-/,]/)[0].trim().split(/\s+/)[0].toLowerCase();
          const candidates = pendingLinks.filter((p: any) =>
            (p.push_name_hint ?? "").toLowerCase().split(/\s+/)[0] === firstName
          );
          if (candidates.length === 1) chosen = candidates[0];
        }

        if (chosen) {
          const { data: linkedProfile } = await supabase
            .from("profiles")
            .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name")
            .eq("id", chosen.user_id)
            .maybeSingle();

          if (linkedProfile) {
            profile = linkedProfile;
            justLinkedViaPending = true;
            // Vincula o LID no profile + remove o pending_link
            await supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", chosen.user_id);
            await (supabase as any).from("pending_whatsapp_links").delete().eq("user_id", chosen.user_id);
            log.push(`lid_linked_via_pending: ${chosen.user_id}`);
          }
        }
      }
    }

    // Último fallback: match por pushName → display_name (safety net)
    // Usado quando pending_link já expirou ou não existe. Só vincula se
    // ENCONTRAR EXATAMENTE 1 profile ativo com o primeiro nome do pushName.
    if (!profile && lid && pushName) {
      const firstName = pushName.split(/[|\-/,]/)[0].trim().split(/\s+/)[0];
      if (firstName && firstName.length >= 2) {
        const { data: matches } = await supabase
          .from("profiles")
          .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name")
          .ilike("display_name", `${firstName}%`)
          .eq("account_status", "active")
          .is("whatsapp_lid", null)
          .limit(2);

        if (matches && matches.length === 1) {
          profile = matches[0];
          supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", matches[0].id).then(() => {}).catch(() => {});
          log.push(`lid_linked_by_pushname: ${firstName} → ${matches[0].id}`);
        }
      }
    }

    // Último fallback mais agressivo: se existe EXATAMENTE 1 profile com phone
    // cadastrado, conta ativa e SEM whatsapp_lid → linka automaticamente.
    // Isso cobre o caso em que Evolution manda @lid e nem resolveLidToPhone nem
    // pushName resolvem (comum em WhatsApp Multi-Device).
    if (!profile && lid) {
      const { data: orphans } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number, account_status, timezone, access_until, display_name")
        .eq("account_status", "active")
        .is("whatsapp_lid", null)
        .not("phone_number", "is", null)
        .limit(2);

      if (orphans && orphans.length === 1) {
        profile = orphans[0];
        supabase.from("profiles").update({ whatsapp_lid: lid }).eq("id", orphans[0].id).then(() => {}).catch(() => {});
        log.push(`lid_linked_by_orphan: ${orphans[0].id}`);
      }
    }

    // ── ORDER SESSION CHECK — intercepta mensagens de estabelecimentos durante pedido ativo ──
    // Roda antes do relay e antes do fluxo normal.
    // Se a mensagem veio de um estabelecimento com order_session ativa → trata e retorna.
    // Tenta TODOS os formatos possíveis do telefone que mandou (fallbackPhone, lid digits, replyTo digits)
    {
      const phoneCandidates = new Set<string>();
      if (fallbackPhone) phoneCandidates.add(fallbackPhone);
      // Também extrai dígitos puros do replyTo (pode ser diferente do fallbackPhone)
      const replyDigits = replyTo.replace(/@.*$/, "").replace(/[:\D]/g, "");
      if (replyDigits.length >= 10) phoneCandidates.add(replyDigits);
      // LID pode conter dígitos úteis
      if (lid) {
        const lidDigits = lid.replace(/\D/g, "");
        if (lidDigits.length >= 10) phoneCandidates.add(lidDigits);
      }

      for (const phoneCandidate of phoneCandidates) {
        try {
          const orderHandled = await handleActiveOrderSession(phoneCandidate, text);
          if (orderHandled) { log.push("order_session_handled"); return log; }
        } catch (orderErr) {
          console.error("[order] handleActiveOrderSession error:", orderErr);
        }
      }
    }

    // ── RELAY CHECK — intercepta respostas de contatos externos ──
    // Roda antes do "unknown_number" para capturar contatos que nao sao usuarios Jarvis
    // e tambem antes do fluxo normal para usuarios Jarvis que estao respondendo um relay.
    //
    // IMPORTANTE: usuarios Jarvis com WhatsApp Multi-Device chegam via @lid (ID opaco),
    // entao fallbackPhone pode estar vazio. Nesse caso usamos profile.phone_number
    // (ja resolvido pelos fallbacks acima) para buscar o relay_request no banco.
    const relayCheckPhone = profile?.phone_number
      ? sanitizePhone(profile.phone_number)
      : fallbackPhone;

    if (relayCheckPhone) {
      try {
        const relayHandled = await handleIncomingRelay(relayCheckPhone, text);
        if (relayHandled) {
          log.push("relay_handled");
          return log;
        }
      } catch (relayErr) {
        // Nao deixa erro no relay quebrar o fluxo principal
        console.error("[relay] handleIncomingRelay error:", relayErr);
      }
    }

    if (!profile) {
      // Loga o que chegou pra diagnosticar casos "unknown_number"
      try {
        await supabase.from("debug_logs").insert({
          message: `unknown_number lid=${lid ?? "null"} replyTo=${replyTo} fallbackPhone=${fallbackPhone} pushName=${pushName ?? "null"}`,
        } as any);
      } catch { /* silent */ }
      // Número/LID totalmente desconhecido — silêncio total (evita spam em bots/scanners).
      // Fluxo correto pra novos clientes:
      //   1. Cadastra phone no MeuPerfil → backend envia código JARVIS-XXXXXX via Evolution
      //   2. User responde com o código → esta função captura no bloco linkMatch acima
      //   3. LID vinculado → futuras mensagens resolvem por whatsapp_lid direto
      log.push("unknown_number");
      return log;
    }

    // Usa o telefone do perfil para enviar respostas (LID não funciona no sendText)
    const sendPhone = profile.phone_number?.replace(/\D/g, "") ?? "";

    // 2. Verifica se a conta está ativa
    if (profile.account_status === "suspended") {
      await sendText(
        sendPhone || replyTo,
        "🚫 *Acesso suspenso*\n\nSua conta no Hey Jarvis está suspensa devido a um estorno ou reembolso confirmado.\n\nSe acredita que isso é um engano, ou deseja reativar sua assinatura, acesse:\n👉 *heyjarvis.com.br*"
      );
      log.push("account_suspended");
      return log;
    }

    if (profile.account_status === "pending") {
      await sendText(
        sendPhone || replyTo,
        "⏳ *Sua conta ainda não tem plano ativo*\n\nPara usar o Jarvis, assine um plano no app:\n👉 *heyjarvis.com.br*\n\nSe já assinou ou um administrador liberou seu acesso, o Jarvis vai começar a responder em instantes."
      );
      log.push("account_pending");
      return log;
    }

    // 2b. Verifica se o período de acesso expirou
    // Volta pra 'pending' (sem plano) ao invés de 'suspended' (suspended = banido).
    // Mantém o aviso "Sua assinatura expirou" mas sem tratar como banimento.
    if (profile.access_until) {
      const accessUntilDate = new Date(profile.access_until);
      if (!isNaN(accessUntilDate.getTime()) && accessUntilDate < new Date()) {
        supabase.from("profiles")
          .update({
            account_status: "pending",
            access_until: null,
            access_source: null,
            subscription_cancelled_at: null,
          } as any)
          .eq("id", profile.id)
          .then(() => {}).catch(() => {});
        supabase.from("agent_configs")
          .update({ is_active: false })
          .eq("user_id", profile.id)
          .then(() => {}).catch(() => {});

        await sendText(
          sendPhone || replyTo,
          "⏰ *Sua assinatura expirou*\n\nSeu período de acesso ao Hey Jarvis chegou ao fim.\n\nRenove sua assinatura para voltar a usar o Jarvis normalmente:\n👉 *heyjarvis.com.br*"
        );
        log.push("access_expired");
        return log;
      }
    }

    // 3. Carrega configuração do agente
    const { data: config } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle();

    // 3b. Verifica se o agente está ativo (toggle do dashboard)
    // is_active === false significa que o agente foi pausado (admin ou usuário) → silêncio total
    if (config?.is_active === false) {
      log.push("agent_paused");
      return log;
    }

    // 3c. Primeira mensagem após vinculação via pending_link → welcome message
    // (não processa o "oi" como comando normal pra não confundir o Jarvis)
    if (justLinkedViaPending) {
      const userName = (profile as any).display_name?.split(/\s+/)[0] || "";
      const hello = userName ? `Oi ${userName}! 👋` : "Oi! 👋";
      await sendText(
        sendPhone || replyTo,
        `${hello}\n\n` +
        `Tudo pronto! Seu WhatsApp está conectado. ✨\n\n` +
        `Agora é só me mandar mensagens aqui pra:\n` +
        `💰 Registrar gastos — _gastei 50 reais de almoço_\n` +
        `📅 Marcar compromissos — _reunião amanhã às 14h_\n` +
        `⏰ Criar lembretes — _me lembra de ligar pro Pedro segunda_\n` +
        `📝 Salvar anotações — _anotação: comprar presente_\n\n` +
        `Pode começar quando quiser! 😊`
      );
      log.push("welcome_sent");
      return log;
    }

    const agentName = config?.agent_name ?? "Jarvis";
    const tone = config?.tone ?? "profissional";
    const language = (config?.language as string) || "pt-BR";
    const userNickname = (config?.user_nickname as string) || null;
    const customInstructions = (config?.custom_instructions as string) || null;
    const userTz = (profile.timezone as string) || "America/Sao_Paulo";
    const tzOffset = getTzOffset(userTz);

    // 4. Busca/cria sessão (contexto de conversa ativa)
    // Sempre usa o telefone do perfil como chave canônica para evitar sessões duplicadas
    // (LID do WhatsApp Web vs telefone real resultariam em sessões separadas sem isso)
    const sessionPhone = profile.phone_number?.replace(/\D/g, "") || (lid ?? replyTo);
    const sessionId = sessionPhone;

    // Busca sessão: tenta pelo telefone canônico OU pelo user_id (para migrar sessões antigas por LID)
    let { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("phone_number", sessionId)
      .maybeSingle();

    if (!session) {
      // Fallback: busca qualquer sessão desse user (pode ter sido criada por LID diferente)
      const { data: sessionByUser } = await supabase
        .from("whatsapp_sessions")
        .select("*")
        .eq("user_id", profile.id)
        .order("last_activity", { ascending: false })
        .limit(1)
        .maybeSingle();
      session = sessionByUser;
    }

    // 4a. TTL do pending_action — expira após 30 min de inatividade.
    // Previne conversas travadas esperando resposta de fluxo abandonado
    // (ex: event_followup, statement_import, shadow_*). Se usuário demorou
    // mais de 30 min pra responder, trata nova mensagem como intent nova.
    if (session?.pending_action && session?.last_activity) {
      const ageMs = Date.now() - new Date(session.last_activity as string).getTime();
      const TTL_MS = 30 * 60 * 1000; // 30 minutos
      if (ageMs > TTL_MS) {
        supabase.from("whatsapp_sessions")
          .update({ pending_action: null, pending_context: null })
          .eq("phone_number", sessionId)
          .then(() => {}).catch(() => {});
        session = { ...session, pending_action: null, pending_context: null };
        log.push("pending_expired");
      }
    }

    // 4b. Verifica respostas rápidas (prioridade máxima)
    // Só dispara quando NÃO há fluxo multi-step pendente — evitar interromper agenda/nota/lembrete em andamento
    const hasPendingFlow = !!session?.pending_action;
    if (!hasPendingFlow) {
      const { data: quickReplies } = await supabase
        .from("quick_replies")
        .select("trigger_text, reply_text")
        .eq("user_id", profile.id);

      if (quickReplies?.length) {
        const textLower = text.toLowerCase().trim();
        const match = quickReplies.find((qr) =>
          textLower === qr.trigger_text.toLowerCase().trim() ||
          textLower.startsWith(qr.trigger_text.toLowerCase().trim())
        );
        if (match) {
          const reply = match.reply_text
            .replace("{{user_name}}", (config?.user_nickname as string) || "")
            .replace("{{agent_name}}", agentName);
          await sendText(sendPhone || replyTo, reply);
          log.push(`quick_reply: ${match.trigger_text}`);
          return log;
        }
      }
    }

    // 4c. ORDER SESSION — intercepta respostas do usuario quando está no meio de um pedido ativo
    // Roda ANTES do classify para evitar que "pode sim", "ok", "cheddar" sejam classificados como outro intent
    {
      const userRawDigits = (sendPhone || replyTo).replace(/\D/g, "");
      const userPhone55   = userRawDigits.startsWith("55") ? userRawDigits : `55${userRawDigits}`;
      const userPhoneNo55 = userRawDigits.startsWith("55") ? userRawDigits.slice(2) : userRawDigits;
      const profilePhone  = profile.phone_number?.replace(/\D/g, "") ?? "";
      const profilePhone55   = profilePhone.startsWith("55") ? profilePhone : `55${profilePhone}`;
      const profilePhoneNo55 = profilePhone.startsWith("55") ? profilePhone.slice(2) : profilePhone;
      const now = new Date().toISOString();

      // Busca order_session com status waiting_user para QUALQUER variação do telefone do usuário
      const phoneVariants = [userPhone55, userPhoneNo55, profilePhone55, profilePhoneNo55].filter(Boolean);
      const orFilter = phoneVariants.map(p => `user_phone.eq.${p}`).join(",");

      const { data: waitingSession } = await supabase
        .from("order_sessions")
        .select("*")
        .or(orFilter)
        .eq("status", "waiting_user")
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (waitingSession) {
        const msgLow = text.toLowerCase().trim();
        const businessPhone = waitingSession.business_phone as string;
        const businessName  = waitingSession.business_name  as string;

        // Comandos de encerramento do pedido
        const isClose = /\b(encerra(r)?|finaliza(r)?|fechar?\s*(pedido|atendimento)?|pode\s*encerrar|ja\s*(chegou|recebi|entregaram|entregue)|pizza\s*chegou|pedido\s*chegou|ja\s*recebi|recebi\s*(o\s*)?(pedido|pizza|lanche|comida|entrega)|entregue|entregaram|pronto\s*pode\s*(encerrar|fechar|finalizar)|nao\s*precisa\s*mais|obrigad[oa]\s*pode\s*(encerrar|fechar|finalizar)|pedido\s*(concluido|finalizado|encerrado)|recebi\s*o?\s*(meu\s*)?(pedido|pizza|lanche)|ta\s*tudo\s*certo|tudo\s*certo\s*obrigad|valeu\s*pode\s*(encerrar|fechar|finalizar)|pode\s*fechar)\b/i.test(msgLow);
        if (isClose) {
          await closeOrderSession(
            waitingSession.id as string,
            profile.id,
            waitingSession.user_phone as string,
          );
          await sendText(
            sendPhone || replyTo,
            `✅ Pedido na *${businessName}* encerrado! Bom apetite! 🍕😋`
          ).catch(() => {});
          log.push("order_session_closed_by_user");
          return log;
        }

        // Verifica se a mensagem deve ser repassada à pizzaria ou se é outro fluxo:
        // 1. Novo comando (pedido, lembrete, agenda) → deixa passar pro classify
        // 2. Tem pending_action na sessão (order_confirm, etc) → a msg é pro fluxo pendente, não relay
        const relayIntent = classifyIntent(text);
        const isNewCommand = relayIntent !== "ai_chat" && relayIntent !== "greeting";
        const hasPendingFlow = !!session?.pending_action;
        if (isNewCommand || hasPendingFlow) {
          // Não é resposta pra pizzaria — deixa passar pro fluxo normal
          log.push("order_relay_skipped");
        } else {
          // Repassa resposta do usuario pro estabelecimento
          await sendText(businessPhone, text).catch(() => {});
          // Volta sessao pra "active" para continuar capturando respostas da pizzaria
          await supabase.from("order_sessions")
            .update({ status: "active" } as any)
            .eq("id", waitingSession.id).then(undefined, () => {});
          // Confirma pro usuario
          await sendText(
            sendPhone || replyTo,
            `✅ Repassei para *${businessName}*: _"${text}"_`
          ).catch(() => {});
          log.push("order_relay");
          return log;
        }
      }

      // Também checa se o usuário quer encerrar uma sessão ativa (não waiting)
      const { data: activeSession } = await supabase
        .from("order_sessions")
        .select("*")
        .or(orFilter)
        .eq("status", "active")
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSession) {
        const msgLow = text.toLowerCase().trim();
        const isClose = /\b(encerra(r)?|finaliza(r)?|fechar?\s*(pedido|atendimento)?|pode\s*encerrar|ja\s*(chegou|recebi|entregaram|entregue)|pizza\s*chegou|pedido\s*chegou|ja\s*recebi|recebi\s*(o\s*)?(pedido|pizza|lanche|comida|entrega)|entregue|entregaram|pronto\s*pode\s*(encerrar|fechar|finalizar)|nao\s*precisa\s*mais|obrigad[oa]\s*pode\s*(encerrar|fechar|finalizar)|pedido\s*(concluido|finalizado|encerrado)|recebi\s*o?\s*(meu\s*)?(pedido|pizza|lanche)|ta\s*tudo\s*certo|tudo\s*certo\s*obrigad|valeu\s*pode\s*(encerrar|fechar|finalizar)|pode\s*fechar)\b/i.test(msgLow);
        if (isClose) {
          await closeOrderSession(
            activeSession.id as string,
            profile.id,
            activeSession.user_phone as string,
          );
          await sendText(
            sendPhone || replyTo,
            `✅ Pedido na *${activeSession.business_name}* encerrado! Bom apetite! 🍕😋`
          ).catch(() => {});
          log.push("order_session_closed_by_user");
          return log;
        }

        // Mensagens conversacionais curtas (ok, obrigado, valeu) quando há pedido
        // em andamento NÃO devem ir pro AI chat — respondemos direto e fluxo continua
        const isSmallTalk =
          msgLow.length < 40 &&
          /^(ok|obrigad[oa]|valeu|blz|beleza|show|\uD83D\uDC4D|top|massa|legal|bacana|otimo|ótimo|perfeito|combinado|demais|maravilha|tranquilo|tranquil[ao]|bom|bom sabe|de boa|ok obrigad|ok valeu|tmj|de boas|maravilhoso)\s*[!.?\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]*\s*$/iu.test(msgLow);
        if (isSmallTalk) {
          await sendText(
            sendPhone || replyTo,
            `😊 Aguardando resposta da *${activeSession.business_name}* pro seu pedido. Quando chegar, te aviso!`
          ).catch(() => {});
          log.push("order_smalltalk");
          return log;
        }
      }
    }

    // 5. Classifica intenção
    let intent: Intent = classifyIntent(text);
    currentIntent = intent;

    // Se há ação pendente e a mensagem parece ser uma resposta, mantém o contexto
    // Exclui reminder_snooze pois é ação one-shot (não tem fluxo multi-step)
    const oneShot = ["reminder_snooze"];
    if (
      session?.pending_action &&
      !oneShot.includes(session.pending_action as string) &&
      intent === "ai_chat" &&
      text.length < 150
    ) {
      intent = session.pending_action as Intent;
      currentIntent = intent;
    }

    // ── Reply WhatsApp: infere intent pelo contexto da mensagem respondida ──
    // Se o usuário deu "reply" em uma mensagem específica do Jarvis, usamos o
    // conteúdo dela pra direcionar a ação certa (ex: replied em "Confirma o pedido?"
    // → força order_confirm; replied em "Hora do seu hábito" → habit_checkin)
    if (quotedText && intent === "ai_chat") {
      const qLow = quotedText.toLowerCase();
      if (/confirma o pedido\?|vou agendar seu pedido|pedido agendado|responda \*sim\* para.*(enviar|agendar)/i.test(qLow)) {
        intent = "order_confirm" as Intent;
        currentIntent = intent;
      } else if (/hora do seu habito|hora do hábito|habito:|hábito:/i.test(qLow)) {
        intent = "habit_checkin" as Intent;
        currentIntent = intent;
      } else if (/confirma o evento|evento criado|reuni[ãa]o marcada|^⏰.*lembrete/i.test(qLow)) {
        intent = "event_followup" as Intent;
        currentIntent = intent;
      }
    }

    // Módulos ativos por padrão quando sem configuração
    const moduleFinance = config?.module_finance !== false;
    const moduleAgenda = config?.module_agenda !== false;
    const moduleNotes = config?.module_notes !== false;
    const moduleChat = config?.module_chat !== false;

    const modules: ModuleMap = { finance: moduleFinance, agenda: moduleAgenda, notes: moduleNotes, chat: moduleChat };

    // Mapa intent → módulo necessário
    const INTENT_REQUIRES: Partial<Record<Intent, keyof ModuleMap>> = {
      finance_record:    "finance",
      finance_report:    "finance",
      budget_set:        "finance",
      budget_query:      "finance",
      recurring_create:  "finance",
      agenda_create:   "agenda",
      agenda_query:    "agenda",
      agenda_lookup:   "agenda",
      agenda_edit:     "agenda",
      agenda_delete:   "agenda",
      event_followup:  "agenda",
      notes_save:      "notes",
      reminder_set:    "notes",
      reminder_list:   "notes",
      reminder_cancel: "notes",
      reminder_edit:   "notes",
      reminder_snooze: "notes",
      ai_chat:         "chat",
    };

    const requiredModule = INTENT_REQUIRES[intent];
    const moduleActive = !requiredModule || modules[requiredModule];

    // 6. Executa handler
    let responseText: string;
    let pendingAction: string | undefined;
    let pendingContext: unknown;

    // ── HIGH-PRIORITY: order_confirm com pending_action ativo ──
    if (session?.pending_action === "order_confirm" && text.trim().length < 100) {
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const yes = /\b(sim|s|ok|okay|confirma(r|do)?|pode|claro|envia(r)?|manda(r)?|vai|yes|yep|bora|confirmo|positivo|aprovo|beleza|blz|isso|perfeito|certo|pode ser)\b/i.test(msgLow);
      const no  = /\b(nao|n|cancela(r)?|deixa|esquece|nope|cancelar|negativo|desisto|deixa pra la)\b/i.test(msgLow);

      if (yes && ctx.business_name) {
        if (ctx.scheduled_at) {
          responseText = await scheduleOrder(profile.id, sendPhone || replyTo, ctx);
        } else {
          responseText = await executeOrder(profile.id, sendPhone || replyTo, ctx);
        }
        pendingAction  = undefined;
        pendingContext = undefined;
      } else if (no) {
        responseText  = "Ok, pedido cancelado! Pode pedir de novo quando quiser. 👍";
        pendingAction  = undefined;
        pendingContext = undefined;
      } else {
        // Mensagem ambígua — preserva e pede clarificação
        responseText   = "Responda *sim* para confirmar o pedido ou *não* para cancelar.";
        pendingAction  = "order_confirm";
        pendingContext = ctx;
      }

      // Upsert da sessão imediatamente (não depende do fluxo final)
      await supabase.from("whatsapp_sessions").upsert({
        user_id: profile.id,
        phone_number: sessionId,
        pending_action: pendingAction ?? null,
        pending_context: pendingContext ?? null,
        last_activity: new Date().toISOString(),
        last_processed_id: messageId ?? null,
      }, { onConflict: "phone_number" });

      // Envia responseText se não vazio (executeOrder envia sozinho → retorna "")
      if (responseText) {
        await sendText(sendPhone || replyTo, responseText).catch((err) =>
          console.error("[order_confirm top-level] sendText failed:", err)
        );
      }
      log.push("order_confirm_handled_early");
      return log;
    }

    if (intent === "greeting") {
      // Saudação: usa greeting_message personalizado do usuário ou fallback padrão
      const rawTplGreeting = (config?.greeting_message as string)
        || "Olá, {{user_name}}! Sou o {{agent_name}}, seu assistente pessoal. Como posso ajudar?";
      // Garante gênero masculino no template
      const tplGreeting = rawTplGreeting
        .replace(/\ba\s+\{\{agent_name\}\}/gi, "o {{agent_name}}")
        .replace(/\bsou\s+a\b/gi, "sou o")
        .replace(/\bsua\s+assistente\b/gi, "seu assistente")
        .replace(/\ba\s+assistente\b/gi, "o assistente");
      const greetName = userNickname || pushName || "você";
      responseText = applyTemplate(tplGreeting, {
        user_name: greetName,
        agent_name: agentName,
      });
      // Traduz se necessário (a template pode estar em PT mas usuário preferir EN/ES)
      if (language !== "pt-BR") {
        responseText = await translateIfNeeded(responseText, language);
      }
      await sendText(sendPhone || replyTo, responseText);
      log.push("greeting_sent");
      return log; // early return — não salva sessão pendente, não incrementa contador de módulos
    } else if (!moduleActive) {
      // ── Módulo desativado: informa o usuário e limpa fluxo pendente ──
      responseText = getModuleDisabledMsg(intent, language, modules);
      pendingAction = undefined;   // evita usuário preso em fluxo de módulo desativado
      pendingContext = undefined;
    } else if (intent === "budget_set") {
      responseText = await handleBudgetSet(profile.id, text);
    } else if (intent === "budget_query") {
      responseText = await handleBudgetQuery(profile.id, text);
    } else if (intent === "recurring_create") {
      responseText = await handleRecurringCreate(profile.id, text);
    } else if (intent === "habit_create") {
      responseText = await handleHabitCreate(profile.id, sendPhone || replyTo, text, userTz);
    } else if (intent === "habit_checkin") {
      const checkinResult = await handleHabitCheckin(profile.id, text, userTz);
      responseText = checkinResult.response;
      pendingAction = checkinResult.pendingAction;
      pendingContext = checkinResult.pendingContext;
    } else if (intent === "habit_checkin_choose") {
      // Usuário está escolhendo qual hábito concluiu (após ver a lista numerada)
      const ctx = (session?.pending_context ?? {}) as any;
      const options = (ctx.options ?? []) as Array<{ id: string; name: string; icon: string; current_streak: number; best_streak: number }>;

      if (/^(nao|cancela|deixa|esquece|nada)/i.test(text.trim())) {
        responseText = "✅ Ok, não registrei nada.";
      } else {
        // Tenta match por número OU por nome
        let chosen: typeof options[number] | null = null;
        const numMatch = text.trim().match(/^(\d+)$/);
        if (numMatch) {
          const idx = parseInt(numMatch[1], 10) - 1;
          if (idx >= 0 && idx < options.length) chosen = options[idx];
        } else {
          const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          chosen = options.find(o => {
            const nm = String(o.name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return normalized.includes(nm);
          }) ?? null;
        }

        if (!chosen) {
          responseText = `Não entendi qual hábito. Responda com o *número* (1 a ${options.length}) ou o nome do hábito.`;
          pendingAction = "habit_checkin_choose";
          pendingContext = ctx;
        } else {
          // Registra o hábito escolhido (inline — mesma lógica do handleHabitCheckin)
          const today = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });
          const { error: insErr } = await supabase.from("habit_logs").insert({
            habit_id: chosen.id,
            user_id: profile.id,
            logged_date: today,
          });
          if (insErr) {
            responseText = insErr.code === "23505" ? "Ja registrado hoje! 👍" : "Erro ao registrar. Tente novamente.";
          } else {
            // Recalcula streak
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toLocaleDateString("sv-SE", { timeZone: userTz });
            const { data: yLog } = await (supabase.from("habit_logs") as any)
              .select("id").eq("habit_id", chosen.id).eq("logged_date", yesterdayStr).maybeSingle();
            const newStreak = yLog ? (chosen.current_streak || 0) + 1 : 1;
            const bestStreak = Math.max(newStreak, chosen.best_streak || 0);
            await supabase.from("habits").update({ current_streak: newStreak, best_streak: bestStreak }).eq("id", chosen.id);
            let motivation = "";
            if (newStreak === 1) motivation = "\n\n💪 Primeiro dia!";
            else if (newStreak === 7) motivation = "\n\n🔥 *1 semana seguida!*";
            else if (newStreak === 30) motivation = "\n\n🏆 *30 dias!*";
            else if (newStreak >= 3) motivation = `\n\n🔥 ${newStreak} dias seguidos!`;
            responseText = `✅ *${chosen.icon ?? "✅"} ${chosen.name}* — registrado!${motivation}`;
          }
        }
      }
    } else if (intent === "finance_record") {
      responseText = await handleFinanceRecord(profile.id, sendPhone || replyTo, text, config, userTz);
    } else if (intent === "category_list") {
      responseText = await handleCategoryList(profile.id);
    } else if (intent === "installment_query") {
      responseText = await handleInstallmentQuery(profile.id);
    } else if (intent === "finance_delete") {
      const delResult = await handleFinanceDelete(profile.id, text, userTz);
      responseText = delResult.response;
      pendingAction = delResult.pendingAction;
      pendingContext = delResult.pendingContext;
    } else if (intent === "finance_delete_confirm") {
      const confirmResult = await handleFinanceDeleteConfirm(profile.id, text, session ?? {});
      responseText = confirmResult.response;
      pendingAction = confirmResult.pendingAction;
      pendingContext = confirmResult.pendingContext;
    } else if (intent === "finance_report") {
      const reportResult = await handleFinanceReport(profile.id, text);
      responseText = reportResult.text;
      // Envia grafico antes do texto (se disponivel)
      if (reportResult.chartUrl) {
        try {
          await sendImage(sendPhone || replyTo, reportResult.chartUrl, "", true);
        } catch (chartErr) {
          console.error("[finance_report] Failed to send chart:", chartErr);
        }
      }
    } else if (intent === "agenda_create" || session?.pending_action === "agenda_create") {
      const result = await handleAgendaCreate(profile.id, sendPhone || replyTo, text, session, language, userNickname, userTz);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_query") {
      responseText = await handleAgendaQuery(profile.id, text, userTz);
    } else if (intent === "agenda_lookup") {
      const result = await handleAgendaLookup(profile.id, text, userTz);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_edit" || session?.pending_action === "agenda_edit") {
      const result = await handleAgendaEdit(profile.id, sendPhone || replyTo, text, session, userTz);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_edit_choose") {
      // Usuário escolheu um evento da lista de desambiguação
      const ctx = (session?.pending_context ?? {}) as any;
      const options = (ctx.options ?? []) as Array<{ id: string; title: string; event_date: string; event_time: string | null; reminder_minutes: number | null }>;
      const numMatch = text.trim().match(/^(\d+)$/);
      if (/^(nao|cancela|deixa|esquece|nada)/i.test(text.trim())) {
        responseText = "✅ Ok, não editei nada.";
      } else if (!numMatch) {
        responseText = `Por favor responda apenas com o *número* do compromisso (1 a ${options.length}).`;
        pendingAction = "agenda_edit_choose";
        pendingContext = ctx;
      } else {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx < 0 || idx >= options.length) {
          responseText = `Número inválido. Escolha entre 1 e ${options.length}.`;
          pendingAction = "agenda_edit_choose";
          pendingContext = ctx;
        } else {
          const chosen = options[idx];
          // Continua o fluxo de edit com o evento escolhido e o texto de edição original
          const fakeSession = {
            pending_context: {
              event_id: chosen.id,
              event_title: chosen.title,
              event_date: chosen.event_date,
              event_time: chosen.event_time,
              reminder_minutes: chosen.reminder_minutes,
              step: "awaiting_change",
            },
          };
          const editText = ctx.pending_edit_text || text;
          const result = await handleAgendaEdit(profile.id, sendPhone || replyTo, editText, fakeSession, userTz);
          responseText = result.response;
          pendingAction = result.pendingAction;
          pendingContext = result.pendingContext;
        }
      }
    } else if (intent === "agenda_delete") {
      responseText = await handleAgendaDelete(profile.id, text);
    } else if (intent === "notes_list") {
      responseText = await handleNotesList(profile.id);
    } else if (intent === "anota_ambiguous") {
      // Usuário disse "anota" sem destino claro — pergunta qual
      responseText =
        `📝 Onde você quer que eu salve?\n\n` +
        `*1.* 📌 Anotações (bloco de notas)\n` +
        `*2.* 📅 Agenda (compromisso com data)\n` +
        `*3.* ⏰ Lembrete (aviso futuro)\n\n` +
        `Me diz o número ou fala _"nas anotações"_, _"na agenda"_ ou _"em lembretes"_ e depois o que quer salvar.`;
      pendingAction = "anota_choose_destination";
      pendingContext = {};
    } else if (session?.pending_action === "anota_choose_destination") {
      // Usuário respondeu qual destino e/ou já mandou o conteúdo
      const msgLow = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const isNotes  = /^1$|\bnota|anotac|bloco de nota/.test(msgLow);
      const isAgenda = /^2$|\bagenda|calendario|compromisso/.test(msgLow);
      const isRem    = /^3$|\blembrete|avisa|lembra/.test(msgLow);

      // Se a mensagem só diz o destino (curta), pede o conteúdo
      const contentAfter = text.replace(/^\s*(1|2|3|nas? anotac\w+|na agenda|no calendario|em lembretes?|nos lembretes|o que|sobre|anota)\s*[:\-,]?\s*/i, "").trim();
      const hasContent = contentAfter.length > 3 && contentAfter !== text.trim();

      if (!isNotes && !isAgenda && !isRem) {
        responseText = `Não entendi. Responda *1* (anotações), *2* (agenda) ou *3* (lembrete).`;
        pendingAction = "anota_choose_destination";
        pendingContext = {};
      } else if (!hasContent) {
        const destName = isNotes ? "anotações" : isAgenda ? "agenda" : "lembretes";
        responseText = `Beleza! O que você quer que eu salve em *${destName}*?`;
        pendingAction = isNotes ? "anota_await_content_notes" : isAgenda ? "anota_await_content_agenda" : "anota_await_content_reminder";
        pendingContext = {};
      } else if (isNotes) {
        const r = await handleNotesSave(profile.id, sendPhone || replyTo, `anota: ${contentAfter}`, session, config, userTz);
        responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
      } else if (isAgenda) {
        const r = await handleAgendaCreate(profile.id, sendPhone || replyTo, contentAfter, session, language, userNickname, userTz);
        responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
      } else {
        const r = await handleReminderSet(profile.id, sendPhone || replyTo, contentAfter, session, language, userNickname, userTz);
        responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
      }
    } else if (session?.pending_action === "anota_await_content_notes") {
      const r = await handleNotesSave(profile.id, sendPhone || replyTo, `anota: ${text}`, session, config, userTz);
      responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
    } else if (session?.pending_action === "anota_await_content_agenda") {
      const r = await handleAgendaCreate(profile.id, sendPhone || replyTo, text, session, language, userNickname, userTz);
      responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
    } else if (session?.pending_action === "anota_await_content_reminder") {
      const r = await handleReminderSet(profile.id, sendPhone || replyTo, text, session, language, userNickname, userTz);
      responseText = r.response; pendingAction = r.pendingAction; pendingContext = r.pendingContext;
    } else if (intent === "notes_save") {
      const notesResult = await handleNotesSave(profile.id, sendPhone || replyTo, text, session, config, userTz);
      responseText = notesResult.response;
      pendingAction = notesResult.pendingAction;
      pendingContext = notesResult.pendingContext;
    } else if (intent === "notes_delete") {
      const delResult = await handleNotesDelete(profile.id, text);
      responseText = delResult.response;
      pendingAction = delResult.pendingAction;
      pendingContext = delResult.pendingContext;
    } else if (intent === "notes_delete_confirm") {
      const confirmResult = await handleNotesDeleteConfirm(profile.id, text, session ?? {});
      responseText = confirmResult.response;
      pendingAction = confirmResult.pendingAction;
      pendingContext = confirmResult.pendingContext;
    } else if (intent === "reminder_list") {
      responseText = await handleReminderList(profile.id, language, userTz);
    } else if (intent === "reminder_cancel") {
      responseText = await handleReminderCancel(profile.id, text, language);
    } else if (intent === "reminder_edit") {
      responseText = await handleReminderEdit(profile.id, text, language, userTz);
    } else if (intent === "reminder_set") {
      const reminderResult = await handleReminderSet(profile.id, sendPhone || replyTo, text, session, language, userNickname, userTz);
      responseText = reminderResult.response;
      pendingAction = reminderResult.pendingAction;
      pendingContext = reminderResult.pendingContext;
    } else if (intent === "reminder_snooze") {
      responseText = await handleReminderSnooze(profile.id, sendPhone || replyTo, text, userTz);
    } else if (intent === "event_followup") {
      const followupResult = await handleEventFollowup(profile.id, sendPhone || replyTo, text, session ?? {});
      responseText = followupResult.response;
      pendingAction = followupResult.pendingAction;
      pendingContext = followupResult.pendingContext;
    } else if (intent === "statement_import") {
      const stmtResult = await handleStatementConfirm(profile.id, sendPhone || replyTo, text, session ?? {});
      responseText = stmtResult.response;
      pendingAction = stmtResult.pendingAction;
      pendingContext = stmtResult.pendingContext;

    } else if (intent === "shadow_finance_confirm") {
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase();
      if (text === "BUTTON:SHADOW_FIN_YES" || /^(1|sim|confirmar|registrar|ok)\b/.test(msgLow)) {
        const txDate = (ctx.date as string) || new Date().toLocaleDateString("sv-SE", { timeZone: userTz });
        await supabase.from("transactions").insert({
          user_id: profile.id,
          type: ctx.type || "expense",
          amount: ctx.amount,
          category: ctx.category || "outros",
          description: ctx.description || "Encaminhado",
          transaction_date: txDate,
          source: "whatsapp_forward",
        });
        const emoji = ctx.type === "income" ? "🟢" : "🔴";
        const catEm = CATEGORY_EMOJI[(ctx.category as string) ?? "outros"] ?? "📦";
        responseText = `${emoji} Registrado: R$ ${fmtBRL(ctx.amount as number)} — ${ctx.description || "encaminhado"} (${catEm} ${ctx.category || "outros"}) [📨 encaminhado]`;
      } else {
        responseText = "Ok, ignorei essa transação. 🗑️";
      }
      pendingAction = undefined;
      pendingContext = undefined;

    } else if (intent === "shadow_event_confirm") {
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase();
      if (text === "BUTTON:SHADOW_EVT_YES" || /^(1|sim|criar|confirmar|ok)\b/.test(msgLow)) {
        await supabase.from("events").insert({
          user_id: profile.id,
          title: ctx.title || "Evento encaminhado",
          event_date: ctx.date ?? null,
          event_time: ctx.time ?? null,
          status: "confirmed",
          source: "whatsapp_forward",
        });
        const dateStr = ctx.date ? ` — ${ctx.date}` : "";
        const timeStr = ctx.time ? ` às ${ctx.time}` : "";
        responseText = `✅ Evento criado: *${ctx.title || "Evento encaminhado"}*${dateStr}${timeStr} [📨 encaminhado]`;
        syncGoogleCalendar(profile.id, ctx.title as string, ctx.date as string, (ctx.time as string) ?? null, null, null, null, userTz).catch(() => {});
      } else {
        responseText = "Ok, ignorei o evento. 🗑️";
      }
      pendingAction = undefined;
      pendingContext = undefined;

    } else if (intent === "shadow_reminder_confirm") {
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase();
      if (text === "BUTTON:SHADOW_REM_YES" || /^(1|sim|criar|confirmar|ok)\b/.test(msgLow)) {
        const remindAt = ctx.remind_at
          ? new Date(ctx.remind_at as string)
          : new Date(Date.now() + 24 * 60 * 60 * 1000);
        await supabase.from("reminders").insert({
          user_id: profile.id,
          whatsapp_number: sendPhone || replyTo,
          title: (ctx.title as string) || "Lembrete encaminhado",
          message: `🔔 *Lembrete!*\n${(ctx.title as string) || "Lembrete encaminhado"}`,
          send_at: remindAt.toISOString(),
          recurrence: "none",
          source: "whatsapp_forward",
          status: "pending",
        });
        responseText = `✅ Lembrete criado: *${ctx.title || "Lembrete encaminhado"}* [📨 encaminhado]`;
      } else {
        responseText = "Ok, ignorei o lembrete. 🗑️";
      }
      pendingAction = undefined;
      pendingContext = undefined;

    } else if (intent === "contact_save") {
      // Salvar contato digitado: "salva o contato João 11999999999"
      // Extrai nome
      const nameMatchCS = text.match(
        /(?:contato|numero|telefone)\s+(?:d[oa]\s+)?([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*)|(?:salva|adiciona)\s+(?:o\s+)?([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)/i
      );
      const nameCS = (nameMatchCS?.[1] ?? nameMatchCS?.[2] ?? "").trim();
      // Extrai telefone — qualquer sequência de dígitos com 8+ dígitos
      const phoneMatchCS = text.match(/\b(\d[\d\s\-().]{7,}\d)\b/);
      let phoneCS = phoneMatchCS ? phoneMatchCS[1].replace(/\D/g, "") : "";
      if (phoneCS && !phoneCS.startsWith("55") && phoneCS.length <= 11) phoneCS = `55${phoneCS}`;

      if (!nameCS || !phoneCS) {
        responseText = `Para salvar um contato, me diga o nome e o número:\n_"Salva o contato João: 11 99999-9999"_\n\nOu compartilhe o contato direto da agenda do WhatsApp! 📇`;
      } else {
        const phoneDisplayCS = phoneForDisplay(phoneCS);
        const sessionId = profile.phone_number?.replace(/\D/g, "") || (sendPhone || replyTo).replace(/\D/g, "");
        await sendButtons(
          sendPhone || replyTo,
          "📇 Salvar contato?",
          `*${nameCS}*\n📱 ${phoneDisplayCS}\n\nConfirma salvar nos seus contatos?`,
          [
            { id: `CONTACT_SAVE_YES|${nameCS}|${phoneCS}`, text: "💾 Salvar" },
            { id: "CONTACT_SAVE_NO",                        text: "❌ Não" },
          ]
        );
        pendingAction  = "contact_save_confirm";
        pendingContext = { name: nameCS, phone: phoneCS };
        responseText   = ""; // botão já enviado
      }

    } else if (session?.pending_action === "order_disambiguate") {
      // Usuário respondeu qual estabelecimento quer (desambiguação)
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const result = await handleOrderDisambiguate(profile.id, sendPhone || replyTo, text, ctx);
      responseText   = result.response;
      pendingAction  = result.pendingAction;
      pendingContext = result.pendingContext;

    } else if (session?.pending_action === "order_collecting") {
      // Usuário está no fluxo de coleta de detalhes do pedido (what → drinks → obs → confirm)
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const result = await handleOrderCollecting(ctx, text);
      responseText   = result.response;
      pendingAction  = result.pendingAction;
      pendingContext = result.pendingContext;

    } else if (intent === "order_confirm" || session?.pending_action === "order_confirm") {
      // Usuario confirmou (ou negou) o pedido ao estabelecimento
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase().trim();
      const yes = /^(1|sim|s|ok|confirma|pode|claro|envia|manda|vai|yes|yep|bora)\b/i.test(msgLow);
      const no  = /^(2|nao|n|cancela|deixa|esquece|não|nope|cancelar)\b/i.test(msgLow);

      if (yes && ctx.business_name) {
        // Se tem scheduled_at → agenda pro futuro; senão → envia agora
        if (ctx.scheduled_at) {
          responseText = await scheduleOrder(profile.id, sendPhone || replyTo, ctx);
        } else {
          responseText = await executeOrder(profile.id, sendPhone || replyTo, ctx);
        }
        pendingAction  = undefined;
        pendingContext = undefined;
      } else if (no) {
        responseText  = "Ok, pedido cancelado! Pode pedir de novo quando quiser. 👍";
        pendingAction  = undefined;
        pendingContext = undefined;
      } else {
        // Nao entendeu — repete a confirmacao E preserva o contexto
        responseText   = "Responda *sim* para confirmar o pedido ou *não* para cancelar.";
        pendingAction  = "order_confirm";
        pendingContext = ctx;
      }

    } else if (intent === "contact_save_confirm") {
      // Usuário clicou em "💾 Salvar" ou "❌ Ignorar" após detectar contato
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;

      // Extrai nome e phone do botão (formato "CONTACT_SAVE_YES|Nome|phone")
      // ou do pending_context como fallback
      let csName = (ctx.name as string) || "";
      let csPhone = (ctx.phone as string) || "";
      const btnParts = text.replace("BUTTON:", "").split("|");
      if (btnParts[0] === "CONTACT_SAVE_YES" && btnParts[1]) {
        csName = btnParts[1];
        csPhone = btnParts[2] ?? csPhone;
      }

      const isYes =
        text.startsWith("BUTTON:CONTACT_SAVE_YES") ||
        /^(1|sim|salvar|salva|confirmar|ok|yes)\b/i.test(text);

      if (isYes && csName && csPhone) {
        // Em vez de salvar direto, pergunta se é Pessoa ou Estabelecimento
        await sendButtons(
          sendPhone || replyTo,
          "📇 Tipo de contato",
          `*${csName}* é uma pessoa ou estabelecimento?`,
          [
            { id: `CONTACT_TYPE_PERSON|${csName}|${csPhone}`, text: "👤 Pessoa" },
            { id: `CONTACT_TYPE_BIZ|${csName}|${csPhone}`,    text: "🏪 Estabelecimento" },
          ]
        );
        pendingAction  = "contact_save_type";
        pendingContext = { name: csName, phone: csPhone };
        responseText   = ""; // botão já enviado
      } else {
        responseText   = "Ok, contato não salvo. 👍";
        pendingAction  = undefined;
        pendingContext = undefined;
      }

    } else if (intent === "contact_save_type") {
      // Usuário escolheu Pessoa ou Estabelecimento
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      let ctName  = (ctx.name  as string) || "";
      let ctPhone = (ctx.phone as string) || "";

      // Extrai do botão se disponível
      const btnParts = text.replace("BUTTON:", "").split("|");
      if ((btnParts[0] === "CONTACT_TYPE_PERSON" || btnParts[0] === "CONTACT_TYPE_BIZ") && btnParts[1]) {
        ctName  = btnParts[1];
        ctPhone = btnParts[2] ?? ctPhone;
      }

      const isPerson =
        text.startsWith("BUTTON:CONTACT_TYPE_PERSON") ||
        /^(1|pessoa|pessoal|amigo|amiga|familiar|contato pessoal)\b/i.test(text);

      const isBiz =
        text.startsWith("BUTTON:CONTACT_TYPE_BIZ") ||
        /^(2|estabelecimento|empresa|loja|restaurante|farmacia|negocio|comercio|biz)\b/i.test(text);

      if (isPerson && ctName && ctPhone) {
        const { error } = await supabase.from("contacts").upsert(
          { user_id: profile.id, name: ctName, phone: ctPhone, source: "whatsapp", type: "person", category: null } as any,
          { onConflict: "user_id,phone" }
        );
        const firstName = ctName.split(" ")[0];
        responseText = error
          ? `⚠️ Erro ao salvar. Tente de novo.`
          : `✅ *${ctName}* salvo como *Pessoa*!\n\nAgora pode pedir:\n• _"Manda mensagem pro ${firstName} dizendo..."_\n• _"Marca reunião com ${firstName} amanhã às 14h"_`;
        pendingAction  = undefined;
        pendingContext = undefined;

      } else if (isBiz && ctName && ctPhone) {
        // Pergunta categoria
        const CATEGORIES = ["Pizzaria", "Restaurante", "Farmácia", "Mercado", "Padaria", "Lanchonete", "Sushi", "Hamburguer", "Açaí", "Serviço", "Outro"];
        const catLines = CATEGORIES.slice(0, 9).map((c, i) => `*${i + 1}.* ${c}`).join("\n");
        responseText   = `🏪 Qual categoria?\n\n${catLines}\n*10.* Serviço\n*11.* Outro\n\nResponda com o *número* ou o nome.`;
        pendingAction  = "contact_save_category";
        pendingContext = { name: ctName, phone: ctPhone };

      } else {
        responseText   = "Não entendi. Responde *Pessoa* ou *Estabelecimento*. 😊";
        // mantém pendingAction e pendingContext inalterados para retry
        pendingAction  = "contact_save_type";
        pendingContext = ctx;
      }

    } else if (intent === "contact_save_category") {
      // Usuário escolheu a categoria do estabelecimento
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const ccName  = (ctx.name  as string) || "";
      const ccPhone = (ctx.phone as string) || "";

      const CATEGORIES = ["pizzaria", "restaurante", "farmácia", "mercado", "padaria", "lanchonete", "sushi", "hamburguer", "açaí", "serviço", "outro"];
      const LABELS     = ["Pizzaria", "Restaurante", "Farmácia", "Mercado", "Padaria", "Lanchonete", "Sushi", "Hamburguer", "Açaí", "Serviço", "Outro"];

      let category = "";
      const numMatch = text.trim().match(/^(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]) - 1;
        if (idx >= 0 && idx < CATEGORIES.length) category = CATEGORIES[idx];
      }
      if (!category) {
        const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const found = CATEGORIES.findIndex(c => norm.includes(c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
        if (found >= 0) category = CATEGORIES[found];
      }
      if (!category) category = "outro";

      const label = LABELS[CATEGORIES.indexOf(category)] ?? "Outro";

      const { error } = await supabase.from("contacts").upsert(
        { user_id: profile.id, name: ccName, phone: ccPhone, source: "whatsapp", type: "business", category } as any,
        { onConflict: "user_id,phone" }
      );
      responseText = error
        ? `⚠️ Erro ao salvar. Tente de novo.`
        : `✅ *${ccName}* salvo como *Estabelecimento* (${label})!\n\nAgora posso fazer pedidos lá pra você. Basta dizer:\n_"Jarvis, pede uma pizza de calabresa na ${ccName}"_ 🍕`;
      pendingAction  = undefined;
      pendingContext = undefined;

    } else if (intent === "reminder_delegate") {
      // Resposta à pergunta "Quem envia?" disparada pelo send-reminder quando o
      // lembrete continha um "enviar pro X..." — usuário escolhe Jarvis ou ele mesmo.
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const contactText = (ctx.contact_text as string) ?? "";
      const msgLow = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const jarvisSends =
        text === "BUTTON:DELEGATE_JARVIS" ||
        /^(1|jarvis|pode|voce envia|pode enviar|jarvis envia|pode ser|manda voce|envia voce|sim)\b/i.test(msgLow);
      const meSends =
        text === "BUTTON:DELEGATE_ME" ||
        /^(2|eu|eu mesmo|eu envio|vou eu|nao|deixa que eu|eu mando)\b/i.test(msgLow);

      if (jarvisSends && contactText) {
        // Jarvis executa o envio — reutiliza handleSendToContact com o texto original do lembrete
        responseText = await handleSendToContact(
          profile.id, sendPhone || replyTo, contactText, userTz, agentName, userNickname, pushName
        );
      } else if (meSends) {
        responseText = "Ok, você envia! ✌️ Me avisa se precisar de mais alguma coisa.";
      } else {
        // Não reconheceu — repete a pergunta
        const opts =
          `Quem envia essa mensagem?\n\n` +
          `*1.* 🤖 Jarvis envia\n` +
          `*2.* ✉️ Eu mesmo envio`;
        responseText = opts;
      }
      pendingAction = undefined;
      pendingContext = undefined;

    } else if (intent === "list_contacts") {
      // Usa a coluna correta "phone" (não phone_number — schema contacts tem phone)
      const { data: allContacts } = await supabase
        .from("contacts")
        .select("name, phone")
        .eq("user_id", profile.id)
        .order("name", { ascending: true });
      if (!allContacts || allContacts.length === 0) {
        responseText = "Você ainda não tem contatos salvos no Jarvis. 📇\n\nCompartilhe um contato comigo ou diga _\"Salva o contato [Nome]: [número]\"_";
      } else {
        // Formata phone pra exibição se disponível (ex: +55 11 9xxxx-xxxx)
        const lines = allContacts.map((c: any) => {
          const phone = c.phone ? ` — ${c.phone}` : "";
          return `• *${c.name}*${phone}`;
        }).join("\n");
        responseText = `📇 *Seus contatos salvos (${allContacts.length}):*\n\n${lines}\n\nPara enviar mensagem: _"Manda pra [Nome] dizendo..."_`;
      }

    } else if (intent === "order_on_behalf") {
      const orderResult = await handleOrderOnBehalf(
        profile.id, sendPhone || replyTo, text, agentName, userNickname, pushName, userTz
      );
      responseText  = orderResult.response;
      pendingAction = orderResult.pendingAction;
      pendingContext = orderResult.pendingContext;

    } else if (intent === "send_to_contact") {
      responseText = await handleSendToContact(
        profile.id, sendPhone || replyTo, text, userTz, agentName, userNickname, pushName
      );

    } else if (intent === "schedule_meeting") {
      const meetResult = await handleScheduleMeeting(
        profile.id, sendPhone || replyTo, text, userTz, agentName, userNickname, pushName, language
      );
      responseText = meetResult.response;
      pendingAction = meetResult.pendingAction;
      pendingContext = meetResult.pendingContext;

    } else if (intent === "meeting_invite_confirm") {
      const ctx = (session?.pending_context ?? {}) as Record<string, unknown>;
      const msgLow = text.toLowerCase().trim();
      const yes =
        text === "BUTTON:MEETING_INVITE_YES" ||
        /^(1|sim|envia|envia(r)?|manda(r)?|pode|claro|isso|por favor|s|y|yes|ok|beleza|blz|com certeza)\b/.test(msgLow);
      const no =
        text === "BUTTON:MEETING_INVITE_NO" ||
        /^(2|nao|n|não|deixa|deixa pra la|esquece|nem|cancela|nope|nah|no)\b/.test(msgLow);

      if (yes) {
        const contactPhone = ctx.contact_phone as string | undefined;
        const contactFirst = (ctx.contact_first as string) || "Contato";
        const senderName = (ctx.sender_name as string) || "seu contato";
        const agentN = (ctx.agent_name as string) || agentName;
        const dateLbl = (ctx.date_label as string) || "";
        const timeLbl = ctx.time_label ? ` às *${ctx.time_label}*` : "";
        const meet = ctx.meet_link as string | null;
        const subj = ctx.subject as string | null;

        if (!contactPhone) {
          responseText = "Não consegui encontrar o telefone do contato. 😕";
        } else {
          // Busca telefone real do user pra CTA
          const { data: userProfile } = await supabase
            .from("profiles")
            .select("phone_number")
            .eq("id", profile.id)
            .maybeSingle();
          const userPhoneDisplay = phoneForDisplay(userProfile?.phone_number ?? replyTo);

          const subjectLine = subj ? `\n📝 *Assunto:* ${subj}` : "";
          const meetLine = meet ? `\n🔗 *Link da reunião:*\n${meet}` : "";
          const contactMsg =
            `Olá, *${contactFirst}*! 👋\n\n` +
            `Aqui é o *${agentN}*, assistente virtual de *${senderName}*.\n\n` +
            `Ele(a) marcou uma reunião com você:\n\n` +
            `📅 *${dateLbl}*${timeLbl}` +
            subjectLine +
            meetLine +
            buildJarvisCTA(senderName, userPhoneDisplay);

          try {
            await sendText(contactPhone, contactMsg);
            // Agenda lembrete 10 min antes pro contato também
            if (ctx.time_label) {
              const dateMatch = (dateLbl || "").match(/(\d{1,2}) de (\w+)/);
              // event_date original veio do extract — pra simplificar, busca o evento mais recente desse user com esse título
              const todayLocal = new Date().toLocaleDateString("sv-SE", { timeZone: userTz });
              const { data: ev } = await supabase
                .from("events")
                .select("event_date, event_time")
                .eq("user_id", profile.id)
                .eq("source", "whatsapp_meeting")
                .gte("event_date", todayLocal)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (ev?.event_date && ev?.event_time) {
                const meetingDt = new Date(`${ev.event_date}T${ev.event_time.slice(0, 5)}:00`);
                const reminderAt = new Date(meetingDt.getTime() - 10 * 60_000).toISOString();
                if (new Date(reminderAt) > new Date()) {
                  const meetSuffix = meet ? `\n\n🔗 ${meet}` : "";
                  await supabase.from("reminders").insert({
                    user_id: profile.id,
                    whatsapp_number: contactPhone,
                    title: `Lembrete reunião em 10 min`,
                    message: `⏰ *Lembrete, ${contactFirst}!*\n\nDaqui 10 minutos você tem reunião com *${senderName}*!${subj ? `\n📝 Assunto: _${subj}_` : ""}${meetSuffix}\n\n_— ${agentN}, assistente virtual de ${senderName}_`,
                    send_at: reminderAt,
                    recurrence: "none",
                    status: "pending",
                    source: "meeting_reminder_contact",
                  });
                }
              }
            }
            responseText = `📤 Convite enviado pra *${contactFirst}*! Vou lembrar vocês 10 min antes. ⏰`;
          } catch (sendErr) {
            console.error("[meeting_invite_confirm] sendText to contact failed:", sendErr);
            responseText = `❌ Não consegui enviar pro *${contactFirst}*. Verifica se o número dele(a) está certo nos seus contatos.`;
          }
        }
      } else if (no) {
        responseText = `👍 Beleza, não enviei pra ${(ctx.contact_first as string) || "ele(a)"}. A reunião está marcada só pra você.`;
      } else {
        // Resposta ambígua — pergunta de novo mantendo o pending
        responseText = `Não entendi. Quer que eu envie o convite pra *${ctx.contact_first || "o contato"}*?\n\n*1.* ✅ Sim, envia\n*2.* ❌ Não, deixa`;
        pendingAction = "meeting_invite_confirm";
        pendingContext = ctx;
      }

    } else {
      // Chat geral com IA (moduleChat já verificado acima via moduleActive)
      // Informa à IA quais módulos estão ativos/inativos para consistência
      const moduleContext = [
        `Módulos ativos: ${[moduleFinance && "Financeiro", moduleAgenda && "Agenda", moduleNotes && "Anotações/Lembretes", "Conversa livre"].filter(Boolean).join(", ")}.`,
        !moduleFinance ? "O módulo Financeiro está DESATIVADO — se o usuário pedir registro de gastos, diga que o módulo está desativado e peça para ativar no painel." : "",
        !moduleAgenda  ? "O módulo Agenda está DESATIVADO — se o usuário pedir agenda ou compromissos, diga que o módulo está desativado e peça para ativar no painel." : "",
        !moduleNotes   ? "O módulo Anotações/Lembretes está DESATIVADO — se o usuário pedir anotações ou lembretes, diga que o módulo está desativado e peça para ativar no painel." : "",
      ].filter(Boolean).join(" ");
      const enrichedInstructions = [customInstructions, moduleContext].filter(Boolean).join("\n\n");
      const history = await getRecentHistory(profile.id);
      // Se o usuário deu reply em uma mensagem anterior do Jarvis, adiciona isso como contexto
      const contextualText = quotedText
        ? `[Usuário está respondendo a essa sua mensagem anterior: "${quotedText.slice(0, 300)}"]\n\nMensagem do usuário: ${text}`
        : text;
      responseText = await assistantChat(contextualText, agentName, tone, language, userNickname, enrichedInstructions, history);
    }

    // 7. Traduz resposta se necessário e envia
    // (responseText vazio indica que um botão interativo já foi enviado pelo handler)
    if (responseText) {
      if (language !== "pt-BR") {
        responseText = await translateIfNeeded(responseText, language);
      }
      try {
        await sendText(sendPhone || replyTo, responseText);
      } catch (sendErr) {
        console.error("[processMessage] sendText failed, queuing for retry:", sendErr);
        await queueMessage(sendPhone || replyTo, responseText, profile.id);
      }
    }

    // 8. Atualiza sessão
    await supabase.from("whatsapp_sessions").upsert(
      {
        user_id: profile.id,
        phone_number: sessionId,
        pending_action: pendingAction ?? null,
        pending_context: pendingContext ?? null,
        last_activity: new Date().toISOString(),
        last_processed_id: messageId ?? null,
      },
      { onConflict: "phone_number" }
    );

    // 9. Salva mensagens na conversa
    // Pula registro de conversa quando responseText esta vazio (botoes interativos ja enviados pelo handler)
    if (responseText) {
      await saveConversation(profile.id, lid, sendPhone, pushName, text, responseText, intent);
    }

    // 10. Incrementa contador de mensagens
    await supabase
      .from("profiles")
      .update({ messages_used: profile.messages_used + 1 })
      .eq("id", profile.id);

    // 11. Registra metrica de performance (fire-and-forget)
    logMetric(profile.id, currentIntent || "ai_chat", Date.now() - t0, true, undefined, text.length).catch(() => {});

    log.push("success");
    return log;
  } catch (err) {
    const { message, stack } = fromThrown(err);
    log.push(`ERROR: ${message}`);
    await logError({
      context: "whatsapp-webhook/processMessage",
      message,
      stack,
      phone_number: replyTo.replace(/@.*$/, ""),
      metadata: { lid, messageId },
    });
    // Registra metrica de erro se temos profile (busca por phone_number, nao por id)
    try {
      const errPhone = sanitizePhone(replyTo.replace(/@.*$/, "").replace(/:\d+$/, ""));
      if (errPhone) {
        const { data: pErr } = await supabase.from("profiles").select("id")
          .or(`phone_number.eq.${errPhone},phone_number.eq.+${errPhone}`)
          .maybeSingle();
        if (pErr?.id) logMetric(pErr.id, currentIntent || "unknown", Date.now() - t0, false, message.slice(0, 100)).catch(() => {});
      }
    } catch { /* ignora */ }
    try {
      const humanizedError = getHumanizedError(currentIntent);
      await sendText(replyTo, humanizedError);
    } catch { /* ignora erro no fallback */ }
    return log;
  }
}

async function getRecentHistory(userId: string): Promise<ChatMessage[]> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) return [];

  const { data: msgs } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (msgs ?? []).reverse() as ChatMessage[];
}

async function saveConversation(
  userId: string,
  lid: string | null,
  phoneNumber: string,
  contactName: string,
  userText: string,
  assistantText: string,
  intent: string
): Promise<void> {
  // Busca conversa existente: por LID (se disponível) ou por user_id
  let { data: conv } = await supabase
    .from("conversations")
    .select("id, message_count")
    .eq("user_id", userId)
    .eq(lid ? "whatsapp_lid" : "phone_number", lid ?? phoneNumber)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    const { data: newConv } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        phone_number: phoneNumber,
        whatsapp_lid: lid ?? null,
        contact_name: contactName || null,
      })
      .select()
      .single();
    conv = newConv;
  } else {
    // Atualiza nome se mudou
    if (contactName) {
      await supabase
        .from("conversations")
        .update({ contact_name: contactName })
        .eq("id", conv.id);
    }
  }

  if (!conv) return;

  // Formata texto de botão para log legível
  const displayUserText = userText.startsWith("BUTTON:")
    ? `[Botão: ${userText.replace("BUTTON:", "").replace(/_/g, " ")}]`
    : userText;

  await supabase.from("messages").insert([
    { conversation_id: conv.id, role: "user", content: displayUserText, intent },
    { conversation_id: conv.id, role: "assistant", content: assistantText },
  ]);

  await supabase
    .from("conversations")
    .update({
      message_count: (conv.message_count ?? 0) + 2,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conv.id);
}

