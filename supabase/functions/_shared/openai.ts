const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Chamada simples ao Claude para extração de dados ou chat */
export async function chat(
  messages: ChatMessage[],
  systemPrompt?: string,
  jsonMode = false
): Promise<string> {
  const body: Record<string, unknown> = {
    model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (jsonMode) {
    // Prefill para forçar resposta JSON
    body.messages = [
      ...messages,
      { role: "assistant", content: "{" },
    ];
  }

  // Timeout de 25s — impede que a função trave se Claude não responder
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Anthropic API timeout after 25s");
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content[0].text as string;

  // Se modo JSON, recoloca a chave de abertura que usamos no prefill
  return jsonMode ? "{" + text : text;
}

/** Extrai dados estruturados de transações financeiras do texto do usuário */
export async function extractTransactions(
  text: string
): Promise<Array<{ amount: number; description: string; type: "expense" | "income"; category: string }>> {
  const system = `Você é um extrator de dados financeiros. Responda APENAS com JSON válido, sem markdown.`;

  const prompt = `Extraia transações financeiras do texto abaixo. Retorne JSON com array "transactions".
Cada item: { "amount": número, "description": string, "type": "expense" ou "income", "category": uma de [alimentacao, transporte, moradia, saude, lazer, educacao, trabalho, outros] }

Texto: "${text}"

Exemplos:
"gastei 200 de gasolina" → expense, transporte
"paguei 500 no mercado" → expense, alimentacao
"recebi 1000 de freela" → income, trabalho
"comprei remédio 80 reais" → expense, saude

Responda SOMENTE com o JSON, sem explicações.`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );
  const parsed = JSON.parse(result);
  return parsed.transactions ?? [];
}

/** Tipo de retorno da extração de evento */
export interface ExtractedEvent {
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  end_time: string | null; // HH:MM
  location: string | null;
  event_type: "compromisso" | "reuniao" | "consulta" | "evento" | "tarefa";
  priority: "baixa" | "media" | "alta";
  reminder_minutes: number | null;
  needs_clarification: string | null;
  clarification_type: "time" | "title" | "reminder_offer" | "reminder_minutes" | null;
}

/** Extrai dados de evento/agenda do texto do usuário (fluxo conversacional multi-step) */
export async function extractEvent(
  text: string,
  today: string,
  lang = "pt-BR"
): Promise<ExtractedEvent> {
  const langLabel = lang === "en" ? "English" : lang === "es" ? "Spanish" : "Portuguese Brazilian";
  const system = `You are an intelligent calendar data extractor. Respond ONLY with valid JSON, no markdown, no explanations. Write the "needs_clarification" field in ${langLabel}.`;

  const prompt = `Extraia informações de evento/agenda do texto. Hoje é ${today} (use como referência para datas relativas como "amanhã", "semana que vem", "dia 15", etc).

Retorne JSON com EXATAMENTE esta estrutura:
{
  "title": "string - título do evento",
  "date": "YYYY-MM-DD",
  "time": "HH:MM" ou null,
  "end_time": "HH:MM" ou null,
  "location": "string" ou null,
  "event_type": "compromisso" | "reuniao" | "consulta" | "evento" | "tarefa",
  "priority": "baixa" | "media" | "alta",
  "reminder_minutes": número ou null,
  "needs_clarification": "string - pergunta para o usuário" ou null,
  "clarification_type": "time" | "title" | "reminder_offer" | "reminder_minutes" ou null
}

REGRAS DE CLASSIFICAÇÃO:
- event_type: "reuniao" para meetings/reuniões, "consulta" para médico/dentista/profissional, "tarefa" para tarefas/to-dos, "evento" para festas/shows/conferências, "compromisso" para o resto.
- priority: "alta" para reuniões de trabalho/médico/urgente, "media" para compromissos normais, "baixa" para tarefas/lembretes simples.

REGRAS DE CLARIFICAÇÃO (ordem de prioridade):
1. Se faltar título → needs_clarification: "Qual o nome ou motivo desse compromisso? 📝", clarification_type: "title"
2. Se faltar horário (time é null) → needs_clarification: "Qual horário? 🕐", clarification_type: "time"
3. Se o horário JÁ FOI FORNECIDO e reminder_minutes é null e NÃO houve discussão sobre lembrete → needs_clarification: "Quer que eu te lembre antes desse compromisso? 🔔\n\nPosso te avisar com antecedência ou só na hora do evento.", clarification_type: "reminder_offer"
4. Se tiver lembrete explícito no texto (ex: "20 minutos antes", "1 hora antes", "2 horas antes"), preencha reminder_minutes em minutos e NÃO peça clarificação.
5. Se o usuário disser "só na hora" / "me avisa na hora" / "no horário", preencha reminder_minutes: 0 e NÃO peça clarificação.

CONTEXTO DE FOLLOW-UP:
O texto pode conter dados parciais de uma extração anterior (JSON com campo "partial") + a resposta do usuário.
Quando houver dados parciais:
- NÃO peça clarificação para campos que já foram preenchidos no partial.
- Se partial já tem time preenchido, NÃO coloque clarification_type "time".
- Se o usuário respondeu "não"/"nao"/"não precisa"/"sem lembrete" a uma oferta de lembrete, coloque reminder_minutes: null, needs_clarification: null, clarification_type: null (evento pronto para criar).
- Se o usuário respondeu "sim"/"quero"/"pode ser" a uma oferta de lembrete, coloque needs_clarification: "Quantos minutos antes você quer ser lembrado? ⏱️", clarification_type: "reminder_minutes".
- Se o usuário deu um tempo (ex: "15", "30 minutos", "meia hora", "1 hora", "2 horas", "só na hora"), converta para minutos (horas × 60) e coloque reminder_minutes com o valor e needs_clarification: null. "só na hora" = reminder_minutes: 0.
- Mescle os dados parciais com os novos dados extraídos. Campos já preenchidos no partial devem ser mantidos.

Texto: "${text}"

Responda SOMENTE com o JSON.`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );
  return JSON.parse(result);
}

/** Analisa uma consulta de agenda e retorna o intervalo de datas desejado */
export async function parseAgendaQuery(
  text: string,
  today: string,
  lang = "pt-BR"
): Promise<{ start_date: string; end_date: string; description: string }> {
  const langLabel = lang === "en" ? "English" : lang === "es" ? "Spanish" : "Portuguese Brazilian";
  const system = `You are a calendar query parser. Respond ONLY with valid JSON, no markdown. Write the "description" field in ${langLabel}.`;

  const prompt = `Analise a consulta de agenda e determine o intervalo de datas. Hoje é ${today}.

Retorne JSON:
{
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "description": "string curta descrevendo o período, ex: 'hoje', 'amanhã', 'esta semana', 'dia 15 de abril'"
}

Exemplos:
- "o que tenho hoje" → start_date e end_date = hoje
- "agenda de amanhã" → start_date e end_date = amanhã
- "compromissos da semana" / "essa semana" → segunda a domingo da semana atual
- "o que tenho dia 15" → start_date e end_date = dia 15 do mês atual (ou próximo mês se dia 15 já passou)
- "agenda de abril" → 1 a 30 de abril
- "próximos 3 dias" → hoje até hoje+2
- "próximos 10 dias" → hoje até hoje+9
- "semana que vem" → segunda a domingo da próxima semana
- Sem especificação clara → próximos 7 dias

Texto: "${text}"

Responda SOMENTE com o JSON.`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );
  return JSON.parse(result);
}

/**
 * Transcreve áudio via Groq Whisper (GROQ_API_KEY).
 * Aceita base64 do arquivo de áudio + mimetype.
 */
export async function transcribeAudio(base64: string, mimetype: string): Promise<string> {
  if (!GROQ_KEY) {
    throw new Error("GROQ_API_KEY não configurada. Adicione no painel Supabase → Edge Functions → Secrets.");
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ext = mimetype.includes("ogg") ? "ogg"
    : mimetype.includes("mp4") ? "mp4"
    : mimetype.includes("webm") ? "webm"
    : "ogg";

  const file = new File([bytes], `audio.${ext}`, { type: mimetype || "audio/ogg" });

  const form = new FormData();
  form.append("file", file);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "text");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Whisper error ${res.status}: ${err}`);
  }

  return (await res.text()).trim();
}

/** Resultado da extração de edição de evento */
export interface ExtractedAgendaEdit {
  new_date: string | null;          // YYYY-MM-DD
  new_time: string | null;          // HH:MM
  new_title: string | null;
  cancel: boolean;                  // true se o usuário quer cancelar/excluir
  fields_changed: string[];         // ["date", "time", "title"]
  needs_clarification: string | null;
}

/** Extrai o que o usuário quer alterar em um evento existente */
export async function extractAgendaEdit(
  text: string,
  today: string
): Promise<ExtractedAgendaEdit> {
  const system = `Você é um extrator de edições de agenda. Responda APENAS com JSON válido, sem markdown, sem explicações.`;

  const prompt = `Analise a mensagem do usuário e extraia o que ele quer mudar em um evento. Hoje é ${today}.

O usuário pode dizer coisas como:
- "mudei para dia 15" → nova data
- "muda o horário para 14:00" → novo horário
- "cancela esse evento" → cancelar
- "é às 3 da tarde agora" → novo horário
- "remarca pro dia 20 às 10h" → nova data e horário

Retorne JSON com EXATAMENTE esta estrutura:
{
  "new_date": "YYYY-MM-DD ou null",
  "new_time": "HH:MM ou null",
  "new_title": "string ou null",
  "cancel": false,
  "fields_changed": ["date", "time"],
  "needs_clarification": null
}

REGRAS:
- Se detectar intenção de cancelar/excluir/apagar/deletar → cancel: true, demais campos null
- Se o usuário informou apenas nova data (sem horário) → needs_clarification: "Qual será o novo horário? 🕐"
- Se o usuário informou nova data E novo horário → needs_clarification: null
- Para horários no formato "3 da tarde" → "15:00", "3 da manhã" → "03:00", "meio-dia" → "12:00"
- Datas relativas: "dia 15" → dia 15 do mês atual ou próximo mês se já passou
- "amanhã" → tomorrow based on hoje=${today}
- fields_changed deve listar apenas os campos que foram alterados

Mensagem: "${text}"

Responda SOMENTE com o JSON.`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );
  return JSON.parse(result) as ExtractedAgendaEdit;
}

/**
 * Analisa imagem com Claude Vision.
 * Se for nota fiscal/recibo, extrai transações. Retorna array vazio se não for.
 */
export async function extractReceiptFromImage(
  base64: string,
  mimetype: string
): Promise<Array<{ amount: number; description: string; type: "expense" | "income"; category: string }>> {
  const mediaType = (mimetype || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: "Você é um extrator de dados de notas fiscais. Responda APENAS com JSON válido, sem markdown.",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Analise esta imagem. Se for nota fiscal, cupom, recibo ou comprovante de pagamento, extraia as transações.
Retorne JSON: { "is_receipt": true/false, "store": string ou null, "transactions": [{ "amount": número, "description": string, "type": "expense", "category": uma de [alimentacao, transporte, moradia, saude, lazer, educacao, trabalho, outros] }] }
Se não for nota fiscal, retorne: { "is_receipt": false, "store": null, "transactions": [] }
Responda SOMENTE com o JSON.`,
          },
        ],
      }],
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const text = (data.content?.[0]?.text as string) ?? "";
  try {
    const parsed = JSON.parse(text);
    if (!parsed.is_receipt) return [];
    return parsed.transactions ?? [];
  } catch {
    return [];
  }
}

/** Chat geral com o assistente Maya */
export async function assistantChat(
  userMessage: string,
  agentName: string,
  tone: string,
  language: string,
  userNickname: string | null,
  customInstructions: string | null,
  history: ChatMessage[]
): Promise<string> {
  const TONE_DESCRIPTIONS: Record<string, string> = {
    profissional: "Use a formal, professional tone. Speak formally, avoid slang, be direct and concise. Use at most 1-2 emojis per message. Address the user with respect.",
    casual: "Use a relaxed, natural tone. Everyday language, light slang is OK. Moderate emoji use (2-3 per message). Be friendly like a colleague.",
    amigavel: "Use a warm, enthusiastic, caring tone. Use emojis generously (3-5 per message). Celebrate the user's achievements. Be close and affectionate like a trusted friend.",
    tecnico: "Use a technical, precise tone. Prioritize data, exact numbers, structured formatting. Use at most 1 emoji per message. Use technical terminology when relevant.",
  };

  const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
    "pt-BR": "Responda SEMPRE em Português Brasileiro. Todas as mensagens, confirmações, perguntas e erros devem estar em Português Brasileiro.",
    "en": "You MUST respond EXCLUSIVELY in English. ALL messages, confirmations, questions, suggestions and error messages must be in English, regardless of what language the user writes in. Do NOT mix languages.",
    "es": "Debes responder EXCLUSIVAMENTE en Español. TODOS los mensajes, confirmaciones, preguntas, sugerencias y errores deben estar en Español, sin importar el idioma del usuario. NO mezcles idiomas.",
  };

  const toneInstruction = TONE_DESCRIPTIONS[tone] ?? TONE_DESCRIPTIONS["casual"];
  const langInstruction = LANGUAGE_INSTRUCTIONS[language] ?? LANGUAGE_INSTRUCTIONS["pt-BR"];
  const userRef = userNickname ? `Always address the user as "${userNickname}".` : "";
  const extra = customInstructions ? `\n\nAdditional instructions:\n${customInstructions}` : "";

  const systemPrompt = `You are ${agentName}, an intelligent personal assistant via WhatsApp.
${langInstruction}
Tone: ${toneInstruction}
${userRef}
You help with finances, calendar/agenda, notes, reminders and general conversation.
Be concise and natural. Do not mention being an AI unless asked.
Do not invent financial data — if asked about specific expenses and you don't have the info, say no records were found.

REAL SYSTEM CAPABILITIES (NEVER deny these):
- You CAN and DO send automatic WhatsApp reminders (the system runs a job every minute)
- When the user schedules an event with a reminder, an alert is programmed and sent automatically
- 15 minutes after an appointment, you automatically send a follow-up check
- If a reminder didn't arrive, acknowledge it as a possible technical glitch, NEVER say you lack this capability
- If the user complains about a missed alert: apologize for the technical issue, confirm it's fixed and that future reminders will work normally${extra}`;

  const messages: ChatMessage[] = [
    ...history.slice(-6),
    { role: "user", content: userMessage },
  ];

  return await chat(messages, systemPrompt);
}

// ─────────────────────────────────────────────────────────────────
// REMINDER INTENT PARSER
// ─────────────────────────────────────────────────────────────────

export interface ReminderParsed {
  title: string;               // curto, ex: "Ligar pro pai"
  message: string;             // mensagem completa a enviar
  remind_at: string;           // ISO 8601 com timezone (ex: "2026-04-07T12:20:00-03:00")
  recurrence: "none" | "daily" | "weekly" | "monthly" | "day_of_month";
  recurrence_value: number | null; // weekday 0-6 (weekly) ou dia 1-31 (day_of_month)
}

/**
 * Usa Claude para transformar linguagem natural de lembrete em dados estruturados.
 * @param message  texto do usuário, ex: "me lembra de ligar pro pai às 12:20"
 * @param nowIso   data/hora atual no formato ISO com offset, ex: "2026-04-07T11:00:00-03:00"
 */
export async function parseReminderIntent(
  message: string,
  nowIso: string,
  lang = "pt-BR"
): Promise<ReminderParsed | null> {
  const langLabel = lang === "en" ? "English" : lang === "es" ? "Spanish" : "Portuguese Brazilian";
  const system = `You are a reminder intent parser. Respond ONLY with valid JSON, no markdown, no explanations. Write the "message" and "title" fields in ${langLabel}.`;

  const prompt = `Hora atual: ${nowIso} (America/Sao_Paulo, UTC-3).

Analise o pedido de lembrete e retorne JSON com EXATAMENTE esta estrutura:
{
  "title": "texto curto descritivo (máx 60 chars)",
  "message": "message to be sent as the reminder notification (starts with ⏰, written in ${langLabel})",
  "remind_at": "ISO 8601 com offset -03:00, ex: 2026-04-07T12:20:00-03:00",
  "recurrence": "none | daily | weekly | monthly | day_of_month",
  "recurrence_value": null ou número (dia da semana 0=dom..6=sáb para weekly; dia 1-31 para day_of_month)
}

Regras para remind_at:
- ATENÇÃO: compare CUIDADOSAMENTE a hora atual com a hora mencionada. Se a hora mencionada ainda NÃO passou hoje, agende para HOJE mesmo.
- Exemplo: se agora é 01:36 e o usuário disse "1h50", a hora 01:50 ainda não passou → agende para HOJE (não amanhã).
- Exemplo: se agora é 14:00 e o usuário disse "10h", a hora 10:00 já passou → agende para amanhã.
- Se hora mencionada já passou hoje → agendar para amanhã
- Se não mencionou data → assume hoje (ou amanhã se hora passou)
- "amanhã" → próximo dia
- "sexta" / "segunda" → próximo dia da semana mencionado
- "semana que vem" → +7 dias

Regras para recurrence (analise CUIDADOSAMENTE — é muito importante detectar corretamente):
- Sem indicativo de repetição → "none"
- "todo dia" / "todos os dias" / "diariamente" / "cada dia" / "sempre" / "todo dia de manhã/tarde/noite" → "daily", recurrence_value = null
- "toda semana" / "semanalmente" / "todas as semanas" (sem dia específico) → "weekly", recurrence_value = null
- "toda segunda" / "toda segunda-feira" → "weekly", recurrence_value = 1
- "toda terça" / "toda terça-feira" → "weekly", recurrence_value = 2
- "toda quarta" / "toda quarta-feira" → "weekly", recurrence_value = 3
- "toda quinta" / "toda quinta-feira" → "weekly", recurrence_value = 4
- "toda sexta" / "toda sexta-feira" → "weekly", recurrence_value = 5
- "todo sábado" / "todo fim de semana" → "weekly", recurrence_value = 6
- "todo domingo" → "weekly", recurrence_value = 0
- "todo dia 10" / "dia 10 de todo mês" / "todo mês no dia X" / "mensalmente no dia X" → "day_of_month", recurrence_value = X
- "todo mês" / "mensalmente" (sem dia específico) → "monthly", recurrence_value = null
- Para "toda [dia-da-semana]": recurrence_value = (0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb)
- Se for recorrente semanal sem dia específico → recurrence_value = null (herda o dia do remind_at)

Pedido: "${message}"`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );

  try {
    const parsed = JSON.parse(result) as ReminderParsed;
    // Validação básica
    if (!parsed.remind_at || !parsed.recurrence) return null;

    // Guarda de segurança: se a IA agendou para amanhã mas o horário ainda não passou hoje,
    // corrige para hoje. Isso evita erros com horários de madrugada como "1h50".
    if (parsed.recurrence === "none") {
      const now = new Date(nowIso);
      const remindAt = new Date(parsed.remind_at);
      const diffMs = remindAt.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // Se a IA agendou para mais de 20h à frente, verifica se o mesmo horário ainda existe hoje
      if (diffHours > 20 && diffHours < 28) {
        const todayVersion = new Date(remindAt);
        todayVersion.setDate(todayVersion.getDate() - 1);
        // Se a versão de hoje ainda não passou (tem pelo menos 1 min de margem), usa ela
        if (todayVersion.getTime() > now.getTime() + 60000) {
          parsed.remind_at = todayVersion.toISOString().replace("Z", "-03:00").replace(/\.\d{3}/, "");
          // Reconstrói com offset correto
          const y = todayVersion.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
          const t = todayVersion.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(11, 19);
          parsed.remind_at = `${y}T${t}-03:00`;
        }
      }
    }

    return parsed;
  } catch {
    return null;
  }
}
