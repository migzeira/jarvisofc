import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, extractPhone, downloadMediaBase64, resolveLidToPhone } from "../_shared/evolution.ts";
import { syncGoogleCalendar, syncGoogleSheets, syncNotion } from "../_shared/integrations.ts";
import {
  chat,
  extractTransactions,
  extractEvent,
  parseAgendaQuery,
  extractAgendaEdit,
  assistantChat,
  transcribeAudio,
  extractReceiptFromImage,
  parseReminderIntent,
  type ChatMessage,
  type ExtractedEvent,
} from "../_shared/openai.ts";
import { logError, fromThrown } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────
// LOCALIZATION HELPERS
// ─────────────────────────────────────────────

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
    finance_record:  "finance",
    finance_report:  "finance",
    agenda_create:   "agenda",
    agenda_query:    "agenda",
    agenda_lookup:   "agenda",
    agenda_edit:     "agenda",
    agenda_delete:   "agenda",
    event_followup:  "agenda",
    notes_save:      "notes",
    reminder_set:    "notes",
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
// INTENT CLASSIFIER (regex first, sem custo IA)
// ─────────────────────────────────────────────
type Intent =
  | "greeting"
  | "finance_record"
  | "finance_report"
  | "agenda_create"
  | "agenda_query"
  | "agenda_lookup"
  | "agenda_edit"
  | "agenda_delete"
  | "notes_save"
  | "reminder_set"
  | "reminder_snooze"
  | "event_followup"
  | "ai_chat";

function classifyIntent(msg: string): Intent {
  const m = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Saudação simples — deve ser primeira verificação (antes de qualquer outro intent)
  if (
    /^(oi|ola|olá|hello|hi|hey|bom dia|boa tarde|boa noite|hola|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|good evening|good night|e ai|e aí|salve|fala|opa|tudo bem|tudo bom|como vai|como estas|como esta)[\s!,?.]*$/.test(m)
  )
    return "greeting";

  // Relatório financeiro (antes de finance_record para evitar falso positivo)
  if (
    /quanto (gastei|ganhei|recebi|devo)|total (de |dos |das )?(gastos?|despesas?)|relatorio|resumo (de |dos )?(gastos?|financ)|meus gastos|minhas despesas/.test(
      m
    )
  )
    return "finance_report";

  // Registro financeiro
  if (
    /gastei|comprei|paguei|recebi|ganhei|custou|vale |custa |despesa|despendi|gasei/.test(
      m
    )
  )
    return "finance_record";

  // Criar agenda
  if (
    /marca(r)?( na| uma| pra)? (agenda|reuniao|meeting|compromisso|consulta|evento)|agendar|marcar reuniao|tenho (reuniao|consulta|compromisso|medico|dentista|medica)|colocar na agenda|adicionar na agenda|criar evento|novo compromisso|nova reuniao|nova consulta|novo evento|agenda dia \d|vou ao (medico|dentista|hospital|especialista)|vou a (clinica|consulta)|preciso ir ao (medico|dentista|hospital)|marcar com o (medico|dentista|doutor|dra|dr)/.test(
      m
    )
  )
    return "agenda_create";

  // Consultar agenda
  if (
    /o que (tenho|tem) (hoje|amanha|marcado|essa semana|semana|na agenda)|minha agenda|(proximos?|pr[oó]ximos?) (eventos?|compromissos?|reunioes?)|(agenda de|agenda do|agenda da|agenda dessa|agenda desta) (hoje|amanha|semana|mes)|meus compromissos|tem algo marcado|compromissos de (hoje|amanha|semana)|agenda dessa semana|compromissos da semana|eventos? (de|da|do) (hoje|amanha|semana|mes)|o que tenho marcado/.test(
      m
    )
  )
    return "agenda_query";

  // Salvar nota
  if (
    /^(anota|anotacao|anote|salva|escreve|registra|guarda)[\s:,]|^nota[\s:,]|preciso lembrar|lembrar de /.test(
      m
    )
  )
    return "notes_save";

  // Snooze de lembrete — adiar um lembrete recente (em português natural)
  if (
    /^snooze\b/.test(m) ||
    m === "adiar" || m === "adia" ||
    /^adiar?\s+\d+\s*(min|minuto|hora)/.test(m) ||
    /me lembra (isso |de novo |novamente )?(daqui|em) \d/.test(m) ||
    /me lembra (de novo|novamente) (daqui|em)/.test(m) ||
    /me avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /manda (de novo|novamente) (daqui|em) \d/.test(m) ||
    /repete (daqui|em) \d/.test(m) ||
    /avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /(de novo|novamente) em \d/.test(m) ||
    /daqui a pouco de novo/.test(m) ||
    /me lembra (daqui|em) \d/.test(m)
  ) return "reminder_snooze";

  // Lembrete simples — exige forma imperativa (não pega perguntas sobre a Maya)
  // Evita falso positivo em "você não vai me lembrar?", "ia me lembrar", etc.
  if (
    /^me lembra\b|^me avisa\b|^me notifica\b|^quero um lembrete|^cria(r)? (um )?lembrete|^salva (um )?lembrete|^adiciona (um )?lembrete|^lembrete:/.test(m) ||
    /\bme lembra (de|que|do|da|às|as|amanha|hoje|semana|todo|toda|dia \d)\b/.test(m) ||
    /\bme avisa (às|as|quando|amanha|hoje|dia \d)\b/.test(m)
  ) return "reminder_set";

  // Buscar evento específico
  if (/voce lembra (do|da|de) (meu|minha)|lembra (do|da|de) (meu|minha)|tem (meu|minha) .{2,30} marcad|qual (e|é) (meu|minha)|quando (e|é) (meu|minha)|tem algo (marcado|agendado) (dia|no dia|para)/.test(m))
    return "agenda_lookup";

  // Cancelar/excluir evento direto (sem edição)
  if (
    /^(cancela|exclui|apaga|deleta|remove|desmarca)\s+(meu|minha|o|a)?\s*.{2,40}$/.test(m) ||
    /nao vou mais (ao|a|para o|para a|ao |a )\s*.{2,30}/.test(m) ||
    /(cancela|exclui|apaga|deleta|desmarca) (o evento|a reuniao|o compromisso|a consulta|o|a)\s+.{2,30}/.test(m)
  )
    return "agenda_delete";

  // Editar/remarcar evento
  if (/(mudei|muda|mude|alterei|altera|altere|remarca|remarcar|atualiza|cancela|cancelar|excluir|deletar|mover) .{0,20}(dia|hora|horario|data|evento|compromisso|reuniao|consulta)|mudei de (data|dia|horario|hora)|nao e mais (dia|hora)|e (dia|hora) \d|muda (o|a) (dia|hora|horario|data)/.test(m))
    return "agenda_edit";

  return "ai_chat";
}

// ─────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v),
    template
  );
}

async function handleFinanceRecord(
  userId: string,
  phone: string,
  message: string,
  config: Record<string, unknown> | null
): Promise<string> {
  const transactions = await extractTransactions(message);

  if (!transactions.length) {
    return "Não consegui identificar os valores. Pode repetir? Ex: *gastei 200 reais de gasolina*";
  }

  const inserts = transactions.map((t) => ({
    user_id: userId,
    description: t.description,
    amount: t.amount,
    type: t.type,
    category: t.category,
    source: "whatsapp",
  }));

  const { error } = await supabase.from("transactions").insert(inserts);
  if (error) throw error;

  // Sync Google Sheets (fire-and-forget, sem bloquear resposta)
  const today = new Date().toISOString().split("T")[0];
  for (const t of transactions) {
    syncGoogleSheets(userId, {
      date: today,
      description: t.description,
      amount: t.amount,
      type: t.type,
      category: t.category,
    }).catch(() => {}); // ignora erros de sync
  }

  if (transactions.length === 1) {
    const t = transactions[0];
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

  const lines = transactions.map((t) => {
    const emoji = t.type === "expense" ? "🔴" : "🟢";
    return `${emoji} ${t.description}: *R$ ${t.amount.toFixed(2).replace(".", ",")}*`;
  });
  const total = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);

  const tplMulti = (config?.template_expense_multi as string)
    ?? "✅ *{{count}} gastos registrados{{name_tag}}!*\n\n{{lines}}\n\n💸 *Total: R$ {{total}}*";

  const nickMulti = (config?.user_nickname as string) || "";
  return applyTemplate(tplMulti, {
    count: String(transactions.length),
    lines: lines.join("\n"),
    total: total.toFixed(2).replace(".", ","),
    name_tag: nickMulti ? `, ${nickMulti}` : "",
  });
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

function detectCategory(m: string): string | null {
  // Normaliza e tokeniza pra evitar falsos positivos (ex: "moto" != "moradia")
  const normalized = m
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = normalized.split(/\s+/);

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
  message: string
): Promise<string> {
  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Detecta categoria específica na pergunta
  const filterCategory = detectCategory(m);

  // Determina período
  let startDate: string;
  let periodLabel: string;
  const now = new Date();

  if (/hoje/.test(m)) {
    startDate = now.toISOString().split("T")[0];
    periodLabel = "hoje";
  } else if (/semana/.test(m)) {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    startDate = start.toISOString().split("T")[0];
    periodLabel = "esta semana";
  } else if (/mes|mês/.test(m)) {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    periodLabel = "este mês";
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    periodLabel = "este mês";
  }

  let query = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .gte("transaction_date", startDate)
    .order("transaction_date", { ascending: false });

  if (filterCategory) {
    query = query.eq("category", filterCategory);
  }

  const { data: transactions, error } = await query;

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
        return `📊 Nenhum gasto registrado para *${periodLabel}* ainda.`;
      }
      const catList = cats.map((c) => `${catEmojis[c] ?? "📌"} ${c}`).join(", ");
      return `📊 Não encontrei gastos com *${filterCategory}* em *${periodLabel}*.\n\nCategorias que você tem registros: ${catList}`;
    }
    return `📊 Nenhum registro encontrado para *${periodLabel}*.`;
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
    return r;
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

  report += `\n\n📱 Ver gráficos completos no app Minha Maya`;

  return report;
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

// Detecta se o usuário NÃO quer lembrete nenhum
function isReminderDecline(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /^(nao|n|nope|nah|sem lembrete|nao precisa|nao quero|dispenso|pode nao|nao obrigado|nao, obrigado|ta bom assim|nao quero lembrete|sem aviso)$/.test(m);
}

// Detecta se o usuário quer ser avisado NA HORA do evento (reminder_minutes = 0)
function isReminderAtTime(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /(so (me avisa|avisa|notifica) na hora|na hora|no horario|quando chegar a hora|so na hora|avisa na hora|me avisa na hora|no momento)/.test(m);
}

// Detecta se o usuário está aceitando lembrete (com antecedência)
function isReminderAccept(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /^(sim|s|quero|pode ser|claro|por favor|bora|pode|yes|ok|beleza|blz|com certeza|isso|quero sim|pode|quero ser lembrado)$/.test(m);
}

// Converte texto de tempo em minutos (ex: "2 horas" → 120, "meia hora" → 30)
function parseMinutes(msg: string): number | null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // "na hora" ou "no momento" → 0 min (avisa na hora)
  if (/(na hora|no momento|no horario|so na hora)/.test(m)) return 0;
  // "X horas antes" / "X hora antes"
  const hoursMatch = m.match(/(\d+(?:[.,]\d+)?)\s*hora/);
  if (hoursMatch) return Math.round(parseFloat(hoursMatch[1].replace(",", ".")) * 60);
  // "meia hora"
  if (/meia hora/.test(m)) return 30;
  // "hora e meia"
  if (/hora e meia/.test(m)) return 90;
  // número simples (minutos)
  const numMatch = m.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return null;
}

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
  userNickname: string | null = null
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = new Date().toISOString().split("T")[0];

  // Recupera contexto pendente de follow-up
  const context = (session?.pending_context as Record<string, unknown>) ?? {};
  const partial = (context.partial as Record<string, unknown>) ?? {};
  const step = (context.step as string) ?? null;

  // ─── STEP: waiting_reminder_answer ───
  // Usuário está respondendo à oferta de lembrete
  if (step === "waiting_reminder_answer") {
    // "só me avisa na hora" → lembrete no momento do evento (0 min antes)
    const recurrenceFromCtx = context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : undefined;
    if (isReminderAtTime(message)) {
      const finalData = { ...partial, reminder_minutes: 0 } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname);
    }
    // "não quero lembrete"
    if (isReminderDecline(message)) {
      const finalData = { ...partial, reminder_minutes: null } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname);
    }
    // Já veio com tempo especificado (ex: "30 minutos antes", "2 horas antes")
    const minutesInAnswer = parseMinutes(message);
    if (minutesInAnswer !== null && message.match(/\d|hora|minuto|meia/)) {
      const finalData = { ...partial, reminder_minutes: minutesInAnswer } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtx, language, userNickname);
    }
    if (isReminderAccept(message)) {
      // Aceitou — perguntar quanto tempo antes
      return {
        response: "Com quanto tempo de antecedência? ⏱️\n\n_Ex: 15 min, 30 min, 1 hora, 2 horas — ou \"só na hora\"_",
        pendingAction: "agenda_create",
        pendingContext: { partial, step: "waiting_reminder_minutes" },
      };
    }
    // Resposta ambígua — pede de novo
    return {
      response: "Quer que eu te lembre antes? Pode me dizer:\n• *30 minutos antes*\n• *1 hora antes*\n• *só na hora*\n• *não precisa*",
      pendingAction: "agenda_create",
      pendingContext: { partial, step: "waiting_reminder_answer" },
    };
  }

  // ─── STEP: waiting_reminder_minutes ───
  // Usuário está informando com quanto tempo de antecedência quer o lembrete
  if (step === "waiting_reminder_minutes") {
    const minutes = parseMinutes(message);
    if (minutes !== null) {
      const recurrenceFromCtxMin = context._recurrence ? { type: context._recurrence as string, weekday: context._recurrence_weekday as number | undefined } : undefined;
      const finalData = { ...partial, reminder_minutes: minutes } as unknown as ExtractedEvent;
      return await createEventAndConfirm(userId, phone, finalData, recurrenceFromCtxMin, language, userNickname);
    }
    // Não entendeu — pede de novo
    return {
      response: "Não entendi. Com quanto tempo antes?\n\n_Ex: 15, 30, 1 hora, 2 horas — ou \"só na hora\"_ ⏱️",
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
    return await createEventAndConfirm(userId, phone, dataWithTitle, recurrenceFromCtxTitle, language, userNickname);
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
        return {
          response: "Perfeito! Quer que eu te lembre deste evento? ⏱️\n\n_Ex: 15 min antes, 1 hora, só na hora ou não_",
          pendingAction: "agenda_create",
          pendingContext: { partial: savedPartial, step: "waiting_reminder_answer" },
        };
      }
      return await createEventAndConfirm(userId, phone, savedPartial, undefined, language, userNickname);
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
        return {
          response: "Horário atualizado! Quer que eu te lembre deste evento? ⏱️\n\n_Ex: 15 min antes, 1 hora, só na hora ou não_",
          pendingAction: "agenda_create",
          pendingContext: { partial: newData, step: "waiting_reminder_answer" },
        };
      }
      return await createEventAndConfirm(userId, phone, newData, undefined, language, userNickname);
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
    return {
      response: extracted.needs_clarification,
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
  return await createEventAndConfirm(userId, phone, extracted, recurrence ?? undefined, language, userNickname);
}

/** Cria o evento no banco e retorna a confirmação formatada */
async function createEventAndConfirm(
  userId: string,
  phone: string,
  extracted: ExtractedEvent,
  recurrence?: { type: string; weekday?: number },
  lang = "pt-BR",
  userNickname: string | null = null
): Promise<{ response: string }> {
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

  // Sync Google Calendar (fire-and-forget)
  syncGoogleCalendar(userId, extracted.title, extracted.date, extracted.time).catch(() => {});

  // Cria lembrete se solicitado (reminder_minutes >= 0 significa lembrete ativo)
  if (extracted.reminder_minutes != null && extracted.time) {
    // Interpreta o horário como Brasília (UTC-3) usando offset explícito
    const timeStr = extracted.time.length === 5 ? extracted.time : extracted.time.slice(0, 5);
    const eventDateTime = new Date(`${extracted.date}T${timeStr}:00-03:00`);
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
    const eventDateTime = new Date(`${extracted.date}T${timeStr}:00-03:00`);
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
  message: string
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = new Date().toISOString().split("T")[0];

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

  if (keyword && startDate && endDate) {
    query = query.or(
      `title.ilike.%${keyword}%,and(event_date.gte.${startDate},event_date.lte.${endDate})`
    );
  } else if (keyword) {
    query = query.ilike("title", `%${keyword}%`);
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
  }
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
      // Interpreta o horário como Brasília (UTC-3) usando offset explícito
      const finalTimeStr = finalTime.length >= 5 ? finalTime.slice(0, 5) : finalTime;
      const eventDt = new Date(`${finalDate}T${finalTimeStr}:00-03:00`);
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

  // 4. Sync Google Calendar (fire-and-forget)
  const gcalDate = updates.event_date ?? originalData.event_date;
  const gcalTime = updates.event_time ?? originalData.event_time;
  syncGoogleCalendar(userId, originalData.title, gcalDate, gcalTime ?? null).catch(() => {});

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
  session: Record<string, unknown> | null
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = new Date().toISOString().split("T")[0];
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
    });
  }

  // ─── STEP: waiting_reminder_answer ───
  if (step === "waiting_reminder_answer") {
    if (isReminderAtTime(message)) {
      return await finalizeEdit(userId, phone, ctx, 0);
    }
    if (isReminderDecline(message)) {
      return await finalizeEdit(userId, phone, ctx, null);
    }
    const minutesInAnswer = parseMinutes(message);
    if (minutesInAnswer !== null && message.match(/\d|hora|minuto|meia/)) {
      return await finalizeEdit(userId, phone, ctx, minutesInAnswer);
    }
    if (isReminderAccept(message)) {
      return {
        response: "Com quanto tempo de antecedência? ⏱️\n\n_Ex: 15 min, 30 min, 1 hora — ou \"só na hora\"_",
        pendingAction: "agenda_edit",
        pendingContext: { ...ctx, step: "waiting_reminder_minutes" },
      };
    }
    return {
      response: "Quer que eu te lembre antes? Pode me dizer:\n• *30 minutos antes*\n• *1 hora antes*\n• *só na hora*\n• *não precisa*",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_answer" },
    };
  }

  // ─── STEP: waiting_reminder_minutes ───
  if (step === "waiting_reminder_minutes") {
    const minutes = parseMinutes(message);
    if (minutes !== null) {
      return await finalizeEdit(userId, phone, ctx, minutes);
    }
    return {
      response: "Não entendi. Com quanto tempo antes?\n\n_Ex: 15, 30, 1 hora — ou \"só na hora\"_ ⏱️",
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_minutes" },
    };
  }

  // ─── STEP: awaiting_change (ou direto sem sessão anterior) ───

  // Se não há event_id na sessão, tenta encontrar evento pelo texto
  if (!ctx.event_id) {
    const keyword = message
      .toLowerCase()
      .replace(/mudei|muda|mude|alterei|altera|altere|remarca|remarcar|atualiza|cancela|cancelar|excluir|deletar|mover|dia|hora|horario|data|evento|compromisso|reuniao|consulta|para|pro|pra|o|a/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 2)[0] ?? "";

    if (keyword) {
      const { data: found } = await supabase
        .from("events")
        .select("id, title, event_date, event_time, reminder_minutes_before")
        .eq("user_id", userId)
        .eq("status", "pending")
        .ilike("title", `%${keyword}%`)
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!found) {
        return {
          response: `Não encontrei nenhum compromisso com "${keyword}". 🔍\n\nComo está o nome do compromisso que você quer editar?`,
        };
      }
      // Encontrou — usa como contexto e continua para extração de edição
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
  });
}

/** Depois de coletar data/hora novos, oferece atualização de lembrete */
async function offerReminderAfterEdit(
  userId: string,
  phone: string,
  ctx: Record<string, unknown>
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  // Se o evento tinha lembrete, pergunta se quer manter/alterar
  const hadReminder = (ctx.reminder_minutes as number | null) != null;
  if (hadReminder) {
    return {
      response: `Quer atualizar o lembrete também?\n\n• *Sim* — me diga com quantos minutos de antecedência\n• *Só na hora* — te aviso na hora do evento\n• *Não precisa* — remove o lembrete`,
      pendingAction: "agenda_edit",
      pendingContext: { ...ctx, step: "waiting_reminder_answer" },
    };
  }

  // Sem lembrete anterior — aplica direto sem perguntar
  return await finalizeEdit(userId, phone, ctx, undefined);
}

/** Aplica as alterações acumuladas e retorna a mensagem de confirmação */
async function finalizeEdit(
  userId: string,
  phone: string,
  ctx: Record<string, unknown>,
  reminderMinutes: number | null | undefined
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
    }
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

async function handleAgendaQuery(userId: string, message: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

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

  const prompt = `Analise esta mensagem de WhatsApp enviada para uma assistente pessoal: "${rawMessage}"

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
  config: Record<string, unknown> | null = null
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const userNickname = (config?.user_nickname as string) || "";
  const tplNote = (config?.template_note as string) || '📝 *Anotado, {{user_name}}!*\n"{{content}}"';
  const buildNoteResponse = (content: string): string => {
    const noteLine = applyTemplate(tplNote, { content, user_name: userNickname });
    return `${noteLine}\n\nQuer que eu te lembre sobre isso mais tarde? ⏰\n_Diga o horário ou "não precisa"_`;
  };
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const step = (ctx.step as string) ?? null;

  // ─── STEP: note_or_event_choice ───
  if (step === "note_or_event_choice") {
    const m = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const cleanContent = ctx.cleanContent as string;
    const suggestedTitle = ctx.suggestedTitle as string;
    const needsMoreInfo = ctx.needsMoreInfo as boolean;
    const moreInfoQuestion = ctx.moreInfoQuestion as string | null;
    const originalMessage = ctx.originalMessage as string;

    // Usuário quer colocar na agenda
    if (/^1$|^agenda$|^agendar|^marcar|^compromisso|^sim$|^quero agenda/.test(m)) {
      if (needsMoreInfo && moreInfoQuestion) {
        return {
          response: moreInfoQuestion,
          pendingAction: "notes_save",
          pendingContext: { ...ctx, step: "agenda_more_info" },
        };
      }
      // Redireciona para criação de evento com a mensagem original
      return await handleAgendaCreate(userId, phone, originalMessage, null);
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
    return await handleAgendaCreate(userId, phone, combinedMessage, null);
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

    if (isReminderDecline(m) || /^(nao|não|n|dispenso|nao precisa|ta bom|tudo bem)$/.test(m)) {
      return {
        response: `Ok! A anotação está salva. 📝\nQuando precisar é só pedir: _"busca minha anotação sobre ${noteTitle}"_ 🔍`,
      };
    }

    // Tenta extrair horário diretamente da resposta
    const nowIso = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T") + "-03:00";
    const parsed = await parseReminderIntent(message, nowIso);
    if (parsed) {
      const remindAt = new Date(parsed.remind_at);
      if (!isNaN(remindAt.getTime()) && remindAt > new Date()) {
        const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", userId).maybeSingle();
        const whatsappPhone = phone || profile?.phone_number || "";
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
        const timeStr = remindAt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        const dateStr = remindAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });
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

  // Se parece um evento → pergunta o que fazer
  if (analysis.looksLikeEvent) {
    const eventHint = analysis.needsMoreInfo && analysis.moreInfoQuestion
      ? `\n\n_Também posso te pedir mais detalhes como especialidade ou local._`
      : "";

    return {
      response: `Isso parece um compromisso! 📅${eventHint}\n\nO que você prefere?\n1️⃣ *Colocar na agenda* — com data, hora e lembrete\n2️⃣ *Salvar como anotação* — só para consulta depois`,
      pendingAction: "notes_save",
      pendingContext: {
        step: "note_or_event_choice",
        cleanContent: analysis.cleanContent,
        suggestedTitle: analysis.suggestedTitle,
        needsMoreInfo: analysis.needsMoreInfo,
        moreInfoQuestion: analysis.moreInfoQuestion,
        originalMessage: message,
      },
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

  // ── Webhook Origin Check (optional) ──────────────────────────────────────
  // Rate limiting já protege contra abuso (20 msgs/min por número)

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

  // Deduplicação: ignora se já processamos esse message ID recentemente
  const messageId = key?.id as string;
  if (messageId) {
    const { data: existing } = await supabase
      .from("whatsapp_sessions")
      .select("last_processed_id")
      .eq("last_processed_id", messageId)
      .maybeSingle();
    if (existing) {
      return new Response("OK");
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
  const text =
    (messageData?.conversation as string) ||
    (messageData?.extendedTextMessage as Record<string, unknown>)?.text as string;

  const pushName = (data?.pushName as string) || "";

  // ─── Áudio (ptt = push-to-talk / audioMessage) ───────────────────────────
  const audioMsg = messageData?.audioMessage ?? messageData?.pttMessage;
  if (audioMsg) {
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
      const debugResult = await processMessage(replyTo, `[🎤 Áudio transcrito] ${transcription}`, lid, messageId, pushName, transcription);
      return new Response(JSON.stringify({ ok: true, transcription, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("OK");
  }

  // ─── Imagem (nota fiscal / recibo) ───────────────────────────────────────
  const imageMsg = messageData?.imageMessage;
  if (imageMsg) {
    const media = await downloadMediaBase64(data);
    if (media) {
      const debugResult = await processImageMessage(replyTo, media.base64, media.mimetype, lid, messageId, pushName);
      return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("OK");
  }

  if (!text?.trim()) {
    return new Response("OK");
  }

  // Processa e responde (síncrono para garantir execução)
  const debugResult = await processMessage(replyTo, text.trim(), lid, messageId, pushName);

  return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ─────────────────────────────────────────────
// LEMBRETE AVULSO (com recorrência)
// ─────────────────────────────────────────────
async function handleReminderSet(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null = null,
  lang = "pt-BR",
  userNickname: string | null = null
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const nowIso = new Date().toLocaleString("sv-SE", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
  }).replace(" ", "T") + "-03:00";

  // ── Recupera contexto pendente (fluxo de antecedência) ──
  const ctx = (session?.pending_context as Record<string, unknown>) ?? {};
  const step = (ctx.step as string) ?? null;

  // Usuário está respondendo com quanto tempo antes quer ser avisado
  if (step === "reminder_advance") {
    const parsed = ctx.parsed as Record<string, unknown>;
    const remindAt = new Date(parsed.remind_at as string);

    // "só na hora" / "na hora" → 0 min de antecedência (avisa exatamente no horário)
    if (isReminderAtTime(message)) {
      return await saveReminder(userId, phone, parsed, remindAt, 0, lang);
    }
    // "não precisa" → avisa na hora mesmo (sem antecedência adicional)
    if (isReminderDecline(message)) {
      return await saveReminder(userId, phone, parsed, remindAt, 0, lang);
    }
    // Tenta extrair minutos de antecedência
    const advanceMin = parseMinutes(message);
    if (advanceMin !== null && advanceMin > 0) {
      const advancedTime = new Date(remindAt.getTime() - advanceMin * 60 * 1000);
      return await saveReminder(userId, phone, parsed, advancedTime, advanceMin, lang);
    }
    // Não entendeu
    return {
      response: "Não entendi. Com quanto tempo antes? Ex: *15 min*, *1 hora* — ou diga *só na hora*",
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

  // ── Pergunta com quanto tempo de antecedência ──
  // Só pergunta se o lembrete não é recorrente nem tem "na hora" explícito na mensagem
  const msgLower = message.toLowerCase();
  const mentionedAdvance = /antes|antecedência|antecipado|minutos? antes|horas? antes/.test(msgLower);
  const atTimeNow = isReminderAtTime(msgLower);

  if (!mentionedAdvance && !atTimeNow && parsed.recurrence === "none") {
    const timeStr = remindAt.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", minute: "2-digit",
    });
    const dateStr = remindAt.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long", day: "numeric", month: "long",
    });
    return {
      response: `Ok! Vou te lembrar sobre *${parsed.title}* em ${dateStr} às ${timeStr}.\n\nQuer que eu te avise com antecedência ou *só na hora*? ⏱️\n\n_Ex: 15 min antes, 1 hora antes, só na hora_`,
      pendingAction: "reminder_set",
      pendingContext: { step: "reminder_advance", parsed },
    };
  }

  // Tem antecedência explícita na mensagem → salva direto
  return await saveReminder(userId, phone, parsed, remindAt, 0, lang);
}

/** Salva o lembrete no banco e retorna confirmação formatada */
async function saveReminder(
  userId: string,
  phone: string,
  parsed: Record<string, unknown>,
  remindAt: Date,
  advanceMin: number,
  lang = "pt-BR"
): Promise<{ response: string }> {
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
    timeZone: "America/Sao_Paulo",
    weekday: "long", day: "numeric", month: "long",
  });
  const dateStr = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  const timeStr = remindAt.toLocaleTimeString(locale, {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit",
  });

  const recurrenceLabel: Record<string, string> = lang === "en" ? {
    none: "",
    daily: "\n🔁 *Recurring:* every day",
    weekly: "\n🔁 *Recurring:* every week",
    monthly: "\n🔁 *Recurring:* every month",
    day_of_month: `\n🔁 *Recurring:* every ${parsed.recurrence_value ?? ""} of the month`,
  } : lang === "es" ? {
    none: "",
    daily: "\n🔁 *Recurrente:* todos los días",
    weekly: "\n🔁 *Recurrente:* todas las semanas",
    monthly: "\n🔁 *Recurrente:* todos los meses",
    day_of_month: `\n🔁 *Recurrente:* cada día ${parsed.recurrence_value ?? ""} del mes`,
  } : {
    none: "",
    daily: "\n🔁 *Recorrente:* todo dia",
    weekly: "\n🔁 *Recorrente:* toda semana",
    monthly: "\n🔁 *Recorrente:* todo mês",
    day_of_month: `\n🔁 *Recorrente:* todo dia ${parsed.recurrence_value ?? ""} do mês`,
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
  message: string
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
    timeZone: "America/Sao_Paulo",
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

async function processImageMessage(
  replyTo: string,
  base64: string,
  mimetype: string,
  lid: string | null,
  messageId: string | undefined,
  pushName: string
): Promise<unknown> {
  const log: string[] = ["image_processing"];
  try {
    const transactions = await extractReceiptFromImage(base64, mimetype);

    if (transactions.length === 0) {
      // Não é nota fiscal — apenas confirma recebimento
      log.push("not_a_receipt");
      // Tentamos encontrar o perfil para dar resposta personalizada
      const phone = replyTo.replace(/@s\.whatsapp\.net$/, "").replace(/:\d+$/, "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone_number, account_status")
        .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`)
        .maybeSingle();
      const sendPhone = profile?.phone_number ?? replyTo;
      await sendText(sendPhone, "📷 Recebi sua imagem! Não identifiquei como nota fiscal.\n\nPara registrar um gasto, me envie uma mensagem de texto. Ex: *gastei R$50 de almoço*");
      return log;
    }

    // Salva como transação e processa igual texto
    const fakeText = transactions.map(t =>
      `${t.type === "expense" ? "gastei" : "recebi"} ${t.amount} reais de ${t.description}`
    ).join(", ");

    return await processMessage(replyTo, `[📷 Nota fiscal] ${fakeText}`, lid, messageId, pushName, fakeText);
  } catch (err) {
    log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    console.error("processImageMessage error:", err);
    return log;
  }
}

async function processMessage(replyTo: string, text: string, lid: string | null = null, messageId?: string, pushName = "", _originalText?: string): Promise<unknown> {
  const log: string[] = [];
  try {
    // ── Fluxo de vinculação: usuário enviou código MAYA-XXXXXX ──
    const linkMatch = text.trim().match(/^MAYA[-\s]?([A-Z0-9]{6})$/i);
    if (linkMatch) {
      const code = linkMatch[1].toUpperCase();
      log.push(`link_attempt: ${code}`);

      const { data: profileByCode } = await supabase
        .from("profiles")
        .select("id, link_code_expires_at")
        .eq("link_code", code)
        .maybeSingle();

      if (!profileByCode) {
        await sendText(replyTo, "❌ Código inválido. Gere um novo código no app Minha Maya.");
        return log;
      }

      if (profileByCode.link_code_expires_at && new Date(profileByCode.link_code_expires_at) < new Date()) {
        await sendText(replyTo, "⏰ Código expirado. Gere um novo no app Minha Maya.");
        return log;
      }

      // Salva LID e limpa código
      await supabase.from("profiles").update({
        whatsapp_lid: lid ?? replyTo,
        link_code: null,
        link_code_expires_at: null,
      }).eq("id", profileByCode.id);

      await sendText(replyTo, "✅ *WhatsApp vinculado com sucesso!*\nAgora pode usar a Minha Maya normalmente. Tente: *gastei 50 reais de almoço*");
      log.push("linked!");
      return log;
    }

    // ── Busca perfil por LID (novo WhatsApp) ou telefone (fallback) ──
    let profile: { id: string; plan: string; messages_used: number; messages_limit: number; phone_number: string; account_status: string } | null = null;

    if (lid) {
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number, account_status")
        .eq("whatsapp_lid", lid)
        .maybeSingle();
      profile = data;
    }

    if (!profile) {
      // Fallback: tenta por telefone (@s.whatsapp.net ou @lid → extrai dígitos)
      const phone = replyTo
        .replace(/@s\.whatsapp\.net$/, "")
        .replace(/@lid$/, "")
        .replace(/:\d+$/, "");
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number, account_status")
        .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`)
        .maybeSingle();
      profile = data;
    }

    // Fallback adicional: busca em user_phone_numbers (múltiplos números - plano business)
    if (!profile) {
      const phone = replyTo
        .replace(/@s\.whatsapp\.net$/, "")
        .replace(/@lid$/, "")
        .replace(/:\d+$/, "");
      const { data: extraNum } = await supabase
        .from("user_phone_numbers")
        .select("user_id")
        .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`)
        .maybeSingle();
      if (extraNum?.user_id) {
        const { data } = await supabase
          .from("profiles")
          .select("id, plan, messages_used, messages_limit, phone_number, account_status")
          .eq("id", extraNum.user_id)
          .maybeSingle();
        profile = data;
      }
    }

    // Fallback por resolução de LID → telefone real via Evolution API
    // Útil quando o usuário tem WhatsApp Multi-Device e ainda não vinculou o LID
    if (!profile && lid) {
      const resolvedPhone = await resolveLidToPhone(lid);
      if (resolvedPhone) {
        const { data } = await supabase
          .from("profiles")
          .select("id, plan, messages_used, messages_limit, phone_number, account_status")
          .or(
            `phone_number.eq.${resolvedPhone},phone_number.eq.+${resolvedPhone},phone_number.eq.55${resolvedPhone}`
          )
          .maybeSingle();
        if (data) {
          profile = data;
          // Salva o LID no perfil automaticamente para lookups futuros (sem precisar de código MAYA)
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

    if (!profile) {
      await sendText(
        replyTo,
        "❌ Conta não encontrada.\n\nPara usar a Minha Maya:\n1. Acesse *minhamaya.com.br* e crie sua conta\n2. Vá em *Meu Perfil* e cadastre seu número\n3. Aguarde a aprovação da sua conta"
      );
      return log;
    }

    // Usa o telefone do perfil para enviar respostas (LID não funciona no sendText)
    const sendPhone = profile.phone_number?.replace(/\D/g, "") ?? "";

    // 2. Verifica se a conta foi aprovada pelo admin
    if (profile.account_status !== "active") {
      await sendText(
        sendPhone || replyTo,
        "⏳ *Sua conta está aguardando aprovação.*\n\nAssim que o administrador aprovar seu acesso, você receberá uma confirmação aqui e poderá usar a Minha Maya normalmente.\n\nQualquer dúvida, acesse o app."
      );
      return log;
    }

    // 3. Verifica limite de mensagens
    if (profile.messages_used >= profile.messages_limit) {
      await sendText(
        sendPhone || replyTo,
        "⚠️ Você atingiu o limite de mensagens do seu plano.\nAcesse o app para fazer upgrade! 🚀"
      );
      return log;
    }

    // 3. Carrega configuração do agente
    const { data: config } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle();

    const agentName = config?.agent_name ?? "Maya";
    const tone = config?.tone ?? "profissional";
    const language = (config?.language as string) || "pt-BR";
    const userNickname = (config?.user_nickname as string) || null;
    const customInstructions = (config?.custom_instructions as string) || null;

    // 4. Busca/cria sessão (contexto de conversa ativa)
    const sessionId = lid ?? replyTo;
    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("phone_number", sessionId)
      .maybeSingle();

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

    // 5. Classifica intenção
    let intent: Intent = classifyIntent(text);

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
    }

    // Módulos ativos por padrão quando sem configuração
    const moduleFinance = config?.module_finance !== false;
    const moduleAgenda = config?.module_agenda !== false;
    const moduleNotes = config?.module_notes !== false;
    const moduleChat = config?.module_chat !== false;

    const modules: ModuleMap = { finance: moduleFinance, agenda: moduleAgenda, notes: moduleNotes, chat: moduleChat };

    // Mapa intent → módulo necessário
    const INTENT_REQUIRES: Partial<Record<Intent, keyof ModuleMap>> = {
      finance_record:  "finance",
      finance_report:  "finance",
      agenda_create:   "agenda",
      agenda_query:    "agenda",
      agenda_lookup:   "agenda",
      agenda_edit:     "agenda",
      agenda_delete:   "agenda",
      event_followup:  "agenda",
      notes_save:      "notes",
      reminder_set:    "notes",
      reminder_snooze: "notes",
      ai_chat:         "chat",
    };

    const requiredModule = INTENT_REQUIRES[intent];
    const moduleActive = !requiredModule || modules[requiredModule];

    // 6. Executa handler
    let responseText: string;
    let pendingAction: string | undefined;
    let pendingContext: unknown;

    if (intent === "greeting") {
      // Saudação: usa greeting_message personalizado do usuário ou fallback padrão
      const tplGreeting = (config?.greeting_message as string)
        || "Olá, {{user_name}}! Sou a {{agent_name}}, sua assistente pessoal. Como posso ajudar?";
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
    } else if (intent === "finance_record") {
      responseText = await handleFinanceRecord(profile.id, replyTo, text, config);
    } else if (intent === "finance_report") {
      responseText = await handleFinanceReport(profile.id, text);
    } else if (intent === "agenda_create") {
      const result = await handleAgendaCreate(profile.id, sendPhone || replyTo, text, session, language, userNickname);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_query") {
      responseText = await handleAgendaQuery(profile.id, text);
    } else if (intent === "agenda_lookup") {
      const result = await handleAgendaLookup(profile.id, text);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_edit") {
      const result = await handleAgendaEdit(profile.id, sendPhone || replyTo, text, session);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_delete") {
      responseText = await handleAgendaDelete(profile.id, text);
    } else if (intent === "notes_save") {
      const notesResult = await handleNotesSave(profile.id, sendPhone || replyTo, text, session, config);
      responseText = notesResult.response;
      pendingAction = notesResult.pendingAction;
      pendingContext = notesResult.pendingContext;
    } else if (intent === "reminder_set") {
      const reminderResult = await handleReminderSet(profile.id, sendPhone || replyTo, text, session, language, userNickname);
      responseText = reminderResult.response;
      pendingAction = reminderResult.pendingAction;
      pendingContext = reminderResult.pendingContext;
    } else if (intent === "reminder_snooze") {
      responseText = await handleReminderSnooze(profile.id, sendPhone || replyTo, text);
    } else if (intent === "event_followup") {
      const followupResult = await handleEventFollowup(profile.id, sendPhone || replyTo, text, session ?? {});
      responseText = followupResult.response;
      pendingAction = followupResult.pendingAction;
      pendingContext = followupResult.pendingContext;
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
      responseText = await assistantChat(text, agentName, tone, language, userNickname, enrichedInstructions, history);
    }

    // 7. Traduz resposta se necessário e envia
    if (language !== "pt-BR") {
      responseText = await translateIfNeeded(responseText, language);
    }
    await sendText(sendPhone || replyTo, responseText);

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
    await saveConversation(profile.id, lid, sendPhone, pushName, text, responseText, intent);

    // 10. Incrementa contador de mensagens
    await supabase
      .from("profiles")
      .update({ messages_used: profile.messages_used + 1 })
      .eq("id", profile.id);

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
    try {
      await sendText(replyTo, "⚠️ Ocorreu um erro. Tente novamente em alguns instantes.");
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

  await supabase.from("messages").insert([
    { conversation_id: conv.id, role: "user", content: userText, intent },
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

