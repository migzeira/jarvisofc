/**
 * process-recurring
 * Chamado via pg_cron diariamente às 12:00 UTC (09:00 Brasília).
 *
 * MUDANÇA 2026-05-16: ANTES criava transação automaticamente no dia X
 * (silencioso, gerava gasto fantasma se user não pagou). AGORA pergunta
 * via WhatsApp e SÓ cria se user confirmar com "sim".
 *
 * Workflow (Opção C):
 *   1. Cron acha recurring com next_date <= hoje
 *   2. Se pending_status='idle': manda pergunta inicial + marca 'awaiting'
 *   3. Se pending_status='awaiting':
 *      • 7+ dias desde primeira pergunta → expira (pula esse ciclo, próximo mês)
 *      • 2+ dias desde última pergunta + ask_count<4 → re-pergunta
 *      • Caso contrário → silêncio até próximo cron
 *   4. UMA pergunta por user por execução (evita spam quando user tem várias
 *      recurring vencendo no mesmo dia)
 *
 * Respostas (tratadas em whatsapp-webhook, intent recurring_confirm):
 *   "sim" / "ok" / "paguei"      → cria tx + avança ciclo + reseta pending
 *   "ainda não" / "nao"           → mantém awaiting (cron vai re-perguntar em 2d)
 *   "pula" / "skip" / "já paguei" → avança ciclo SEM criar tx + reseta pending
 *
 * FALLBACK: se profile não tem phone_number, mantém comportamento antigo
 * (cria tx silenciosa) — não bloqueia users sem WhatsApp configurado.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const DAY_MS = 24 * 60 * 60 * 1000;
const RE_ASK_AFTER_DAYS = 2;     // re-pergunta depois de 2 dias sem resposta
const EXPIRE_AFTER_DAYS = 7;     // após 7 dias sem confirmar, pula esse ciclo
const MAX_ASK_COUNT = 4;         // teto de re-perguntas por ciclo

interface RecurringRow {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  type: "expense" | "income";
  category: string;
  frequency: string;
  next_date: string;
  last_processed: string | null;
  day_of_month: number | null;
  sent_by_phone: string | null;
  pending_status: "idle" | "awaiting";
  pending_first_asked_at: string | null;
  pending_last_asked_at: string | null;
  pending_ask_count: number;
  profiles: { phone_number: string | null; display_name: string | null } | null;
}

serve(async (req) => {
  // Auth: só aceita chamada com service_role (cron ou admin).
  // Supabase migrou pro formato sb_secret_* em 2026 — a env var
  // SUPABASE_SERVICE_ROLE_KEY agora aponta pra esse formato curto (41 chars).
  // Se o caller mandar JWT legacy (eyJ...), o includes() falha.
  // Solução: usar sempre a sb_secret_* no header Authorization.
  const authHeader = req.headers.get("Authorization") ?? "";
  const internalSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(internalSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();

  // Métricas pra response (debug + monitoramento)
  let processed = 0;        // tx criadas silenciosamente (fallback sem phone)
  let asked = 0;            // primeira pergunta enviada
  let reasked = 0;          // re-pergunta enviada
  let expired = 0;          // recurring expirados (pulou ciclo)
  let skipped = 0;          // ainda no período de espera (entre re-perguntas)

  // Busca todas as recurring ativas com next_date <= hoje
  const { data: recurringRaw } = await supabase
    .from("recurring_transactions")
    .select("*, profiles(phone_number, display_name)")
    .eq("active", true)
    .lte("next_date", today);

  const recurring = (recurringRaw ?? []) as RecurringRow[];

  // ── Passo 1: processa expirações em batch (não envia pergunta, só avança) ──
  const remaining: RecurringRow[] = [];
  for (const rec of recurring) {
    if (rec.pending_status === "awaiting" && rec.pending_first_asked_at) {
      const daysSinceFirst = Math.floor(
        (now.getTime() - new Date(rec.pending_first_asked_at).getTime()) / DAY_MS
      );
      if (daysSinceFirst >= EXPIRE_AFTER_DAYS) {
        try {
          await expireRecurring(rec);
          expired++;
        } catch (e) {
          console.error(`[expire] Error on ${rec.id}:`, e);
        }
        continue; // não entra no batch de perguntas
      }
    }
    remaining.push(rec);
  }

  // ── Passo 2: pra cada user, escolhe NO MÁXIMO UMA recurring pra perguntar ──
  // (evita spam quando user tem aluguel + assinaturas vencendo no mesmo dia)
  const byUser = new Map<string, RecurringRow[]>();
  for (const rec of remaining) {
    if (!byUser.has(rec.user_id)) byUser.set(rec.user_id, []);
    byUser.get(rec.user_id)!.push(rec);
  }

  for (const [userId, recs] of byUser) {
    // Pega o primeiro com phone_number disponível
    const sample = recs[0];
    const phone = sample.profiles?.phone_number?.replace(/\D/g, "") ?? "";

    if (!phone) {
      // FALLBACK: sem phone, processa todas em modo silencioso (comportamento antigo)
      for (const rec of recs) {
        try {
          await createTransactionFromRecurring(rec, today);
          await advanceCycleAndReset(rec);
          processed++;
        } catch (e) {
          console.error(`[silent-create] Error on ${rec.id}:`, e);
        }
      }
      continue;
    }

    // Filtra só as que precisam de pergunta agora
    const toAsk = recs.filter((r) => {
      if (r.pending_status === "idle") return true;
      if (r.pending_status === "awaiting") {
        const lastAsked = r.pending_last_asked_at
          ? new Date(r.pending_last_asked_at)
          : new Date(0);
        const daysSinceLast = Math.floor((now.getTime() - lastAsked.getTime()) / DAY_MS);
        return daysSinceLast >= RE_ASK_AFTER_DAYS && r.pending_ask_count < MAX_ASK_COUNT;
      }
      return false;
    });

    if (toAsk.length === 0) {
      // Tem awaiting mas ainda dentro do período de silêncio (< 2 dias)
      skipped += recs.length;
      continue;
    }

    // Ordena por next_date crescente (mais antigas primeiro) + idle primeiro
    toAsk.sort((a, b) => {
      if (a.pending_status !== b.pending_status) {
        return a.pending_status === "idle" ? -1 : 1;
      }
      return a.next_date.localeCompare(b.next_date);
    });

    const pick = toAsk[0];

    try {
      if (pick.pending_status === "idle") {
        await askFirstTime(pick, phone);
        asked++;
      } else {
        await askAgain(pick, phone);
        reasked++;
      }
    } catch (e) {
      console.error(`[ask] Error on ${pick.id}:`, e);
    }
  }

  // ── Limpeza de dedup (mantido do código original) ──
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

  const result = { ok: true, processed, asked, reasked, expired, skipped };
  console.log("[process-recurring] result:", JSON.stringify(result));

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Operações de DB (workflow de confirmação)
// ──────────────────────────────────────────────────────────────────────────

/** Cria a transação a partir da recurring (usado no fallback sem phone E
 *  quando user responde "sim" no webhook). */
async function createTransactionFromRecurring(rec: RecurringRow, dateOverride?: string): Promise<void> {
  await supabase.from("transactions").insert({
    user_id: rec.user_id,
    description: rec.description,
    amount: rec.amount,
    type: rec.type,
    category: rec.category,
    transaction_date: dateOverride ?? rec.next_date,
    source: "recurring",
    sent_by_phone: rec.sent_by_phone ?? null,
  } as any);
}

/** Avança next_date pro próximo ciclo + reseta o pending state. */
async function advanceCycleAndReset(rec: RecurringRow): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const next = calcNextDate(rec.next_date, rec.frequency, rec.day_of_month);
  await supabase
    .from("recurring_transactions")
    .update({
      next_date: next,
      last_processed: today,
      pending_status: "idle",
      pending_first_asked_at: null,
      pending_last_asked_at: null,
      pending_ask_count: 0,
    })
    .eq("id", rec.id);
}

/** Primeira pergunta do ciclo: marca awaiting + manda mensagem + grava sessão. */
async function askFirstTime(rec: RecurringRow, phone: string): Promise<void> {
  const nowIso = new Date().toISOString();

  await sendText(phone, formatFirstQuestion(rec));

  // Marca pending
  await supabase
    .from("recurring_transactions")
    .update({
      pending_status: "awaiting",
      pending_first_asked_at: nowIso,
      pending_last_asked_at: nowIso,
      pending_ask_count: 1,
    })
    .eq("id", rec.id);

  // Grava sessão pra próximo turno do user
  await supabase.from("whatsapp_sessions").upsert(
    {
      user_id: rec.user_id,
      phone_number: phone,
      pending_action: "recurring_confirm",
      pending_context: { recurring_id: rec.id },
      last_activity: nowIso,
    } as any,
    { onConflict: "phone_number" },
  );
}

/** Re-pergunta dentro do mesmo ciclo: incrementa contador + atualiza last_asked. */
async function askAgain(rec: RecurringRow, phone: string): Promise<void> {
  const nowIso = new Date().toISOString();

  await sendText(phone, formatReQuestion(rec));

  await supabase
    .from("recurring_transactions")
    .update({
      pending_last_asked_at: nowIso,
      pending_ask_count: (rec.pending_ask_count ?? 1) + 1,
    })
    .eq("id", rec.id);

  await supabase.from("whatsapp_sessions").upsert(
    {
      user_id: rec.user_id,
      phone_number: phone,
      pending_action: "recurring_confirm",
      pending_context: { recurring_id: rec.id },
      last_activity: nowIso,
    } as any,
    { onConflict: "phone_number" },
  );
}

/** Expira o ciclo (7+ dias sem resposta): pula sem criar + avisa user + avança. */
async function expireRecurring(rec: RecurringRow): Promise<void> {
  const phone = rec.profiles?.phone_number?.replace(/\D/g, "");
  const nextDate = calcNextDate(rec.next_date, rec.frequency, rec.day_of_month);

  if (phone) {
    await sendText(phone, formatExpireMessage(rec, nextDate));
  }

  await supabase
    .from("recurring_transactions")
    .update({
      next_date: nextDate,
      pending_status: "idle",
      pending_first_asked_at: null,
      pending_last_asked_at: null,
      pending_ask_count: 0,
      // last_processed NÃO é atualizado — só é atualizado em criação real
    })
    .eq("id", rec.id);

  // Limpa session se ainda estiver apontando pra essa recurring
  if (phone) {
    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("pending_context")
      .eq("phone_number", phone)
      .maybeSingle();
    const sessRecId = (session?.pending_context as any)?.recurring_id;
    if (sessRecId === rec.id) {
      await supabase
        .from("whatsapp_sessions")
        .update({ pending_action: null, pending_context: null })
        .eq("phone_number", phone);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Formatação das mensagens
// ──────────────────────────────────────────────────────────────────────────

function formatFirstQuestion(rec: RecurringRow): string {
  const emoji = rec.type === "expense" ? "🔴" : "🟢";
  const verb = rec.type === "expense" ? "pagou" : "recebeu";
  const typeLabel = rec.type === "expense" ? "cobrança" : "receita";
  const amount = Number(rec.amount).toFixed(2).replace(".", ",");
  return (
    `${emoji} *Hoje é dia da ${typeLabel} recorrente:*\n` +
    `📝 ${rec.description}\n` +
    `💰 R$ ${amount}\n\n` +
    `Você já ${verb}? Responda:\n` +
    `• *sim* — registro como ${rec.type === "expense" ? "gasto" : "receita"}\n` +
    `• *ainda não* — te aviso de novo daqui 2 dias\n` +
    `• *pula* — ignora esse mês`
  );
}

function formatReQuestion(rec: RecurringRow): string {
  const emoji = rec.type === "expense" ? "🔴" : "🟢";
  const verb = rec.type === "expense" ? "pagou" : "recebeu";
  const amount = Number(rec.amount).toFixed(2).replace(".", ",");
  return (
    `${emoji} *Lembrete:* ${rec.description} (R$ ${amount}) — já ${verb}?\n\n` +
    `• *sim* — registro agora\n` +
    `• *ainda não* — silencio por mais 2 dias\n` +
    `• *pula* — ignora esse mês`
  );
}

function formatExpireMessage(rec: RecurringRow, nextDate: string): string {
  const amount = Number(rec.amount).toFixed(2).replace(".", ",");
  const cycleLabel = rec.frequency === "monthly" ? "mês" :
                     rec.frequency === "weekly" ? "semana" :
                     rec.frequency === "yearly" ? "ano" : "ciclo";
  return (
    `⏰ Passou ${EXPIRE_AFTER_DAYS} dias sem confirmação da recorrência ` +
    `*${rec.description}* (R$ ${amount}). Pulei esse ${cycleLabel} sem registrar. ` +
    `Próxima cobrança: *${formatDate(nextDate)}*`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers de data (mantidos do código original)
// ──────────────────────────────────────────────────────────────────────────

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
