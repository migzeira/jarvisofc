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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

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

/** Extrai dados de evento/agenda do texto do usuário */
export async function extractEvent(
  text: string,
  today: string
): Promise<{
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  reminder_minutes: number | null;
  needs_clarification: string | null;
}> {
  const system = `Você é um extrator de dados de agenda. Responda APENAS com JSON válido, sem markdown.`;

  const prompt = `Extraia informações de evento/agenda do texto. Hoje é ${today}. Retorne JSON.
Campos: { "title": string, "date": "YYYY-MM-DD", "time": "HH:MM" ou null, "reminder_minutes": número ou null, "needs_clarification": string ou null }

Se faltar título, coloque "needs_clarification": "Qual o nome ou motivo desse compromisso?"
Se faltar horário, coloque "needs_clarification": "A que horas é? Quer que eu te lembre antes?"
Se tiver lembrete explícito, preencha reminder_minutes (ex: "20 minutos antes" = 20).

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
  const userRef = userNickname ? `Chame o usuário de "${userNickname}".` : "";
  const extra = customInstructions ? `\n\nInstruções adicionais:\n${customInstructions}` : "";

  const systemPrompt = `Você é ${agentName}, assistente pessoal inteligente via WhatsApp.
Tom: ${tone}. Idioma: ${language}.
${userRef}
Você ajuda com finanças, agenda, anotações e conversas gerais.
Seja conciso e natural. Não mencione que é IA a menos que perguntado.
Não invente dados financeiros — se perguntado sobre gastos específicos e não tiver a informação, diga que não encontrou registros com essa descrição.${extra}`;

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
  nowIso: string
): Promise<ReminderParsed | null> {
  const system = `Você é um parser de lembretes. Responda APENAS com JSON válido, sem markdown, sem explicações.`;

  const prompt = `Hora atual: ${nowIso} (America/Sao_Paulo, UTC-3).

Analise o pedido de lembrete e retorne JSON com EXATAMENTE esta estrutura:
{
  "title": "texto curto descritivo (máx 60 chars)",
  "message": "mensagem que será enviada no lembrete (começa com ⏰)",
  "remind_at": "ISO 8601 com offset -03:00, ex: 2026-04-07T12:20:00-03:00",
  "recurrence": "none | daily | weekly | monthly | day_of_month",
  "recurrence_value": null ou número (dia da semana 0=dom..6=sáb para weekly; dia 1-31 para day_of_month)
}

Regras para remind_at:
- Se hora mencionada já passou hoje → agendar para amanhã
- Se não mencionou data → assume hoje (ou amanhã se hora passou)
- "amanhã" → próximo dia
- "sexta" / "segunda" → próximo dia da semana mencionado
- "semana que vem" → +7 dias

Regras para recurrence:
- Sem "todo" / "toda" / "sempre" → "none"
- "todo dia" → "daily"
- "toda segunda/terça/..." → "weekly", recurrence_value = dia (0=dom,1=seg,2=ter,3=qua,4=qui,5=sex,6=sáb)
- "todo dia 10" / "dia 10 de todo mês" → "day_of_month", recurrence_value = 10
- "todo mês" → "monthly", recurrence_value = null

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
    return parsed;
  } catch {
    return null;
  }
}
