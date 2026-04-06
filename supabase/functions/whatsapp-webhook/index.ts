import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, extractPhone } from "../_shared/evolution.ts";
import { syncGoogleCalendar, syncGoogleSheets, syncNotion } from "../_shared/integrations.ts";
import {
  extractTransactions,
  extractEvent,
  assistantChat,
  type ChatMessage,
} from "../_shared/openai.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────
// INTENT CLASSIFIER (regex first, sem custo IA)
// ─────────────────────────────────────────────
type Intent =
  | "finance_record"
  | "finance_report"
  | "agenda_create"
  | "agenda_query"
  | "notes_save"
  | "reminder_set"
  | "ai_chat";

function classifyIntent(msg: string): Intent {
  const m = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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
    /marca(r)?( na| uma| pra)? (agenda|reuniao|meeting|compromisso|consulta|evento)|agendar|marcar reuniao|tenho (reuniao|consulta|compromisso)|colocar na agenda/.test(
      m
    )
  )
    return "agenda_create";

  // Consultar agenda
  if (
    /o que (tenho|tem) (hoje|amanha|essa semana|semana)|minha agenda|(proximos|pr[oó]ximos) (eventos?|compromissos?|reunioes?)|(agenda de|agenda do) (hoje|amanha)/.test(
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

  // Lembrete simples
  if (/me lembra|me avisa|me notific|lembrete/.test(m)) return "reminder_set";

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
      ? (config?.template_expense as string) ?? "🔴 *Gasto registrado!*\n📝 {{description}}\n💰 R$ {{amount}}"
      : (config?.template_income as string) ?? "🟢 *Receita registrada!*\n📝 {{description}}\n💰 R$ {{amount}}";
    return applyTemplate(tpl, {
      description: t.description,
      amount: t.amount.toFixed(2).replace(".", ","),
      category: t.category,
      type: t.type,
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
    ?? "✅ *{{count}} gastos registrados!*\n\n{{lines}}\n\n💸 *Total: R$ {{total}}*";

  return applyTemplate(tplMulti, {
    count: String(transactions.length),
    lines: lines.join("\n"),
    total: total.toFixed(2).replace(".", ","),
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
  for (const [cat, keywords] of Object.entries(CATEGORY_SYNONYMS)) {
    if (keywords.some((k) => m.includes(k))) return cat;
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

  report += `\n\n📱 Ver gráficos completos no app MayaChat`;

  return report;
}

async function handleAgendaCreate(
  userId: string,
  phone: string,
  message: string,
  session: Record<string, unknown> | null
): Promise<{ response: string; pendingAction?: string; pendingContext?: unknown }> {
  const today = new Date().toISOString().split("T")[0];

  // Verifica se há contexto pendente de follow-up
  const context = (session?.pending_context as Record<string, unknown>) ?? {};
  const combinedMessage =
    Object.keys(context).length > 0
      ? `${JSON.stringify(context)} Resposta do usuário: ${message}`
      : message;

  const extracted = await extractEvent(combinedMessage, today);

  if (extracted.needs_clarification) {
    return {
      response: extracted.needs_clarification,
      pendingAction: "agenda_create",
      pendingContext: { ...context, partial: extracted },
    };
  }

  // Cria o evento
  const eventData: Record<string, unknown> = {
    user_id: userId,
    title: extracted.title,
    event_date: extracted.date,
    event_time: extracted.time,
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

  // Cria lembrete se solicitado
  if (extracted.reminder_minutes != null && extracted.time) {
    const [y, mo, d] = extracted.date.split("-").map(Number);
    const [h, min] = extracted.time.split(":").map(Number);
    const eventDateTime = new Date(y, mo - 1, d, h, min);
    const reminderTime = new Date(
      eventDateTime.getTime() - extracted.reminder_minutes * 60 * 1000
    );

    if (reminderTime > new Date()) {
      await supabase.from("reminders").insert({
        user_id: userId,
        event_id: event.id,
        whatsapp_number: phone,
        message: `⏰ *Lembrete!*\nEm ${extracted.reminder_minutes} minutos você tem: *${extracted.title}* às ${extracted.time}`,
        send_at: reminderTime.toISOString(),
      });
    }
  }

  const dateFormatted = new Date(extracted.date + "T12:00:00").toLocaleDateString(
    "pt-BR",
    { weekday: "long", day: "numeric", month: "long" }
  );

  let response = `✅ *Agendado!*\n📅 ${extracted.title}\n🗓 ${dateFormatted}`;
  if (extracted.time) response += `\n⏰ ${extracted.time}`;
  if (extracted.reminder_minutes) {
    response += `\n🔔 Te lembro ${extracted.reminder_minutes} min antes`;
  }

  return { response };
}

async function handleAgendaQuery(userId: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .gte("event_date", today)
    .lte("event_date", nextWeek)
    .eq("status", "pending")
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });

  if (error) throw error;

  if (!events || events.length === 0) {
    return "📅 Nenhum compromisso nos próximos 7 dias!";
  }

  const lines = events.map((e) => {
    const dateStr = new Date(e.event_date + "T12:00:00").toLocaleDateString(
      "pt-BR",
      { weekday: "short", day: "numeric", month: "short" }
    );
    const time = e.event_time ? ` às ${e.event_time.slice(0, 5)}` : "";
    const reminder = e.reminder ? ` 🔔` : "";
    return `📌 *${e.title}*\n   ${dateStr}${time}${reminder}`;
  });

  return `📅 *Sua agenda (próx. 7 dias):*\n\n${lines.join("\n\n")}`;
}

async function handleNotesSave(
  userId: string,
  message: string
): Promise<string> {
  let content = message
    .replace(/^(anota|anotacao|anote|salva|escreve|registra|guarda|nota)[\s:,]+/i, "")
    .replace(/^preciso lembrar[\s:,]*/i, "")
    .replace(/^lembrar de[\s:,]*/i, "")
    .trim();

  if (!content) {
    return "O que você quer anotar?";
  }

  const { error } = await supabase.from("notes").insert({
    user_id: userId,
    content,
    source: "whatsapp",
  });

  if (error) throw error;

  // Sync Notion (fire-and-forget)
  syncNotion(userId, content).catch(() => {});

  return `📝 *Anotado!*\n"${content}"`;
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // LOG BRUTO para diagnóstico
  console.log("WEBHOOK_FULL:", JSON.stringify(body));

  // Apenas mensagens recebidas (não enviadas pelo bot)
  const event = body.event as string;
  console.log("WEBHOOK_EVENT:", event);
  if (event !== "messages.upsert") {
    return new Response("OK");
  }

  // Suporta data como objeto ou array (diferentes versões do Evolution API)
  const rawData = body.data;
  const data = (Array.isArray(rawData) ? rawData[0] : rawData) as Record<string, unknown>;
  const key = data?.key as Record<string, unknown>;

  console.log("WEBHOOK_KEY:", JSON.stringify(key));

  if (key?.fromMe) {
    console.log("WEBHOOK_SKIP: fromMe");
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
      console.log("WEBHOOK_SKIP: duplicate", messageId);
      return new Response("OK");
    }
  }

  const remoteJid = key?.remoteJid as string;
  console.log("WEBHOOK_JID:", remoteJid);

  if (!remoteJid || remoteJid.endsWith("@g.us")) {
    console.log("WEBHOOK_SKIP: no_jid_or_group");
    return new Response("OK");
  }

  // Determina o identificador: LID (@lid) ou telefone (@s.whatsapp.net)
  const isLid = remoteJid.endsWith("@lid");
  const lid = isLid ? remoteJid : null;
  // Para enviar respostas, usamos o remoteJid direto (Evolution aceita LID no sendText)
  const replyTo = remoteJid;

  const messageData = data?.message as Record<string, unknown>;
  const text =
    (messageData?.conversation as string) ||
    (messageData?.extendedTextMessage as Record<string, unknown>)
      ?.text as string;

  const pushName = (data?.pushName as string) || "";
  console.log("WEBHOOK_TEXT:", text, "LID:", lid, "NAME:", pushName);

  if (!text?.trim()) {
    console.log("WEBHOOK_SKIP: no_text");
    return new Response("OK");
  }

  // Processa e responde (síncrono para garantir execução)
  const debugResult = await processMessage(replyTo, text.trim(), lid, messageId, pushName);

  return new Response(JSON.stringify({ ok: true, debug: debugResult }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function processMessage(replyTo: string, text: string, lid: string | null = null, messageId?: string, pushName = ""): Promise<unknown> {
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
        await sendText(replyTo, "❌ Código inválido. Gere um novo código no app MayaChat.");
        return log;
      }

      if (profileByCode.link_code_expires_at && new Date(profileByCode.link_code_expires_at) < new Date()) {
        await sendText(replyTo, "⏰ Código expirado. Gere um novo no app MayaChat.");
        return log;
      }

      // Salva LID e limpa código
      await supabase.from("profiles").update({
        whatsapp_lid: lid ?? replyTo,
        link_code: null,
        link_code_expires_at: null,
      }).eq("id", profileByCode.id);

      await sendText(replyTo, "✅ *WhatsApp vinculado com sucesso!*\nAgora pode usar o MayaChat normalmente. Tente: *gastei 50 reais de almoço*");
      log.push("linked!");
      return log;
    }

    // ── Busca perfil por LID (novo WhatsApp) ou telefone (fallback) ──
    let profile: { id: string; plan: string; messages_used: number; messages_limit: number; phone_number: string } | null = null;

    if (lid) {
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number")
        .eq("whatsapp_lid", lid)
        .maybeSingle();
      profile = data;
      log.push(`lookup: lid → ${profile ? profile.id : "NOT FOUND"}`);
    }

    if (!profile) {
      // Fallback: tenta por telefone (mensagens @s.whatsapp.net sem LID)
      const phone = replyTo.replace(/@s\.whatsapp\.net$/, "").replace(/:\d+$/, "");
      const { data } = await supabase
        .from("profiles")
        .select("id, plan, messages_used, messages_limit, phone_number")
        .or(`phone_number.eq.${phone},phone_number.eq.+${phone}`)
        .maybeSingle();
      profile = data;
      log.push(`lookup: phone(${phone}) → ${profile ? profile.id : "NOT FOUND"}`);
    }

    log.push(`profile: ${profile ? profile.id : "NOT FOUND"}`);

    if (!profile) {
      await sendText(
        replyTo,
        "❌ Conta não encontrada.\n\nPara usar o MayaChat:\n1. Acesse o app e vá em *Meu Perfil*\n2. Clique em *Conectar WhatsApp*\n3. Envie o código gerado aqui"
      );
      return log;
    }

    // Usa o telefone do perfil para enviar respostas (LID não funciona no sendText)
    const sendPhone = profile.phone_number?.replace(/\D/g, "") ?? "";

    // 2. Verifica limite de mensagens
    if (profile.messages_used >= profile.messages_limit) {
      await sendText(
        sendPhone,
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
    const language = config?.language ?? "Português brasileiro";
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
        await sendText(sendPhone, reply);
        log.push(`quick_reply: ${match.trigger_text}`);
        return log;
      }
    }

    log.push(`config: ${config ? "found" : "NULL"} finance=${config?.module_finance} agenda=${config?.module_agenda}`);
    log.push(`intent_input: ${text}`);
    // 5. Classifica intenção
    let intent: Intent = classifyIntent(text);
    log.push(`intent: ${intent}`);

    // Se há ação pendente e a mensagem parece ser uma resposta, mantém o contexto
    if (
      session?.pending_action &&
      intent === "ai_chat" &&
      text.length < 100
    ) {
      intent = session.pending_action as Intent;
    }

    // Módulos ativos por padrão quando sem configuração
    const moduleFinance = config?.module_finance !== false;
    const moduleAgenda = config?.module_agenda !== false;
    const moduleNotes = config?.module_notes !== false;
    const moduleChat = config?.module_chat !== false;

    // 6. Executa handler
    let responseText: string;
    let pendingAction: string | undefined;
    let pendingContext: unknown;

    if (intent === "finance_record" && moduleFinance) {
      responseText = await handleFinanceRecord(profile.id, replyTo, text, config);
    } else if (intent === "finance_report" && moduleFinance) {
      responseText = await handleFinanceReport(profile.id, text);
    } else if (intent === "agenda_create" && moduleAgenda) {
      const result = await handleAgendaCreate(profile.id, replyTo, text, session);
      responseText = result.response;
      pendingAction = result.pendingAction;
      pendingContext = result.pendingContext;
    } else if (intent === "agenda_query" && moduleAgenda) {
      responseText = await handleAgendaQuery(profile.id);
    } else if (intent === "notes_save" && moduleNotes) {
      responseText = await handleNotesSave(profile.id, text);
    } else if (moduleChat) {
      // Chat geral com IA
      const history = await getRecentHistory(profile.id);
      responseText = await assistantChat(text, agentName, tone, language, userNickname, customInstructions, history);
    } else {
      responseText = `Desculpe, não entendi. Posso ajudar com ${[moduleFinance && "finanças", moduleAgenda && "agenda", moduleNotes && "anotações"].filter(Boolean).join(", ")}.`;
    }

    // 7. Envia resposta (usa phone_number do perfil, não LID)
    await sendText(sendPhone, responseText);

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
    const errMsg = err instanceof Error ? err.message : String(err);
    log.push(`ERROR: ${errMsg}`);
    console.error("processMessage error:", err);
    try {
      await sendText(phone, "⚠️ Ocorreu um erro. Tente novamente em alguns instantes.");
    } catch {
      // ignora erro no fallback
    }
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

