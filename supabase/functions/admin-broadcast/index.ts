/**
 * admin-broadcast
 * POST { user_ids: string[], message: string, scheduled_at?: string }
 * Envia ou agenda uma mensagem WhatsApp para os usuários selecionados.
 * Suporta variáveis: {{nome}}, {{user_name}}, {{first_name}}, {{full_name}}
 * Protegido: apenas admin (is_admin=true no profile ou bootstrap list).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Substitui variáveis do template com dados do perfil. */
function applyTemplate(tpl: string, profile: { display_name?: string | null }): string {
  const full = (profile.display_name ?? "").trim();
  const first = full.split(/\s+/)[0] || "";
  return tpl
    .replace(/\{\{\s*(nome|user_name|first_name)\s*\}\}/gi, first)
    .replace(/\{\{\s*full_name\s*\}\}/gi, full);
}

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
  let body: { user_ids: string[]; message: string; scheduled_at?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, CORS);
  }

  const { user_ids, message, scheduled_at } = body;
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

  // ── Modo AGENDAMENTO ──────────────────────────────────────────────────────
  if (scheduled_at) {
    const sendAt = new Date(scheduled_at);
    if (isNaN(sendAt.getTime())) {
      return json({ error: "scheduled_at invalid" }, 400, CORS);
    }
    if (sendAt.getTime() < Date.now() - 60_000) {
      return json({ error: "scheduled_at must be in the future" }, 400, CORS);
    }
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("scheduled_broadcasts" as any)
      .insert({
        admin_id: user.id,
        message: message.trim(),
        user_ids,
        send_at: sendAt.toISOString(),
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (insErr) {
      return json({ error: "failed to schedule: " + insErr.message }, 500, CORS);
    }
    return json({ ok: true, scheduled: true, id: (inserted as any)?.id, send_at: sendAt.toISOString() }, 200, CORS);
  }

  // ── Modo ENVIO IMEDIATO ───────────────────────────────────────────────────
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, phone_number, whatsapp_lid")
    .in("id", user_ids);

  if (profErr || !profiles) {
    return json({ error: "failed to load profiles" }, 500, CORS);
  }

  const results: { user_id: string; name: string; ok: boolean; error?: string }[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const target = (profile.phone_number ?? "").replace(/\D/g, "") || profile.whatsapp_lid;

    if (!target) {
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: false, error: "no_phone" });
      skipped++;
      continue;
    }

    try {
      const personalized = applyTemplate(message.trim(), profile);
      await sendText(target, personalized);
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: true });
      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ user_id: profile.id, name: profile.display_name ?? "–", ok: false, error: errMsg });
      failed++;
    }

    if (i < profiles.length - 1) await sleep(250);
  }

  await supabaseAdmin.from("broadcast_logs" as any).insert({
    admin_id: user.id,
    message: message.trim(),
    total: user_ids.length,
    sent,
    failed,
    skipped,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});

  return json({ ok: true, sent, failed, skipped, results }, 200, CORS);
});
