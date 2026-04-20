/**
 * renewal-reminder-cron
 *
 * Disparado pelo pg_cron a cada hora. Envia 2 lembretes de renovação
 * para clientes Kirvano:
 *
 *  Lembrete 1 ("venceu hoje, renove"):
 *    → access_until já passou, mas dentro da janela de grace (24h).
 *    → account_status ainda = 'active' (expire_stale_accounts só suspende
 *      após 24h de grace).
 *    → renewal_reminder_sent_at IS NULL.
 *
 *  Lembrete 2 ("sendo desativado agora"):
 *    → access_until passou há ≥ 23h (prestes a ser suspenso pelo cron).
 *    → account_status ainda = 'active'.
 *    → suspension_notice_sent_at IS NULL.
 *
 * Quando o cliente paga na Kirvano, o webhook dispara `activate` e
 * handleActivate() limpa as 2 flags — permitindo novo ciclo no futuro.
 *
 * Segurança: exige service_role key ou cron secret via Authorization Bearer.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function getSetting(key: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) ?? "";
}

function buildLink(raw: string): string {
  const link = (raw ?? "").trim();
  return link || "Entre em contato com o suporte.";
}

/** Escolhe o link de renovação baseado no plano do cliente.
 *  anual → renewal_link_annual; mensal (ou qualquer outro) → renewal_link_monthly.
 *  Fallback na ordem: link específico → renewal_link (legacy) → "". */
function pickLinkByPlan(
  plan: string | null,
  monthly: string,
  annual: string,
  legacy: string,
): string {
  const p = (plan ?? "").toLowerCase();
  const isAnnual = p.includes("anual") || p.includes("annual") || p.includes("annually");
  const chosen = isAnnual ? (annual || legacy) : (monthly || legacy);
  return buildLink(chosen);
}

async function sendReminder1(
  userId: string,
  phone: string,
  link: string,
): Promise<boolean> {
  const msg =
    `⚠️ *Seu plano venceu hoje*\n\n` +
    `Olá! Identifiquei que seu plano do Jarvis venceu hoje.\n\n` +
    `Pra continuar falando comigo e não perder seu acesso, renove aqui:\n${link}\n\n` +
    `_Seu acesso fica ativo por mais 24 horas enquanto aguardo sua renovação._`;

  try {
    await sendText(phone, msg);
    await supabase.from("profiles")
      .update({ renewal_reminder_sent_at: new Date().toISOString() } as any)
      .eq("id", userId);
    console.log(`[renewal-cron] ✅ Reminder 1 sent → user=${userId}`);
    return true;
  } catch (err) {
    console.error(`[renewal-cron] ❌ Reminder 1 failed user=${userId}:`, err);
    return false;
  }
}

async function sendReminder2(
  userId: string,
  phone: string,
  link: string,
): Promise<boolean> {
  const msg =
    `🛑 *Estou sendo desativado*\n\n` +
    `Olá! Como seu pagamento não foi renovado, meu acesso será suspenso em instantes.\n\n` +
    `Assim que você renovar por este link, sua conta volta a funcionar normalmente e automaticamente:\n${link}\n\n` +
    `_Estou aqui quando você voltar. 🤝_`;

  try {
    await sendText(phone, msg);
    await supabase.from("profiles")
      .update({ suspension_notice_sent_at: new Date().toISOString() } as any)
      .eq("id", userId);
    console.log(`[renewal-cron] ✅ Reminder 2 sent → user=${userId}`);
    return true;
  } catch (err) {
    console.error(`[renewal-cron] ❌ Reminder 2 failed user=${userId}:`, err);
    return false;
  }
}

serve(async (req) => {
  // Segurança: exige Authorization Bearer contendo service_role OU cron secret
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const allowed = token && (token === serviceRole || (cronSecret && token === cronSecret));
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const enabled = (await getSetting("renewal_reminders_enabled")) !== "false";
  if (!enabled) {
    console.log("[renewal-cron] disabled via app_settings.renewal_reminders_enabled=false");
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Carrega os 3 links (mensal, anual, legacy) em paralelo
  const [monthlyLink, annualLink, legacyLink] = await Promise.all([
    getSetting("renewal_link_monthly"),
    getSetting("renewal_link_annual"),
    getSetting("renewal_link"),
  ]);

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const h24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const h23Ago = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();

  // ── Lembrete 1: access_until venceu nas últimas 24h, ainda em grace ──
  const { data: r1, error: r1err } = await supabase
    .from("profiles")
    .select("id, phone_number, plan")
    .eq("account_status", "active")
    .eq("access_source", "kirvano")
    .lte("access_until", inOneHour)   // já venceu (ou vence na próxima hora)
    .gte("access_until", h24Ago)      // dentro da janela de grace
    .is("renewal_reminder_sent_at", null);

  if (r1err) console.error("[renewal-cron] query1 error:", r1err.message);

  let sent1 = 0;
  for (const p of r1 ?? []) {
    const phone = (p.phone_number ?? "").replace(/\D/g, "");
    if (!phone) continue;
    const link = pickLinkByPlan(p.plan, monthlyLink, annualLink, legacyLink);
    if (await sendReminder1(p.id, phone, link)) sent1++;
  }

  // ── Lembrete 2: grace quase acabou (≥23h no vencido), ainda ativo ──
  const { data: r2, error: r2err } = await supabase
    .from("profiles")
    .select("id, phone_number, plan")
    .eq("account_status", "active")
    .eq("access_source", "kirvano")
    .lte("access_until", h23Ago)
    .is("suspension_notice_sent_at", null);

  if (r2err) console.error("[renewal-cron] query2 error:", r2err.message);

  let sent2 = 0;
  for (const p of r2 ?? []) {
    const phone = (p.phone_number ?? "").replace(/\D/g, "");
    if (!phone) continue;
    const link = pickLinkByPlan(p.plan, monthlyLink, annualLink, legacyLink);
    if (await sendReminder2(p.id, phone, link)) sent2++;
  }

  const summary = {
    ok: true,
    reminder1_sent: sent1,
    reminder2_sent: sent2,
    timestamp: now.toISOString(),
  };
  console.log("[renewal-cron] done:", summary);
  return new Response(JSON.stringify(summary), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
