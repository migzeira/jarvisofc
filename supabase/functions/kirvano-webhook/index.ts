/**
 * kirvano-webhook
 * Recebe todos os eventos de pagamento da Kirvano e gerencia
 * status de conta dos usuários automaticamente.
 *
 * Eventos suportados:
 *  - purchase.approved / subscription.activated / subscription.renewed → ativa conta
 *  - subscription.cancelled / subscription.canceled                    → mantém acesso até fim do ciclo
 *  - purchase.refunded / purchase.chargeback                           → revoga acesso imediatamente
 *  - subscription.overdue / purchase.refused                           → log apenas (sem ação ainda)
 *
 * Match de usuário (prioridade):
 *  1. Email via RPC get_user_id_by_email (auth.users)
 *  2. Telefone via profiles.phone_number
 *  3. Telefone via user_phone_numbers
 *  4. Não encontrado → registra em kirvano_events como unmatched
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────────────────
// Mapeamento de nome de produto → plano
// ─────────────────────────────────────────────────────────
const PLAN_NAMES = ["business", "pro", "starter"] as const;
type Plan = typeof PLAN_NAMES[number];

function detectPlan(productName: string): Plan {
  const lower = (productName ?? "").toLowerCase();
  for (const p of PLAN_NAMES) {
    if (lower.includes(p)) return p;
  }
  return "starter";
}

// ─────────────────────────────────────────────────────────
// Normaliza o nome do evento para um canonical type
// ─────────────────────────────────────────────────────────
type CanonicalEvent =
  | "activate"   // purchase approved / subscription renewed
  | "cancel"     // subscription cancelled (keep access till cycle end)
  | "revoke"     // refund / chargeback (immediate)
  | "overdue"    // overdue payment
  | "refused"    // purchase refused
  | "unknown";

function normalizeEventType(raw: string | undefined): CanonicalEvent {
  if (!raw) return "unknown";
  const e = raw.toLowerCase().replace(/[_\s]/g, ".");

  if (
    e.includes("purchase.approved") ||
    e.includes("subscription.activated") ||
    e.includes("subscription.renewed") ||
    e.includes("subscription.reactivated") ||
    e.includes("approved")
  ) return "activate";

  if (
    e.includes("subscription.cancelled") ||
    e.includes("subscription.canceled") ||
    e.includes("subscription.cancellation") ||
    e.includes("purchase.cancelled") ||
    e.includes("purchase.canceled")
  ) return "cancel";

  if (
    e.includes("refund") ||
    e.includes("chargeback") ||
    e.includes("estorno")
  ) return "revoke";

  if (
    e.includes("overdue") ||
    e.includes("inadimplente") ||
    e.includes("vencida")
  ) return "overdue";

  if (
    e.includes("refused") ||
    e.includes("recusada") ||
    e.includes("recusado") ||
    e.includes("declined")
  ) return "refused";

  return "unknown";
}

// ─────────────────────────────────────────────────────────
// Extrai campos do payload (Kirvano pode variar a estrutura)
// ─────────────────────────────────────────────────────────
interface KirvanoData {
  event: string;
  email: string;
  name: string;
  phone: string;
  productName: string;
  subscriptionId: string | null;
  orderId: string | null;
  accessUntil: string | null; // ISO date from Kirvano (next billing date)
  rawPayload: Record<string, unknown>;
}

function extractPayload(body: Record<string, unknown>): KirvanoData {
  // Kirvano pode aninhar dados em body.data, body.checkout, body.customer etc.
  const data = (body.data ?? body) as Record<string, unknown>;
  const customer =
    (data.customer ?? data.buyer ?? data.client ?? {}) as Record<string, unknown>;
  const product =
    (data.product ?? data.plan ?? body.product ?? {}) as Record<string, unknown>;
  const subscription =
    (data.subscription ?? body.subscription ?? {}) as Record<string, unknown>;
  const purchase =
    (data.purchase ?? data.order ?? body.purchase ?? {}) as Record<string, unknown>;

  // Evento pode estar na raiz ou dentro de data
  const event =
    (body.event ?? body.type ?? data.event ?? data.type ?? "") as string;

  // Email: customer > body direto
  const email = (
    customer.email ??
    customer.correo ??
    body.email ??
    data.email ??
    ""
  ) as string;

  // Nome
  const name = (
    customer.name ??
    customer.nome ??
    customer.full_name ??
    body.name ??
    data.name ??
    ""
  ) as string;

  // Telefone — remove tudo que não é dígito
  const rawPhone = (
    customer.phone ??
    customer.telefone ??
    customer.mobile ??
    body.phone ??
    data.phone ??
    ""
  ) as string;
  const phone = String(rawPhone).replace(/\D/g, "");

  // Nome do produto
  const productName = (
    product.name ??
    product.nome ??
    product.title ??
    body.product_name ??
    data.product_name ??
    ""
  ) as string;

  // ID da assinatura
  const subscriptionId = (
    subscription.id ??
    subscription.subscription_id ??
    data.subscription_id ??
    body.subscription_id ??
    null
  ) as string | null;

  // ID do pedido
  const orderId = (
    purchase.id ??
    purchase.order_id ??
    data.order_id ??
    body.order_id ??
    null
  ) as string | null;

  // Data de fim do acesso (próxima cobrança ou data de expiração do ciclo)
  const accessUntilRaw = (
    subscription.next_billing_date ??
    subscription.expires_at ??
    subscription.period_end ??
    data.next_billing_date ??
    data.expires_at ??
    null
  ) as string | null;
  const accessUntil = accessUntilRaw ? String(accessUntilRaw) : null;

  return {
    event,
    email: email.toLowerCase().trim(),
    name: String(name).trim(),
    phone,
    productName: String(productName),
    subscriptionId: subscriptionId ? String(subscriptionId) : null,
    orderId: orderId ? String(orderId) : null,
    accessUntil,
    rawPayload: body,
  };
}

// ─────────────────────────────────────────────────────────
// Encontra usuário pelo email ou telefone
// ─────────────────────────────────────────────────────────
async function findMatchingUser(
  email: string,
  phone: string
): Promise<string | null> {
  // 1) Tenta pelo email via RPC (usa índice em auth.users)
  if (email) {
    const { data: emailMatch } = await supabase.rpc("get_user_id_by_email", {
      p_email: email,
    });
    if (emailMatch) return emailMatch as string;
  }

  // 2) Tenta pelo telefone principal no profiles
  if (phone) {
    const { data: phoneMatch } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_number", phone)
      .maybeSingle();
    if (phoneMatch?.id) return phoneMatch.id as string;

    // 3) Tenta nos números extras
    const { data: extraMatch } = await supabase
      .from("user_phone_numbers" as any)
      .select("user_id")
      .eq("phone_number", phone)
      .maybeSingle();
    if ((extraMatch as any)?.user_id) return (extraMatch as any).user_id as string;
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// Handlers de negócio
// ─────────────────────────────────────────────────────────

/** Ativa conta: approved / renewed */
async function handleActivate(
  userId: string,
  plan: Plan,
  subscriptionId: string | null
): Promise<void> {
  await supabase.from("profiles").update({
    account_status: "active",
    plan,
    access_until: null,
    ...(subscriptionId && { kirvano_subscription_id: subscriptionId }),
  }).eq("id", userId);

  // Garante que o agente está ativo
  await supabase.from("agent_configs").update({ is_active: true })
    .eq("user_id", userId);

  console.log(`[kirvano] ✅ Activated user ${userId} plan=${plan}`);
}

/** Cancela assinatura: mantém acesso até o fim do ciclo */
async function handleCancel(
  userId: string,
  accessUntilFromKirvano: string | null
): Promise<void> {
  // Se Kirvano enviar a data de expiração, usa ela. Caso contrário +30 dias.
  let accessUntil: string;
  if (accessUntilFromKirvano) {
    const parsed = new Date(accessUntilFromKirvano);
    accessUntil = isNaN(parsed.getTime())
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : parsed.toISOString();
  } else {
    accessUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  await supabase.from("profiles").update({
    // Mantém active por enquanto — o webhook de WhatsApp verifica access_until
    account_status: "active",
    access_until: accessUntil,
  }).eq("id", userId);

  console.log(`[kirvano] 🔔 Subscription cancelled for user ${userId}, access until ${accessUntil}`);
}

/** Revoga acesso imediatamente: refund / chargeback */
async function handleRevoke(userId: string): Promise<void> {
  await supabase.from("profiles").update({
    account_status: "suspended",
    access_until: null,
  }).eq("id", userId);

  // Pausa o agente também
  await supabase.from("agent_configs").update({ is_active: false })
    .eq("user_id", userId);

  console.log(`[kirvano] 🚫 Access revoked for user ${userId}`);
}

/** Pagamento atrasado — apenas log por enquanto */
async function handleOverdue(userId: string): Promise<void> {
  console.log(`[kirvano] ⚠️ Overdue payment for user ${userId} — logged only`);
  // Futuro: enviar aviso via WhatsApp
}

// ─────────────────────────────────────────────────────────
// Log de eventos (audit)
// ─────────────────────────────────────────────────────────
async function logEvent(
  kData: KirvanoData,
  canonicalEvent: CanonicalEvent,
  userId: string | null
): Promise<void> {
  await supabase.from("kirvano_events" as any).insert({
    event_type: kData.event,
    canonical_event: canonicalEvent,
    email: kData.email || null,
    phone: kData.phone || null,
    product_name: kData.productName || null,
    subscription_id: kData.subscriptionId,
    order_id: kData.orderId,
    user_id: userId,
    matched: !!userId,
    raw_payload: kData.rawPayload,
  }).then(({ error }) => {
    if (error) console.error("[kirvano] log error:", error.message);
  });
}

// ─────────────────────────────────────────────────────────
// Processa o evento
// ─────────────────────────────────────────────────────────
async function processEvent(kData: KirvanoData): Promise<void> {
  const canonical = normalizeEventType(kData.event);
  const plan = detectPlan(kData.productName);

  // Encontra usuário
  const userId = await findMatchingUser(kData.email, kData.phone);

  // Registra audit log
  await logEvent(kData, canonical, userId);

  if (!userId) {
    console.warn(
      `[kirvano] ⚠️ No user found for email="${kData.email}" phone="${kData.phone}" event="${kData.event}"`
    );
    return;
  }

  switch (canonical) {
    case "activate":
      await handleActivate(userId, plan, kData.subscriptionId);
      break;
    case "cancel":
      await handleCancel(userId, kData.accessUntil);
      break;
    case "revoke":
      await handleRevoke(userId);
      break;
    case "overdue":
      await handleOverdue(userId);
      break;
    case "refused":
      console.log(`[kirvano] ❌ Purchase refused for user ${userId} — no action`);
      break;
    default:
      console.log(`[kirvano] ❓ Unknown event "${kData.event}" for user ${userId}`);
  }
}

// ─────────────────────────────────────────────────────────
// Entry point — sempre retorna 200 para a Kirvano
// ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    // Body inválido — retorna 200 mesmo assim para não Kirvano reenviar
    console.error("[kirvano] Invalid JSON body");
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[kirvano] Received event:", JSON.stringify(body).slice(0, 500));

  // Extrai os dados logo e responde 200 imediatamente
  // Processamento em background para não bloquear a resposta
  const kData = extractPayload(body);

  // Opcional: verificar token secreto se configurado
  const secret = Deno.env.get("KIRVANO_WEBHOOK_SECRET");
  if (secret) {
    const tokenHeader =
      req.headers.get("x-kirvano-token") ??
      req.headers.get("authorization")?.replace("Bearer ", "") ??
      (body.token as string) ??
      null;
    if (tokenHeader !== secret) {
      console.warn("[kirvano] Invalid webhook secret");
      // Retorna 200 mesmo com token inválido para não revelar segredo
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Processa de forma async e responde imediatamente
  processEvent(kData).catch((err) => {
    console.error("[kirvano] processEvent error:", err?.message ?? err);
  });

  return new Response(JSON.stringify({ ok: true, received: kData.event || "unknown" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
