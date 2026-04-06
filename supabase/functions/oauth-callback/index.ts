/**
 * oauth-callback
 * Recebe o código de autorização do Google/Notion,
 * troca por tokens e salva na tabela integrations.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(`${DASHBOARD_URL}?error=${error}`);
  }

  if (!code || !stateRaw) {
    return Response.redirect(`${DASHBOARD_URL}?error=missing_params`);
  }

  let state: { provider: string; userId: string };
  try {
    state = JSON.parse(atob(stateRaw));
  } catch {
    return Response.redirect(`${DASHBOARD_URL}?error=invalid_state`);
  }

  const { provider, userId } = state;

  const dashboardUrl = await getSetting("dashboard_url") || "https://mayachat.com.br/dashboard/integracoes";

  try {
    if (provider === "google_calendar" || provider === "google_sheets") {
      const googleClientId = await getSetting("google_client_id");
      const googleClientSecret = await getSetting("google_client_secret");
      // Troca código por tokens Google
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: CALLBACK_URL,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) throw new Error(tokens.error_description);

      // Busca email da conta Google
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = await userInfoRes.json();

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      // Salva/atualiza Google Calendar
      await supabase.from("integrations").upsert({
        user_id: userId,
        provider: "google_calendar",
        is_connected: true,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        metadata: { email: userInfo.email },
      }, { onConflict: "user_id,provider" });

      // Salva/atualiza Google Sheets com os mesmos tokens
      await supabase.from("integrations").upsert({
        user_id: userId,
        provider: "google_sheets",
        is_connected: true,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        metadata: { email: userInfo.email },
      }, { onConflict: "user_id,provider" });

    } else if (provider === "notion") {
      const notionClientId = await getSetting("notion_client_id");
      const notionClientSecret = await getSetting("notion_client_secret");
      // Troca código por token Notion
      const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${notionClientId}:${notionClientSecret}`)}`,
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: CALLBACK_URL,
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) throw new Error(tokens.error);

      await supabase.from("integrations").upsert({
        user_id: userId,
        provider: "notion",
        is_connected: true,
        access_token: tokens.access_token,
        connected_at: new Date().toISOString(),
        metadata: {
          workspace_name: tokens.workspace_name,
          workspace_icon: tokens.workspace_icon,
          bot_id: tokens.bot_id,
        },
      }, { onConflict: "user_id,provider" });
    }

    return Response.redirect(`${dashboardUrl}?success=${provider}`);
  } catch (err) {
    console.error("oauth-callback error:", err);
    return Response.redirect(`${dashboardUrl}?error=token_exchange_failed`);
  }
});
