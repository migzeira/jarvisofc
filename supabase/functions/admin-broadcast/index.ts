/**
 * admin-broadcast
 * POST { user_ids: string[], message: string }
 * Envia uma mensagem WhatsApp manual para os usuários selecionados.
 * Protegido: apenas admin (is_admin=true no profile ou bootstrap list).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ALLOWED_ORIGINS = [
  "https://heyjarvis.com.br",
  "https://www.heyjarvis.com.br",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(data: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/** Aguarda N ms (evita throttle da Evolution API) */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

serve(async (req) => {
  const CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, CORS);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401, CORS);

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401, CORS);

  // Verifica admin: bootstrap list OU is_admin no perfil
  const BOOTSTRAP_ADMINS = new Set(["migueldrops@gmail.com"]);
  let isAdmin = user.email ? BOOTSTRAP_ADMINS.has(user.email) : false;
  if (!isAdmin) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = (profile as any)?.is_admin === true;
  }
  if (!isAdmin) return json({ error: "forbidden" }, 403, CORS);

  // ── Payload ───────────────────────────────────────────────────────────────
  let body: { user_ids: string[]; message: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, CORS);
  }

  const { user_ids, message } = body;
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return json({ error: "user_ids must be a non-empty array" }, 400, CORS);
  }
  if (!message || message.trim().length === 0) {
    return json({ error: "message is required" }, 400, CORS);
  }
  if (message.length > 4000) {
    return json({ error: "message too long (max 4000 chars)" }, 400, CORS);
  }
  if (user_ids.length > 500) {
    return json({ error: "too many recipients (max 500)" }, 400, CORS);
  }

  // ── Carrega perfis dos destinatários ──────────────────────────────────────
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, phone_number, whatsapp_lid")
    .in("id", user_ids);

  if (profErr || !profiles) {
    return json({ error: "failed to load profiles" }, 500, CORS);
  }

  // ── Envia mensagens ───────────────────────────────────────────────────────
  const results: { user_id: string; name: string; ok: boolean; error?: string }[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const profile of profiles) {
    // Usa phone_number preferencial; cai para whatsapp_lid como fallback
    const target = (profile.phone_number ?? "").replace(/\D/g, "") || profile.whatsapp_lid;

    if (!target) {
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: false, error: "no_phone" });
      skipped++;
      continue;
    }

    try {
      await sendText(target, message.trim());
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: true });
      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: false, error: errMsg });
      failed++;
    }

    // 250ms entre envios para não saturar a Evolution API
    if (profiles.indexOf(profile) < profiles.length - 1) {
      await sleep(250);
    }
  }

  // ── Log da operação no Supabase ───────────────────────────────────────────
  await supabaseAdmin.from("broadcast_logs" as any).insert({
    admin_id: user.id,
    message: message.trim(),
    total: user_ids.length,
    sent,
    failed,
    skipped,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {}); // log é best-effort, não bloqueia

  return json({ ok: true, sent, failed, skipped, results }, 200, CORS);
});
