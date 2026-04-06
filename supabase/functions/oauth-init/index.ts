/**
 * oauth-init
 * Gera a URL de autorização OAuth para Google ou Notion.
 * Chamado pelo frontend com ?provider=google_calendar&user_id=xxx
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/oauth-callback`;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getSetting(key: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? Deno.env.get(key.toUpperCase()) ?? "";
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const userId = url.searchParams.get("user_id");

  if (!provider || !userId) {
    return new Response(JSON.stringify({ error: "provider and user_id required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const state = btoa(JSON.stringify({ provider, userId }));
  let authUrl: string;

  if (provider === "google_calendar" || provider === "google_sheets") {
    const googleClientId = await getSetting("google_client_id");
    if (!googleClientId) {
      return new Response(JSON.stringify({ error: "Google Client ID não configurado. Vá em Configurações → Integrações → Credenciais." }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" ");

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: CALLBACK_URL,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  } else if (provider === "notion") {
    const notionClientId = await getSetting("notion_client_id");
    if (!notionClientId) {
      return new Response(JSON.stringify({ error: "Notion Client ID não configurado. Vá em Configurações → Integrações → Credenciais." }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      client_id: notionClientId,
      redirect_uri: CALLBACK_URL,
      response_type: "code",
      owner: "user",
      state,
    });
    authUrl = `https://api.notion.com/v1/oauth/authorize?${params}`;

  } else {
    return new Response(JSON.stringify({ error: "unknown provider" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
