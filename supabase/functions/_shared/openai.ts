const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

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
    model: "claude-haiku-4-5-20251001",
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
