/**
 * admin-impersonate-token
 *
 * Gera tokens de sessão (access_token + refresh_token) pra um user-alvo,
 * permitindo que o admin "veja o painel" como se fosse o user. Usado pela
 * feature "Ver painel do cliente" no AdminPanel.
 *
 * Fluxo:
 *   1. Admin manda POST com { target_user_id }
 *   2. Func verifica JWT do admin → confirma is_admin (profiles.is_admin OR bootstrap email)
 *   3. Busca email do target em auth.users
 *   4. Gera magic link via auth.admin.generateLink({ type: 'magiclink' })
 *   5. Troca o hashed_token por sessão via verifyOtp (chamado em cliente anon)
 *   6. Registra a ação em admin_audit_log
 *   7. Retorna { access_token, refresh_token, expires_at, target_email, target_name }
 *
 * O frontend usa esses tokens pra fazer setSession() num CLIENTE SUPABASE
 * SECUNDÁRIO (storageKey isolado) — assim o admin não perde a própria sessão.
 *
 * SECURITY:
 *   - Requer JWT válido (Authorization header) com is_admin=true
 *   - Toda chamada registrada em admin_audit_log com IP e user_agent
 *   - Magic link expira em ~5 min (config padrão do GoTrue)
 *   - Tokens retornados expiram em 1h (config padrão da access_token)
 *   - NÃO logamos tokens em console nem em DB
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BOOTSTRAP_ADMINS = new Set(["migueldrops@gmail.com"]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ─── 1. Autenticação admin ──────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const adminUser = userData.user;

  // Confirma is_admin
  let isAdmin = adminUser.email ? BOOTSTRAP_ADMINS.has(adminUser.email) : false;
  if (!isAdmin) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", adminUser.id)
      .maybeSingle();
    isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin === true;
  }
  if (!isAdmin) {
    // Audit log da tentativa falha pra detectar abuso
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: adminUser.id,
      target_user_id: null,
      action: "impersonate_denied_not_admin",
      metadata: { admin_email: adminUser.email },
      ip_address: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    } as never);
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ─── 2. Parse body ──────────────────────────────────────────────────────
  let body: { target_user_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const targetUserId = body.target_user_id;
  if (!targetUserId || typeof targetUserId !== "string") {
    return new Response(JSON.stringify({ error: "Missing target_user_id" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ─── 3. Busca email do target ───────────────────────────────────────────
  // Usa admin.getUserById que retorna email mesmo se RLS bloquear profiles.
  const { data: targetUserData, error: targetErr } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
  if (targetErr || !targetUserData?.user) {
    return new Response(JSON.stringify({ error: "Target user not found" }), {
      status: 404,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const targetEmail = targetUserData.user.email;
  if (!targetEmail) {
    return new Response(JSON.stringify({ error: "Target user has no email" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Busca display_name do profile pra mostrar no banner do view-as
  const { data: targetProfile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, phone_number")
    .eq("id", targetUserId)
    .maybeSingle();

  // ─── 4. Gera magic link ─────────────────────────────────────────────────
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: targetEmail,
  });
  if (linkErr || !linkData?.properties) {
    console.error("[admin-impersonate-token] generateLink failed:", linkErr);
    return new Response(JSON.stringify({ error: "Failed to generate impersonation link" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const hashedToken = (linkData.properties as { hashed_token?: string }).hashed_token;
  if (!hashedToken) {
    return new Response(JSON.stringify({ error: "Magic link has no hashed_token" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ─── 5. Troca o hashed_token por session via verifyOtp ──────────────────
  // Usa um cliente ANÔNIMO fresco — não passa Authorization header pra não
  // confundir o GoTrue com o JWT do admin.
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: sessionData, error: otpErr } = await anonClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });

  if (otpErr || !sessionData?.session) {
    console.error("[admin-impersonate-token] verifyOtp failed:", otpErr);
    return new Response(JSON.stringify({ error: "Failed to exchange token for session" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const session = sessionData.session;

  // ─── 6. Registra no audit log ───────────────────────────────────────────
  // Best-effort: se o insert falhar, não bloqueia o retorno (admin precisa do
  // token), mas loga. Sempre falha aqui = investigar table/RLS.
  const { error: auditErr } = await supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: adminUser.id,
    target_user_id: targetUserId,
    action: "impersonate_token_generated",
    metadata: {
      admin_email: adminUser.email,
      target_email: targetEmail,
      target_name: targetProfile?.display_name ?? null,
      expires_at: new Date(Date.now() + (session.expires_in ?? 3600) * 1000).toISOString(),
    },
    ip_address: req.headers.get("x-forwarded-for") ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  } as never);
  if (auditErr) {
    console.error("[admin-impersonate-token] audit log insert failed:", auditErr);
  }

  // ─── 7. Retorna os tokens pro frontend ──────────────────────────────────
  return new Response(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in ?? 3600,
      expires_at: session.expires_at ?? null,
      target_user: {
        id: targetUserId,
        email: targetEmail,
        display_name: targetProfile?.display_name ?? null,
        phone_number: targetProfile?.phone_number ?? null,
      },
    }),
    {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    }
  );
});
