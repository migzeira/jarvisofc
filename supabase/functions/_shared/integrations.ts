import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

/** Busca integração e renova token se necessário */
async function getIntegration(userId: string, provider: string) {
  const { data } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_connected", true)
    .maybeSingle();

  if (!data?.access_token) return null;

  // Renova token Google se expirado
  if (
    provider.startsWith("google") &&
    data.refresh_token &&
    data.expires_at &&
    new Date(data.expires_at) <= new Date(Date.now() + 60_000)
  ) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.access_token) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      await supabase
        .from("integrations")
        .update({ access_token: tokens.access_token, expires_at: expiresAt })
        .eq("id", data.id);
      data.access_token = tokens.access_token;
    }
  }

  return data;
}

/** Cria evento no Google Calendar */
export async function syncGoogleCalendar(
  userId: string,
  title: string,
  date: string,
  time: string | null
): Promise<void> {
  const integration = await getIntegration(userId, "google_calendar");
  if (!integration) return;

  const start = time
    ? { dateTime: `${date}T${time}:00`, timeZone: "America/Sao_Paulo" }
    : { date };
  const end = time
    ? { dateTime: `${date}T${time}:00`, timeZone: "America/Sao_Paulo" }
    : { date };

  await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ summary: title, start, end }),
    }
  );
}

/** Adiciona linha ao Google Sheets */
export async function syncGoogleSheets(
  userId: string,
  row: { date: string; description: string; amount: number; type: string; category: string }
): Promise<void> {
  const integration = await getIntegration(userId, "google_sheets");
  if (!integration?.metadata?.sheet_id) return;

  const sheetId = integration.metadata.sheet_id;
  const values = [[
    row.date,
    row.description,
    row.type === "expense" ? `-${row.amount}` : `${row.amount}`,
    row.type === "expense" ? "Gasto" : "Receita",
    row.category,
  ]];

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:E:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );
}

/** Cria página no Notion */
export async function syncNotion(
  userId: string,
  content: string
): Promise<void> {
  const integration = await getIntegration(userId, "notion");
  if (!integration?.metadata?.database_id && !integration?.metadata?.page_id) return;

  const parentId = integration.metadata.database_id ?? integration.metadata.page_id;
  const parentType = integration.metadata.database_id ? "database_id" : "page_id";

  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { [parentType]: parentId },
      properties: {
        title: {
          title: [{ text: { content: content.slice(0, 100) } }],
        },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content } }],
          },
        },
      ],
    }),
  });
}
