/**
 * kirvano-webhook — Sistema completo de gestão de assinaturas
 *
 * Fluxos:
 *  COMPRA APROVADA (novo usuário)  → registra pendência; quando ele criar conta no Jarvis é ativado automaticamente
 *  COMPRA APROVADA (conta existente) → ativa a conta e define o plano
 *  ASSINATURA RENOVADA            → mantém conta ativa, renova plano
 *  ASSINATURA CANCELADA           → mantém acesso até fim do ciclo (next_charge_date ou +30d)
 *  REEMBOLSO / CHARGEBACK         → bloqueia imediatamente + notifica no WhatsApp
 *  PAGAMENTO RECUSADO / ATRASADO  → apenas log (sem ação ainda)
 *
 * Payload real da Kirvano (descoberto em teste):
 *  event           → "SUBSCRIPTION_RENEWED", "PURCHASE_APPROVED" etc (uppercase/underscore)
 *  customer.email, customer.name, customer.phone_number
 *  plan.name, plan.next_charge_date
 *  products[].name
 *  sale_id, checkout_id
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/** Lê configuração do app_settings (fallback para env var) */
async function getSetting(key: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) ?? Deno.env.get(key.toUpperCase()) ?? "";
}

// ─────────────────────────────────────────────────────────
// Plano único — mensal ou anual (sem tiers de funcionalidade)
// ─────────────────────────────────────────────────────────
function detectPlan(productName: string): string {
  const lower = (productName ?? "").toLowerCase();
  // Distingue apenas mensal vs anual para exibição
  if (lower.includes("anual") || lower.includes("annual") || lower.includes("annually")) return "maya_anual";
  return "maya_mensal";
}

// ─────────────────────────────────────────────────────────
// Normaliza nome do evento → tipo canônico
// ─────────────────────────────────────────────────────────
type CanonicalEvent = "activate" | "cancel" | "revoke" | "overdue" | "refused" | "unknown";

function normalizeEventType(raw: string | undefined): CanonicalEvent {
  if (!raw) return "unknown";
  // Kirvano usa UPPERCASE_UNDERSCORE — normaliza para lowercase.dot
  const e = raw.toLowerCase().replace(/_/g, ".");

  if (
    e.includes("purchase.approved") || e.includes("purchase.complete") ||
    e.includes("subscription.activated") || e.includes("subscription.renewed") ||
    e.includes("subscription.reactivated") || e.includes("sale.approved") ||
    e.includes("approved")
  ) return "activate";

  if (
    e.includes("subscription.cancelled") || e.includes("subscription.canceled") ||
    e.includes("subscription.cancellation") || e.includes("purchase.cancelled") ||
    e.includes("purchase.canceled") || e.includes("cancelled") || e.includes("canceled")
  ) return "cancel";

  if (
    e.includes("refund") || e.includes("chargeback") ||
    e.includes("estorno") || e.includes("reembolso")
  ) return "revoke";

  if (
    e.includes("overdue") || e.includes("inadimplente") || e.includes("vencida") ||
    e.includes("late") || e.includes("subscription.overdue")
  ) return "overdue";

  if (
    e.includes("refused") || e.includes("recusad") || e.includes("declined") ||
    e.includes("failed") || e.includes("purchase.refused")
  ) return "refused";

  return "unknown";
}

// ─────────────────────────────────────────────────────────
// Extrai campos do payload Kirvano (estrutura real confirmada)
// ─────────────────────────────────────────────────────────
interface KirvanoData {
  event: string;
  email: string;
  name: string;
  phone: string;
  productName: string;
  subscriptionId: string | null;
  orderId: string | null;
  accessUntil: string | null;
  rawPayload: Record<string, unknown>;
}

function extractPayload(body: Record<string, unknown>): KirvanoData {
  // Kirvano aninha dados diretamente na raiz
  const customer = (body.customer ?? body.buyer ?? body.client ?? {}) as Record<string, unknown>;
  const planObj  = (body.plan ?? {}) as Record<string, unknown>;
  const products = (body.products ?? []) as any[];
  const product  = (body.product ?? {}) as Record<string, unknown>;

  const event = (body.event ?? body.type ?? "") as string;

  // Email
  const email = String(
    customer.email ?? customer.correo ?? body.email ?? ""
  ).toLowerCase().trim();

  // Nome
  const name = String(
    customer.name ?? customer.nome ?? customer.full_name ?? body.name ?? ""
  ).trim();

  // Telefone — Kirvano usa phone_number (confirmado no teste)
  const rawPhone = String(
    customer.phone_number ?? customer.phone ?? customer.mobile ??
    customer.telefone ?? body.phone ?? ""
  );
  const phone = rawPhone.replace(/\D/g, "");

  // Nome do produto — Kirvano usa plan.name OU products[0].name
  const productName = String(
    planObj.name ??
    (products.length > 0 ? products[0].name : null) ??
    product.name ?? product.nome ?? body.product_name ?? ""
  ).trim();

  // ID da assinatura / venda
  const subscriptionId = String(
    body.sale_id ?? body.checkout_id ?? body.subscription_id ??
    (planObj as any).id ?? ""
  ) || null;

  // ID do pedido
  const orderId = String(
    body.sale_id ?? body.order_id ?? body.checkout_id ?? ""
  ) || null;

  // Data de fim de acesso — Kirvano usa plan.next_charge_date (confirmado no teste)
  const accessUntilRaw = String(
    planObj.next_charge_date ?? planObj.expires_at ??
    body.next_billing_date ?? body.expires_at ?? ""
  ) || null;

  let accessUntil: string | null = null;
  if (accessUntilRaw) {
    const parsed = new Date(accessUntilRaw);
    if (!isNaN(parsed.getTime())) accessUntil = parsed.toISOString();
  }

  return { event, email, name, phone, productName, subscriptionId, orderId, accessUntil, rawPayload: body };
}

// ─────────────────────────────────────────────────────────
// Busca usuário por email ou telefone
// ─────────────────────────────────────────────────────────
async function findMatchingUser(email: string, phone: string): Promise<string | null> {
  if (email) {
    const { data } = await supabase.rpc("get_user_id_by_email", { p_email: email });
    if (data) return data as string;
  }
  if (phone) {
    const { data: p1 } = await supabase
      .from("profiles").select("id").eq("phone_number", phone).maybeSingle();
    if (p1?.id) return p1.id as string;

    const { data: p2 } = await supabase
      .from("user_phone_numbers" as any).select("user_id").eq("phone_number", phone).maybeSingle();
    if ((p2 as any)?.user_id) return (p2 as any).user_id as string;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// Envia notificação WhatsApp ao usuário (se tiver número)
// ─────────────────────────────────────────────────────────
async function notifyUser(userId: string, message: string): Promise<void> {
  try {
    const { data: prof } = await supabase
      .from("profiles").select("phone_number").eq("id", userId).maybeSingle();
    if (prof?.phone_number) {
      await sendText(prof.phone_number.replace(/\D/g, ""), message);
    }
  } catch (err) {
    console.error("[kirvano] notify error:", err);
  }
}

// ─────────────────────────────────────────────────────────
// Handlers de negócio
// ─────────────────────────────────────────────────────────

/** Ativa conta: compra aprovada / renovação */
async function handleActivate(
  userId: string,
  plan: string,
  subscriptionId: string | null
): Promise<void> {
  await supabase.from("profiles").update({
    account_status: "active",
    plan,
    messages_limit: 999999,
    access_until: null,
    access_source: "kirvano",
    subscription_cancelled_at: null, // ativa = limpa qualquer cancelamento anterior
    renewal_reminder_sent_at: null,  // permite novo ciclo de lembretes
    suspension_notice_sent_at: null,
    ...(subscriptionId && { kirvano_subscription_id: subscriptionId }),
  } as any).eq("id", userId);

  // Garante agente ligado
  await supabase.from("agent_configs").update({ is_active: true }).eq("user_id", userId);

  console.log(`[kirvano] ✅ Activated user ${userId} plan=${plan}`);
}

/** Cancela assinatura: mantém acesso até fim do ciclo */
async function handleCancel(
  userId: string,
  accessUntilFromKirvano: string | null,
  plan: string
): Promise<void> {
  // Se Kirvano enviou a data exata (next_charge_date), usa ela.
  // Caso contrário calcula com base no tipo de plano: anual = +365d, mensal = +30d
  let accessUntil: string;
  if (accessUntilFromKirvano) {
    accessUntil = accessUntilFromKirvano;
  } else {
    const isAnnual = plan.includes("anual") || plan.includes("annual") || plan.includes("annually");
    const days = isAnnual ? 365 : 30;
    accessUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    // Log para diagnosticar qualidade dos dados da Kirvano — quando o
    // next_charge_date não vem no payload, caímos no fallback por tipo de plano.
    console.warn(
      `[kirvano] ⚠️ handleCancel: next_charge_date ausente no payload — usando fallback de ${days}d ` +
      `(plan=${plan}, user=${userId}, accessUntil=${accessUntil})`
    );
  }

  await supabase.from("profiles").update({
    account_status: "active",
    access_until: accessUntil,
    access_source: "kirvano",
    subscription_cancelled_at: new Date().toISOString(), // marca o cancelamento
  } as any).eq("id", userId);

  // Busca timezone do usuário pra exibir a data no fuso dele
  const { data: tzProfile } = await supabase
    .from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const userTz = (tzProfile?.timezone as string) || "America/Sao_Paulo";

  // Notifica no WhatsApp
  const until = new Date(accessUntil).toLocaleDateString("pt-BR", { timeZone: userTz });
  await notifyUser(userId,
    `⚠️ *Assinatura cancelada*\n\nSua assinatura do Jarvis foi cancelada.\n\nSeu acesso continua ativo até *${until}*. Após essa data o assistente será desativado automaticamente.\n\nSe quiser continuar usando, basta renovar sua assinatura no app.`
  );

  console.log(`[kirvano] 🔔 Cancelled for user ${userId}, access until ${accessUntil}`);
}

/** Revoga acesso imediatamente: reembolso / chargeback */
async function handleRevoke(userId: string): Promise<void> {
  await supabase.from("profiles").update({
    account_status: "suspended",
    access_until: null,
    access_source: null,
    subscription_cancelled_at: null,
  } as any).eq("id", userId);

  // Pausa o agente
  await supabase.from("agent_configs").update({ is_active: false }).eq("user_id", userId);

  // Notifica no WhatsApp
  await notifyUser(userId,
    `🚫 *Acesso suspenso*\n\nSeu acesso ao Jarvis foi suspenso devido a um reembolso ou estorno confirmado.\n\nCaso acredite que isso seja um erro, entre em contato com nosso suporte.`
  );

  console.log(`[kirvano] 🚫 Revoked access for user ${userId}`);
}

/** Convida o cliente por email apos compra aprovada quando ele AINDA NAO tem conta.
 *  Cria auth.users via admin.inviteUserByEmail → dispara email do Supabase com link
 *  pra /bem-vindo onde ele define a senha. O trigger handle_new_user (que roda no
 *  INSERT de auth.users) ja faz match com kirvano_events pendente e cria o profile
 *  com plano ATIVO, entao quando ele entrar o acesso ja esta liberado.
 *
 *  Idempotente: se o email ja existe em auth.users, o invite falha com "already registered"
 *  e apenas logamos — o fluxo normal (signup manual → trigger match) continua valido. */
async function inviteNewCustomer(email: string, name: string): Promise<void> {
  if (!email) return;

  const siteUrl = (await getSetting("site_url")) || Deno.env.get("SITE_URL") || "https://app.heyjarvis.com.br";
  const redirectTo = `${siteUrl.replace(/\/$/, "")}/bem-vindo`;

  try {
    const { data, error } = await (supabase.auth.admin as any).inviteUserByEmail(email, {
      redirectTo,
      data: name ? { display_name: name } : undefined,
    });

    if (error) {
      // "User already registered" e esperado quando cliente ja tem conta — nao e erro real
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        console.log(`[kirvano] ℹ️ Invite skipped (user ${email} already exists) — signup manual fara match`);
        return;
      }
      console.error(`[kirvano] ⚠️ inviteUserByEmail failed for ${email}:`, error.message);
      return;
    }

    console.log(`[kirvano] 📧 Invite sent to ${email} (auth user ${data?.user?.id ?? "?"})`);
  } catch (err: any) {
    console.error(`[kirvano] ⚠️ inviteUserByEmail threw for ${email}:`, err?.message ?? err);
  }
}

/** Pagamento atrasado — define período de graça e notifica.
 *  Após `overdue_grace_days` (default 7) sem regularizar, o cron
 *  `expire_stale_accounts` suspende automaticamente. */
async function handleOverdue(userId: string): Promise<void> {
  const graceSetting = await getSetting("overdue_grace_days");
  const graceDays = Math.max(1, parseInt(graceSetting || "7", 10) || 7);

  const { data: prof } = await supabase
    .from("profiles")
    .select("account_status, access_until")
    .eq("id", userId)
    .maybeSingle();

  // Só aplica grace period se a conta está ativa e ainda não tem deadline.
  // Se já tem access_until (ex: cancelamento anterior), respeita a data existente.
  let graceApplied = false;
  if (prof?.account_status === "active" && !prof.access_until) {
    const accessUntil = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("profiles").update({
      access_until: accessUntil,
      access_source: "kirvano",
    } as any).eq("id", userId);
    graceApplied = true;
    console.log(`[kirvano] ⏰ Overdue grace period set for user ${userId}: ${graceDays}d → ${accessUntil}`);
  }

  const tail = graceApplied
    ? `\n\nSeu acesso continua ativo por mais *${graceDays} dia(s)*. Após esse prazo, o assistente será suspenso automaticamente.`
    : ``;

  await notifyUser(userId,
    `⏰ *Pagamento atrasado*\n\nIdentificamos um pagamento em atraso na sua assinatura do Jarvis.${tail}\n\nRegularize para evitar a suspensão do seu acesso. Qualquer dúvida, acesse o app.`
  );
  console.log(`[kirvano] ⚠️ Overdue notified for user ${userId} (graceApplied=${graceApplied})`);
}

// ─────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────
async function logEvent(
  kData: KirvanoData,
  canonicalEvent: CanonicalEvent,
  userId: string | null
): Promise<void> {
  const { error } = await (supabase.from("kirvano_events" as any).insert({
    event_type: kData.event || "unknown",
    status: canonicalEvent,
    customer_email: kData.email || null,
    customer_phone: kData.phone || null,
    customer_name: kData.name || null,
    product_name: kData.productName || null,
    subscription_id: kData.subscriptionId || null,
    transaction_id: kData.orderId || null,
    matched_user_id: userId || null,
    processed_at: new Date().toISOString(),
    raw_payload: kData.rawPayload,
  }) as any);
  if (error) console.error("[kirvano] log error:", error.message, error.details);
}

// ─────────────────────────────────────────────────────────
// Processa o evento
// ─────────────────────────────────────────────────────────
async function processEvent(kData: KirvanoData): Promise<void> {
  const canonical = normalizeEventType(kData.event);
  const plan = detectPlan(kData.productName);
  const userId = await findMatchingUser(kData.email, kData.phone);

  // Registra no audit log antes de qualquer ação
  await logEvent(kData, canonical, userId);

  if (!userId) {
    // Usuário ainda não tem conta no Jarvis.
    // O evento fica gravado em kirvano_events. Quando ele criar conta com este
    // email, o trigger handle_new_user vai buscar este evento (status='activate',
    // matched_user_id IS NULL) e auto-ativar a conta com o plano correto.
    console.log(
      `[kirvano] ℹ️ No user yet for email="${kData.email}" event="${kData.event}" — event stored, will activate on registration via handle_new_user trigger`
    );

    // Se foi uma ativacao (compra/renovacao), dispara convite automatico:
    // cria auth user + envia email com link pra /bem-vindo. Zero friccao pro cliente.
    // Outros eventos (cancel/revoke/overdue) nao geram invite — nao faz sentido
    // convidar alguem pra conta que ja foi cancelada.
    if (canonical === "activate") {
      await inviteNewCustomer(kData.email, kData.name);
    }
    return;
  }

  switch (canonical) {
    case "activate":
      await handleActivate(userId, plan, kData.subscriptionId);
      break;
    case "cancel":
      await handleCancel(userId, kData.accessUntil, plan);
      break;
    case "revoke":
      await handleRevoke(userId);
      break;
    case "overdue":
      await handleOverdue(userId);
      break;
    case "refused":
      console.log(`[kirvano] ❌ Refused for user ${userId} — no action`);
      break;
    default:
      console.log(`[kirvano] ❓ Unknown event "${kData.event}" for user ${userId}`);
  }
}

// ─────────────────────────────────────────────────────────
// Entry point — sempre retorna 200 para a Kirvano não reenviar
// ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    console.error("[kirvano] Invalid JSON body");
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const kData = extractPayload(body);
  console.log(`[kirvano] Event: ${kData.event} | Email: ${kData.email} | Product: ${kData.productName}`);

  // Verifica token secreto apenas se configurado E se o request traz um token
  const secret = Deno.env.get("KIRVANO_WEBHOOK_SECRET");
  if (secret) {
    const token =
      req.headers.get("x-kirvano-token") ??
      req.headers.get("authorization")?.replace("Bearer ", "") ??
      (body.token as string) ?? null;
    if (token && token !== secret) {
      console.warn("[kirvano] Invalid token");
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Processa em background e responde imediatamente
  processEvent(kData).catch((err) => {
    console.error("[kirvano] processEvent error:", err?.message ?? err);
  });

  return new Response(
    JSON.stringify({ ok: true, received: kData.event || "unknown" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
