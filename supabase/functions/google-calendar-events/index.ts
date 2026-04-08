/**
 * google-calendar-events
 * Busca eventos do Google Calendar do usuario autenticado.
 * Retorna lista de eventos em formato compativel com a agenda nativa.
 *
 * Query params:
 *   timeMin - ISO datetime (inicio do range)
 *   timeMax - ISO datetime (fim do range)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

async function getSetting(key: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? Deno.env.get(key.toUpperCase()) ?? "";
}

/** Renova token Google se expirado */
async function refreshGoogleToken(integration: any): Promise<string | null> {
  if (
    integration.refresh_token &&
    integration.expires_at &&
    new Date(integration.expires_at) <= new Date(Date.now() + 60_000)
  ) {
    const clientId = await getSetting("google_client_id");
    const clientSecret = await getSetting("google_client_secret");
    if (!clientId || !clientSecret) return integration.access_token;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: integration.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.access_token) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      await supabase
        .from("integrations")
        .update({ access_token: tokens.access_token, expires_at: expiresAt })
        .eq("id", integration.id);
      return tokens.access_token;
    }
    if (tokens.error === "invalid_grant") {
      await supabase
        .from("integrations")
        .update({ is_connected: false, access_token: null, refresh_token: null })
        .eq("id", integration.id);
      return null;
    }
  }
  return integration.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // Autentica usuario via JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Nao autenticado" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Busca integracao Google Calendar
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "google_calendar")
      .eq("is_connected", true)
      .maybeSingle();

    if (!integration?.access_token) {
      return new Response(JSON.stringify({ connected: false, events: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Renova token se necessario
    const accessToken = await refreshGoogleToken(integration);
    if (!accessToken) {
      return new Response(JSON.stringify({ connected: false, events: [], error: "token_expired" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Parse query params
    const url = new URL(req.url);
    const timeMin = url.searchParams.get("timeMin") || new Date().toISOString();
    const timeMax = url.searchParams.get("timeMax") ||
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 dias

    // Busca eventos do Google Calendar
    const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    calendarUrl.searchParams.set("timeMin", timeMin);
    calendarUrl.searchParams.set("timeMax", timeMax);
    calendarUrl.searchParams.set("singleEvents", "true");
    calendarUrl.searchParams.set("orderBy", "startTime");
    calendarUrl.searchParams.set("maxResults", "250");

    const calRes = await fetch(calendarUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!calRes.ok) {
      const errBody = await calRes.text();
      console.error("Google Calendar API error:", calRes.status, errBody);
      return new Response(JSON.stringify({ connected: true, events: [], error: "google_api_error" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const calData = await calRes.json();
    const googleEvents = (calData.items || []).map((item: any) => {
      // Converte formato Google Calendar para formato da agenda Maya
      const isAllDay = !!item.start?.date;
      const startDate = isAllDay
        ? item.start.date
        : item.start?.dateTime?.split("T")[0];
      const startTime = isAllDay
        ? null
        : item.start?.dateTime?.split("T")[1]?.slice(0, 5);
      const endTime = isAllDay
        ? null
        : item.end?.dateTime?.split("T")[1]?.slice(0, 5);

      return {
        id: `gcal_${item.id}`,
        google_event_id: item.id,
        title: item.summary || "(Sem titulo)",
        description: item.description || null,
        event_date: startDate,
        event_time: startTime,
        end_time: endTime,
        location: item.location || null,
        event_type: "compromisso",
        priority: null,
        color: "#4285f4", // Azul Google
        reminder: false,
        reminder_minutes_before: null,
        status: item.status === "cancelled" ? "cancelled" : "pending",
        source: "google_calendar",
        user_id: user.id,
        created_at: item.created,
      };
    });

    return new Response(JSON.stringify({
      connected: true,
      events: googleEvents,
      email: integration.metadata?.email || null,
    }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("google-calendar-events error:", err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
