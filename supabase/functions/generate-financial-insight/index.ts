/**
 * generate-financial-insight
 *
 * Gera o "Resumo Inteligente do Jarvis" mostrado no topo da aba Finanças.
 * Lê transactions/budgets do mês corrente + mês anterior, monta prompt
 * com os dados agregados, chama IA (Claude/OpenAI via chatWithProvider),
 * cacheia em financial_insights_cache (TTL 4h) e retorna.
 *
 * Requisições:
 *   GET  → retorna cache se válido OU gera novo se expirado/ausente
 *   POST → força regeneração (bypass cache, usado pelo botão "Atualizar")
 *
 * Auth: requer JWT do usuário (verify_jwt=true). user_id vem do auth.uid().
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatWithProvider, type ChatMessage } from "../_shared/openai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    // apikey + x-client-info são enviados automaticamente pelo supabase-js client.
    // Sem isso o preflight OPTIONS falha e o browser bloqueia a requisição real.
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

interface FinancialSnapshot {
  txCount: number;
  txCountLastMonth: number;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  totalIncomeLastMonth: number;
  totalExpenseLastMonth: number;
  balanceLastMonth: number;
  topCategories: Array<{ category: string; amount: number }>;
  categoryDelta: Array<{ category: string; thisMonth: number; lastMonth: number; deltaPct: number | null }>;
  budgetWarnings: Array<{ category: string; usedPct: number; limit: number; spent: number }>;
  daysIntoMonth: number;
  daysInMonth: number;
  projectedBalance: number;
}

interface InsightState {
  state: "rich" | "partial" | "empty";
  text: string;
  snapshot: FinancialSnapshot | null;
}

function startOfMonthISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function endOfMonthISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0));
  const lastStr = String(last.getUTCDate()).padStart(2, "0");
  return `${y}-${String(m + 1).padStart(2, "0")}-${lastStr}`;
}

function startOfPrevMonthISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - 1;
  const adjY = m < 0 ? y - 1 : y;
  const adjM = (m + 12) % 12;
  return `${adjY}-${String(adjM + 1).padStart(2, "0")}-01`;
}

function endOfPrevMonthISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

async function buildSnapshot(userId: string): Promise<FinancialSnapshot> {
  const now = new Date();
  const monthStart = startOfMonthISO(now);
  const monthEnd = endOfMonthISO(now);
  const prevStart = startOfPrevMonthISO(now);
  const prevEnd = endOfPrevMonthISO(now);

  const [{ data: txCurrent }, { data: txPrev }, { data: budgets }] = await Promise.all([
    supabase
      .from("transactions")
      .select("amount, type, category, transaction_date")
      .eq("user_id", userId)
      .gte("transaction_date", monthStart)
      .lte("transaction_date", monthEnd),
    supabase
      .from("transactions")
      .select("amount, type, category, transaction_date")
      .eq("user_id", userId)
      .gte("transaction_date", prevStart)
      .lte("transaction_date", prevEnd),
    supabase
      .from("budgets" as any)
      .select("category, amount_limit")
      .eq("user_id", userId),
  ]);

  const cur = (txCurrent ?? []) as Array<{ amount: number | string; type: string; category: string }>;
  const prev = (txPrev ?? []) as Array<{ amount: number | string; type: string; category: string }>;

  const sumBy = (rows: typeof cur, type: string) =>
    rows.filter((r) => r.type === type).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const totalIncome = sumBy(cur, "income");
  const totalExpense = sumBy(cur, "expense");
  const totalIncomeLastMonth = sumBy(prev, "income");
  const totalExpenseLastMonth = sumBy(prev, "expense");

  // Top categorias EXPENSE no mês corrente
  const byCategoryCurrent = new Map<string, number>();
  for (const t of cur.filter((r) => r.type === "expense")) {
    byCategoryCurrent.set(t.category, (byCategoryCurrent.get(t.category) ?? 0) + Number(t.amount ?? 0));
  }
  const topCategories = Array.from(byCategoryCurrent.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, amount]) => ({ category, amount }));

  // Delta por categoria vs mês anterior (só categorias com >R$50 em algum mês)
  const byCategoryPrev = new Map<string, number>();
  for (const t of prev.filter((r) => r.type === "expense")) {
    byCategoryPrev.set(t.category, (byCategoryPrev.get(t.category) ?? 0) + Number(t.amount ?? 0));
  }
  const allCats = new Set<string>([...byCategoryCurrent.keys(), ...byCategoryPrev.keys()]);
  const categoryDelta = Array.from(allCats)
    .map((category) => {
      const thisMonth = byCategoryCurrent.get(category) ?? 0;
      const lastMonth = byCategoryPrev.get(category) ?? 0;
      const deltaPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
      return { category, thisMonth, lastMonth, deltaPct };
    })
    .filter((d) => Math.max(d.thisMonth, d.lastMonth) >= 50)
    .sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0))
    .slice(0, 3);

  // Orçamentos próximos do limite (>=70% usado)
  const budgetWarnings: FinancialSnapshot["budgetWarnings"] = [];
  for (const b of (budgets ?? []) as Array<{ category: string; amount_limit: number | string }>) {
    const limit = Number(b.amount_limit ?? 0);
    if (limit <= 0) continue;
    const spent = byCategoryCurrent.get(b.category) ?? 0;
    const usedPct = Math.round((spent / limit) * 100);
    if (usedPct >= 70) {
      budgetWarnings.push({ category: b.category, usedPct, limit, spent });
    }
  }
  budgetWarnings.sort((a, b) => b.usedPct - a.usedPct);

  // Projeção: extrapola gasto diário do mês até o fim
  const daysIntoMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyExpense = daysIntoMonth > 0 ? totalExpense / daysIntoMonth : 0;
  const projectedExpense = dailyExpense * daysInMonth;
  const projectedBalance = totalIncome - projectedExpense;

  return {
    txCount: cur.length,
    txCountLastMonth: prev.length,
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    totalIncomeLastMonth,
    totalExpenseLastMonth,
    balanceLastMonth: totalIncomeLastMonth - totalExpenseLastMonth,
    topCategories,
    categoryDelta,
    budgetWarnings,
    daysIntoMonth,
    daysInMonth,
    projectedBalance: Math.round(projectedBalance * 100) / 100,
  };
}

function fmtBRL(n: number): string {
  return `R$ ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".").replace(".", ",").replace(/(\d),(\d{3})/g, "$1.$2")}`;
}

// Fallback determinístico — usado quando user tem dados parciais (1-4 tx) ou
// quando IA falha. Evita exposição de prompt vazio/erro.
function buildFallbackText(s: FinancialSnapshot, userName: string | null): string {
  const greeting = userName ? `${userName}, ` : "";
  if (s.txCount === 0) {
    return (
      `${greeting}você ainda não registrou nenhuma transação esse mês. ` +
      `Comece registrando seus gastos pelo WhatsApp — ex: _"gastei 50 no mercado"_ ou _"recebi 2.000 do cliente"_.`
    );
  }
  if (s.txCount < 5) {
    return (
      `${greeting}você registrou ${s.txCount} ${s.txCount === 1 ? "transação" : "transações"} esse mês. ` +
      `Continue registrando seus gastos pelo WhatsApp pra eu te dar análises mais ricas.`
    );
  }
  // Resumo determinístico baseado em dados
  const balSign = s.balance >= 0 ? "positivo em" : "negativo em";
  const top = s.topCategories[0];
  const projection = s.projectedBalance >= 0 ? `${fmtBRL(s.projectedBalance)} positivos` : `${fmtBRL(Math.abs(s.projectedBalance))} negativos`;
  let line = `Seu saldo do mês está ${balSign} ${fmtBRL(Math.abs(s.balance))}.`;
  if (top) line += ` Maior gasto: ${top.category} (${fmtBRL(top.amount)}).`;
  line += ` Projeção fim do mês: ~${projection}.`;
  return line;
}

async function generateAIInsight(s: FinancialSnapshot, userName: string | null): Promise<string> {
  // Decide explicitamente se deve comparar com mês anterior
  const hasPrevMonthData = s.txCountLastMonth >= 3 && (s.totalIncomeLastMonth > 0 || s.totalExpenseLastMonth > 0);

  // Monta prompt com flags explícitas pra IA não inventar
  const lines: string[] = [];
  lines.push(`Saldo do mês corrente: ${fmtBRL(s.balance)} ${s.balance >= 0 ? "(positivo)" : "(negativo)"}`);
  lines.push(`Receitas do mês: ${fmtBRL(s.totalIncome)}`);
  lines.push(`Gastos do mês: ${fmtBRL(s.totalExpense)}`);
  lines.push(`Total de transações no mês: ${s.txCount}`);

  if (hasPrevMonthData) {
    lines.push(`--- Mês anterior (DADOS DISPONÍVEIS) ---`);
    lines.push(`Saldo do mês anterior: ${fmtBRL(s.balanceLastMonth)}`);
    lines.push(`Receitas do mês anterior: ${fmtBRL(s.totalIncomeLastMonth)}`);
    lines.push(`Gastos do mês anterior: ${fmtBRL(s.totalExpenseLastMonth)}`);
    lines.push(`Total de transações no mês anterior: ${s.txCountLastMonth}`);
  } else {
    lines.push(`--- Mês anterior: SEM DADOS SUFICIENTES (${s.txCountLastMonth} transações). NÃO COMPARE. ---`);
  }

  if (s.topCategories.length > 0) {
    lines.push(`Top categorias de GASTO: ${s.topCategories.map((c) => `${c.category} (${fmtBRL(c.amount)})`).join(", ")}`);
  }
  if (s.categoryDelta.length > 0 && hasPrevMonthData) {
    const movers = s.categoryDelta
      .filter((d) => d.deltaPct !== null && d.lastMonth >= 50)
      .slice(0, 2)
      .map((d) => `${d.category}: ${fmtBRL(d.thisMonth)} agora vs ${fmtBRL(d.lastMonth)} mês anterior (${(d.deltaPct! >= 0 ? "+" : "")}${d.deltaPct}%)`);
    if (movers.length > 0) lines.push(`Variações por categoria: ${movers.join(" | ")}`);
  }
  if (s.budgetWarnings.length > 0) {
    const w = s.budgetWarnings[0];
    lines.push(`Alerta orçamento: ${w.category} já usou ${w.usedPct}% do limite (${fmtBRL(w.spent)} de ${fmtBRL(w.limit)})`);
  }
  lines.push(`Projeção fim do mês (extrapolando ritmo atual): saldo ~${fmtBRL(s.projectedBalance)} (estamos no dia ${s.daysIntoMonth} de ${s.daysInMonth})`);

  const dataBlock = lines.map((l) => `- ${l}`).join("\n");

  const system = `Você é o Jarvis, assistente financeiro pessoal brasileiro. Gere um resumo curto e factual em português.

REGRAS CRÍTICAS — NUNCA QUEBRAR:
1. SOMENTE use os dados fornecidos abaixo. NUNCA invente, suponha ou estime números que não estão nos dados.
2. Se o input diz "SEM DADOS SUFICIENTES" pro mês anterior, NÃO faça comparação. NUNCA diga "redução vs mês anterior" / "aumentou vs mês anterior" / "melhor que mês passado". Simplesmente NÃO mencione mês anterior.
3. NÃO confunda saldo (entradas - gastos) com gastos. Saldo positivo é DINHEIRO QUE SOBROU, não gasto.
4. Se saldo é positivo, NUNCA diga "redução" ou "queda" — é dinheiro sobrando, não dinheiro perdido.

REGRAS DE FORMATO:
- 2 a 3 frases, MÁXIMO 280 caracteres no total.
- Tom sóbrio e profissional, sem empolgação. No máximo 1 emoji discreto (📈 📉 ou nenhum).
- NÃO comece com saudação. Vá direto ao ponto.
- Frase 1: status atual do saldo do mês (com valor exato).
- Frase 2: 1 insight relevante baseado nos dados (top categoria de gasto, OU alerta de orçamento se existir, OU variação de categoria SE houver dados do mês anterior).
- Frase 3 (opcional): projeção de fechamento ou recomendação prática.
- Use formato R$ X.XXX,XX (ponto pra milhar, vírgula pra decimal).`;

  const user = `${userName ? `Usuário: ${userName}\n\n` : ""}DADOS REAIS DO USUÁRIO:\n${dataBlock}\n\nGere o resumo APENAS com base nesses dados. Se não há dados do mês anterior, NÃO compare.`;

  const messages: ChatMessage[] = [{ role: "user", content: user }];
  const text = await chatWithProvider(messages, system, false, "generate-financial-insight");
  return text.trim().slice(0, 320);
}

async function buildInsight(userId: string): Promise<InsightState> {
  // Busca display_name pra personalizar
  let userName: string | null = null;
  try {
    const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    userName = (data as { display_name?: string } | null)?.display_name?.split(" ")[0] ?? null;
  } catch { /* silent */ }

  const snapshot = await buildSnapshot(userId);

  if (snapshot.txCount === 0) {
    return { state: "empty", text: buildFallbackText(snapshot, userName), snapshot };
  }
  if (snapshot.txCount < 5) {
    return { state: "partial", text: buildFallbackText(snapshot, userName), snapshot };
  }

  // Tenta IA; se falhar, fallback determinístico (não quebra o card)
  try {
    const aiText = await generateAIInsight(snapshot, userName);
    if (aiText && aiText.length > 20) {
      return { state: "rich", text: aiText, snapshot };
    }
    console.warn("[generate-financial-insight] AI returned empty/short text, using fallback");
    return { state: "rich", text: buildFallbackText(snapshot, userName), snapshot };
  } catch (e) {
    console.error("[generate-financial-insight] AI error, using fallback:", e);
    return { state: "rich", text: buildFallbackText(snapshot, userName), snapshot };
  }
}

async function saveCache(userId: string, insight: InsightState): Promise<void> {
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // +4h
  const { error } = await (supabase
    .from("financial_insights_cache" as any)
    .upsert({
      user_id: userId,
      insight_text: insight.text,
      data_snapshot: insight.snapshot as unknown as Record<string, unknown>,
      generated_at: new Date().toISOString(),
      expires_at: expiresAt,
    } as any, { onConflict: "user_id" }) as any);
  if (error) console.error("[generate-financial-insight] saveCache error:", error.message);
}

async function readCache(userId: string): Promise<{ text: string; generated_at: string; expired: boolean } | null> {
  const { data } = await (supabase
    .from("financial_insights_cache" as any)
    .select("insight_text, generated_at, expires_at")
    .eq("user_id", userId)
    .maybeSingle() as any);
  if (!data) return null;
  const row = data as { insight_text: string; generated_at: string; expires_at: string };
  const expired = new Date(row.expires_at).getTime() < Date.now();
  return { text: row.insight_text, generated_at: row.generated_at, expired };
}

serve(async (req) => {
  const CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Auth: pega user via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const isPost = req.method === "POST";
  const forceRefresh = isPost; // POST = força regeneração (botão "Atualizar")

  try {
    // Tenta cache primeiro (a menos que force refresh)
    if (!forceRefresh) {
      const cached = await readCache(user.id);
      if (cached && !cached.expired) {
        return new Response(
          JSON.stringify({
            insight: cached.text,
            generated_at: cached.generated_at,
            from_cache: true,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    }

    // Gera novo insight
    const insight = await buildInsight(user.id);
    await saveCache(user.id, insight);

    return new Response(
      JSON.stringify({
        insight: insight.text,
        generated_at: new Date().toISOString(),
        state: insight.state,
        from_cache: false,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[generate-financial-insight] fatal:", errMsg);
    return new Response(
      JSON.stringify({ error: "Falha ao gerar insight", detail: errMsg }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
