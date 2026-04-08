/**
 * insights-analyzer
 * Analisa padroes nos dados acumulados e envia insights proativos via WhatsApp.
 * Chamado pelo pg_cron toda segunda-feira as 11:00 UTC (08:00 BRT).
 *
 * Detecta automaticamente:
 * 1. Categoria com gasto aumentado/reduzido > 25% vs mes anterior
 * 2. Dia da semana com gasto acima de 50% da media geral (min 4 semanas de dados)
 * 3. Dia da semana com alta taxa de cancelamento de eventos (>= 50%, min 4 eventos)
 * 4. Habito com queda de streak > 3 dias sem check-in
 * 5. Receita vs Despesa: saldo negativo no mes atual
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CLAUDE_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLAUDE_MODEL = "claude-haiku-4-5";

const WEEKDAY_PT = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
const WEEKDAY_PT_ACC = ["domingos", "segundas", "tercas", "quartas", "quintas", "sextas", "sabados"];

const CATEGORY_PT: Record<string, string> = {
  alimentacao: "alimentacao",
  transporte: "transporte",
  moradia: "moradia",
  saude: "saude",
  lazer: "lazer",
  educacao: "educacao",
  trabalho: "trabalho",
  outros: "outros",
};

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: tz });
}

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function formatPct(value: number): string {
  return `${Math.abs(Math.round(value))}%`;
}

// ── Insight types ─────────────────────────────────────────────────────────────

interface InsightResult {
  type: string;
  severity: "info" | "warning" | "alert";
  message: string;
  data: Record<string, unknown>;
}

// ── Pattern Detectors ─────────────────────────────────────────────────────────

/**
 * Detecta categorias com variacao significativa vs periodo anterior.
 * Compara os ultimos 30 dias com os 30 dias anteriores.
 */
async function detectCategoryTrends(
  userId: string,
  minChangePct = 25
): Promise<InsightResult[]> {
  const insights: InsightResult[] = [];
  const now = new Date();

  const d30 = new Date(now); d30.setDate(now.getDate() - 30);
  const d60 = new Date(now); d60.setDate(now.getDate() - 60);

  const currentStart = d30.toLocaleDateString("sv-SE");
  const previousStart = d60.toLocaleDateString("sv-SE");
  const today = now.toLocaleDateString("sv-SE");

  const [{ data: curr }, { data: prev }] = await Promise.all([
    supabase.from("transactions")
      .select("category, amount")
      .eq("user_id", userId).eq("type", "expense")
      .gte("transaction_date", currentStart)
      .lte("transaction_date", today),
    supabase.from("transactions")
      .select("category, amount")
      .eq("user_id", userId).eq("type", "expense")
      .gte("transaction_date", previousStart)
      .lt("transaction_date", currentStart),
  ]);

  if (!curr?.length && !prev?.length) return insights;

  // Agrupa por categoria
  const sumBy = (rows: { category: string; amount: unknown }[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.category] = (m[r.category] ?? 0) + Number(r.amount);
    return m;
  };

  const currMap = sumBy(curr ?? []);
  const prevMap = sumBy(prev ?? []);

  // Todas as categorias presentes em algum periodo
  const cats = new Set([...Object.keys(currMap), ...Object.keys(prevMap)]);

  for (const cat of cats) {
    const c = currMap[cat] ?? 0;
    const p = prevMap[cat] ?? 0;

    // Precisa ter ao menos R$ 30 gasto em um dos periodos para ser relevante
    if (c < 30 && p < 30) continue;

    // Categoria nova (zero antes) — so alerta se gasto > R$ 50
    if (p === 0 && c >= 50) {
      insights.push({
        type: "category_new",
        severity: "info",
        message: `Percebi que voce comecou a gastar com *${CATEGORY_PT[cat] ?? cat}* este mes: ${formatBRL(c)}.`,
        data: { cat, currentAmount: c },
      });
      continue;
    }

    if (p === 0) continue;

    const changePct = ((c - p) / p) * 100;

    if (Math.abs(changePct) >= minChangePct) {
      const direction = changePct > 0 ? "aumentaram" : "diminuiram";
      const emoji = changePct > 0 ? (changePct >= 50 ? "🔴" : "🟡") : "🟢";
      const severity: InsightResult["severity"] = changePct >= 50 ? "alert" : changePct >= 25 ? "warning" : "info";

      insights.push({
        type: "category_trend",
        severity,
        message: `${emoji} Seus gastos com *${CATEGORY_PT[cat] ?? cat}* ${direction} *${formatPct(changePct)}%* — de ${formatBRL(p)} para ${formatBRL(c)} nos ultimos 30 dias.`,
        data: { cat, currentAmount: c, previousAmount: p, changePct },
      });
    }
  }

  // Ordena por severidade (alert > warning > info) e magnitude
  insights.sort((a, b) => {
    const order = { alert: 0, warning: 1, info: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    const ma = Math.abs((a.data.changePct as number) ?? 0);
    const mb = Math.abs((b.data.changePct as number) ?? 0);
    return mb - ma;
  });

  return insights;
}

/**
 * Detecta dia da semana com gasto medio significativamente acima da media geral.
 * Usa os ultimos 56 dias (8 semanas) para ter ao menos 4 pontos por dia.
 */
async function detectDayOfWeekSpikes(userId: string): Promise<InsightResult[]> {
  const insights: InsightResult[] = [];
  const now = new Date();
  const d56 = new Date(now); d56.setDate(now.getDate() - 56);
  const startDate = d56.toLocaleDateString("sv-SE");
  const today = now.toLocaleDateString("sv-SE");

  const { data: expenses } = await supabase
    .from("transactions")
    .select("amount, transaction_date")
    .eq("user_id", userId).eq("type", "expense")
    .gte("transaction_date", startDate)
    .lte("transaction_date", today);

  if (!expenses?.length || expenses.length < 10) return insights;

  // Acumula gasto e count por dia da semana
  const daySum: number[] = Array(7).fill(0);
  const dayCount: number[] = Array(7).fill(0);

  for (const t of expenses) {
    const dow = new Date(t.transaction_date + "T12:00:00").getDay();
    daySum[dow] += Number(t.amount);
    dayCount[dow]++;
  }

  // Media por ocorrencia do dia (ex: media de todas as segundas)
  const dayAvg: number[] = daySum.map((s, i) => dayCount[i] >= 3 ? s / dayCount[i] : 0);

  // Media geral por dia (total gasto / total de dias com transacao)
  const daysWithData = dayCount.filter(c => c > 0).length;
  if (daysWithData === 0) return insights;

  const totalSpent = daySum.reduce((a, b) => a + b, 0);
  const totalDayInstances = dayCount.reduce((a, b) => a + b, 0);
  const overallDailyAvg = totalSpent / totalDayInstances;

  if (overallDailyAvg < 20) return insights; // Media muito baixa, nao relevante

  for (let dow = 0; dow < 7; dow++) {
    if (dayCount[dow] < 3) continue; // Precisa de pelo menos 3 ocorrencias
    const avg = dayAvg[dow];
    if (avg <= 0) continue;

    const ratioPct = ((avg - overallDailyAvg) / overallDailyAvg) * 100;

    if (ratioPct >= 50) {
      insights.push({
        type: "day_spike",
        severity: ratioPct >= 100 ? "alert" : "warning",
        message: `📊 Nas *${WEEKDAY_PT_ACC[dow]}* voce gasta em media *${formatBRL(avg)}* — ${formatPct(ratioPct)}% acima da sua media diaria de ${formatBRL(overallDailyAvg)}.`,
        data: { dow, dayAvg: avg, overallAvg: overallDailyAvg, ratioPct },
      });
    }
  }

  return insights;
}

/**
 * Detecta dia da semana com alta taxa de cancelamento de eventos.
 * Usa os ultimos 90 dias, precisa de ao menos 4 eventos no dia.
 */
async function detectCancellationPatterns(userId: string): Promise<InsightResult[]> {
  const insights: InsightResult[] = [];
  const now = new Date();
  const d90 = new Date(now); d90.setDate(now.getDate() - 90);
  const startDate = d90.toLocaleDateString("sv-SE");
  const today = now.toLocaleDateString("sv-SE");

  const { data: events } = await supabase
    .from("events")
    .select("status, event_date")
    .eq("user_id", userId)
    .gte("event_date", startDate)
    .lte("event_date", today);

  if (!events?.length || events.length < 8) return insights;

  // Conta total e cancelados por dia da semana
  const dayTotal: number[] = Array(7).fill(0);
  const dayCancelled: number[] = Array(7).fill(0);

  for (const ev of events) {
    const dow = new Date(ev.event_date + "T12:00:00").getDay();
    dayTotal[dow]++;
    if (ev.status === "cancelled") dayCancelled[dow]++;
  }

  for (let dow = 0; dow < 7; dow++) {
    if (dayTotal[dow] < 4) continue; // Precisa de volume suficiente
    const rate = dayCancelled[dow] / dayTotal[dow];
    if (rate >= 0.5) {
      const cancelCount = dayCancelled[dow];
      const totalCount = dayTotal[dow];
      insights.push({
        type: "cancellation_pattern",
        severity: rate >= 0.7 ? "alert" : "warning",
        message: `📅 Voce cancela *${cancelCount} de cada ${totalCount}* compromissos agendados nas *${WEEKDAY_PT_ACC[dow]}*. Quer que eu evite agendar nesse dia?`,
        data: { dow, cancelCount, totalCount, rate },
      });
    }
  }

  return insights;
}

/**
 * Detecta habitos com streak quebrado recentemente (sem check-in por 3+ dias).
 */
async function detectBrokenHabitStreaks(userId: string): Promise<InsightResult[]> {
  const insights: InsightResult[] = [];
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE");
  const d7 = new Date(now); d7.setDate(now.getDate() - 7);
  const sevenDaysAgo = d7.toLocaleDateString("sv-SE");

  const { data: habits } = await supabase
    .from("habits")
    .select("id, name, current_streak, best_streak")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!habits?.length) return insights;

  for (const habit of habits) {
    if (habit.current_streak < 3) continue; // So alerta streaks que valiam a pena

    // Verifica ultimo check-in
    const { data: lastLog } = await supabase
      .from("habit_logs")
      .select("logged_date")
      .eq("habit_id", habit.id)
      .eq("user_id", userId)
      .order("logged_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastLog) continue;

    const lastDate = new Date(lastLog.logged_date + "T12:00:00");
    const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays >= 3) {
      insights.push({
        type: "habit_streak_at_risk",
        severity: diffDays >= 5 ? "alert" : "warning",
        message: `🔥 Seu habito *${habit.name}* esta ha *${diffDays} dias* sem check-in. Voce tinha um streak de ${habit.current_streak} dias — ainda da para retomar!`,
        data: { habitName: habit.name, currentStreak: habit.current_streak, daysMissed: diffDays },
      });
    }
  }

  return insights;
}

/**
 * Detecta saldo negativo no mes atual.
 */
async function detectNegativeBalance(userId: string): Promise<InsightResult[]> {
  const insights: InsightResult[] = [];
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toLocaleDateString("sv-SE");

  const { data: txs } = await supabase
    .from("transactions")
    .select("type, amount")
    .eq("user_id", userId)
    .gte("transaction_date", monthStart)
    .lte("transaction_date", today);

  if (!txs?.length) return insights;

  const income = txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const balance = income - expense;

  // So alerta se houver receita registrada E saldo negativo significativo
  if (income > 0 && balance < -50) {
    insights.push({
      type: "negative_balance",
      severity: "alert",
      message: `🔴 Atencao: seus gastos este mes (${formatBRL(expense)}) ja superam suas receitas registradas (${formatBRL(income)}). Saldo atual: *-${formatBRL(Math.abs(balance))}*.`,
      data: { income, expense, balance },
    });
  }

  return insights;
}

// ── Phrasing com Claude ────────────────────────────────────────────────────────

/**
 * Usa Claude Haiku para reescrever os insights de forma mais natural e personalizada.
 * Fallback: retorna os textos originais se Claude falhar.
 */
async function phraseInsightsWithAI(
  rawInsights: InsightResult[],
  userName: string
): Promise<string[]> {
  if (!CLAUDE_API_KEY || rawInsights.length === 0) {
    return rawInsights.map(i => i.message);
  }

  const insightTexts = rawInsights.map((i, idx) => `${idx + 1}. ${i.message}`).join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        messages: [{
          role: "user",
          content: `Voce e a Maya, assistente pessoal do ${userName}. Reescreva cada insight abaixo de forma mais natural, empática e conversacional em portugues brasileiro. Mantenha os numeros exatos. Use emojis dos originais. Cada insight em uma linha separada (sem numeros). Maximo 2 frases por insight.

${insightTexts}`,
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);

    const json = await res.json() as { content: Array<{ text: string }> };
    const text = json.content?.[0]?.text?.trim() ?? "";
    if (!text) throw new Error("Empty Claude response");

    // Divide por linhas nao vazias
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length >= rawInsights.length) return lines.slice(0, rawInsights.length);
    return rawInsights.map(i => i.message); // Fallback se formato inesperado
  } catch (err) {
    console.error("[insights-analyzer] Claude phrasing failed:", err);
    return rawInsights.map(i => i.message);
  }
}

// ── Deduplicação ──────────────────────────────────────────────────────────────

/**
 * Verifica quais tipos de insight ja foram enviados esta semana para evitar spam.
 */
async function filterAlreadySentThisWeek(
  userId: string,
  insights: InsightResult[]
): Promise<InsightResult[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentReminders } = await supabase
    .from("reminders")
    .select("message")
    .eq("user_id", userId)
    .eq("source", "insights_analyzer")
    .gte("sent_at", sevenDaysAgo.toISOString());

  if (!recentReminders?.length) return insights;

  // Filtra insights cujo tipo ja foi enviado esta semana
  const sentTypes = new Set(
    recentReminders
      .map(r => {
        try { return JSON.parse(r.message)?.type ?? ""; } catch { return ""; }
      })
      .filter(Boolean)
  );

  return insights.filter(i => !sentTypes.has(i.type + "_" + JSON.stringify(i.data).slice(0, 30)));
}

// ── Main serve ────────────────────────────────────────────────────────────────

serve(async (req) => {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  console.log(`[insights-analyzer] Running at UTC: ${new Date().toISOString()}`);

  const { data: users, error: usersErr } = await supabase
    .from("profiles")
    .select("id, phone_number, timezone")
    .eq("account_status", "active")
    .not("phone_number", "is", null);

  if (usersErr) {
    console.error("Error fetching users:", usersErr);
    return new Response(JSON.stringify({ error: usersErr.message }), { status: 500 });
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const user of users ?? []) {
    if (!user.phone_number) { skipped++; continue; }

    try {
      const { data: cfg } = await supabase
        .from("agent_configs")
        .select("user_nickname, daily_briefing_enabled, proactive_insights_enabled")
        .eq("user_id", user.id)
        .maybeSingle();

      // Respeita preferencia do usuario — se daily_briefing_enabled=false, pula insights tambem
      if (cfg?.daily_briefing_enabled === false) { skipped++; continue; }
      // Campo especifico para insights proativos (default: true)
      if (cfg?.proactive_insights_enabled === false) { skipped++; continue; }

      const userName = (cfg?.user_nickname as string) || "voce";
      const phone = (user.phone_number as string).replace(/\D/g, "");

      // ── Roda todos os detectores em paralelo ──
      const [categoryInsights, dayInsights, cancellationInsights, habitInsights, balanceInsights] =
        await Promise.all([
          detectCategoryTrends(user.id),
          detectDayOfWeekSpikes(user.id),
          detectCancellationPatterns(user.id),
          detectBrokenHabitStreaks(user.id),
          detectNegativeBalance(user.id),
        ]);

      // Combina e limita a 4 insights por usuario (prioriza severidade)
      let allInsights: InsightResult[] = [
        ...balanceInsights,           // Sempre primeiro (dinheiro)
        ...cancellationInsights,       // Comportamento
        ...categoryInsights,           // Financas por categoria
        ...dayInsights,                // Padrao dia da semana
        ...habitInsights,              // Habitos
      ];

      // Filtra duplicatas desta semana
      allInsights = await filterAlreadySentThisWeek(user.id, allInsights);

      if (allInsights.length === 0) {
        console.log(`[insights-analyzer] No new insights for user ${user.id}`);
        skipped++;
        continue;
      }

      // Limita a 3 insights por envio (para nao sobrecarregar)
      const topInsights = allInsights.slice(0, 3);

      // Reformula com IA
      const phrasedInsights = await phraseInsightsWithAI(topInsights, userName);

      // Monta mensagem final
      const lines: string[] = [];
      lines.push(`🔍 *Insights da semana, ${userName}*\n`);
      lines.push(`A Maya analisou seus dados e encontrou alguns padroes interessantes:\n`);

      for (const phrase of phrasedInsights) {
        lines.push(phrase);
        lines.push("");
      }

      lines.push(`_Quer detalhes sobre algum desses pontos? E so perguntar!_ 💡`);

      const message = lines.join("\n");
      await sendText(phone, message);

      // Registra envio (com tipo do primeiro insight para deduplicacao)
      for (const insight of topInsights) {
        await supabase.from("reminders").insert({
          user_id: user.id,
          whatsapp_number: user.phone_number,
          title: `Insight: ${insight.type}`,
          message: JSON.stringify({ type: insight.type + "_" + JSON.stringify(insight.data).slice(0, 30) }),
          send_at: new Date().toISOString(),
          recurrence: "none",
          source: "insights_analyzer",
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      }

      sent++;
      console.log(`[insights-analyzer] Sent ${topInsights.length} insights to user ${user.id}`);
    } catch (err) {
      failed++;
      console.error(`[insights-analyzer] Failed for user ${user.id}:`, err);
    }
  }

  const result = { sent, skipped, failed, date: todayInTz("America/Sao_Paulo") };
  console.log("[insights-analyzer] Done:", result);
  return new Response(JSON.stringify(result));
});
