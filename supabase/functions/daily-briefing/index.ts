/**
 * daily-briefing
 * Chamado pelo pg_cron às 11:00 UTC (08:00 BRT) todos os dias.
 * Envia um resumo matinal personalizado para cada usuário ativo.
 * - Com compromissos/lembretes hoje → resume o dia com AI
 * - Sem nada agendado → mensagem proativa e acolhedora perguntando se há algo pra organizar
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// ─────────────────────────────────────────────
// Gera mensagem personalizada via Claude
// ─────────────────────────────────────────────
async function generateBriefingMessage(
  userName: string,
  scheduleLines: string | null
): Promise<string> {
  const systemPrompt = `Você é Maya, assistente pessoal inteligente e acolhedora da plataforma Minha Maya.
Você envia uma mensagem matinal personalizada pelo WhatsApp todos os dias de manhã.
Regras:
- Máximo 200 palavras
- Use no máximo 4 emojis
- Tom caloroso, motivador e pessoal — como uma assistente de verdade
- Sempre se dirija à pessoa pelo nome
- Português brasileiro informal mas profissional
- Nunca diga "como posso ajudar" de forma genérica — seja específica e contextual`;

  let userPrompt: string;

  if (scheduleLines) {
    userPrompt = `Gere uma mensagem de bom dia para ${userName} com o resumo do dia de hoje. Compromissos de hoje:\n\n${scheduleLines}\n\nSeja animada, organize o resumo de forma clara e termine com uma frase motivadora.`;
  } else {
    // Varia a mensagem baseado no dia da semana para não ficar repetitivo
    const dow = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" });
    userPrompt = `Gere uma mensagem de bom dia para ${userName}. Hoje é ${dow} e não há nada agendado. Pergunte de forma natural e acolhedora se há algo que ${userName} queira agendar, criar um lembrete ou anotar para hoje ou essa semana. Varie a abordagem para não parecer um robô — seja criativa e genuína.`;
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 350,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      console.error("Anthropic API error:", resp.status, await resp.text());
      return fallbackMessage(userName, scheduleLines);
    }

    const data = await resp.json();
    return data.content?.[0]?.text ?? fallbackMessage(userName, scheduleLines);
  } catch (err) {
    console.error("AI briefing error:", err);
    return fallbackMessage(userName, scheduleLines);
  }
}

function fallbackMessage(userName: string, scheduleLines: string | null): string {
  if (scheduleLines) {
    return `🌅 Bom dia, ${userName}!\n\nAqui está seu resumo de hoje:\n\n${scheduleLines}\n\nTenha um ótimo dia! 💪`;
  }
  return `🌅 Bom dia, ${userName}! Hoje sua agenda está livre. Quer agendar algo, criar um lembrete ou anotar uma ideia? É só me dizer! 😊`;
}

// ─────────────────────────────────────────────
// Emojis por tipo de evento
// ─────────────────────────────────────────────
const EVENT_TYPE_EMOJIS: Record<string, string> = {
  compromisso: "📌",
  reuniao: "🤝",
  consulta: "🏥",
  evento: "🎉",
  tarefa: "✏️",
};

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
serve(async (_req) => {
  // Calcula data de hoje em BRT (UTC-3)
  const todayBRT = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }); // formato YYYY-MM-DD

  console.log(`[daily-briefing] Running for date: ${todayBRT}`);

  // Busca todos os usuários ativos com número de telefone configurado
  // e que têm o resumo diário ativado (daily_briefing_enabled = true ou null = padrão ativo)
  const { data: users, error: usersErr } = await supabase
    .from("profiles")
    .select("id, phone_number")
    .eq("account_status", "active")
    .not("phone_number", "is", null);

  if (usersErr) {
    console.error("Error fetching users:", usersErr);
    return new Response(JSON.stringify({ error: usersErr.message }), { status: 500 });
  }

  if (!users || users.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: "No active users" }));
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.phone_number) {
      skipped++;
      continue;
    }

    try {
      // Busca apelido e configurações do agente (inclui flag de resumo diário)
      const { data: agentConfig } = await supabase
        .from("agent_configs")
        .select("user_nickname, daily_briefing_enabled")
        .eq("user_id", user.id)
        .maybeSingle();

      // Pula se o usuário desativou o resumo diário
      // null = padrão (ativado), false = desativado explicitamente
      if (agentConfig?.daily_briefing_enabled === false) {
        skipped++;
        continue;
      }

      const userName = (agentConfig?.user_nickname as string) || "você";

      // Busca eventos de hoje
      const { data: events } = await supabase
        .from("events")
        .select("title, event_time, end_time, event_type, location, status")
        .eq("user_id", user.id)
        .eq("event_date", todayBRT)
        .neq("status", "cancelled")
        .order("event_time", { ascending: true });

      // Busca lembretes pendentes de hoje
      const todayStart = `${todayBRT}T00:00:00.000Z`;
      const todayEndBRT = new Date(`${todayBRT}T23:59:59-03:00`).toISOString();
      const { data: reminders } = await supabase
        .from("reminders")
        .select("title, send_at, message")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .gte("send_at", todayStart)
        .lte("send_at", todayEndBRT)
        .order("send_at", { ascending: true });

      const hasEvents = events && events.length > 0;
      const hasReminders = reminders && reminders.length > 0;

      let scheduleLines: string | null = null;

      if (hasEvents || hasReminders) {
        const lines: string[] = [];

        if (hasEvents) {
          for (const ev of events!) {
            const emoji = EVENT_TYPE_EMOJIS[ev.event_type] ?? "📌";
            const timeStr = ev.event_time ? ev.event_time.slice(0, 5) : "Sem horário";
            const endStr = ev.end_time ? ` - ${ev.end_time.slice(0, 5)}` : "";
            const locStr = ev.location ? ` | 📍 ${ev.location}` : "";
            const doneTag = ev.status === "done" ? " ✅" : "";
            lines.push(`${emoji} *${ev.title}*${doneTag} — ${timeStr}${endStr}${locStr}`);
          }
        }

        if (hasReminders) {
          for (const rem of reminders!) {
            const remTime = new Date(rem.send_at).toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            lines.push(`🔔 Lembrete: *${rem.title}* às ${remTime}`);
          }
        }

        scheduleLines = lines.join("\n");
      }

      // Gera mensagem personalizada
      const message = await generateBriefingMessage(userName, scheduleLines);

      // Envia via WhatsApp
      await sendText(user.phone_number, message);

      // Registra o briefing enviado (cria um registro na tabela reminders como tipo especial)
      await supabase.from("reminders").insert({
        user_id: user.id,
        whatsapp_number: user.phone_number,
        title: "Resumo diário",
        message: message.slice(0, 500),
        send_at: new Date().toISOString(),
        recurrence: "none",
        source: "daily_briefing",
        status: "sent",
        sent_at: new Date().toISOString(),
      });

      sent++;
      console.log(`[daily-briefing] ✅ Sent to user ${user.id}`);
    } catch (err) {
      failed++;
      console.error(`[daily-briefing] ❌ Failed for user ${user.id}:`, err);
    }
  }

  const result = { sent, failed, skipped, date: todayBRT };
  console.log("[daily-briefing] Done:", result);
  return new Response(JSON.stringify(result));
});
