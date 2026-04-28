import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OPENAI_KEY_ENV = Deno.env.get("OPENAI_API_KEY") ?? ""; // fallback secundário se não estiver em app_settings

// Cliente Supabase interno (usa service_role) pra ler app_settings e gravar ai_usage_log.
// Lazy: só cria se as env vars existirem (evita quebrar testes locais).
const _aiSupabase = (() => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !srk) return null;
  return createClient(url, srk);
})();

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─────────────────────────────────────────────
// AI ROUTER — Claude (default) + OpenAI (opcional, mais barato pra chat)
// ─────────────────────────────────────────────
// Comportamento:
//   - Default: usa Claude (zero mudança vs comportamento original)
//   - Se admin definir ai_chat_provider="openai" + openai_api_key no painel,
//     funções migradas (assistantChat / classifyReminderWithAI /
//     analyzeForwardedContent) chamam GPT-4o-mini.
//   - Se OpenAI falhar, fallback automático pra Claude (sem afetar UX).
//   - Cada chamada é logada em public.ai_usage_log pra acompanhar custo.
// ─────────────────────────────────────────────

type AIProvider = "claude" | "openai";

interface AIConfig {
  provider: AIProvider;
  openaiKey: string;
}

// Cache em memória (60s) — evita ler app_settings a cada chamada.
let _aiConfigCache: AIConfig | null = null;
let _aiConfigCacheExpiry = 0;
const AI_CONFIG_TTL_MS = 60_000;

async function getAIConfig(): Promise<AIConfig> {
  const now = Date.now();
  if (_aiConfigCache && now < _aiConfigCacheExpiry) return _aiConfigCache;

  const fallback: AIConfig = { provider: "claude", openaiKey: OPENAI_KEY_ENV };

  if (!_aiSupabase) {
    _aiConfigCache = fallback;
    _aiConfigCacheExpiry = now + AI_CONFIG_TTL_MS;
    return fallback;
  }

  try {
    const { data } = await _aiSupabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["ai_chat_provider", "openai_api_key"]);

    const map = new Map<string, string>();
    for (const row of data ?? []) {
      if (row?.key) map.set(row.key, String(row.value ?? ""));
    }

    const providerRaw = (map.get("ai_chat_provider") ?? "").toLowerCase().trim();
    const provider: AIProvider = providerRaw === "openai" ? "openai" : "claude";
    const openaiKey = (map.get("openai_api_key") ?? "").trim() || OPENAI_KEY_ENV;

    const cfg: AIConfig = { provider, openaiKey };
    _aiConfigCache = cfg;
    _aiConfigCacheExpiry = now + AI_CONFIG_TTL_MS;
    return cfg;
  } catch (e) {
    console.error("[ai-config] erro lendo app_settings, usando default Claude:", e);
    _aiConfigCache = fallback;
    _aiConfigCacheExpiry = now + AI_CONFIG_TTL_MS;
    return fallback;
  }
}

interface AIUsageEntry {
  provider: AIProvider;
  functionName: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  fallbackUsed?: boolean;
  errorMessage?: string;
  durationMs?: number;
}

function logAIUsage(entry: AIUsageEntry): void {
  if (!_aiSupabase) return;
  // Fire-and-forget: nunca bloqueia o fluxo principal.
  _aiSupabase
    .from("ai_usage_log")
    .insert({
      provider: entry.provider,
      function_name: entry.functionName,
      model: entry.model ?? null,
      tokens_in: entry.tokensIn ?? null,
      tokens_out: entry.tokensOut ?? null,
      fallback_used: entry.fallbackUsed ?? false,
      error_message: entry.errorMessage ?? null,
      duration_ms: entry.durationMs ?? null,
    })
    .then(() => {})
    .catch(() => {}); // silent — telemetria não pode quebrar IA
}

/** Chamada à OpenAI (gpt-4o-mini). Retorna { text, tokensIn, tokensOut } ou throw. */
async function chatOpenAI(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  jsonMode: boolean,
  apiKey: string
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const fullMessages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages) fullMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
    messages: fullMessages,
    max_tokens: 500,
  };
  if (jsonMode) {
    // OpenAI requer "json" mencionado no prompt quando response_format é json_object.
    // Adicionamos hint discreto se não estiver presente.
    body.response_format = { type: "json_object" };
    const lastIsUser = fullMessages[fullMessages.length - 1]?.role === "user";
    const lastContent = String(fullMessages[fullMessages.length - 1]?.content ?? "");
    if (lastIsUser && !/json/i.test(lastContent)) {
      fullMessages[fullMessages.length - 1].content = lastContent + "\n\nResponda em JSON válido.";
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const tokensIn = Number(data?.usage?.prompt_tokens ?? 0);
    const tokensOut = Number(data?.usage?.completion_tokens ?? 0);
    return { text, tokensIn, tokensOut };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OpenAI timeout after 25s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wrapper público pras 3 funções migradas (assistantChat, classifyReminderWithAI,
 * analyzeForwardedContent). Tenta OpenAI se configurado; se falhar, cai pro Claude
 * automaticamente. Loga uso pra ai_usage_log (fire-and-forget).
 *
 * Mantém comportamento original quando provider="claude" (default).
 */
export async function chatWithProvider(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  jsonMode: boolean,
  functionName: string
): Promise<string> {
  const cfg = await getAIConfig();
  const useOpenAI = cfg.provider === "openai" && cfg.openaiKey.length > 0;

  // Tenta OpenAI primeiro (se configurado)
  if (useOpenAI) {
    const start = Date.now();
    try {
      const result = await chatOpenAI(messages, systemPrompt, jsonMode, cfg.openaiKey);
      logAIUsage({
        provider: "openai",
        functionName,
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: Date.now() - start,
      });
      return result.text;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[ai-fallback] OpenAI falhou em ${functionName}: ${errMsg} → tentando Claude`);
      logAIUsage({
        provider: "openai",
        functionName,
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        errorMessage: errMsg,
        durationMs: Date.now() - start,
      });
      // Continua e tenta Claude abaixo
    }
  }

  // Claude (default OU fallback)
  const startClaude = Date.now();
  try {
    const text = await chat(messages, systemPrompt, jsonMode);
    logAIUsage({
      provider: "claude",
      functionName,
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
      fallbackUsed: useOpenAI, // se chegamos aqui depois de OpenAI falhar, é fallback
      durationMs: Date.now() - startClaude,
    });
    return text;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logAIUsage({
      provider: "claude",
      functionName,
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
      fallbackUsed: useOpenAI,
      errorMessage: errMsg,
      durationMs: Date.now() - startClaude,
    });
    throw e;
  }
}

/** Limpa o cache de config (chamar manualmente em testes ou após mudança imediata). */
export function _resetAIConfigCache(): void {
  _aiConfigCache = null;
  _aiConfigCacheExpiry = 0;
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

/** Categorias default sempre disponíveis (mesmo quando usuário não tem custom) */
export const DEFAULT_CATEGORIES = [
  "alimentacao", "transporte", "moradia", "saude",
  "lazer", "educacao", "trabalho", "outros",
];

/** Extrai dados estruturados de transações financeiras do texto do usuário.
 *  Se o usuário tem categorias customizadas (criadas via app), passe-as em
 *  userCategories para que o Jarvis use elas também. Fallback: DEFAULT_CATEGORIES. */
export async function extractTransactions(
  text: string,
  userCategories: string[] = DEFAULT_CATEGORIES
): Promise<Array<{ amount: number; description: string; type: "expense" | "income"; category: string; installments?: number }>> {
  const system = `Você é um extrator de dados financeiros. Responda APENAS com JSON válido, sem markdown.`;

  // Normaliza a lista: garante defaults presentes + remove duplicatas (case-insensitive)
  const seen = new Set<string>();
  const allCats: string[] = [];
  for (const c of [...userCategories, ...DEFAULT_CATEGORIES]) {
    const k = c.toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); allCats.push(c); }
  }

  // Separa custom vs default pra explicar ao modelo no prompt
  const defaultSet = new Set(DEFAULT_CATEGORIES.map((c) => c.toLowerCase().trim()));
  const customCats = allCats.filter((c) => !defaultSet.has(c.toLowerCase().trim()));
  const customList = customCats.join(", ");

  const catList = allCats.join(", ");

  const prompt = `Extraia transações financeiras do texto abaixo. Retorne JSON com array "transactions".
Cada item: { "amount": número, "description": string, "type": "expense" ou "income", "category": uma de [${catList}], "installments": número ou null }

REGRAS IMPORTANTES:
1. EXPENSE vs INCOME — decida pelo CONTEXTO da mensagem:
   - INCOME (recebimento): se o texto tem "salário", "salario", "renda", "receita", "rendimento",
     "freelance", "freela", "bônus", "bonus", "13o", "13º", "décimo terceiro", "recebimento",
     "pagamento único", "recebi", "ganhei", "entrou", "caiu na conta", "comissão", "venda",
     "cliente pagou", "caiu", "creditou".
   - EXPENSE (gasto): qualquer outro padrão sem palavras de income; padrão "NÚMERO CATEGORIA"
     (ex: "340 gasolina", "100 uber", "50 netflix") sem contexto de income → assuma EXPENSE.
2. Escolha a categoria que melhor descreve. Se nenhuma encaixa exatamente, mapeie para a mais próxima:
   - bar, pub, balada → lazer
   - pedagio, estacionamento → transporte
   - uber, 99, taxi → transporte
   - açai, pizza, hamburguer → alimentacao
   - salário, freelance, freela, bônus, 13o, comissão, venda → trabalho
   - Se ainda assim não encaixar, use "outros"
3. CATEGORIAS PERSONALIZADAS DO USUÁRIO: ${customList || "(nenhuma)"}
   - Se a mensagem mencionar alguma dessas categorias custom (ou variação ortográfica/fonética próxima), USE ELA.
   - IMPORTANTE: considere variações fonéticas comuns em transcrição de áudio. Ex: se categoria é
     "Cibele" e texto diz "Sibele" / "Cebele" / "Cybelle" → usar "Cibele" (são fonéticamente iguais).
   - Considere também variações de acento: "Saúde" / "saude", "Pet" / "Petz" / "Pets".
   - Match por contexto inteligente, não só palavra exata. Ex: se categoria é "Pet", texto "ração do petshop"
     → usar "Pet" (contexto claro).
   - Se NÃO houver match claro com nenhuma categoria custom OU default, use "outros".

4. PARCELAMENTO — Se detectar padrões como "3x", "em 3 vezes", "parcelado em 6", "12x", "3 parcelas", "em 10 vezes":
   - Retorne o amount como o VALOR TOTAL da compra (NÃO divida pelo número de parcelas)
   - Preencha "installments" com o número de parcelas (ex: 3, 6, 12)
   - Se NÃO detectar parcelamento: "installments" deve ser null
   - Parcelamento só faz sentido para EXPENSE; para INCOME use installments: null

5. Valores com sufixo "k" significam milhares: "20k" = 20000, "1.5k" = 1500, "3k" = 3000.

Texto: "${text}"

Exemplos EXPENSE:
"340 gasolina" → { "amount": 340, "description": "Gasolina", "type": "expense", "category": "transporte", "installments": null }
"gastei 200 de gasolina" → { "amount": 200, "description": "Gasolina", "type": "expense", "category": "transporte", "installments": null }
"comprei celular 300 em 3x" → { "amount": 300, "description": "Celular", "type": "expense", "category": "outros", "installments": 3 }
"sofá 1200 parcelado em 12x" → { "amount": 1200, "description": "Sofá", "type": "expense", "category": "outros", "installments": 12 }
"comprei tv 2000 em 10 vezes" → { "amount": 2000, "description": "TV", "type": "expense", "category": "outros", "installments": 10 }
"paguei 500 no mercado" → { "amount": 500, "description": "Mercado", "type": "expense", "category": "alimentacao", "installments": null }

Exemplos INCOME:
"salário 20k" → { "amount": 20000, "description": "Salário", "type": "income", "category": "trabalho", "installments": null }
"salario 8000" → { "amount": 8000, "description": "Salário", "type": "income", "category": "trabalho", "installments": null }
"recebi 1000 de freela" → { "amount": 1000, "description": "Freela", "type": "income", "category": "trabalho", "installments": null }
"freelance 1500" → { "amount": 1500, "description": "Freelance", "type": "income", "category": "trabalho", "installments": null }
"bonus 500" → { "amount": 500, "description": "Bônus", "type": "income", "category": "trabalho", "installments": null }
"13o de 8000" → { "amount": 8000, "description": "13º salário", "type": "income", "category": "trabalho", "installments": null }
"pagamento único 20k registra hoje" → { "amount": 20000, "description": "Pagamento único", "type": "income", "category": "outros", "installments": null }
"registra receita de 20k hoje" → { "amount": 20000, "description": "Receita", "type": "income", "category": "outros", "installments": null }
"recebi 5000 do cliente" → { "amount": 5000, "description": "Cliente", "type": "income", "category": "trabalho", "installments": null }

Responda SOMENTE com o JSON, sem explicações.`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );
  const parsed = JSON.parse(result);
  const transactions = parsed.transactions ?? [];

  // Safety net: se AI retornar categoria que não está na lista, força "outros"
  const allCatsLower = new Set(allCats.map(c => c.toLowerCase()));
  for (const t of transactions) {
    if (!t.category || !allCatsLower.has(String(t.category).toLowerCase())) {
      t.category = "outros";
    }
    // Safety net: installments inválido
    if (t.installments != null && (t.installments < 2 || t.installments > 48)) {
      t.installments = null;
    }
  }
  return transactions;
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

// ─────────────────────────────────────────────
// SMART STATEMENT IMPORT — Feature #15
// ─────────────────────────────────────────────

export interface StatementExtraction {
  document_type: "extrato" | "fatura" | "nota_fiscal" | "comprovante" | "unknown";
  institution?: string;
  period?: string;
  transactions: Array<{
    amount: number;
    description: string;
    type: "expense" | "income";
    category: string;
    date?: string;
  }>;
  total_expense: number;
  total_income: number;
}

/**
 * Analisa imagem com Claude Vision e detecta tipo de documento financeiro.
 * Suporta: extrato bancário, fatura de cartão, nota fiscal/cupom, comprovante de pagamento.
 */
export async function extractStatementFromImage(
  base64: string,
  mimetype: string,
  caption = ""
): Promise<StatementExtraction> {
  const fallback: StatementExtraction = {
    document_type: "unknown",
    transactions: [],
    total_expense: 0,
    total_income: 0,
  };

  // 1) Remove prefixo data URI se existir ("data:image/jpeg;base64,...")
  let cleanB64 = base64;
  const dataUriMatch = cleanB64.match(/^data:([^;]+);base64,(.+)$/);
  let detectedMime = "";
  if (dataUriMatch) {
    detectedMime = dataUriMatch[1];
    cleanB64 = dataUriMatch[2];
  }

  // 2) Detecta mimetype REAL pelos magic bytes do base64 (não confia no Evolution API)
  //    JPEG: /9j/  |  PNG: iVBORw0KGgo  |  GIF: R0lGOD  |  WebP: UklGR
  const firstBytes = cleanB64.slice(0, 20);
  let sniffedMime = "";
  if (firstBytes.startsWith("/9j/")) sniffedMime = "image/jpeg";
  else if (firstBytes.startsWith("iVBORw0KGgo")) sniffedMime = "image/png";
  else if (firstBytes.startsWith("R0lGOD")) sniffedMime = "image/gif";
  else if (firstBytes.startsWith("UklGR")) sniffedMime = "image/webp";

  // 3) Prioridade: magic bytes > data URI > mimetype passado > default jpeg
  const rawMime = (sniffedMime || detectedMime || mimetype || "image/jpeg").toLowerCase();
  const mediaType = (
    rawMime.includes("png") ? "image/png" :
    rawMime.includes("webp") ? "image/webp" :
    rawMime.includes("gif") ? "image/gif" :
    "image/jpeg"
  ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  // 4) Valida tamanho — Claude Vision aceita até ~5MB de base64 (~3.75MB binário)
  const sizeBytes = Math.ceil(cleanB64.length * 0.75);
  console.log(`[extractStatementFromImage] mime=${mediaType} sniffed=${sniffedMime} passed=${mimetype} sizeKB=${Math.round(sizeBytes / 1024)}`);
  if (sizeBytes > 5 * 1024 * 1024) {
    console.error(`[extractStatementFromImage] image too large: ${sizeBytes} bytes`);
    return { ...fallback, document_type: "too_large" as "unknown" };
  }

  const captionHint = caption
    ? `\n\nDica do usuário (legenda enviada junto com a imagem): "${caption}"`
    : "";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: `Você é um extrator especializado de documentos financeiros brasileiros. Analise imagens e retorne APENAS JSON válido, sem markdown, sem explicações.`,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: cleanB64 },
          },
          {
            type: "text",
            text: `Analise esta imagem e identifique o tipo de documento financeiro.${captionHint}

Tipos possíveis:
- "extrato": extrato bancário com múltiplos lançamentos de débito/crédito
- "fatura": fatura de cartão de crédito com lista de compras
- "nota_fiscal": nota fiscal, cupom fiscal ou recibo de loja (1-3 itens geralmente)
- "comprovante": comprovante de PIX, TED, boleto ou transferência (pagamento único)
- "unknown": não é documento financeiro

IMPORTANTE: Se a dica do usuário mencionar "comprovante", "pix", "pagamento", "recibo", "nota fiscal" → priorize esse tipo mesmo se a imagem for parcialmente legível.

Para cada transação visível extraia:
- amount: valor numérico (positivo sempre)
- description: descrição/estabelecimento
- type: "expense" (débito/compra/pagamento) ou "income" (crédito/recebimento/salário)
- category: uma de [alimentacao, transporte, moradia, saude, lazer, educacao, trabalho, outros]
- date: data no formato YYYY-MM-DD se visível, senão null

Regras de categoria por nome do estabelecimento/descrição:
- alimentacao: iFood, Rappi, Uber Eats, ifood, restaurante, lanchonete, padaria, supermercado, mercado, açougue, peixaria, McDonald's, Burger King, KFC, Subway, pizza, hamburguer
- transporte: Uber, 99, Cabify, Lyft, taxi, ônibus, metrô, CPTM, posto de gasolina, combustível, estacionamento, pedágio, Autopass
- moradia: aluguel, condomínio, IPTU, água, luz, gás, energia, internet, Vivo, Claro, TIM, Oi, NET, GVT
- saude: farmácia, drogaria, médico, hospital, clínica, plano de saúde, Unimed, dentista, exame
- lazer: Netflix, Spotify, Steam, Prime Video, Disney+, HBO, Apple TV, cinema, teatro, show, viagem, hotel, turismo, jogo
- educacao: escola, faculdade, curso, livro, Udemy, Alura, Coursera, mensalidade
- trabalho: salário, freelance, pagamento de serviço, nota fiscal emitida, CNPJ
- outros: qualquer coisa não categorizada acima

Para "extrato" e "fatura": extraia TODAS as transações visíveis.
Para "comprovante": 1 transação (type=expense se você pagou, income se recebeu).
Para "nota_fiscal": extraia os itens da nota.

Retorne SOMENTE este JSON (sem markdown):
{
  "document_type": "extrato|fatura|nota_fiscal|comprovante|unknown",
  "institution": "nome do banco/instituição ou null",
  "period": "período do extrato/fatura ou null",
  "transactions": [...],
  "total_expense": número,
  "total_income": número
}`,
          },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[extractStatementFromImage] API error:", res.status, errText.slice(0, 500));
    return fallback;
  }

  const data = await res.json();
  const text = (data.content?.[0]?.text as string) ?? "";
  console.log("[extractStatementFromImage] raw response:", text.slice(0, 800));

  // Claude às vezes envolve o JSON em ```json ... ``` ou adiciona explicação antes
  // Extrai o primeiro bloco JSON válido do texto
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  // Se ainda não começar com {, tenta achar o primeiro { ... } balanceado
  if (!jsonStr.startsWith("{")) {
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr) as StatementExtraction;
    console.log(`[extractStatementFromImage] parsed: doc_type=${parsed.document_type} tx_count=${parsed.transactions?.length ?? 0}`);
    if (!parsed.document_type) return fallback;
    // Garante campos obrigatórios
    parsed.transactions = parsed.transactions ?? [];
    parsed.total_expense = parsed.total_expense ?? parsed.transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    parsed.total_income = parsed.total_income ?? parsed.transactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
    return parsed;
  } catch (err) {
    console.error("[extractStatementFromImage] JSON parse failed:", err instanceof Error ? err.message : String(err), "| jsonStr:", jsonStr.slice(0, 300));
    return fallback;
  }
}

// ─────────────────────────────────────────────
// SHADOW MODE: Analise de conteudo encaminhado
// ─────────────────────────────────────────────

export interface ShadowAnalysis {
  action: "finance_record" | "event_create" | "note_save" | "reminder_create" | "unknown";
  confidence: number;
  data: {
    amount?: number;
    description?: string;
    type?: "expense" | "income";
    category?: string;
    date?: string;
    title?: string;
    event_date?: string;
    event_time?: string;
    duration_minutes?: number;
    note_title?: string;
    note_content?: string;
    reminder_title?: string;
    remind_at?: string;
  };
}

/**
 * Classifica conteudo de mensagem encaminhada usando Claude Haiku.
 * Retorna acao recomendada + dados extraidos + nivel de confianca.
 */
export async function analyzeForwardedContent(
  text: string,
  today: string,
  userTz = "America/Sao_Paulo"
): Promise<ShadowAnalysis> {
  const fallback: ShadowAnalysis = { action: "unknown", confidence: 0, data: {} };
  if (!text || text.length < 3) return fallback;

  const system = "Voce classifica mensagens encaminhadas no WhatsApp para um assistente pessoal brasileiro. Responda APENAS com JSON valido, sem markdown.";

  const prompt = `Uma pessoa encaminhou esta mensagem para seu assistente pessoal Jarvis. Analise e classifique.

Hoje: ${today}. Fuso: ${userTz}.

MENSAGEM ENCAMINHADA:
"${text.slice(0, 1500)}"

Classifique como UMA acao:

1. "finance_record" — Comprovante de PIX/TED/boleto, texto com valor monetario e contexto de pagamento/recebimento, cobranca ou fatura.
   Extraia: amount (numero positivo), description (string), type ("expense"|"income"), category (alimentacao|transporte|moradia|saude|lazer|educacao|trabalho|outros), date (YYYY-MM-DD ou null)

2. "event_create" — Alguem marcando reuniao/encontro/compromisso, referencia a data+hora especifica futura, convite.
   Extraia: title (string curto), event_date (YYYY-MM-DD), event_time (HH:MM ou null), duration_minutes (ou null)

3. "reminder_create" — Prazo/deadline ("entregar ate dia X", "vence dia X"), algo pra lembrar numa data.
   Extraia: reminder_title (string curto), remind_at (YYYY-MM-DD ou YYYY-MM-DDTHH:MM)

4. "note_save" — Informacao geral util (endereco, telefone, instrucoes, dados) que nao encaixa acima.
   Extraia: note_title (string curto), note_content (conteudo limpo)

5. "unknown" — Incompreensivel, muito curto ou irrelevante (sticker, emoji solo, "ok").

Regras:
- confidence: 0.0-1.0 (>= 0.8 se obvio, 0.5-0.7 se ambiguo)
- Para finance: R$, reais, PIX, transferencia, boleto sao pistas fortes
- Para event: "amanha as 14h", "sexta 10h", "dia 15 as 9h"
- Se ambiguo entre note e finance (valor sem contexto de pagamento) → note
- Se ambiguo entre event e reminder → event se tem horario, reminder se so data

JSON:
{"action":"...","confidence":0.0,"data":{...}}`;

  try {
    // Roteado: usa OpenAI se admin configurou (ai_chat_provider="openai"),
    // senão Claude. Fallback automático se OpenAI falhar.
    const result = await chatWithProvider(
      [{ role: "user", content: prompt }],
      system,
      false,
      "analyzeForwardedContent"
    );
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as ShadowAnalysis;
    if (!parsed.action) return fallback;
    parsed.confidence = parsed.confidence ?? 0;
    return parsed;
  } catch {
    return fallback;
  }
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

/** Chat geral com o assistente Jarvis */
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

  const genderRule = `REGRA DE GÊNERO (OBRIGATÓRIO — nunca quebre): Você é MASCULINO. Diga "sou o ${agentName}", "o ${agentName}". JAMAIS diga "sou a ${agentName}", "a ${agentName}" ou qualquer forma feminina.`;

  const systemPrompt = `You are ${agentName}, a male intelligent personal assistant via WhatsApp.
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
- If the user complains about a missed alert: apologize for the technical issue, confirm it's fixed and that future reminders will work normally${extra}

CRITICAL — NEVER FAKE WRITE OPERATIONS (this is the most important rule):
- You are running in CHAT FALLBACK mode. The actual creation of events, reminders, contacts, transactions, notes, and Google Meet links is handled by SEPARATE specialized handlers, NOT by you.
- If you receive a message that LOOKS like a request to create/schedule something (e.g. "marca reuniao com X amanha 10h", "anota isso", "lembra de X", "registra gasto"), the routing classifier already decided this falls through to chat — meaning it didn't match any handler.
- In that case, you MUST NOT pretend the action was done. NEVER reply with "✅ Reunião marcada", "✅ Agendado", "✅ Lembrete criado", "✅ Anotação salva" or fake confirmation messages.
- NEVER invent Google Meet URLs, calendar event IDs, contact phone numbers, transaction receipts, or any system-generated link/identifier. URLs you write WILL NOT WORK.
- Instead, ask the user to rephrase more clearly. Examples of correct fallback responses:
  - "Não consegui identificar todos os detalhes. Pode reformular? Ex: _marca reunião com Cibele amanhã às 10h sobre dinheiro_"
  - "Pra agendar uma reunião com link Meet, manda assim: _marca reunião com [nome] [data] [hora]_"
  - "Pra criar lembrete: _me lembra de [coisa] [quando]_"
- Confirmation messages with checkmarks (✅) are RESERVED for the specialized handlers. You only use ✅ to acknowledge things you genuinely know are done (like answering a question about existing data).

${genderRule}`;

  // Sanitize history: replace feminine agent references so the model doesn't copy the pattern
  const sanitizedHistory = history.slice(-6).map(msg => {
    if (msg.role !== "assistant") return msg;
    const fixed = msg.content
      .replace(new RegExp(`\\ba\\s+${agentName}\\b`, "gi"), `o ${agentName}`)
      .replace(new RegExp(`sou a\\b`, "gi"), `sou o`)
      .replace(new RegExp(`\\bela\\b`, "gi"), "ele");
    return { ...msg, content: fixed };
  });

  const messages: ChatMessage[] = [
    ...sanitizedHistory,
    { role: "user", content: userMessage },
  ];

  // Roteado: usa OpenAI se admin configurou, senão Claude. Fallback se falhar.
  return await chatWithProvider(messages, systemPrompt, false, "assistantChat");
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

  // Extract offset from nowIso (e.g. "2026-04-07T15:30:00-03:00" → "-03:00")
  const offsetMatch = nowIso.match(/([+-]\d{2}:\d{2})$/);
  const tzHint = offsetMatch ? `UTC${offsetMatch[1]}` : "UTC-03:00";
  const prompt = `Hora atual: ${nowIso} (${tzHint}).

Analise o pedido de lembrete e retorne JSON com EXATAMENTE esta estrutura:
{
  "title": "texto curto descritivo (máx 60 chars)",
  "message": "message to be sent as the reminder notification (starts with ⏰, written in ${langLabel})",
  "remind_at": "ISO 8601 com offset -03:00, ex: 2026-04-07T12:20:00-03:00",
  "recurrence": "none | daily | weekly | monthly | day_of_month",
  "recurrence_value": null ou número (dia da semana 0=dom..6=sáb para weekly; dia 1-31 para day_of_month)
}

Regras para remind_at:
- "daqui X minutos" / "em X minutos" / "daqui X horas" / "em X horas" → adicione esse tempo à hora atual
  - Exemplo: se agora é 14:00 e pediu "daqui 2 minutos" → agende para 14:02
  - Exemplo: se agora é 14:00 e pediu "daqui 1 hora" → agende para 15:00
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
- "a cada X horas" / "de X em X horas" / "todo X horas" / "a cada hora" → "hourly", recurrence_value = X (número de horas, ex: 5 → a cada 5 horas; "a cada hora" → recurrence_value = 1)
- "a cada X minutos" / "de X em X minutos" NÃO é suportado → use "hourly" com o valor mais próximo em horas

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
      // A janela é > 20h e < 28h para cobrir qualquer fuso UTC-12 a UTC+12
      if (diffHours > 20 && diffHours < 28) {
        const todayVersion = new Date(remindAt);
        todayVersion.setDate(todayVersion.getDate() - 1);
        // Se a versão de hoje ainda não passou (tem pelo menos 1 min de margem), usa ela
        if (todayVersion.getTime() > now.getTime() + 60000) {
          // Usa o mesmo offset que o nowIso tem
          const tzOffset = offsetMatch ? offsetMatch[1] : "-03:00";
          // userTz vem do parâmetro da função analyzeForwardedContent (default São Paulo)
          const y = todayVersion.toLocaleString("sv-SE", { timeZone: userTz }).slice(0, 10);
          const t = todayVersion.toLocaleString("sv-SE", { timeZone: userTz }).slice(11, 19);
          parsed.remind_at = `${y}T${t}${tzOffset}`;
        }
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// REMINDER ANSWER — IA fallback
// ─────────────────────────────────────────────
// Usado quando parseReminderAnswer (regex) retorna "unknown".
// Custo baixo: ~50-80 tokens, modelo Haiku, timeout curto.
// Garante que respostas exóticas como "vai que esquece, me pega 1h antes" sejam entendidas.

export type ReminderAIResult =
  | { kind: "accept_with_time"; minutes: number }
  | { kind: "accept_no_time" }
  | { kind: "at_time" }
  | { kind: "decline" }
  | { kind: "unknown" };

export async function classifyReminderWithAI(
  message: string,
  eventTitle: string | null = null
): Promise<ReminderAIResult> {
  // Aceita Anthropic OU OpenAI — chatWithProvider escolhe. Se nenhuma config existir
  // E ambos os providers falharem, o catch mais abaixo retorna { kind: "unknown" }.
  if (!ANTHROPIC_KEY && !OPENAI_KEY_ENV) {
    // Pode ainda ter openai_api_key em app_settings — tenta mesmo assim, catch trata.
  }

  const safeMsg = (message ?? "").slice(0, 200);
  const titleLine = eventTitle ? `Evento em questão: "${eventTitle}"\n` : "";

  const system = `Você classifica respostas curtas a uma pergunta de lembrete.
Contexto: o assistente acabou de perguntar "Quer que eu te lembre antes do evento?".
${titleLine}Classifique a resposta do usuário em UMA das categorias e responda APENAS com JSON válido (sem markdown).

Categorias:
- "accept_with_time": aceita lembrete E informa tempo de antecedência (ex: "sim 2h antes", "claro, 30 min").
- "accept_no_time":   aceita lembrete SEM informar tempo (ex: "sim me avisa antes", "claro", "pode").
- "at_time":          quer aviso só na hora exata do evento (ex: "só na hora", "no horário").
- "decline":          recusa lembrete (ex: "não precisa", "deixa pra lá").
- "unknown":          não dá pra inferir com confiança.

Formato de resposta:
{"kind": "<categoria>", "minutes": <número ou null>}

Exemplos:
"sim me avisa antes" → {"kind": "accept_no_time", "minutes": null}
"sim, 2 horas antes" → {"kind": "accept_with_time", "minutes": 120}
"manda 15min antes blz" → {"kind": "accept_with_time", "minutes": 15}
"só na hora" → {"kind": "at_time", "minutes": null}
"deixa pra lá" → {"kind": "decline", "minutes": null}
"talvez" → {"kind": "unknown", "minutes": null}`;

  try {
    // Roteado: usa OpenAI se admin configurou, senão Claude. Fallback se falhar.
    const raw = await chatWithProvider(
      [{ role: "user", content: safeMsg }],
      system,
      true,
      "classifyReminderWithAI"
    );
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { kind?: string; minutes?: number | null };

    const kind = parsed.kind;
    const minutes = typeof parsed.minutes === "number" ? parsed.minutes : null;

    if (kind === "accept_with_time" && minutes !== null && minutes > 0) {
      return { kind: "accept_with_time", minutes };
    }
    if (kind === "accept_no_time") return { kind: "accept_no_time" };
    if (kind === "at_time") return { kind: "at_time" };
    if (kind === "decline") return { kind: "decline" };
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
