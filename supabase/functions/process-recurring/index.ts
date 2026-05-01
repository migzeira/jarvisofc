/**
 * process-recurring
 * Chamado via pg_cron diariamente às 06:00.
 * Processa transações recorrentes que vencem hoje ou antes.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const internalSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(internalSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];
  let processed = 0;

  // Busca todas as recorrentes ativas com next_date <= hoje
  const { data: recurring } = await supabase
    .from("recurring_transactions")
    .select("*, profiles(phone_number, display_name)")
    .eq("active", true)
    .lte("next_date", today);

  for (const rec of recurring ?? []) {
    try {
      // Cria a transação — preserva sent_by_phone do recorrente original
      // pra atribuir corretamente no plano casal (se aluguel é do partner,
      // a transação mensal gerada também deve aparecer como dele).
      await supabase.from("transactions").insert({
        user_id: rec.user_id,
        description: rec.description,
        amount: rec.amount,
        type: rec.type,
        category: rec.category,
        transaction_date: rec.next_date,
        source: "recurring",
        sent_by_phone: rec.sent_by_phone ?? null,
      } as any);

      // Calcula próxima data — preserva day_of_month original pra não pular meses
      const next = calcNextDate(rec.next_date, rec.frequency, rec.day_of_month);
      await supabase
        .from("recurring_transactions")
        .update({ next_date: next, last_processed: today })
        .eq("id", rec.id);

      // Notifica o usuário via WhatsApp (se tiver número)
      const phone = rec.profiles?.phone_number?.replace(/\D/g, "");
      if (phone) {
        const emoji = rec.type === "expense" ? "🔴" : "🟢";
        const typeLabel = rec.type === "expense" ? "Gasto" : "Receita";
        await sendText(phone,
          `${emoji} *${typeLabel} recorrente registrado!*\n📝 ${rec.description}\n💰 R$ ${Number(rec.amount).toFixed(2).replace(".", ",")}\n🔁 Próxima: ${formatDate(next)}`
        );

        // ── Verifica orçamento e alerta se estourou (só pra gastos) ──
        // Antes não era chamado — aluguel de R$3000 estourava budget de moradia
        // R$2000 sem avisar o cliente.
        if (rec.type === "expense") {
          await checkBudgetAlertForCategory(rec.user_id, phone, rec.category).catch(err =>
            console.error(`[budget-alert] Error for ${rec.user_id}:`, err)
          );
        }
      }

      processed++;
    } catch (e) {
      console.error(`Error processing recurring ${rec.id}:`, e);
    }
  }

  // Limpeza de dedup atômico: remove entradas mais antigas que 48h
  // (evita crescimento ilimitado da tabela processed_messages)
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { count: cleaned } = await (supabase as any)
      .from("processed_messages")
      .delete()
      .lt("created_at", cutoff)
      .select("*", { count: "exact", head: true });
    console.log(`[dedup-cleanup] Removed ${cleaned ?? 0} old processed_messages entries`);
  } catch (e) {
    console.warn("[dedup-cleanup] cleanup failed (non-fatal):", e);
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});

function calcNextDate(currentDate: string, frequency: string, dayOfMonth: number | null = null): string {
  const d = new Date(currentDate + "T12:00:00");
  switch (frequency) {
    case "daily":   d.setDate(d.getDate() + 1); break;
    case "weekly":  d.setDate(d.getDate() + 7); break;
    case "monthly": {
      // Vai pro primeiro dia do próximo mês e aplica o dia desejado (com fallback ao último dia válido)
      // Sem isso, setMonth() pode pular meses inteiros (ex: 31 Jan + 1 = 3 Mar, pulou fev).
      const target = dayOfMonth ?? d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(target, lastDay));
      break;
    }
    case "yearly":  d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "numeric", month: "long",
  });
}

/**
 * Verifica se uma categoria estourou o orçamento do mês e envia alerta no WhatsApp.
 * Versão simplificada do checkBudgetAlerts do whatsapp-webhook — replica a mesma
 * lógica pra transações recorrentes (antes não era chamado).
 */
async function checkBudgetAlertForCategory(
  userId: string,
  phone: string,
  category: string,
): Promise<void> {
  const { data: budget } = await supabase
    .from("budgets")
    .select("*")
    .eq("user_id", userId)
    .eq("category", category)
    .maybeSingle();

  if (!budget) return;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const todayStr = now.toISOString().split("T")[0];

  if (budget.last_alert_date === todayStr) return; // já alertou hoje

  const { data: monthTx } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("type", "expense")
    .eq("category", category)
    .gte("transaction_date", monthStart);

  const totalSpent = (monthTx ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const limit = Number(budget.amount_limit);
  const pct = limit > 0 ? (totalSpent / limit) * 100 : 0;
  const alertThreshold = Number(budget.alert_at_percent) || 80;

  const catEmojis: Record<string, string> = {
    alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
    lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
  };
  const emoji = catEmojis[category] ?? "📌";
  const catName = category.charAt(0).toUpperCase() + category.slice(1);

  let alertMsg = "";
  if (pct >= 100) {
    const excess = totalSpent - limit;
    alertMsg = `🚨 *Orçamento estourado!*\n\n${emoji} *${catName}*: R$ ${totalSpent.toFixed(2).replace(".", ",")} de R$ ${limit.toFixed(2).replace(".", ",")}\n💸 Excedeu *R$ ${excess.toFixed(2).replace(".", ",")}*\n\n_Transação recorrente fez a categoria estourar o limite este mês._`;
  } else if (pct >= alertThreshold) {
    const remaining = limit - totalSpent;
    alertMsg = `⚠️ *Atenção com o orçamento!*\n\n${emoji} *${catName}*: R$ ${totalSpent.toFixed(2).replace(".", ",")} de R$ ${limit.toFixed(2).replace(".", ",")} (*${pct.toFixed(0)}%*)\n💰 Resta *R$ ${remaining.toFixed(2).replace(".", ",")}* este mês.`;
  }

  if (alertMsg) {
    await sendText(phone, alertMsg);
    await supabase
      .from("budgets")
      .update({ last_alert_date: todayStr })
      .eq("id", budget.id);
  }
}
