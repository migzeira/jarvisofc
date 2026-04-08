/**
 * send-report
 * Chamado via pg_cron (toda segunda 08:00 e todo dia 1 08:00).
 * Envia relatório financeiro via WhatsApp para todos os usuários ativos
 * que têm phone_number cadastrado.
 *
 * Query param: ?type=weekly | ?type=monthly
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendImage } from "../_shared/evolution.ts";
import { generateExpenseChartUrl } from "../_shared/chart.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  // Segurança: só aceita chamadas com o service role ou secret interno
  const authHeader = req.headers.get("Authorization") ?? "";
  const internalSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(internalSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") as "weekly" | "monthly" || "weekly";

  const now = new Date();
  let startDate: string;
  let periodLabel: string;

  if (type === "monthly") {
    // Mês anterior
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const endMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const endDate = endMonth.toISOString().split("T")[0];
    periodLabel = lastMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    await sendReports(startDate, endDate, periodLabel, "📊 *Relatório Mensal*");
  } else {
    // Semana anterior (segunda a domingo)
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() - 6); // semana passada
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    startDate = monday.toISOString().split("T")[0];
    const endDate = sunday.toISOString().split("T")[0];

    const monStr = monday.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    const sunStr = sunday.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    periodLabel = `${monStr} a ${sunStr}`;

    await sendReports(startDate, endDate, periodLabel, "📊 *Relatório Semanal*");
  }

  return new Response(JSON.stringify({ ok: true, type }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function sendReports(startDate: string, endDate: string, periodLabel: string, title: string) {
  // Busca todos os usuários ativos com phone_number
  const { data: users } = await supabase
    .from("profiles")
    .select("id, phone_number, display_name")
    .eq("account_status", "active")
    .not("phone_number", "is", null);

  if (!users?.length) return;

  for (const user of users) {
    try {
      const { data: tx } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .gte("transaction_date", startDate)
        .lte("transaction_date", endDate);

      if (!tx?.length) continue; // Sem transações → não envia

      const expenses = tx.filter(t => t.type === "expense");
      const incomes = tx.filter(t => t.type === "income");
      const totalExpense = expenses.reduce((s, t) => s + Number(t.amount), 0);
      const totalIncome = incomes.reduce((s, t) => s + Number(t.amount), 0);
      const balance = totalIncome - totalExpense;

      // Top categorias
      const byCategory: Record<string, number> = {};
      for (const t of expenses) {
        byCategory[t.category] = (byCategory[t.category] ?? 0) + Number(t.amount);
      }
      const catEmojis: Record<string, string> = {
        alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
        lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
      };
      const topCats = Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([cat, val]) => `${catEmojis[cat] ?? "📌"} ${cat}: *R$ ${val.toFixed(2).replace(".", ",")}*`)
        .join("\n");

      const name = user.display_name?.split(" ")[0] || "você";
      const balanceSign = balance >= 0 ? "+" : "";

      let msg = `${title} — ${periodLabel}\n\n`;
      msg += `Olá, ${name}! Aqui está seu resumo:\n\n`;
      msg += `🔴 Gastos: *R$ ${totalExpense.toFixed(2).replace(".", ",")}*\n`;
      if (totalIncome > 0) {
        msg += `🟢 Receitas: *R$ ${totalIncome.toFixed(2).replace(".", ",")}*\n`;
      }
      msg += `💰 Saldo: *${balanceSign}R$ ${balance.toFixed(2).replace(".", ",")}*\n`;
      if (topCats) msg += `\n📂 *Por categoria:*\n${topCats}\n`;

      // Adiciona status de orcamentos
      try {
        const { data: userBudgets } = await supabase
          .from("budgets")
          .select("category, amount_limit")
          .eq("user_id", user.id);
        if (userBudgets?.length) {
          let budgetLines = "";
          for (const b of userBudgets) {
            const spent = byCategory[b.category] ?? 0;
            if (spent <= 0) continue;
            const limit = Number(b.amount_limit);
            const pct = limit > 0 ? (spent / limit) * 100 : 0;
            const bar = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
            budgetLines += `\n${bar} ${b.category}: ${pct.toFixed(0)}% do limite`;
          }
          if (budgetLines) msg += `\n🎯 *Orçamentos:*${budgetLines}\n`;
        }
      } catch { /* skip budget info */ }

      msg += `\n📱 Ver detalhes no app MayaChat`;

      const phone = user.phone_number.replace(/\D/g, "");

      // Envia grafico antes do texto (se houver gastos)
      if (totalExpense > 0) {
        try {
          const chartUrl = await generateExpenseChartUrl({
            byCategory,
            periodLabel,
            totalExpense,
          });
          if (chartUrl) {
            await sendImage(phone, chartUrl, "", true);
          }
        } catch (chartErr) {
          console.error(`Chart error for ${user.id}:`, chartErr);
        }
      }

      await sendText(phone, msg);
    } catch (e) {
      console.error(`Error sending report to ${user.id}:`, e);
    }
  }
}
