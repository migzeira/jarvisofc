/**
 * whatsapp-session-manager
 *
 * Gerencia sessoes WPPConnect Server pelo painel admin:
 *   - list           → retorna numeros + status (puxa do banco)
 *   - create         → cria entrada em jarvis_numbers + start-session no WPPConnect
 *   - qr             → retorna QR base64 da sessao
 *   - status         → consulta status real no WPPConnect e atualiza banco
 *   - close          → fecha sessao no WPPConnect (mantem registro)
 *   - logout         → desconecta completamente (limpa credenciais)
 *   - delete         → remove registro do banco (so se nao tem users assignados)
 *   - reassign-all   → realoca todos users desse numero pra outros (usar quando banir)
 *   - update         → muda label/is_active
 *
 * Auth: requer JWT admin (is_admin=true ou bootstrap email).
 *
 * Env necessario:
 *   WPPCONNECT_URL          → ex: http://72.62.8.63:21465
 *   WPPCONNECT_SECRET_KEY   → secret pra gerar tokens (ex: THISISMYSECURETOKEN)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const WPPCONNECT_URL = Deno.env.get("WPPCONNECT_URL") ?? "";
const WPPCONNECT_SECRET = Deno.env.get("WPPCONNECT_SECRET_KEY") ?? "";

const BOOTSTRAP_ADMINS = new Set(["migueldrops@gmail.com"]);

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, cors_: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors_, "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// WPPConnect API helpers
// ─────────────────────────────────────────────────────────────────────────

/** Gera token pra uma sessao no WPPConnect. Necessario antes de start-session.
 *
 * IMPORTANTE: WPPConnect 2.9.0 rejeita o "full" token (formato "session:hash") no
 * header Authorization. Aceita SO o `token` puro (hash $2b$10$...). Retornamos
 * `token` aqui pra todas as chamadas subsequentes (start-session, status, qr,
 * close, logout) usarem corretamente como `Authorization: Bearer <token>`.
 */
async function wppGenerateToken(session: string): Promise<{ token: string; full: string } | null> {
  if (!WPPCONNECT_URL || !WPPCONNECT_SECRET) return null;
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/${encodeURIComponent(WPPCONNECT_SECRET)}/generate-token`;
  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return { token: data.token, full: data.full };
  } catch (err) {
    console.error("[wppGenerateToken]", err);
    return null;
  }
}

/** Inicia sessao (gera QR). webhookUrl recebe mensagens. */
async function wppStartSession(session: string, fullToken: string, webhookUrl: string): Promise<any> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/start-session`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${fullToken}`,
    },
    body: JSON.stringify({ webhook: webhookUrl, waitQrCode: false }),
  });
  return await res.json().catch(() => ({}));
}

/** Retorna QR como PNG base64 (data URL nao incluida, so o base64 puro). */
async function wppGetQrPng(session: string, fullToken: string): Promise<string | null> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/qrcode-session`;
  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${fullToken}` },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // base64 encode
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return btoa(binary);
  } catch (err) {
    console.error("[wppGetQrPng]", err);
    return null;
  }
}

/** Verifica se sessao esta conectada. */
async function wppCheckConnection(session: string, fullToken: string): Promise<{ connected: boolean; raw: any }> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/check-connection-session`;
  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${fullToken}` },
    });
    const raw = await res.json().catch(() => ({}));
    return { connected: raw?.status === true, raw };
  } catch (err) {
    return { connected: false, raw: { error: String(err) } };
  }
}

/** Pega status detalhado: qrcode, CONNECTED, CLOSED etc. */
async function wppStatusSession(session: string, fullToken: string): Promise<any> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/status-session`;
  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${fullToken}` },
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

async function wppCloseSession(session: string, fullToken: string): Promise<void> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/close-session`;
  try {
    await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${fullToken}` } });
  } catch (err) {
    console.error("[wppCloseSession]", err);
  }
}

async function wppLogoutSession(session: string, fullToken: string): Promise<void> {
  const url = `${WPPCONNECT_URL}/api/${encodeURIComponent(session)}/logout-session`;
  try {
    await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${fullToken}` } });
  } catch (err) {
    console.error("[wppLogoutSession]", err);
  }
}

/** Mapeia status do WPPConnect pro nosso enum. */
function mapWppStatus(wppStatus: string): "qrcode" | "connecting" | "connected" | "closed" | "pending" {
  const s = (wppStatus ?? "").toLowerCase();
  if (s === "qrcode" || s === "qrreadsuccess" || s === "qrreadfail") return "qrcode";
  if (s === "connected" || s === "isLogged" || s === "inchat" || s === "successchat") return "connected";
  if (s === "starting" || s === "connecting" || s === "browser" || s === "syncing") return "connecting";
  if (s === "closed" || s === "notlogged" || s === "deleted") return "closed";
  return "pending";
}

// ─────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────

async function authenticateAdmin(req: Request): Promise<{ user: any; ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, status: 401, error: "Missing Authorization header" };

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, status: 401, error: "Invalid token" };

  const adminUser = userData.user;
  let isAdmin = adminUser.email ? BOOTSTRAP_ADMINS.has(adminUser.email) : false;
  if (!isAdmin) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", adminUser.id)
      .maybeSingle();
    isAdmin = (profile as any)?.is_admin === true;
  }
  if (!isAdmin) return { ok: false, status: 403, error: "Not an admin" };

  return { user: adminUser, ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────

/** Retorna a URL do webhook que as mensagens devem chegar */
function webhookUrl(): string {
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  return `${supaUrl}/functions/v1/whatsapp-webhook`;
}

/** Garante que existe um token pra essa sessao. Salva no row (encrypted? por ora plain). */
async function ensureSessionToken(numberId: string, sessionName: string): Promise<string | null> {
  // Verifica se ja tem token salvo
  const { data: existing } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("notes")
    .eq("id", numberId)
    .maybeSingle();

  // Notes guarda { token: "..." } como JSON. Hack temporario — fase 2 criar coluna dedicada.
  const notesObj = (() => {
    try { return existing?.notes ? JSON.parse(existing.notes) : {}; } catch { return {}; }
  })();

  if (notesObj.token) return notesObj.token;

  // Gera novo. CRITICO: salvar `tok.token` (hash puro), NAO `tok.full`
  // (que tem prefixo "session:"). WPPConnect 2.9.0 rejeita o full no
  // header Authorization com 401.
  const tok = await wppGenerateToken(sessionName);
  if (!tok) return null;

  notesObj.token = tok.token;
  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update({ notes: JSON.stringify(notesObj) })
    .eq("id", numberId);

  return tok.token;
}

async function actionList() {
  const { data, error } = await supabaseAdmin
    .from("jarvis_numbers_with_stats" as any)
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return json({ error: error.message }, 500);
  // Esconde token de notes na resposta
  const sanitized = (data ?? []).map((n: any) => ({
    ...n,
    notes: stripTokenFromNotes(n.notes),
  }));
  return json({ numbers: sanitized });
}

function stripTokenFromNotes(notes: string | null): string | null {
  if (!notes) return notes;
  try {
    const o = JSON.parse(notes);
    if (o.token) {
      const { token, ...rest } = o;
      return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
    }
    return notes;
  } catch {
    return notes;
  }
}

async function actionCreate(body: any) {
  const sessionName = String(body.session_name ?? "").trim();
  const displayLabel = String(body.display_label ?? "Jarvis").trim();
  if (!sessionName) return json({ error: "session_name required" }, 400);
  if (!/^[a-z0-9_-]+$/i.test(sessionName)) return json({ error: "session_name deve ser alfanumerico (a-z, 0-9, _-)" }, 400);

  // Verifica duplicidade
  const { data: existing } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("id")
    .eq("session_name", sessionName)
    .maybeSingle();
  if (existing) return json({ error: "Ja existe um numero com esse session_name" }, 409);

  // Insere registro
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .insert({
      session_name: sessionName,
      display_label: displayLabel,
      connection_status: "pending",
    })
    .select()
    .single();
  if (insertErr || !inserted) return json({ error: insertErr?.message ?? "insert failed" }, 500);

  // Gera token + inicia sessao no WPPConnect
  const fullToken = await ensureSessionToken((inserted as any).id, sessionName);
  if (!fullToken) {
    return json({
      error: "Falha ao gerar token no WPPConnect. Verifique WPPCONNECT_URL/SECRET_KEY.",
      number: inserted,
    }, 502);
  }

  await wppStartSession(sessionName, fullToken, webhookUrl());

  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update({ connection_status: "qrcode", last_qr_at: new Date().toISOString() })
    .eq("id", (inserted as any).id);

  return json({ ok: true, number: { ...(inserted as any), connection_status: "qrcode" } });
}

async function actionQr(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  const { data: num } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("id, session_name")
    .eq("id", numberId)
    .maybeSingle();
  if (!num) return json({ error: "number not found" }, 404);

  const fullToken = await ensureSessionToken(numberId, (num as any).session_name);
  if (!fullToken) return json({ error: "no token" }, 500);

  const qrBase64 = await wppGetQrPng((num as any).session_name, fullToken);
  if (!qrBase64) return json({ error: "QR nao disponivel (sessao pode estar conectada ou ainda iniciando)" }, 404);

  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update({ last_qr_at: new Date().toISOString() })
    .eq("id", numberId);

  return json({ qr: `data:image/png;base64,${qrBase64}` });
}

async function actionStatus(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  const { data: num } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("id, session_name, connection_status")
    .eq("id", numberId)
    .maybeSingle();
  if (!num) return json({ error: "number not found" }, 404);

  const fullToken = await ensureSessionToken(numberId, (num as any).session_name);
  if (!fullToken) return json({ status: "pending", error: "no token" });

  // Pega status real do WPPConnect
  const wppStatus = await wppStatusSession((num as any).session_name, fullToken);
  const mapped = mapWppStatus(wppStatus?.status ?? "");

  // Atualiza banco se status mudou
  const updates: any = { connection_status: mapped };
  if (mapped === "connected" && (num as any).connection_status !== "connected") {
    updates.last_connected_at = new Date().toISOString();
  }
  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update(updates)
    .eq("id", numberId);

  return json({
    status: mapped,
    raw_status: wppStatus?.status,
  });
}

async function actionClose(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  const { data: num } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("id, session_name")
    .eq("id", numberId)
    .maybeSingle();
  if (!num) return json({ error: "number not found" }, 404);

  const fullToken = await ensureSessionToken(numberId, (num as any).session_name);
  if (fullToken) await wppCloseSession((num as any).session_name, fullToken);

  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update({ connection_status: "closed" })
    .eq("id", numberId);

  return json({ ok: true });
}

async function actionLogout(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  const { data: num } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("id, session_name")
    .eq("id", numberId)
    .maybeSingle();
  if (!num) return json({ error: "number not found" }, 404);

  const fullToken = await ensureSessionToken(numberId, (num as any).session_name);
  if (fullToken) {
    await wppLogoutSession((num as any).session_name, fullToken);
    await wppCloseSession((num as any).session_name, fullToken);
  }

  await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update({ connection_status: "closed", phone_number: null })
    .eq("id", numberId);

  return json({ ok: true });
}

async function actionDelete(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  // Verifica se tem assignments — se sim, bloqueia (admin precisa reassign primeiro)
  const { count } = await supabaseAdmin
    .from("user_jarvis_assignments" as any)
    .select("*", { count: "exact", head: true })
    .eq("jarvis_number_id", numberId);
  if ((count ?? 0) > 0) {
    return json({
      error: `Existem ${count} users atribuidos a este numero. Use Reassign-all antes de deletar.`,
    }, 409);
  }

  // Tenta fechar sessao no WPPConnect
  const { data: num } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .select("session_name")
    .eq("id", numberId)
    .maybeSingle();
  if (num) {
    const fullToken = await ensureSessionToken(numberId, (num as any).session_name);
    if (fullToken) await wppLogoutSession((num as any).session_name, fullToken);
  }

  const { error } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .delete()
    .eq("id", numberId);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}

async function actionUpdate(body: any) {
  const numberId = String(body.id ?? "");
  if (!numberId) return json({ error: "id required" }, 400);

  const patch: any = {};
  if (typeof body.display_label === "string") patch.display_label = body.display_label.trim();
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.phone_number === "string") patch.phone_number = body.phone_number.trim() || null;

  if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);

  const { error } = await supabaseAdmin
    .from("jarvis_numbers" as any)
    .update(patch)
    .eq("id", numberId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function actionReassignAll(body: any) {
  const fromId = String(body.id ?? "");
  if (!fromId) return json({ error: "id required" }, 400);

  // Pega outro numero connected + active (excluindo o atual)
  const { data: target } = await supabaseAdmin
    .from("jarvis_numbers_with_stats" as any)
    .select("id, user_count, daily_msg_count")
    .neq("id", fromId)
    .eq("is_active", true)
    .eq("connection_status", "connected")
    .order("user_count", { ascending: true })
    .order("daily_msg_count", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!target) return json({ error: "Nenhum outro numero ATIVO e CONNECTED disponivel pra reassign" }, 409);

  // Move TODOS os assignments
  const { error: moveErr, count } = await supabaseAdmin
    .from("user_jarvis_assignments" as any)
    .update({
      jarvis_number_id: (target as any).id,
      previous_number_id: fromId,
      reassign_reason: body.reason ?? "manual",
      reassign_count: (supabaseAdmin as any).rpc ? undefined : 1, // increment via rpc se possivel
    })
    .eq("jarvis_number_id", fromId)
    .select("*", { count: "exact", head: true });

  if (moveErr) return json({ error: moveErr.message }, 500);

  return json({ ok: true, reassigned_count: count ?? 0, target_id: (target as any).id });
}

// ─────────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const CORS = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, CORS);

  // Auth
  const auth = await authenticateAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status, CORS);

  // Config check
  if (!WPPCONNECT_URL) {
    return json({ error: "WPPCONNECT_URL nao configurado nos Secrets" }, 500, CORS);
  }
  if (!WPPCONNECT_SECRET) {
    return json({ error: "WPPCONNECT_SECRET_KEY nao configurado nos Secrets" }, 500, CORS);
  }

  // Parse body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, CORS);
  }

  const action = String(body.action ?? "").trim();
  let response: Response;
  try {
    switch (action) {
      case "list":         response = await actionList(); break;
      case "create":       response = await actionCreate(body); break;
      case "qr":           response = await actionQr(body); break;
      case "status":       response = await actionStatus(body); break;
      case "close":        response = await actionClose(body); break;
      case "logout":       response = await actionLogout(body); break;
      case "delete":       response = await actionDelete(body); break;
      case "update":       response = await actionUpdate(body); break;
      case "reassign-all": response = await actionReassignAll(body); break;
      default:
        return json({ error: `Unknown action: ${action}` }, 400, CORS);
    }
  } catch (err) {
    console.error("[whatsapp-session-manager]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, CORS);
  }

  // Re-inject CORS no response
  const body2 = await response.text();
  return new Response(body2, {
    status: response.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
