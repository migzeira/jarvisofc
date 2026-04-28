/**
 * weekly-briefing
 * Chamado pelo pg_cron aos domingos as 23:00 UTC (20:00 BRT).
 * Envia resumo visual da semana (grafico + texto) com:
 * - Gastos da semana (grafico de barras por dia)
 * - Compromissos cumpridos vs cancelados
 * - Notas salvas
 * - Habitos completados
 * - Score de produtividade
 * - Agenda da proxima semana
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendImage } from "../_shared/evolution.ts";
import { generateWeeklySummaryChartUrl } from "../_shared/chart.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const EVENT_TYPE_EMOJIS: Record<string, string> = {
  compromisso: "📌", reuniao: "🤝", consulta: "🏥", evento: "🎉", tarefa: "✏️",
};

const WEEKDAY_PT = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: tz });
}

/** Range da semana que PASSOU (segunda passada a domingo) */
function lastWeekRange(tz: string): { startDate: string; endDate: string } {
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const dayOfWeek = nowLocal.getDay(); // 0=dom
  const lastSunday = new Date(nowLocal);
  lastSunday.setDate(nowLocal.getDate() - (dayOfWeek === 0 ? 0 : dayOfWeek));
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  return {
    startDate: lastMonday.toLocaleDateString("sv-SE"),
    endDate: lastSunday.toLocaleDateString("sv-SE"),
  };
}

/** Range da proxima semana */
function nextWeekRange(tz: string): { startDate: string; endDate: string; nextMonday: Date; nextSunday: Date } {
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const daysUntilMonday = ((8 - nowLocal.getDay()) % 7) || 7;
  const nextMonday = new Date(nowLocal);
  nextMonday.setDate(nowLocal.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  return {
    startDate: nextMonday.toLocaleDateString("sv-SE"),
    endDate: nextSunday.toLocaleDateString("sv-SE"),
    nextMonday, nextSunday,
  };
}

serve(async (req) => {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  console.log(`[weekly-briefing] Running at UTC: ${new Date().toISOString()}`);

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
        .select("user_nickname, daily_briefing_enabled, language")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cfg?.daily_briefing_enabled === false) { skipped++; continue; }

      const userTz = (user.timezone as string) || "America/Sao_Paulo";
      const userName = (cfg?.user_nickname as string) || "voce";
      const locale = "pt-BR";

      // ── Dados da semana que PASSOU ──
      const lastWeek = lastWeekRange(userTz);
      const nextWeek = nextWeekRange(userTz);

      // Transacoes da semana passada
      const { data: transactions } = await supabase
        .from("transactions")
        .select("amount, type, category, transaction_date")
        .eq("user_id", user.id)
        .gte("transaction_date", lastWeek.startDate)
        .lte("transaction_date", lastWeek.endDate);

      const expenses = (transactions ?? []).filter(t => t.type === "expense");
      const incomes = (transactions ?? []).filter(t => t.type === "income");
      const totalExpense = expenses.reduce((s, t) => s + Number(t.amount), 0);
      const totalIncome = incomes.reduce((s, t) => s + Number(t.amount), 0);

      // Gastos por dia da semana
      const dailyMap: Record<string, number> = {};
      for (const t of expenses) {
        const dayIdx = new Date(t.transaction_date + "T12:00:00").getDay();
        const dayLabel = WEEKDAY_SHORT[dayIdx];
        dailyMap[dayLabel] = (dailyMap[dayLabel] ?? 0) + Number(t.amount);
      }
      const dailyExpenses = WEEKDAY_SHORT.map(d => ({ day: d, amount: dailyMap[d] ?? 0 }));

      // Gastos por categoria
      const byCategory: Record<string, number> = {};
      for (const t of expenses) {
        byCategory[t.category] = (byCategory[t.category] ?? 0) + Number(t.amount);
      }

      // Eventos da semana passada
      const { data: pastEvents } = await supabase
        .from("events")
        .select("title, status")
        .eq("user_id", user.id)
        .gte("event_date", lastWeek.startDate)
        .lte("event_date", lastWeek.endDate);

      const eventsCount = pastEvents?.length ?? 0;
      const eventsDone = (pastEvents ?? []).filter(e => e.status === "done").length;
      const eventsCancelled = (pastEvents ?? []).filter(e => e.status === "cancelled").length;

      // Notas da semana
      const { data: notes } = await supabase
        .from("notes")
        .select("id")
        .eq("user_id", user.id)
        .gte("created_at", `${lastWeek.startDate}T00:00:00Z`)
        .lte("created_at", `${lastWeek.endDate}T23:59:59Z`);
      const notesCount = notes?.length ?? 0;

      // Habitos da semana
      const { data: habitLogs } = await supabase
        .from("habit_logs")
        .select("id")
        .eq("user_id", user.id)
        .gte("logged_date", lastWeek.startDate)
        .lte("logged_date", lastWeek.endDate);
      const habitsCompleted = habitLogs?.length ?? 0;

      const { data: activeHabits } = await supabase
        .from("habits")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true);
      const habitsTotal = (activeHabits?.length ?? 0) * 7; // 7 dias

      // Orcamentos
      const { data: budgets } = await supabase
        .from("budgets")
        .select("category, amount_limit")
        .eq("user_id", user.id);

      // Score de produtividade
      const eventScore = eventsCount > 0 ? Math.round((eventsDone / eventsCount) * 100) : 100;
      const habitScore = habitsTotal > 0 ? Math.round((habitsCompleted / habitsTotal) * 100) : 100;
      const productivityScore = Math.round((eventScore + habitScore) / 2);

      // ── Periodo formatado ──
      const monStr = new Date(lastWeek.startDate + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });
      const sunStr = new Date(lastWeek.endDate + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });
      const periodLabel = `${monStr} a ${sunStr}`;

      // ── Gera grafico ──
      const phone = user.phone_number.replace(/\D/g, "");
      try {
        const chartUrl = await generateWeeklySummaryChartUrl({
          dailyExpenses, totalExpense, totalIncome,
          eventsCount, eventsDone, eventsCancelled,
          notesCount, habitsCompleted, habitsTotal, periodLabel,
        });
        if (chartUrl) {
          await sendImage(phone, chartUrl, "", true);
        }
      } catch (chartErr) {
        console.error(`[weekly-briefing] Chart error for ${user.id}:`, chartErr);
      }

      // ── Monta texto ──
      const lines: string[] = [];
      lines.push(`📊 *Resumo Semanal — ${periodLabel}*`);
      lines.push(`Ola, ${userName}!\n`);

      // Financas
      if (totalExpense > 0 || totalIncome > 0) {
        lines.push(`💰 *Financas*`);
        if (totalExpense > 0) lines.push(`  🔴 Gastos: *R$ ${totalExpense.toFixed(2).replace(".", ",")}*`);
        if (totalIncome > 0) lines.push(`  🟢 Receitas: *R$ ${totalIncome.toFixed(2).replace(".", ",")}*`);
        const balance = totalIncome - totalExpense;
        const balSign = balance >= 0 ? "+" : "";
        lines.push(`  💵 Saldo: *${balSign}R$ ${balance.toFixed(2).replace(".", ",")}*`);

        // Top categorias
        const topCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const catEmojis: Record<string, string> = {
          alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
          lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
        };
        if (topCats.length > 0) {
          lines.push(`  📂 Top: ${topCats.map(([c, v]) => `${catEmojis[c] ?? "📌"}${c} R$${v.toFixed(0)}`).join(" | ")}`);
        }

        // Orcamentos
        if (budgets?.length) {
          let budgetLines = "";
          for (const b of budgets) {
            const spent = byCategory[b.category] ?? 0;
            if (spent <= 0) continue;
            const pct = Number(b.amount_limit) > 0 ? Math.round((spent / Number(b.amount_limit)) * 100) : 0;
            const bar = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
            budgetLines += `\n  ${bar} ${b.category}: ${pct}% do limite`;
          }
          if (budgetLines) lines.push(`  🎯 *Orcamentos:*${budgetLines}`);
        }
        lines.push("");
      }

      // Compromissos
      if (eventsCount > 0) {
        lines.push(`📅 *Compromissos*`);
        lines.push(`  ✅ Concluidos: ${eventsDone} | ❌ Cancelados: ${eventsCancelled} | 📋 Total: ${eventsCount}`);
        lines.push("");
      }

      // Notas
      if (notesCount > 0) {
        lines.push(`📝 *Notas salvas:* ${notesCount}`);
      }

      // Proxima semana preview
      const { data: nextEvents } = await supabase
        .from("events")
        .select("title, event_date, event_time, event_type")
        .eq("user_id", user.id)
        .gte("event_date", nextWeek.startDate)
        .lte("event_date", nextWeek.endDate)
        .neq("status", "cancelled")
        .order("event_date").order("event_time")
        .limit(5);

      if (nextEvents?.length) {
        lines.push("");
        lines.push(`📅 *Proxima semana (${nextEvents.length} compromisso${nextEvents.length > 1 ? "s" : ""})*`);
        for (const ev of nextEvents) {
          const d = new Date(ev.event_date + "T12:00:00");
          const dayName = WEEKDAY_SHORT[d.getDay()];
          const emoji = EVENT_TYPE_EMOJIS[ev.event_type] ?? "📌";
          const time = ev.event_time ? ` ${ev.event_time.slice(0, 5)}` : "";
          lines.push(`  ${emoji} ${dayName}${time} — ${ev.title}`);
        }
      }

      lines.push("");
      lines.push(`Tenha uma otima semana, ${userName}! 💪`);

      const message = lines.join("\n");
      await sendText(phone, message);

      // Registra envio
      await supabase.from("reminders").insert({
        user_id: user.id,
        whatsapp_number: user.phone_number,
        title: "Resumo semanal",
        message: message.slice(0, 500),
        send_at: new Date().toISOString(),
        recurrence: "none",
        source: "weekly_briefing",
        status: "sent",
        sent_at: new Date().toISOString(),
      });

      sent++;
      console.log(`[weekly-briefing] Sent to user ${user.id}`);
    } catch (err) {
      failed++;
      console.error(`[weekly-briefing] Failed for user ${user.id}:`, err);
    }
  }

  const result = { sent, skipped, failed, date: todayInTz("America/Sao_Paulo") };
  console.log("[weekly-briefing] Done:", result);
  return new Response(JSON.stringify(result));
});
