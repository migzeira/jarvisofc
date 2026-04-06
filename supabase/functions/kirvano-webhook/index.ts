/**
 * kirvano-webhook
 * Recebe eventos de pagamento da Kirvano e:
 * - approved: cria usuário no Supabase Auth + profile
 * - canceled/refunded: desativa conta (plan = 'free')
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError, fromThrown } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Mapeia produto Kirvano → plano MayaChat
const PLAN_MAP: Record<string, string> = {
  starter: "starter",
  pro: "pro",
  business: "business",
};

// Limite de mensagens por plano
const PLAN_LIMITS: Record<string, number> = {
  starter: 500,
  pro: 2000,
  business: 10000,
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Kirvano envia um token no header ou no body para verificação
  const token = req.headers.get("X-Kirvano-Token") ?? (payload.token as string);
  const expectedToken = Deno.env.get("KIRVANO_WEBHOOK_SECRET");
  if (expectedToken && token !== expectedToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const eventType = payload.event as string; // purchase.approved, purchase.canceled, etc.
  const purchase = payload.purchase as Record<string, unknown>;
  const buyer = payload.buyer as Record<string, unknown>;
  const product = payload.product as Record<string, unknown>;

  if (!buyer?.email) {
    return new Response("Missing buyer email", { status: 400 });
  }

  const email = buyer.email as string;
  const name = (buyer.name as string) ?? "";
  const phone = (buyer.phone as string) ?? "";
  const orderId = (purchase?.order_id as string) ?? (payload.order_id as string) ?? "";
  const productName = (product?.name as string ?? "").toLowerCase();

  // Determina plano pelo nome do produto
  let plan = "starter";
  for (const [key, val] of Object.entries(PLAN_MAP)) {
    if (productName.includes(key)) {
      plan = val;
      break;
    }
  }

  // Registra pagamento
  await supabase.from("kirvano_payments").upsert(
    {
      kirvano_order_id: orderId || `${email}-${Date.now()}`,
      email,
      name,
      phone,
      plan,
      status: eventType.includes("approved") ? "approved" : "canceled",
      amount: purchase?.price ?? null,
    },
    { onConflict: "kirvano_order_id" }
  );

  try {
    if (eventType === "purchase.approved" || eventType === "subscription.activated") {
      await handleApproved(email, name, phone, plan);
    } else if (
      eventType === "purchase.canceled" ||
      eventType === "subscription.canceled" ||
      eventType === "purchase.refunded" ||
      eventType === "purchase.chargeback"
    ) {
      await handleCanceled(email);
    }
  } catch (err) {
    const { message, stack } = fromThrown(err);
    await logError({
      context: "kirvano-webhook",
      message,
      stack,
      metadata: { eventType, email, orderId, plan },
    });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function handleApproved(
  email: string,
  name: string,
  phone: string,
  plan: string
): Promise<void> {
  // Verifica se usuário já existe
  const { data: existing } = await supabase.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email === email);

  const messagesLimit = PLAN_LIMITS[plan] ?? 500;

  if (existingUser) {
    // Atualiza plano + ativa conta do usuário existente
    await supabase
      .from("profiles")
      .update({ plan, messages_limit: messagesLimit, messages_used: 0, account_status: "active" })
      .eq("id", existingUser.id);

    console.log(`Updated plan for existing user: ${email} → ${plan}`);
    return;
  }

  // Cria novo usuário
  const tempPassword = generateTempPassword();

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true, // pula confirmação de email
    user_metadata: {
      display_name: name || email.split("@")[0],
    },
  });

  if (error) {
    console.error("Error creating user:", error);
    throw error;
  }

  if (!newUser.user) return;

  // O trigger on_auth_user_created já cria o profile automaticamente.
  // Só precisamos atualizar com os dados do pagamento e ativar a conta.
  await supabase
    .from("profiles")
    .update({
      display_name: name || email.split("@")[0],
      phone_number: phone ? phone.replace(/\D/g, "") : null,
      plan,
      messages_limit: messagesLimit,
      account_status: "active",
    })
    .eq("id", newUser.user.id);

  // Kirvano também pode enviar email com a senha via ferramenta deles,
  // mas podemos enviar via Supabase magic link para o usuário definir a própria senha.
  const { error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (linkError) {
    console.error("Error generating recovery link:", linkError);
  }

  console.log(`New user created: ${email}, plan: ${plan}`);
}

async function handleCanceled(email: string): Promise<void> {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const user = existing?.users?.find((u) => u.email === email);

  if (!user) return;

  await supabase
    .from("profiles")
    .update({ plan: "free", messages_limit: 0, account_status: "suspended" })
    .eq("id", user.id);

  console.log(`Plan canceled for: ${email}`);
}

function generateTempPassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}
