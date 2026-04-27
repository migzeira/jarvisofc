/**
 * admin-settings
 * GET  → retorna as configurações (sem expor secrets completos)
 * POST → salva configurações (google_client_id, etc.)
 * Protegido: só funciona com o JWT do usuário dono da conta (owner check via profiles)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

const ALLOWED_KEYS = [
  "whatsapp_number",
  "google_client_id",
  "google_client_secret",
  "notion_client_id",
  "notion_client_secret",
  "dashboard_url",
  "renewal_link",          // legacy — mantido pra retrocompat
  "renewal_link_monthly",
  "renewal_link_annual",
  "renewal_reminders_enabled",
  "overdue_grace_days",
  // Roteamento de IA — permite usar OpenAI (mais barato) em tarefas de chat
  // simples mantendo Claude pra extrações estruturadas críticas.
  "openai_api_key",        // mascarado na exibição (lógica abaixo)
  "ai_chat_provider",      // "claude" (default) | "openai"
];

// Keys cuja value deve ser mascarada quando exibida no painel.
// "secret" cobre google_client_secret e notion_client_secret automaticamente.
const SECRET_KEY_NAMES = new Set(["openai_api_key"]);

serve(async (req) => {
  const CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Verifica autenticação
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS });

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS });

  // Autorização admin: aceita is_admin=true no profile OU email no bootstrap list.
  // O bootstrap garante que o admin inicial sempre funciona mesmo se a coluna
  // ainda não tiver sido preenchida (compatibilidade com deploys antigos).
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
  if (!isAdmin) {
    return new Response("Forbidden", { status: 403, headers: CORS });
  }

  if (req.method === "GET") {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value");

    // Mascara secrets na exibição (chaves contendo "secret" + lista explícita
    // SECRET_KEY_NAMES — ex: openai_api_key, que não tem "secret" no nome)
    const masked = (data ?? []).map((row) => {
      const isSecret = row.key.includes("secret") || SECRET_KEY_NAMES.has(row.key);
      return {
        key: row.key,
        value: isSecret && row.value && row.value.length >= 8
          ? row.value.slice(0, 4) + "••••••••" + row.value.slice(-4)
          : row.value,
        configured: (row.value ?? "").length > 0,
      };
    });

    return new Response(JSON.stringify(masked), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const body = await req.json() as Record<string, string>;

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (value === undefined || value === null) continue;

      await supabaseAdmin
        .from("app_settings")
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS });
});
