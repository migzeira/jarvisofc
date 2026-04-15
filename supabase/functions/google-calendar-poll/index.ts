/**
 * google-calendar-poll
 * Cron job que verifica o Google Calendar de cada usuário conectado a cada 2 min.
 * Sincroniza eventos novos/alterados/cancelados pro dashboard do Jarvis e
 * notifica o usuário no WhatsApp.
 *
 * Primeira sincronização: importa últimos 30 dias + futuros (sem notificar).
 * Sincronizações seguintes: usa updatedMin pra pegar só mudanças desde a última poll.
 *
 * Trigger: pg_cron (a cada 2 min) → POST sem body.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? Deno.env.get(key.toUpperCase()) ?? "";
}

/** Renova o access_token se faltar < 60s pra expirar. Retorna token válido ou null. */
async function refreshGoogleToken(integration: any): Promise<string | null> {
  if (
    !integration.refresh_token ||
    !integration.expires_at ||
    new Date(integration.expires_at) > new Date(Date.now() + 60_000)
  ) {
    return integration.access_token;
  }

  const clientId = await getSetting("google_client_id");
  const clientSecret = await getSetting("google_client_secret");
  if (!clientId || !clientSecret) {
    console.warn("[gcal-poll] Google credentials missing in app_settings");
    return integration.access_token;
  }

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
    console.error("[gcal-poll] refresh token invalid for user", integration.user_id);
    await supabase
      .from("integrations")
      .update({ is_connected: false, access_token: null, refresh_token: null })
      .eq("id", integration.id);
    return null;
  }
  console.error("[gcal-poll] token refresh failed:", tokens.error_description ?? tokens.error);
  return null;
}

/** Formata data+hora pra mensagem WhatsApp em PT-BR */
function fmtDateTime(date: string, time: string | null, tz: string): string {
  // date = "YYYY-MM-DD", time = "HH:MM" ou null (all-day)
  if (!time) {
    const d = new Date(`${date}T12:00:00Z`);
    const dateStr = d.toLocaleDateString("pt-BR", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return `${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} (dia inteiro)`;
  }
  const dt = new Date(`${date}T${time}:00`);
  const dateStr = dt.toLocaleDateString("pt-BR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} às ${time}`;
}

/** Extrai a URL de videoconferência (Google Meet, Zoom, Teams) do evento Google */
function extractMeetingUrl(item: any): string | null {
  // 1) Google Meet legacy field
  if (typeof item.hangoutLink === "string" && item.hangoutLink) return item.hangoutLink;

  // 2) conferenceData.entryPoints (Meet, Zoom, etc. via add-ons)
  const eps = item?.conferenceData?.entryPoints;
  if (Array.isArray(eps)) {
    const video = eps.find((ep: any) => ep?.entryPointType === "video" && typeof ep.uri === "string");
    if (video?.uri) return video.uri;
  }

  // 3) Fallback: pesquisa por URL de meet/zoom/teams na location ou description
  const haystack = `${item.location ?? ""}\n${item.description ?? ""}`;
  const m = haystack.match(/https?:\/\/(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s)>\]"']+/i);
  return m ? m[0] : null;
}

/** Converte item do Google Calendar pro shape interno da tabela events */
function googleEventToRow(item: any, userId: string): {
  google_event_id: string;
  title: string;
  description: string | null;
  event_date: string | null;
  event_time: string | null;
  end_time: string | null;
  location: string | null;
  meeting_url: string | null;
  status: string;
} {
  const isAllDay = !!item.start?.date;
  const eventDate = isAllDay
    ? item.start.date
    : item.start?.dateTime?.split("T")[0] ?? null;
  const eventTime = isAllDay
    ? null
    : item.start?.dateTime?.split("T")[1]?.slice(0, 5) ?? null;
  const endTime = isAllDay
    ? null
    : item.end?.dateTime?.split("T")[1]?.slice(0, 5) ?? null;

  return {
    google_event_id: item.id,
    title: item.summary || "(Sem título)",
    description: item.description ?? null,
    event_date: eventDate,
    event_time: eventTime,
    end_time: endTime,
    location: item.location ?? null,
    meeting_url: extractMeetingUrl(item),
    status: item.status === "cancelled" ? "cancelled" : "pending",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync de um único usuário
// ─────────────────────────────────────────────────────────────────────────────

async function syncUser(integration: any): Promise<{
  user_id: string;
  imported: number;
  updated: number;
  cancelled: number;
  notified: number;
  error?: string;
}> {
  const stats = { user_id: integration.user_id, imported: 0, updated: 0, cancelled: 0, notified: 0 };

  // Renova token
  const accessToken = await refreshGoogleToken(integration);
  if (!accessToken) return { ...stats, error: "no_access_token" };

  // Carrega profile pra notificações
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number, timezone, display_name")
    .eq("id", integration.user_id)
    .maybeSingle();
  const phone = profile?.phone_number?.replace(/\D/g, "") ?? null;
  const tz = (profile?.timezone as string) || "America/Sao_Paulo";
  const nick = (profile?.display_name as string)?.split(" ")[0] ?? "";

  // Determina janela de sync
  const meta = (integration.metadata ?? {}) as Record<string, unknown>;
  const lastSyncedAt = meta.last_synced_at as string | undefined;
  const isFirstSync = !lastSyncedAt;
  const now = new Date();

  const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calendarUrl.searchParams.set("singleEvents", "true");
  calendarUrl.searchParams.set("showDeleted", "true");
  calendarUrl.searchParams.set("maxResults", "250");

  if (isFirstSync) {
    // Primeira sincronização: últimos 30 dias + futuro (90 dias)
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    calendarUrl.searchParams.set("timeMin", timeMin);
    calendarUrl.searchParams.set("timeMax", timeMax);
  } else {
    // Polls seguintes: tudo que mudou desde last_synced_at - 60s (overlap de segurança)
    const updatedMin = new Date(new Date(lastSyncedAt!).getTime() - 60_000).toISOString();
    calendarUrl.searchParams.set("updatedMin", updatedMin);
  }

  const calRes = await fetch(calendarUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!calRes.ok) {
    const errText = await calRes.text();
    console.error("[gcal-poll] Google API error", calRes.status, errText);
    return { ...stats, error: `google_api_${calRes.status}` };
  }

  const data = await calRes.json();
  const items = (data.items ?? []) as any[];

  for (const item of items) {
    if (!item?.id) continue;
    const row = googleEventToRow(item, integration.user_id);

    // Skip eventos sem data válida (raros, mas existem)
    if (!row.event_date) continue;

    // Existe?
    const { data: existing } = await supabase
      .from("events")
      .select("id, title, event_date, event_time, end_time, location, meeting_url, status, source")
      .eq("user_id", integration.user_id)
      .eq("google_event_id", row.google_event_id)
      .maybeSingle();

    // ── EXISTE + cancelado no Google ──
    if (existing && row.status === "cancelled") {
      if (existing.status !== "cancelled") {
        await supabase.from("events").update({ status: "cancelled" }).eq("id", existing.id);
        stats.cancelled++;
        if (phone && !isFirstSync) {
          const greet = nick ? `, ${nick}` : "";
          const dt = fmtDateTime(existing.event_date, existing.event_time?.slice(0, 5) ?? null, tz);
          await sendText(
            phone,
            `❌ *Evento cancelado${greet}*\n\n📌 ${existing.title}\n📅 ${dt}\n\n_Removido do seu Google Calendar._`,
          ).catch((e) => console.error("[gcal-poll] sendText cancelled failed:", e));
          stats.notified++;
        }
      }
      continue;
    }

    // ── NÃO EXISTE + cancelado: ignora (já foi deletado antes da gente ver) ──
    if (!existing && row.status === "cancelled") continue;

    // ── NÃO EXISTE + ativo: INSERT ──
    if (!existing) {
      const { error: insErr } = await supabase.from("events").insert({
        user_id: integration.user_id,
        title: row.title,
        description: row.description,
        event_date: row.event_date,
        event_time: row.event_time,
        end_time: row.end_time,
        location: row.location,
        meeting_url: row.meeting_url,
        event_type: "compromisso",
        priority: "media",
        color: "#4285f4", // Azul Google
        status: "pending",
        source: "google_calendar",
        google_event_id: row.google_event_id,
      });
      if (insErr) {
        console.error("[gcal-poll] insert failed:", insErr);
        continue;
      }
      stats.imported++;

      if (phone && !isFirstSync) {
        const greet = nick ? `, ${nick}` : "";
        const dt = fmtDateTime(row.event_date, row.event_time, tz);
        const locLine = row.location ? `\n📍 ${row.location}` : "";
        const meetLine = row.meeting_url ? `\n🔗 ${row.meeting_url}` : "";
        const descLine = row.description ? `\n📝 _${row.description.slice(0, 120)}${row.description.length > 120 ? "..." : ""}_` : "";
        await sendText(
          phone,
          `🆕 *Novo evento na sua agenda${greet}*\n\n📌 ${row.title}\n📅 ${dt}${locLine}${meetLine}${descLine}\n\n_Criado direto no seu Google Calendar._`,
        ).catch((e) => console.error("[gcal-poll] sendText new failed:", e));
        stats.notified++;
      }
      continue;
    }

    // ── EXISTE + ativo: detecta mudança ──
    const existingTime = existing.event_time?.slice(0, 5) ?? null;
    const existingEndTime = (existing as any).end_time?.slice(0, 5) ?? null;
    const existingMeetUrl = (existing as any).meeting_url ?? null;
    const changes: string[] = [];
    if (existing.title !== row.title) changes.push(`título: "${existing.title}" → "${row.title}"`);
    if (existing.event_date !== row.event_date) changes.push(`data: ${existing.event_date} → ${row.event_date}`);
    if (existingTime !== row.event_time) changes.push(`hora: ${existingTime ?? "—"} → ${row.event_time ?? "—"}`);
    if (existingEndTime !== row.end_time) {
      // só conta se ambos são distintos e não-null OU se um deles muda significativamente
      if (existing.end_time || row.end_time) changes.push(`fim: ${existingEndTime ?? "—"} → ${row.end_time ?? "—"}`);
    }
    if ((existing.location ?? null) !== row.location) changes.push(`local: ${existing.location ?? "—"} → ${row.location ?? "—"}`);
    if (existingMeetUrl !== row.meeting_url) {
      if (!existingMeetUrl && row.meeting_url) changes.push(`Meet adicionado: ${row.meeting_url}`);
      else if (existingMeetUrl && !row.meeting_url) changes.push(`Meet removido`);
      else changes.push(`Meet alterado: ${row.meeting_url}`);
    }

    if (changes.length === 0) continue; // sem mudança real

    await supabase
      .from("events")
      .update({
        title: row.title,
        description: row.description,
        event_date: row.event_date,
        event_time: row.event_time,
        end_time: row.end_time,
        location: row.location,
        meeting_url: row.meeting_url,
      })
      .eq("id", existing.id);
    stats.updated++;

    if (phone && !isFirstSync) {
      const greet = nick ? `, ${nick}` : "";
      const dt = fmtDateTime(row.event_date, row.event_time, tz);
      const meetLine = row.meeting_url ? `\n🔗 ${row.meeting_url}` : "";
      await sendText(
        phone,
        `✏️ *Evento atualizado${greet}*\n\n📌 ${row.title}\n📅 ${dt}${meetLine}\n\n*Mudanças:*\n• ${changes.join("\n• ")}\n\n_Atualizado no seu Google Calendar._`,
      ).catch((e) => console.error("[gcal-poll] sendText update failed:", e));
      stats.notified++;
    }
  }

  // Atualiza last_synced_at
  await supabase
    .from("integrations")
    .update({
      metadata: { ...meta, last_synced_at: now.toISOString() },
    })
    .eq("id", integration.id);

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const t0 = Date.now();
  try {
    // Lista todas as integrações conectadas
    const { data: integrations, error } = await supabase
      .from("integrations")
      .select("id, user_id, access_token, refresh_token, expires_at, metadata, connected_at")
      .eq("provider", "google_calendar")
      .eq("is_connected", true);

    if (error) throw error;

    const results: any[] = [];
    for (const integ of integrations ?? []) {
      try {
        const r = await syncUser(integ);
        results.push(r);
      } catch (err) {
        console.error("[gcal-poll] syncUser threw:", integ.user_id, err);
        results.push({ user_id: integ.user_id, error: String(err) });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        imported: acc.imported + (r.imported ?? 0),
        updated: acc.updated + (r.updated ?? 0),
        cancelled: acc.cancelled + (r.cancelled ?? 0),
        notified: acc.notified + (r.notified ?? 0),
      }),
      { imported: 0, updated: 0, cancelled: 0, notified: 0 },
    );

    const elapsed = Date.now() - t0;
    console.log(`[gcal-poll] done in ${elapsed}ms — users:${results.length}`, totals);

    return new Response(
      JSON.stringify({ ok: true, elapsed_ms: elapsed, users: results.length, totals, results }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[gcal-poll] fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
