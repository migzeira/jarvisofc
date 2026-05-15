import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyIntent, type Intent } from "./classify.ts";

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

type AIProvider = "claude" | "openai" | "deepseek";

interface AIConfig {
  provider: AIProvider;        // chat geral (modo sombra, lembretes, etc.)
  financeProvider: AIProvider; // Pass 1 da extração financeira (default "claude")
  openaiKey: string;
  deepseekKey: string;
  pass2Enabled: boolean;       // liga/desliga Pass 2 da categorização
  intentClassifierEnabled: boolean; // liga/desliga IA fallback no classifier de intent
}

// Cache em memória (60s) — evita ler app_settings a cada chamada.
let _aiConfigCache: AIConfig | null = null;
let _aiConfigCacheExpiry = 0;
const AI_CONFIG_TTL_MS = 60_000;

async function getAIConfig(): Promise<AIConfig> {
  const now = Date.now();
  if (_aiConfigCache && now < _aiConfigCacheExpiry) return _aiConfigCache;

  const fallback: AIConfig = {
    provider: "claude",
    financeProvider: "claude",
    openaiKey: OPENAI_KEY_ENV,
    deepseekKey: Deno.env.get("DEEPSEEK_API_KEY") ?? "",
    pass2Enabled: false,
    intentClassifierEnabled: false,
  };

  if (!_aiSupabase) {
    _aiConfigCache = fallback;
    _aiConfigCacheExpiry = now + AI_CONFIG_TTL_MS;
    return fallback;
  }

  try {
    const { data } = await _aiSupabase
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "ai_chat_provider",
        "ai_finance_provider",
        "openai_api_key",
        "deepseek_api_key",
        "ai_pass2_enabled",
        "ai_intent_classifier_enabled",
      ]);

    const map = new Map<string, string>();
    for (const row of data ?? []) {
      if (row?.key) map.set(row.key, String(row.value ?? ""));
    }

    const providerRaw = (map.get("ai_chat_provider") ?? "").toLowerCase().trim();
    const provider: AIProvider = providerRaw === "openai" ? "openai" : "claude";

    // Pass 1 financeiro: separado do chat geral. Default "claude" preserva
    // comportamento atual (extração financeira sempre foi Claude).
    const financeRaw = (map.get("ai_finance_provider") ?? "").toLowerCase().trim();
    const financeProvider: AIProvider = financeRaw === "openai" ? "openai" : "claude";

    const openaiKey = (map.get("openai_api_key") ?? "").trim() || OPENAI_KEY_ENV;
    const deepseekKey = (map.get("deepseek_api_key") ?? "").trim()
      || (Deno.env.get("DEEPSEEK_API_KEY") ?? "");

    const pass2Raw = (map.get("ai_pass2_enabled") ?? "").toLowerCase().trim();
    const pass2Enabled = pass2Raw === "true";

    const intentRaw = (map.get("ai_intent_classifier_enabled") ?? "").toLowerCase().trim();
    const intentClassifierEnabled = intentRaw === "true";

    const cfg: AIConfig = {
      provider,
      financeProvider,
      openaiKey,
      deepseekKey,
      pass2Enabled,
      intentClassifierEnabled,
    };
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
  confidence?: number; // 0.00-1.00, só pra calls de categorização
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
      confidence: entry.confidence ?? null,
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

/** Chamada à DeepSeek (deepseek-chat). API 100% compatível com OpenAI.
 *  Retorna { text, tokensIn, tokensOut } ou throw. */
async function chatDeepSeek(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  jsonMode: boolean,
  apiKey: string
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const fullMessages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages) fullMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-chat",
    messages: fullMessages,
    max_tokens: 800, // pass 2 precisa de mais espaço pra JSON estruturado
  };
  if (jsonMode) {
    // DeepSeek aceita response_format.type = "json_object" igual OpenAI.
    body.response_format = { type: "json_object" };
    const lastIsUser = fullMessages[fullMessages.length - 1]?.role === "user";
    const lastContent = String(fullMessages[fullMessages.length - 1]?.content ?? "");
    if (lastIsUser && !/json/i.test(lastContent)) {
      fullMessages[fullMessages.length - 1].content = lastContent + "\n\nResponda em JSON válido.";
    }
  }

  // Timeout de 20s — DeepSeek pode ser mais lento que OpenAI mas não deve
  // travar fluxo do WhatsApp. Se passar disso, cascata cai pro GPT-4o.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
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
      throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const tokensIn = Number(data?.usage?.prompt_tokens ?? 0);
    const tokensOut = Number(data?.usage?.completion_tokens ?? 0);
    return { text, tokensIn, tokensOut };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("DeepSeek timeout after 20s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Chamada à OpenAI usando modelo FORTE (gpt-4o, não mini) — usado como
 *  fallback do Pass 2 quando DeepSeek falha. */
async function chatOpenAIStrong(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  jsonMode: boolean,
  apiKey: string
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const fullMessages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages) fullMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: Deno.env.get("OPENAI_PASS2_MODEL") ?? "gpt-4o",
    messages: fullMessages,
    max_tokens: 800,
  };
  if (jsonMode) {
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
      throw new Error(`OpenAI(strong) ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const tokensIn = Number(data?.usage?.prompt_tokens ?? 0);
    const tokensOut = Number(data?.usage?.completion_tokens ?? 0);
    return { text, tokensIn, tokensOut };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OpenAI(strong) timeout after 25s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pass 2 da categorização: cascata DeepSeek → GPT-4o.
 *
 * - Tenta DeepSeek primeiro (90% mais barato que GPT-4o)
 * - Se DeepSeek falhar/timeout: cai pra GPT-4o (mais robusto)
 * - Se ambos falharem: throw — caller deve manter resultado do Pass 1
 *
 * Loga TODA call em ai_usage_log com provider correto pra telemetria.
 *
 * @returns { text, provider, fallbackUsed } onde provider indica qual modelo
 *          gerou o resultado final (útil pra debug/telemetria upstream).
 */
async function chatPass2(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  functionName: string
): Promise<{ text: string; provider: "deepseek" | "openai"; fallbackUsed: boolean }> {
  const cfg = await getAIConfig();
  const hasDeepSeek = cfg.deepseekKey.length > 0;
  const hasOpenAI = cfg.openaiKey.length > 0;

  if (!hasDeepSeek && !hasOpenAI) {
    throw new Error("Pass 2 sem provider: nem deepseek_api_key nem openai_api_key configurados");
  }

  // 1. Tenta DeepSeek primeiro (se configurado)
  if (hasDeepSeek) {
    const start = Date.now();
    try {
      const result = await chatDeepSeek(messages, systemPrompt, true, cfg.deepseekKey);
      logAIUsage({
        provider: "deepseek",
        functionName,
        model: Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-chat",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: Date.now() - start,
      });
      return { text: result.text, provider: "deepseek", fallbackUsed: false };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[pass2] DeepSeek falhou em ${functionName}: ${errMsg} → tentando GPT-4o`);
      logAIUsage({
        provider: "deepseek",
        functionName,
        model: Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-chat",
        errorMessage: errMsg,
        durationMs: Date.now() - start,
      });
      // Continua e tenta GPT-4o abaixo
    }
  }

  // 2. Fallback: GPT-4o (se configurado)
  if (hasOpenAI) {
    const start = Date.now();
    try {
      const result = await chatOpenAIStrong(messages, systemPrompt, true, cfg.openaiKey);
      logAIUsage({
        provider: "openai",
        functionName,
        model: Deno.env.get("OPENAI_PASS2_MODEL") ?? "gpt-4o",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        fallbackUsed: hasDeepSeek, // se DeepSeek existia e a gente caiu aqui, é fallback
        durationMs: Date.now() - start,
      });
      return { text: result.text, provider: "openai", fallbackUsed: hasDeepSeek };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[pass2] GPT-4o falhou em ${functionName}: ${errMsg}`);
      logAIUsage({
        provider: "openai",
        functionName,
        model: Deno.env.get("OPENAI_PASS2_MODEL") ?? "gpt-4o",
        errorMessage: errMsg,
        fallbackUsed: hasDeepSeek,
        durationMs: Date.now() - start,
      });
      throw e;
    }
  }

  throw new Error("Pass 2 sem fallback disponível");
}

// ─────────────────────────────────────────────────────────────────────────
// HYBRID INTENT CLASSIFIER — regex (rápido/grátis) + IA (preciso/contextual)
// Resolve falsos positivos de regex em mensagens longas/ambíguas.
// Gated por ai_intent_classifier_enabled no painel admin.
//
// DEFESA EM PROFUNDIDADE (2026-05-14):
//   1. Fast path SEM I/O pra mensagens triviais (zero overhead)
//   2. Cache LRU em memória (5 min TTL) — mesma msg não chama IA 2x
//   3. Timeout duro de 3s no AbortController específico do classifier
//   4. Threshold de confidence (< 0.6 = ignora IA, usa regex)
//   5. Try/catch externo + interno — se algo der ruim, SEMPRE retorna intent válido
//   6. Lista de intents válidos com fallback se IA retornar lixo
// ─────────────────────────────────────────────────────────────────────────

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  source: "regex" | "regex_fast_path" | "ai" | "ai_failed" | "ai_low_confidence" | "cache";
}

/** Subset de intents que a IA conhece — alinhado com o tipo Intent.
 *  Se IA retornar algo fora desta lista, fallback pro regex. */
const AI_KNOWN_INTENTS: ReadonlyArray<Intent> = [
  "finance_record", "finance_report", "finance_delete",
  "agenda_create", "agenda_query", "agenda_lookup", "agenda_edit", "agenda_delete",
  "reminder_set", "reminder_list", "reminder_cancel", "reminder_edit", "reminder_snooze",
  "notes_save", "notes_list", "notes_delete",
  "habit_create", "habit_edit", "habit_delete", "habit_list", "habit_checkin",
  "contact_save", "send_to_contact", "order_on_behalf", "schedule_meeting",
  "list_create", "list_show", "list_show_all", "list_add_items",
  "budget_query", "budget_set",
  "recurring_confirm",
  "ai_chat",
];

// ─────────────────────────────────────────────────────────────────────────
// CACHE LRU em memória pra classificações de intent
// Edge function tem cold start — cache local ajuda quando user manda várias
// mensagens em sequência dentro da mesma instância warm.
// ─────────────────────────────────────────────────────────────────────────
const _intentCache = new Map<string, { value: IntentClassification; expiry: number }>();
const INTENT_CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutos
const INTENT_CACHE_MAX_SIZE = 500;          // limite pra não explodir memória

function _normalizeForCache(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 200);
}

function _getCachedIntent(text: string): IntentClassification | null {
  const key = _normalizeForCache(text);
  const entry = _intentCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiry) {
    _intentCache.delete(key);
    return null;
  }
  // LRU: re-insere pra ir pro fim (Map mantém ordem de inserção)
  _intentCache.delete(key);
  _intentCache.set(key, entry);
  return { ...entry.value, source: "cache" as const };
}

function _setCachedIntent(text: string, value: IntentClassification): void {
  // Não cacheia ai_failed (queremos retry da próxima vez)
  if (value.source === "ai_failed") return;
  const key = _normalizeForCache(text);
  // Limita tamanho — remove o mais antigo se passar do limite
  if (_intentCache.size >= INTENT_CACHE_MAX_SIZE) {
    const firstKey = _intentCache.keys().next().value;
    if (firstKey) _intentCache.delete(firstKey);
  }
  _intentCache.set(key, { value, expiry: Date.now() + INTENT_CACHE_TTL_MS });
}

const INTENT_AI_TIMEOUT_MS = 3000;       // timeout duro pra IA na classificação
const INTENT_MIN_CONFIDENCE = 0.6;       // abaixo disso, usa regex (IA não tem certeza)

/** Chama IA pra classificar intent quando regex tá ambíguo.
 *  Retorna intent + confidence. Se IA retornar lixo, throw → caller usa regex.
 *  Tem timeout duro de INTENT_AI_TIMEOUT_MS (3s) via Promise.race. */
async function classifyIntentWithAI(text: string, regexHint: Intent): Promise<{ intent: Intent; confidence: number }> {
  const system = `Você é um classificador de intent pra mensagens em português brasileiro chegando num assistente pessoal AI chamado Jarvis. Classifique a mensagem em UMA categoria e retorne APENAS JSON válido, sem markdown.`;

  const prompt = `Mensagem do usuário: "${text}"

Hint do regex local: "${regexHint}" (pode estar errado, especialmente em frases longas com palavras que aparecem dentro de outras, mensagens com erros de digitação ou variações regionais).

CATEGORIAS POSSÍVEIS:

FINANÇAS:
- finance_record: registrar gasto/recebimento ("gastei 50 no almoço", "transferi 200 pro João", "salário 5000", "pix 30 pra Cibele", "saiu 850 da conta", "caiu 5000 hoje")
- finance_report: consultar gastos/saldo ("quanto gastei?", "meu saldo", "extrato", "quantos reais sobraram")
- finance_delete: apagar transação ("apaga o último gasto", "remove aquela despesa")
- budget_query: consultar orçamento ("meus orçamentos", "tenho limite ainda?")
- budget_set: definir orçamento ("orçamento 500 pra alimentação")

AGENDA / EVENTOS:
- agenda_create: criar evento/compromisso ("reunião com João amanhã 14h", "marca consulta sexta", "tenho dentista quarta")
- agenda_query: consultar agenda ("o que tenho hoje?", "quais compromissos?", "minha agenda dessa semana")
- agenda_lookup: buscar evento específico ("qual minha reunião com João?", "quando é minha consulta?")
- agenda_edit: editar evento ("muda a reunião pra 15h", "remarca o jantar", "mudei de dia")
- agenda_delete: cancelar evento ("cancela a reunião de amanhã", "desmarca a consulta")
- schedule_meeting: marcar reunião com Google Meet + contato salvo ("marca call com Cibele amanhã 10h")

LEMBRETES (com horário/disparo):
- reminder_set: criar lembrete com horário ("me lembra de pagar conta às 14h", "me lembre da reunião hoje", "me avisa daqui 30min")
- reminder_list: listar lembretes ("meus lembretes", "tenho algum lembrete?")
- reminder_cancel: cancelar lembrete ("cancela o lembrete de pagar")
- reminder_edit: editar lembrete ("muda o lembrete pra 15h")
- reminder_snooze: adiar lembrete que já disparou ("me lembra de novo daqui 30 min")

NOTAS / ANOTAÇÕES (informação livre sem horário):
- notes_save: salvar anotação ("anota que preciso comprar pão", "salva isso aí", "registra essa ideia")
- notes_list: listar anotações ("minhas anotações", "o que anotei?")
- notes_delete: apagar anotação ("apaga a última anotação")

HÁBITOS (rotinas recorrentes):
- habit_create: criar hábito ("hábito de academia 6h", "rotina de meditar", "treino segunda quarta sexta")
- habit_edit: editar hábito existente ("muda o horario do habito meditar pra 9h", "altera academia pra 7h", "muda meditar pra de manhã")
- habit_delete: apagar/cancelar hábito ("apaga o habito meditar", "remove rotina academia", "para o habito X")
- habit_list: listar hábitos ("meus hábitos", "quais hábitos tenho")
- habit_checkin: confirmar hábito feito ("fiz", "feito", "pronto", "completei", "✅")

CONTATOS:
- contact_save: salvar contato ("salva contato Maria 11999", "guarda número da Cibele")
- send_to_contact: enviar mensagem pra contato salvo ("manda mensagem pro João dizendo X", "fala pra Maria que...")
- order_on_behalf: pedir comida em estabelecimento ("pede uma pizza na Maia")

LISTAS DE TAREFAS / COMPRAS:
- list_create: criar lista ("cria lista de compras", "nova lista chamada Mercado")
- list_show: ver itens de uma lista específica ("minha lista de compras")
- list_show_all: listar todas as listas ("minhas listas")
- list_add_items: adicionar item à lista existente ("adiciona leite na lista")

CONFIRMAÇÃO DE COBRANÇA RECORRENTE:
- recurring_confirm: resposta SIM/NÃO/PULA depois do Jarvis perguntar sobre cobrança recorrente ("você pagou o aluguel?")

CONVERSA / OUTROS:
- ai_chat: conversa geral, dúvida sobre o Jarvis, saudação longa, ou nada acima encaixa

REGRAS DE DESEMPATE (importantes — siga essas em ordem):
1. Se a mensagem começa com "me lembre"/"me lembra"/"me avisa"/"me notifica" + complemento natural → reminder_set, mesmo que tenha palavras como "reunião", "compromisso", "hoje".
2. Pergunta direta sobre o que tem ("o que tenho hoje?", "quais compromissos?") → agenda_query.
3. Valor monetário (R$, reais, paus, conto) + verbo de transação (gastei, paguei, transferi, pix, salário, recebi, caiu) → finance_record.
4. "Anota", "registra ideia", "salva isso" SEM horário/data específica → notes_save.
5. "Anota X às 10h" / "anota reunião amanhã" → tem horário, vai pra agenda_create OU reminder_set (depende se é compromisso ou aviso).
6. Pra hábito, exige palavra-chave clara: "hábito de", "rotina de", "todo dia X horário", "treino segunda...".
7. Mensagens curtas e ambíguas ("ok", "sim", "fiz", "pronto") sem contexto → ai_chat ou habit_checkin (ai_chat é mais seguro).
8. Mensagens com erros de digitação CONTAM como o intent correto: "lembar" = lembrar = reminder_set; "gasrei" = gastei = finance_record.
9. Foque no SENTIDO, não em palavras isoladas. Se a frase claramente expressa uma intenção, mesmo com typos, classifique.
10. Se não tem certeza, prefira ai_chat com confidence baixa (< 0.5) ao invés de chutar.

Retorne APENAS este JSON (sem markdown, sem explicação):
{
  "intent": "uma_das_categorias_acima",
  "confidence": 0.95
}`;

  // Timeout duro de 3s — usa Promise.race contra a chamada da IA
  // Sem isso, classify pode segurar a edge function por 25s (timeout do chatWithProvider)
  const aiPromise = chatWithProvider(
    [{ role: "user", content: prompt }],
    system,
    true, // jsonMode
    "classifyIntentHybrid"
  );

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`classifyIntentWithAI timeout after ${INTENT_AI_TIMEOUT_MS}ms`)), INTENT_AI_TIMEOUT_MS);
  });

  const result = await Promise.race([aiPromise, timeoutPromise]);

  // Parse defensivo
  let parsed: { intent?: string; confidence?: number };
  try {
    let jsonStr = result.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    if (!jsonStr.startsWith("{")) {
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
    }
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`AI retornou JSON inválido: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Safety net: intent precisa estar na lista conhecida
  const aiIntent = String(parsed.intent ?? "").trim() as Intent;
  if (!AI_KNOWN_INTENTS.includes(aiIntent)) {
    throw new Error(`AI retornou intent desconhecido: "${aiIntent}"`);
  }

  // Confidence clamp
  const rawConf = Number(parsed.confidence ?? 0.7);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0.7;

  return { intent: aiIntent, confidence };
}

/**
 * Classifier híbrido: regex sempre roda primeiro (rápido/grátis); IA entra
 * SÓ quando ai_intent_classifier_enabled=true E o caso é ambíguo.
 *
 * Fast path (não chama IA mesmo com flag ligada — economiza custo/latência):
 *   - Saudação ("oi", "bom dia")
 *   - Mensagem ≤ 3 palavras
 *   - Comandos de lista (list_*)
 *   - Habit checkin / reminder snooze (regex robusto pra esses)
 *
 * Caso ambíguo → IA classifica. Se IA falhar (timeout, JSON inválido), retorna
 * o regex original com source="ai_failed" pra log/debug.
 */
export async function classifyIntentHybrid(text: string): Promise<IntentClassification> {
  const regexIntent = classifyIntent(text);

  // ─────────────────────────────────────────────────────────────────────────
  // FAST PATH — antes de qualquer I/O (zero overhead pra mensagens triviais).
  //
  // Casos onde regex é altamente confiável e IA seria desperdício de custo:
  //   - Saudações ("oi", "bom dia")
  //   - Mensagens muito curtas (≤ 3 palavras) — pending action ou intent óbvio
  //   - Comandos de lista (list_*) — regex é robusto pra esses
  //   - Habit checkin / reminder snooze — padrões muito específicos
  //   - Saudações com até 5 palavras ("bom dia, tudo bem com você?")
  //
  // BUG fix 2026-05-08: fast path movido pra ANTES de `await getAIConfig()`
  // pra evitar I/O concorrente sob carga.
  // ─────────────────────────────────────────────────────────────────────────
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const isFastPath =
    regexIntent === "greeting" ||
    wordCount <= 3 ||
    regexIntent.startsWith("list_") ||
    regexIntent === "habit_checkin" ||
    regexIntent === "reminder_snooze" ||
    regexIntent === "recurring_confirm";  // resposta a pergunta de cobrança = pending

  if (isFastPath) {
    return { intent: regexIntent, confidence: 1.0, source: "regex_fast_path" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CACHE LRU — mensagem repetida não chama IA de novo (5 min TTL)
  // ─────────────────────────────────────────────────────────────────────────
  const cached = _getCachedIntent(trimmed);
  if (cached) return cached;

  // Daqui em diante: mensagens médias/longas SEM cache hit.
  // Carrega config (com cache 60s no DB query).
  let cfg: AIConfig;
  try {
    cfg = await getAIConfig();
  } catch (e) {
    // Se config falhar, fallback pro regex — não bloqueia user
    console.error(`[intent-classifier] getAIConfig falhou:`, e instanceof Error ? e.message : String(e));
    return { intent: regexIntent, confidence: 0.7, source: "ai_failed" };
  }

  // Flag desligada → regex puro (mesmo comportamento de antes)
  if (!cfg.intentClassifierEnabled) {
    return { intent: regexIntent, confidence: 1.0, source: "regex" };
  }

  // Sem API key configurada → regex (não dá pra chamar IA)
  const hasAnyProvider = (cfg.provider === "openai" && cfg.openaiKey.length > 0) ||
                         (cfg.provider === "claude" && Deno.env.get("ANTHROPIC_API_KEY"));
  if (!hasAnyProvider) {
    console.warn(`[intent-classifier] Flag ON mas sem provider key — usando regex`);
    return { intent: regexIntent, confidence: 1.0, source: "regex" };
  }

  // Caso ambíguo → IA decide com timeout duro
  const start = Date.now();
  try {
    const aiResult = await classifyIntentWithAI(trimmed, regexIntent);
    const durationMs = Date.now() - start;

    logAIUsage({
      provider: cfg.provider,
      functionName: "classifyIntentHybrid",
      model: cfg.provider === "openai"
        ? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini"
        : Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
      durationMs,
      confidence: aiResult.confidence,
    });

    // ── THRESHOLD: se IA tá insegura, prefere regex (que é determinístico) ──
    // Evita IA "chutando" com baixa confidence quando regex já decidiu algo.
    // Especialmente útil quando regex bateu intent específico (não ai_chat).
    if (aiResult.confidence < INTENT_MIN_CONFIDENCE && regexIntent !== "ai_chat") {
      const result: IntentClassification = {
        intent: regexIntent,
        confidence: aiResult.confidence,
        source: "ai_low_confidence",
      };
      _setCachedIntent(trimmed, result);
      return result;
    }

    const result: IntentClassification = {
      intent: aiResult.intent,
      confidence: aiResult.confidence,
      source: "ai",
    };
    _setCachedIntent(trimmed, result);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[intent-classifier] IA falhou (${Date.now() - start}ms), fallback regex: ${errMsg}`);
    logAIUsage({
      provider: cfg.provider,
      functionName: "classifyIntentHybrid",
      errorMessage: errMsg,
      durationMs: Date.now() - start,
    });
    // NÃO cacheia ai_failed (queremos retry da próxima vez)
    return { intent: regexIntent, confidence: 0.7, source: "ai_failed" };
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
 *  userCategories para que o Jarvis use elas também. Fallback: DEFAULT_CATEGORIES.
 *
 *  Retorna confidence (0.0-1.0) por transação. Se modelo não retornar, defaulta
 *  pra 0.7 (assume confiança média — não dispara Pass 2 desnecessariamente). */
export async function extractTransactions(
  text: string,
  userCategories: string[] = DEFAULT_CATEGORIES
): Promise<Array<{ amount: number; description: string; type: "expense" | "income"; category: string; installments?: number; confidence: number }>> {
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
Cada item: { "amount": número, "description": string, "type": "expense" ou "income", "category": uma de [${catList}], "installments": número ou null, "confidence": número 0.0-1.0 }

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

6. CONFIDENCE — adicione campo "confidence" (0.0 a 1.0) honesto:
   - 0.95+ se categoria é óbvia ("uber" → transporte, "ifood" → alimentacao)
   - 0.80-0.95 se boa categoria mas não 100% certo
   - 0.60-0.80 se ficou na dúvida entre 2 categorias possíveis
   - 0.40-0.60 se chutou (ex: nome próprio sem contexto, "Transferi pro João")
   - <0.40 se categorizou em "outros" porque mesmo assim ficou em dúvida

Texto: "${text}"

Exemplos EXPENSE:
"340 gasolina" → { "amount": 340, "description": "Gasolina", "type": "expense", "category": "transporte", "installments": null, "confidence": 0.95 }
"gastei 200 de gasolina" → { "amount": 200, "description": "Gasolina", "type": "expense", "category": "transporte", "installments": null, "confidence": 0.95 }
"comprei celular 300 em 3x" → { "amount": 300, "description": "Celular", "type": "expense", "category": "outros", "installments": 3, "confidence": 0.40 }
"sofá 1200 parcelado em 12x" → { "amount": 1200, "description": "Sofá", "type": "expense", "category": "outros", "installments": 12, "confidence": 0.40 }
"comprei tv 2000 em 10 vezes" → { "amount": 2000, "description": "TV", "type": "expense", "category": "outros", "installments": 10, "confidence": 0.40 }
"paguei 500 no mercado" → { "amount": 500, "description": "Mercado", "type": "expense", "category": "alimentacao", "installments": null, "confidence": 0.95 }
"transferi 200 pro João" → { "amount": 200, "description": "João", "type": "expense", "category": "outros", "installments": null, "confidence": 0.30 }

Exemplos INCOME:
"salário 20k" → { "amount": 20000, "description": "Salário", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.98 }
"salario 8000" → { "amount": 8000, "description": "Salário", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.98 }
"recebi 1000 de freela" → { "amount": 1000, "description": "Freela", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.95 }
"freelance 1500" → { "amount": 1500, "description": "Freelance", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.95 }
"bonus 500" → { "amount": 500, "description": "Bônus", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.95 }
"13o de 8000" → { "amount": 8000, "description": "13º salário", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.95 }
"pagamento único 20k registra hoje" → { "amount": 20000, "description": "Pagamento único", "type": "income", "category": "outros", "installments": null, "confidence": 0.50 }
"registra receita de 20k hoje" → { "amount": 20000, "description": "Receita", "type": "income", "category": "outros", "installments": null, "confidence": 0.50 }
"recebi 5000 do cliente" → { "amount": 5000, "description": "Cliente", "type": "income", "category": "trabalho", "installments": null, "confidence": 0.85 }

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
    // Safety net: confidence ausente ou fora de [0,1] → default 0.7 (médio)
    // 0.7 é escolha proposital: NÃO dispara Pass 2 se modelo esqueceu de
    // retornar (assume Pass 1 confiou). Pass 2 só dispara se confidence < 0.7.
    const rawConf = Number(t.confidence ?? NaN);
    t.confidence = Number.isFinite(rawConf)
      ? Math.max(0, Math.min(1, rawConf))
      : 0.7;
  }
  return transactions;
}

/** Tipo de retorno do Pass 2: transação re-categorizada com confidence. */
export interface DeepCategorizedTransaction {
  amount: number;
  description: string;
  type: "expense" | "income";
  category: string;
  installments?: number | null;
  confidence: number; // 0.00-1.00
}

/** Histórico de transação do user passado ao Pass 2 pra contextualizar a IA. */
export interface UserHistoryItem {
  description: string;
  category: string;
  amount: number;
}

/**
 * Pass 2 da categorização — re-categoriza uma transação que o Pass 1 ficou em
 * dúvida (category="outros" ou confidence baixa). Usa modelo MAIS forte
 * (DeepSeek com fallback GPT-4o) e contexto do histórico do user pra descobrir
 * padrões pessoais (ex: "João" sempre é pet → categoria "Pet").
 *
 * IMPORTANTE: NÃO re-extrai amount/description/type — confia no que Pass 1
 * retornou nesses campos. Foco exclusivo em CATEGORIZAR melhor.
 *
 * Se Pass 2 falhar (ambos providers caírem), throw — caller deve manter o
 * resultado original do Pass 1 e marcar needs_review=true.
 *
 * @param text          Mensagem original do user (mesmo input que Pass 1 viu)
 * @param currentTx     Transação como Pass 1 categorizou (será revisada)
 * @param userHistory   Últimas 30 transações do user (description, category, amount)
 * @param userCategories Lista de categorias válidas (default + custom do user)
 */
export async function extractTransactionsDeep(
  text: string,
  currentTx: { amount: number; description: string; type: "expense" | "income"; category: string; installments?: number | null },
  userHistory: UserHistoryItem[] = [],
  userCategories: string[] = DEFAULT_CATEGORIES
): Promise<DeepCategorizedTransaction> {
  // Normaliza categorias (mesma lógica de extractTransactions)
  const seen = new Set<string>();
  const allCats: string[] = [];
  for (const c of [...userCategories, ...DEFAULT_CATEGORIES]) {
    const k = c.toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); allCats.push(c); }
  }
  const catList = allCats.join(", ");

  // Monta seção de histórico — só os últimos 30, formato compacto pro modelo entender padrões
  const historyText = userHistory.length > 0
    ? userHistory
        .slice(0, 30)
        .map((h) => `- "${h.description}" → ${h.category} (R$${h.amount.toFixed(2)})`)
        .join("\n")
    : "(usuário ainda não tem histórico relevante)";

  const system = `Você é um especialista em categorização financeira brasileira. Analise o contexto histórico do usuário para descobrir padrões pessoais. Responda APENAS JSON válido.`;

  const prompt = `Re-categorize esta transação que a IA inicial não soube classificar com certeza.

TRANSAÇÃO ATUAL (do Pass 1):
- Mensagem original: "${text}"
- Descrição: "${currentTx.description}"
- Valor: R$ ${currentTx.amount.toFixed(2)}
- Tipo: ${currentTx.type}
- Categoria atual (a revisar): "${currentTx.category}"

CATEGORIAS DISPONÍVEIS: [${catList}]

HISTÓRICO DAS ÚLTIMAS TRANSAÇÕES DESSE USUÁRIO (use pra descobrir padrões pessoais):
${historyText}

INSTRUÇÕES:
1. Analise a mensagem original + descrição + histórico do user. Procure padrões: nomes próprios que sempre aparecem com mesma categoria, estabelecimentos recorrentes, valores típicos.
2. Escolha a MELHOR categoria da lista disponível. Use sua intuição contextual — não só palavras-chave.
3. Se nem com histórico você conseguir categorizar com certeza, mantenha "outros" mas com confidence baixa.
4. Retorne confidence honesto: 0.95+ se tem certeza forte, 0.7-0.9 se tem certeza moderada, 0.5-0.7 se é palpite, <0.5 se está mesmo no escuro.

EXEMPLOS DE RACIOCÍNIO:
- "Paguei João 200" + histórico mostra "João → Pet R$150 (semana passada)" → categoria: Pet, confidence: 0.92
- "Posto Shell 100" + histórico mostra padrão de transporte → categoria: transporte, confidence: 0.95
- "Transferi 500" sem contexto + histórico vazio → categoria: outros, confidence: 0.30

Retorne SOMENTE este JSON (sem markdown):
{
  "category": "uma das categorias disponíveis",
  "confidence": número entre 0.0 e 1.0,
  "reasoning": "1 frase curta explicando por que escolheu (pra debug)"
}`;

  const { text: rawResponse, provider, fallbackUsed } = await chatPass2(
    [{ role: "user", content: prompt }],
    system,
    "extractTransactionsDeep"
  );

  // Parse defensivo — se modelo retornar lixo, tem que cair gracefully
  let parsed: { category?: string; confidence?: number; reasoning?: string };
  try {
    // Modelo pode envolver em ```json ... ``` ou prefixar texto. Extrai primeiro {...}
    let jsonStr = rawResponse.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    if (!jsonStr.startsWith("{")) {
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
    }
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[extractTransactionsDeep] JSON parse falhou (provider=${provider}, fallback=${fallbackUsed}): ${e instanceof Error ? e.message : String(e)}`);
    console.error(`[extractTransactionsDeep] raw response: ${rawResponse.slice(0, 300)}`);
    // Retorna current sem mudança + confidence baixa pra caller marcar needs_review
    return {
      ...currentTx,
      installments: currentTx.installments ?? null,
      confidence: 0.3,
    };
  }

  // Safety net 1: categoria DEVE estar na lista válida; se não, mantém current
  const allCatsLower = new Set(allCats.map((c) => c.toLowerCase()));
  const newCategory = String(parsed.category ?? "").trim();
  const finalCategory = newCategory && allCatsLower.has(newCategory.toLowerCase())
    ? newCategory
    : currentTx.category;

  // Safety net 2: confidence DEVE estar em [0, 1]; clampa pra range válido
  const rawConf = Number(parsed.confidence ?? 0);
  const finalConfidence = Number.isFinite(rawConf)
    ? Math.max(0, Math.min(1, rawConf))
    : 0.3;

  return {
    amount: currentTx.amount,
    description: currentTx.description,
    type: currentTx.type,
    category: finalCategory,
    installments: currentTx.installments ?? null,
    confidence: finalConfidence,
  };
}

/** Transação retornada pelo orquestrador Pass1 + Pass2.
 *  needsReview = true se mesmo Pass 2 ficou em dúvida — caller deve marcar
 *  needs_review=true ao inserir na tabela transactions. */
export interface TransactionWithMeta {
  amount: number;
  description: string;
  type: "expense" | "income";
  category: string;
  installments?: number | null;
  confidence: number;
  needsReview: boolean;
}

/**
 * Orquestrador: Pass 1 (extractTransactions) + Pass 2 condicional
 * (extractTransactionsDeep) quando o admin tiver `ai_pass2_enabled=true`.
 *
 * Lógica:
 *  1. Roda Pass 1 (modelo rápido — Claude Haiku ou GPT-4o-mini)
 *  2. Se Pass 2 desligado no painel → retorna Pass 1 + needsReview=false (compat)
 *  3. Identifica transações que precisam de Pass 2:
 *     - category === "outros" OU confidence < 0.7
 *  4. Busca histórico do user (até 30 transações, 1 query) só se houver tx
 *     que precisa de Pass 2 — evita custo desnecessário.
 *  5. Para cada tx que precisa, chama extractTransactionsDeep.
 *  6. Se Pass 2 falhar (ambos providers caírem), mantém Pass 1 e marca
 *     needsReview=true. Nunca quebra fluxo do user.
 *  7. Marca needsReview=true se Pass 2 ainda retornou "outros" OU confidence < 0.5
 *
 * @param text           Mensagem original do user (mesma que vai pro Pass 1)
 * @param userCategories Categorias custom do user (já normalizadas)
 * @param userId         UUID do user — pra buscar histórico
 */
export async function extractTransactionsWithPass2(
  text: string,
  userCategories: string[],
  userId: string
): Promise<TransactionWithMeta[]> {
  // Pass 1 sempre roda — comportamento atual preservado
  const transactions = await extractTransactions(text, userCategories);
  if (transactions.length === 0) return [];

  const cfg = await getAIConfig();

  // Pass 2 desligado OU sem providers configurados → retorna Pass 1 limpo
  // (mesmo comportamento que ANTES desta feature existir)
  const hasAnyProvider = cfg.deepseekKey.length > 0 || cfg.openaiKey.length > 0;
  if (!cfg.pass2Enabled || !hasAnyProvider) {
    return transactions.map((t) => ({
      amount: t.amount,
      description: t.description,
      type: t.type,
      category: t.category,
      installments: t.installments ?? null,
      confidence: t.confidence,
      needsReview: false,
    }));
  }

  // Identifica quais transações precisam de Pass 2
  const indicesNeedingPass2: number[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const lowConf = t.confidence < 0.7;
    const isOthers = (t.category ?? "").toLowerCase().trim() === "outros";
    if (lowConf || isOthers) indicesNeedingPass2.push(i);
  }

  // Nenhuma precisa de Pass 2 — retorna Pass 1 com needsReview=false
  if (indicesNeedingPass2.length === 0) {
    return transactions.map((t) => ({
      amount: t.amount,
      description: t.description,
      type: t.type,
      category: t.category,
      installments: t.installments ?? null,
      confidence: t.confidence,
      needsReview: false,
    }));
  }

  // Busca histórico do user UMA VEZ (mesmo se várias tx precisarem de Pass 2)
  let userHistory: UserHistoryItem[] = [];
  if (_aiSupabase) {
    try {
      const { data } = await _aiSupabase
        .from("transactions")
        .select("description, category, amount")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      userHistory = (data ?? []).map((h: any) => ({
        description: String(h.description ?? ""),
        category: String(h.category ?? "outros"),
        amount: Number(h.amount ?? 0),
      }));
    } catch (e) {
      // Erro buscando histórico: Pass 2 ainda roda, só sem contexto
      console.error(`[pass2] erro buscando historico do user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Roda Pass 2 só nas que precisam (serial — geralmente 1-2 tx por mensagem)
  const results: TransactionWithMeta[] = [];
  const needSet = new Set(indicesNeedingPass2);

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];

    // Não precisa de Pass 2 — usa Pass 1 direto
    if (!needSet.has(i)) {
      results.push({
        amount: t.amount,
        description: t.description,
        type: t.type,
        category: t.category,
        installments: t.installments ?? null,
        confidence: t.confidence,
        needsReview: false,
      });
      continue;
    }

    // Precisa de Pass 2
    try {
      const deep = await extractTransactionsDeep(
        text,
        {
          amount: t.amount,
          description: t.description,
          type: t.type,
          category: t.category,
          installments: t.installments ?? null,
        },
        userHistory,
        userCategories
      );

      // Pass 2 ainda em "outros" ou confidence muito baixa → needs_review
      const stillOthers = deep.category.toLowerCase().trim() === "outros";
      const veryLowConf = deep.confidence < 0.5;

      results.push({
        amount: deep.amount,
        description: deep.description,
        type: deep.type,
        category: deep.category,
        installments: deep.installments ?? null,
        confidence: deep.confidence,
        needsReview: stillOthers || veryLowConf,
      });
    } catch (e) {
      // Pass 2 falhou completamente — mantém Pass 1, marca pra revisão
      console.error(`[pass2] falhou no idx ${i}: ${e instanceof Error ? e.message : String(e)}`);
      results.push({
        amount: t.amount,
        description: t.description,
        type: t.type,
        category: t.category,
        installments: t.installments ?? null,
        confidence: t.confidence,
        needsReview: true,
      });
    }
  }

  return results;
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

  const toneInstruction = TONE_DESCRIPTIONS[tone] ?? TONE_DESCRIPTIONS["amigavel"];
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
  recurrence: "none" | "daily" | "weekly" | "monthly" | "day_of_month" | "hourly";
  recurrence_value: number | null; // weekday 0-6 (weekly) ou dia 1-31 (day_of_month) ou horas (hourly)
}

/**
 * Usa Claude para transformar linguagem natural de lembrete em dados estruturados.
 * @param message  texto do usuário, ex: "me lembra de ligar pro pai às 12:20"
 * @param nowIso   data/hora atual no formato ISO com offset, ex: "2026-04-07T11:00:00-03:00"
 */
export async function parseReminderIntent(
  message: string,
  nowIso: string,
  lang = "pt-BR",
  userTz = "America/Sao_Paulo"
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

🔴 REGRA CRÍTICA #1 — PALAVRAS EXPLÍCITAS DE DATA TÊM PRIORIDADE ABSOLUTA:
Se o usuário disse "amanhã", "depois de amanhã", um dia da semana ("sexta", "segunda"), ou "semana que vem", USE ESSA DATA EXATAMENTE como ele disse. NÃO mude a data baseado em "se a hora ainda não passou hoje".
- Exemplo: agora é 11:35, user disse "amanhã meio dia e meio" → AMANHÃ 12:30 (NÃO hoje 12:30, mesmo que 12:30 ainda não passou)
- Exemplo: agora é 09:00, user disse "amanhã 14h" → AMANHÃ 14:00 (NÃO hoje 14:00)
- Exemplo: agora é segunda, user disse "sexta 10h" → próxima sexta 10:00 (NÃO hoje 10:00)
- Exemplo: agora é 15:00 de uma quinta, user disse "amanhã" sem hora → AMANHÃ 09:00 (próxima sexta 09:00)

🟡 REGRA #2 — Se NÃO houver palavra de data explícita:
- "daqui X minutos" / "em X minutos" / "daqui X horas" / "em X horas" → adicione à hora atual
- Se usuário só mencionou HORA (sem data): use HOJE se hora ainda não passou, senão AMANHÃ
- Exemplo: agora 01:36, user disse "1h50" (sem "amanhã") → HOJE 01:50
- Exemplo: agora 14:00, user disse "10h" (sem "amanhã") → AMANHÃ 10:00 (já passou)
- Exemplo: agora 14:00, user disse "16h" (sem "amanhã") → HOJE 16:00

🟢 REGRA #3 — Palavras-chave de data:
- "amanhã" → +1 dia (use a data calculada — NÃO importa se a hora já passou ou não)
- "depois de amanhã" → +2 dias
- "sexta" / "segunda" / etc → próximo dia da semana mencionado a partir de HOJE (se hoje é segunda e user diz "segunda", é a próxima segunda = +7 dias)
- "semana que vem" → +7 dias
- "no domingo" / "domingo" → próximo domingo

🚨 REGRA CRÍTICA — DEFAULTS QUANDO FALTA HORA:
NUNCA, EM NENHUMA HIPÓTESE, use a HORA ATUAL como default quando o usuário
não mencionar uma hora explícita. Isso é um bug grave.
- Se mencionou DATA mas NÃO mencionou HORA: use 09:00 como default.
  Exemplo: "me lembre amanhã de levar pet" às 18:53 → próximo dia 09:00 (NÃO 18:53!)
  Exemplo: "me lembra na sexta de pagar luz" → próxima sexta 09:00 (NÃO hora atual)
  Exemplo: "me lembra semana que vem da consulta" → +7 dias 09:00
- Se mencionou HORA mas NÃO mencionou DATA: use HOJE (se ainda não passou) ou AMANHÃ.
- Se NÃO mencionou nem DATA nem HORA: use AMANHÃ 09:00 (fallback razoável).
- Períodos do dia: "manhã" = 09:00, "tarde" = 14:00, "noite" = 20:00, "madrugada" = 05:00
  Exemplo: "me lembre amanhã de manhã de levar pet" → próximo dia 09:00
  Exemplo: "me lembra à tarde de ligar pra mãe" → hoje 14:00 (ou amanhã se já passou)

Regras para recurrence (analise CUIDADOSAMENTE — é muito importante detectar corretamente):

REGRA PRINCIPAL: Recurrence só é diferente de "none" quando o usuário usar EXPLICITAMENTE
palavras de repetição: "todo", "todos", "toda", "todas", "cada", "diariamente", "semanalmente",
"mensalmente", "sempre", "a cada".

Exemplos CRÍTICOS de coisas que NÃO são recorrentes (recurrence="none"):
- "me lembra dia 1 de pagar fatura" → none (próximo dia 1 ÚNICO, não todo mês)
- "me lembra na sexta de levar o lixo" → none (próxima sexta ÚNICA)
- "me lembra amanhã às 14h" → none
- "me lembra sábado às 10h" → none (próximo sábado ÚNICO)
- "me lembra no dia 15 de pagar luz" → none (próximo dia 15 ÚNICO)

Exemplos que SÃO recorrentes (note as palavras-chave em MAIÚSCULAS):
- "TODO dia" / "TODOS os dias" / "DIARIAMENTE" / "CADA dia" / "SEMPRE" → "daily", recurrence_value = null
- "TODA semana" / "SEMANALMENTE" / "TODAS as semanas" (sem dia específico) → "weekly", recurrence_value = null
- "TODA segunda" / "TODA segunda-feira" → "weekly", recurrence_value = 1
- "TODA terça" / "TODA terça-feira" → "weekly", recurrence_value = 2
- "TODA quarta" / "TODA quarta-feira" → "weekly", recurrence_value = 3
- "TODA quinta" / "TODA quinta-feira" → "weekly", recurrence_value = 4
- "TODA sexta" / "TODA sexta-feira" → "weekly", recurrence_value = 5
- "TODO sábado" / "TODO fim de semana" → "weekly", recurrence_value = 6
- "TODO domingo" → "weekly", recurrence_value = 0
- "TODO dia 10" / "dia 10 de TODO mês" / "TODO mês no dia X" / "MENSALMENTE no dia X" → "day_of_month", recurrence_value = X
- "TODO mês" / "MENSALMENTE" (sem dia específico) → "monthly", recurrence_value = null
- Para "TODA [dia-da-semana]": recurrence_value = (0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb)
- Se for recorrente semanal sem dia específico → recurrence_value = null (herda o dia do remind_at)
- "A CADA X horas" / "de X em X horas" / "TODO X horas" / "A CADA hora" → "hourly", recurrence_value = X
- "A CADA X minutos" / "de X em X minutos" NÃO é suportado → use "hourly" com o valor mais próximo em horas

ATENÇÃO: Quando o usuário diz só "dia X" sem a palavra "todo", "cada" ou "mensalmente",
SEMPRE recurrence = "none". O remind_at deve ser o PRÓXIMO dia X (mês atual se ainda
não passou, mês seguinte se já passou). NUNCA assuma recorrência sem palavra explícita.

Pedido: "${message}"`;

  const result = await chat(
    [{ role: "user", content: prompt }],
    system,
    true
  );

  try {
    const parsed = JSON.parse(result) as ReminderParsed;
    // Validação robusta: a IA pode retornar shapes inválidos (recurrence_value
    // fora da faixa, recurrence string desconhecida, remind_at não-ISO).
    // Antes só checava remind_at e recurrence — handlers downstream quebravam.

    if (!parsed.remind_at || typeof parsed.remind_at !== "string") return null;
    if (isNaN(Date.parse(parsed.remind_at))) {
      console.warn("[parseReminderIntent] remind_at inválido:", parsed.remind_at);
      return null;
    }

    const validRecurrences = ["none", "daily", "weekly", "monthly", "day_of_month", "hourly"];
    if (!parsed.recurrence || !validRecurrences.includes(parsed.recurrence)) {
      console.warn("[parseReminderIntent] recurrence inválido:", parsed.recurrence);
      return null;
    }

    // recurrence_value tem regras por tipo
    if (parsed.recurrence === "weekly" && parsed.recurrence_value != null) {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 0 || v > 6) {
        console.warn("[parseReminderIntent] weekly recurrence_value fora 0-6:", v);
        parsed.recurrence_value = null; // deixa send-reminder usar dia do remind_at
      }
    }
    if (parsed.recurrence === "day_of_month") {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 1 || v > 31) {
        console.warn("[parseReminderIntent] day_of_month fora 1-31:", v);
        return null; // sem dia válido, day_of_month não funciona
      }
    }
    if (parsed.recurrence === "hourly") {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 1 || v > 24) {
        // Default 1h se valor inválido
        parsed.recurrence_value = 1;
      }
    }

    // title/message defaults se vierem nulos (a IA às vezes esquece)
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      parsed.title = "Lembrete";
    }
    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      parsed.message = `⏰ ${parsed.title}`;
    }

    // Guarda de segurança: se a IA agendou para amanhã mas o horário ainda não passou hoje,
    // corrige para hoje. Isso evita erros com horários de madrugada como "1h50".
    //
    // ⚠️ EXCEÇÃO CRÍTICA: NÃO aplica esse guard se o usuário disse explicitamente "amanhã",
    // "depois de amanhã", dia da semana, ou "semana que vem". Senão a gente reverte a
    // interpretação correta da IA e o lembrete cai pra hoje quando o user queria amanhã.
    // Bug histórico: user disse "amanhã meio dia e meio" às 11:35, IA acertou amanhã 12:30,
    // guard "corrigiu" pra hoje 12:30 porque 12:30 ainda não tinha passado.
    if (parsed.recurrence === "none") {
      const lowMsg = (message || "").toLowerCase();
      const hasExplicitDate =
        /\bamanh[ãa]\b/.test(lowMsg) ||
        /\bdepois de amanh[ãa]\b/.test(lowMsg) ||
        /\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(-feira)?\b/.test(lowMsg) ||
        /\bsemana que vem\b/.test(lowMsg) ||
        /\bpr[óo]xim[ao]\s+(semana|m[êe]s|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|dia)\b/.test(lowMsg) ||
        /\bdaqui\s+a?\s*\d+\s*(dias?|semanas?|m[êe]s|meses)\b/.test(lowMsg);

      if (!hasExplicitDate) {
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
            // userTz é parâmetro da função (default America/Sao_Paulo).
            // BUG HISTÓRICO: este bloco usava userTz sem ter como parâmetro,
            // causando ReferenceError silencioso no catch e falsos negativos
            // tipo "Não entendi o lembrete" pra inputs perfeitamente claros.
            const y = todayVersion.toLocaleString("sv-SE", { timeZone: userTz }).slice(0, 10);
            const t = todayVersion.toLocaleString("sv-SE", { timeZone: userTz }).slice(11, 19);
            parsed.remind_at = `${y}T${t}${tzOffset}`;
          }
        }
      }
    }

    return parsed;
  } catch (e) {
    // Loga pra debug — antes era catch{} silencioso que escondeu o bug do
    // userTz por semanas. Trunca pra 200 chars pra não inflar log.
    console.warn(
      "[parseReminderIntent] failed:",
      (e as Error).message?.slice(0, 200) ?? String(e).slice(0, 200)
    );
    return null;
  }
}

// ─────────────────────────────────────────────
// REMINDER PARSE — modo lenient pra "Foi isso?"
// ─────────────────────────────────────────────
// Quando parseReminderIntent strict falha, tenta uma interpretação permissiva
// que SEMPRE retorna algo (com defaults razoáveis) pra propor ao usuário.
// O handler usa pra mostrar "Não entendi 100%, foi isso aqui que você quis
// dizer? *X às Y*. Responde sim que eu salvo!" — UX muito melhor que
// "reformule sua mensagem".
export async function parseReminderLenient(
  message: string,
  nowIso: string,
  lang = "pt-BR",
  userTz = "America/Sao_Paulo"
): Promise<ReminderParsed | null> {
  // Primeiro tenta strict — se rolar, retorna direto.
  const strict = await parseReminderIntent(message, nowIso, lang, userTz);
  if (strict) return strict;

  // Strict falhou — tenta interpretação permissiva. Prompt deixa claro que é
  // pra fazer o melhor palpite com defaults, porque user vai confirmar depois.
  const langLabel = lang === "en" ? "English" : lang === "es" ? "Spanish" : "Portuguese Brazilian";
  const offsetMatch = nowIso.match(/([+-]\d{2}:\d{2})$/);
  const tzHint = offsetMatch ? `UTC${offsetMatch[1]}` : "UTC-03:00";

  const prompt = `Hora atual: ${nowIso} (${tzHint}).

CONTEXTO: O usuário quer criar um lembrete mas a mensagem está confusa ou incompleta. Sua tarefa é fazer o MELHOR PALPITE possível usando defaults razoáveis. O sistema vai pedir confirmação ao usuário antes de salvar, então é ok ter incertezas.

Pedido: "${message}"

Retorne JSON (escreva title/message em ${langLabel}):
{
  "title": "texto curto do que lembrar (max 60 chars)",
  "message": "começa com ⏰ + título",
  "remind_at": "ISO 8601 com offset, sua MELHOR INTERPRETAÇÃO da data/hora",
  "recurrence": "none | daily | weekly | monthly | day_of_month | hourly",
  "recurrence_value": null ou número (0-6 weekly, 1-31 day_of_month, 1-24 hourly)
}

DEFAULTS quando info estiver faltando:
- Sem hora explícita: assume 09:00 (manhã)
- Sem data e hora ainda não passou: usa hoje. Sem data e hora já passou: amanhã.
- "todo/todos/toda/todas/diariamente/sempre" → recurrence "daily"
- "toda semana/semanal/semanalmente" sem dia → recurrence "weekly"
- "toda [dia da semana]" → recurrence "weekly" + value (0=dom..6=sáb)
- "todo dia X" / "mensalmente dia X" → recurrence "day_of_month" + value
- "a cada X horas" → recurrence "hourly" + value
- Senão → recurrence "none"

Retorne JSON válido SEMPRE — mesmo com defaults. NUNCA retorne null ou erro.`;

  try {
    const result = await chat(
      [{ role: "user", content: prompt }],
      "Voce extrai dados de lembretes mesmo com info incompleta. Sempre retorna JSON valido com defaults razoaveis.",
      true
    );
    const parsed = JSON.parse(result) as ReminderParsed;

    // Validação flexível com defaults — não retorna null por nada
    if (!parsed.remind_at || isNaN(Date.parse(parsed.remind_at))) {
      // Default: amanhã 09:00 no fuso do usuário
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const y = tomorrow.toLocaleString("sv-SE", { timeZone: userTz }).slice(0, 10);
      const tzOffset = offsetMatch ? offsetMatch[1] : "-03:00";
      parsed.remind_at = `${y}T09:00:00${tzOffset}`;
    }

    const validRecurrences = ["none", "daily", "weekly", "monthly", "day_of_month", "hourly"];
    if (!parsed.recurrence || !validRecurrences.includes(parsed.recurrence)) {
      parsed.recurrence = "none";
    }

    if (parsed.recurrence === "weekly" && parsed.recurrence_value != null) {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 0 || v > 6) parsed.recurrence_value = null;
    }
    if (parsed.recurrence === "day_of_month") {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 1 || v > 31) {
        // Sem dia válido pra day_of_month — degrada pra none com remind_at do dia
        parsed.recurrence = "none";
        parsed.recurrence_value = null;
      }
    }
    if (parsed.recurrence === "hourly") {
      const v = Number(parsed.recurrence_value);
      if (!Number.isInteger(v) || v < 1 || v > 24) parsed.recurrence_value = 1;
    }

    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      parsed.title = "Lembrete";
    }
    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      parsed.message = `⏰ ${parsed.title}`;
    }

    return parsed;
  } catch (e) {
    console.warn("[parseReminderLenient] failed:", (e as Error).message?.slice(0, 200));
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

// ─────────────────────────────────────────────────────────────
// LISTS — extração de nome + itens via IA
// Lida com fala natural (transcrição de áudio com palavras-conector
// como "que eu quero assistir", "pra mim", "sabe", "tipo") que regex
// puro não consegue parsear bem.
// ─────────────────────────────────────────────────────────────

export interface ListExtraction {
  /** Nome curto e limpo da lista, ex: "filmes", "mercado", "presentes natal". null se não puder identificar. */
  list_name: string | null;
  /** Itens identificados (sem deduplicar nem normalizar — caller faz isso). */
  items: string[];
}

/**
 * Extrai nome de lista + itens de uma mensagem em linguagem natural.
 * Cobertura ampla: comando direto ("cria lista X com Y, Z"), comando
 * conversacional ("ó, queria fazer uma lista pra anotar os filme que
 * eu quero assistir, tipo, X, Y e Z"), resposta a follow-up ("Sim,
 * arroz feijão e açúcar"), etc.
 *
 * Retorna {list_name: null, items: []} se não conseguiu — caller faz
 * fallback pra regex ou pede mais informação ao usuário.
 *
 * Custo: ~$0.0001 por chamada (Claude Haiku, ~200 tokens).
 */
export async function extractListIntent(
  text: string,
  knownLists: string[] = []
): Promise<ListExtraction> {
  const known = knownLists.length > 0
    ? `\n\nListas que o usuário JÁ TEM: ${knownLists.map((l) => `"${l}"`).join(", ")}\n→ Se o texto mencionar uma dessas (mesmo com palavras extras), use exatamente o nome existente.`
    : "";

  const system =
    `You are a list parser for a personal assistant in Brazilian Portuguese. Respond ONLY with valid JSON, no markdown, no explanations.`;

  const prompt = `Extraia o NOME da lista e os ITENS de uma mensagem natural (provavelmente transcrição de áudio do WhatsApp).

REGRAS DO NOME:
- Curto (1-3 palavras), substantivo principal. Ex: "filmes", "compras", "mercado", "presentes natal", "feira".
- Remova conectores ("que eu quero", "pra mim", "para minha", "tipo"), verbos ("assistir", "comprar", "fazer"), pronomes ("eu", "ele").
- Se o usuário disser "lista de filme que eu quero assistir" → list_name é "filmes" (não "filme que eu quero assistir").
- Se disser "lista pra mercado" → "mercado".
- Se disser "lista de natal" / "presentes de natal" → "presentes natal" ou "natal".
- Se NÃO tem nome claro (ex: "adiciona X na minha lista" sem nome), list_name = null.
- Tudo lowercase.

REGRAS DOS ITENS:
- Lista os itens que o usuário quer adicionar/marcar/remover, na ordem que apareceram.
- Limpe palavras-filler ("né", "tipo", "sabe", "ah", "eh", "então"), afirmações iniciais ("sim, ok, claro").
- Cada item deve ser substantivo curto (1-5 palavras). Ex: "arroz", "feijão preto", "Coringa 2", "detergente ype".
- Se o usuário disser "queria assistir Coringa, Duna e Oppenheimer" → items: ["Coringa", "Duna", "Oppenheimer"].
- Se nenhum item for citado, items: [].
- NÃO invente itens. Apenas extraia.${known}

EXEMPLOS:
- "cria lista de mercado pra mim e adiciona arroz, feijão e açúcar"
  → {"list_name": "mercado", "items": ["arroz", "feijão", "açúcar"]}

- "ó, queria fazer uma lista pra anotar os filme que eu quero assistir tipo Coringa, Duna e Oppenheimer"
  → {"list_name": "filmes", "items": ["Coringa", "Duna", "Oppenheimer"]}

- "Sim, arroz feijão e açúcar" (resposta a "quais itens?")
  → {"list_name": null, "items": ["arroz", "feijão", "açúcar"]}

- "adiciona detergente e papel higiênico na lista de compras"
  → {"list_name": "compras", "items": ["detergente", "papel higiênico"]}

- "tira arroz da lista de mercado"
  → {"list_name": "mercado", "items": ["arroz"]}

- "comprei o arroz e o feijão da lista de compras"
  → {"list_name": "compras", "items": ["arroz", "feijão"]}

- "mostra minha lista de compras"
  → {"list_name": "compras", "items": []}

Texto do usuário: "${text}"

Responda SOMENTE com JSON no formato:
{"list_name": "string ou null", "items": ["string", ...]}`;

  try {
    const result = await chat(
      [{ role: "user", content: prompt }],
      system,
      true
    );
    const parsed = JSON.parse(result) as { list_name?: unknown; items?: unknown };

    const list_name =
      typeof parsed.list_name === "string" && parsed.list_name.trim().length > 0
        ? parsed.list_name.trim().toLowerCase().slice(0, 60)
        : null;

    const items = Array.isArray(parsed.items)
      ? (parsed.items as unknown[])
          .filter((i) => typeof i === "string" && (i as string).trim().length > 0)
          .map((i) => (i as string).trim().slice(0, 200))
      : [];

    return { list_name, items };
  } catch (e) {
    console.warn("[extractListIntent] AI parse failed, returning empty:", (e as Error).message?.slice(0, 100));
    return { list_name: null, items: [] };
  }
}
