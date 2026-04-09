/**
 * send-reminder
 * Chamada pelo pg_cron a cada 1 minuto.
 * Busca lembretes pendentes cujo send_at <= agora e envia via WhatsApp.
 * Suporta recorrência: cria próxima ocorrência automaticamente.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendButtons } from "../_shared/evolution.ts";

/**
 * Detecta se o título do lembrete contém intenção de enviar mensagem para contato.
 * Ex: "enviar pro Caio dizendo que vai atrasar" / "manda pra Ana confirmar horário"
 */
function reminderHasSendToContact(title: string): boolean {
  return /\b(enviar?|mandar?|falar?|avisar?)\s+(uma?\s+)?(mensagem\s+)?(pra|para|pro)\s+\w+/i.test(title ?? "");
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────
// Calcula a próxima data de um lembrete recorrente
// ─────────────────────────────────────────────
function nextOccurrence(
  current: Date,
  recurrence: string,
  recurrenceValue: number | null
): Date | null {
  const next = new Date(current);

  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (recurrence === "weekly") {
    // recurrenceValue = dia da semana (0=dom..6=sáb)
    const targetDay = recurrenceValue ?? current.getDay();
    next.setDate(next.getDate() + 7);
    // Ajusta para o dia correto da semana caso tenha desviado
    while (next.getDay() !== targetDay) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  if (recurrence === "day_of_month") {
    // recurrenceValue = dia do mês (1-31)
    const day = recurrenceValue ?? current.getDate();
    next.setMonth(next.getMonth() + 1);
    // Garante o dia correto (tratando meses com menos dias)
    const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, maxDay));
    return next;
  }

  if (recurrence === "hourly") {
    // recurrenceValue = intervalo em horas (ex: 2 = a cada 2 horas)
    const hours = recurrenceValue ?? 1;
    next.setTime(next.getTime() + hours * 60 * 60 * 1000);
    return next;
  }

  return null; // "none" ou tipo desconhecido → sem próxima
}

serve(async (_req) => {
  // Função interna chamada apenas pelo pg_cron.
  // A segurança é garantida por verify_jwt=false (gateway) + RLS no banco.
  // Não usamos CRON_SECRET via Authorization para não conflitar com pg_net.

  const now = new Date();
  const nowIso = now.toISOString();

  // ── Recupera lembretes presos em "processing" há mais de 5 min (crash recovery) ──
  const ago5min = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await supabase
    .from("reminders")
    .update({ status: "pending", processing_at: null } as any)
    .eq("status", "processing")
    .lt("processing_at", ago5min);

  // ── Reclama atomicamente os lembretes pendentes (evita duplicidade entre runs) ──
  const { data: reminders, error } = await supabase
    .rpc("claim_pending_reminders", { p_limit: 50 }) as any;

  if (error) {
    console.error("Error claiming reminders:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!reminders || reminders.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }));
  }

  let sent = 0;
  let failed = 0;
  let scheduled = 0;

  for (const reminder of reminders) {
    try {
      // ─── Delegação de envio: quando o lembrete é "enviar pro X..." ────────
      // Pergunta ao usuário se a Maya deve enviar ou se ele mesmo envia.
      const isDelegateReminder =
        reminder.source !== "send_to_contact" && // evita loop
        reminderHasSendToContact(reminder.title ?? "");

      if (isDelegateReminder) {
        const sessionPhone = String(reminder.whatsapp_number ?? "").replace(/\D/g, "");
        await sendButtons(
          reminder.whatsapp_number,
          `⏰ Lembrete: ${reminder.title}`,
          `Quem envia essa mensagem?`,
          [
            { id: "DELEGATE_MAYA", text: "🤖 Maya envia" },
            { id: "DELEGATE_ME",   text: "✉️ Eu mesmo envio" },
          ]
        );
        // Armazena na sessão para processar a resposta do botão
        await supabase.from("whatsapp_sessions").upsert(
          {
            user_id: reminder.user_id,
            phone_number: sessionPhone,
            pending_action: "reminder_delegate",
            pending_context: { contact_text: reminder.title },
            last_activity: now.toISOString(),
          },
          { onConflict: "phone_number" }
        );
      } else {
        await sendText(reminder.whatsapp_number, reminder.message);
      }

      // Marca como enviado
      await supabase
        .from("reminders")
        .update({ status: "sent", sent_at: now.toISOString() })
        .eq("id", reminder.id);

      sent++;

      // ─── Followup pós-evento: define pending_action na sessão do usuário ───
      if (reminder.source === "event_followup" && reminder.user_id && reminder.whatsapp_number) {
        let eventType = "compromisso";
        if (reminder.event_id) {
          const { data: ev } = await supabase
            .from("events")
            .select("event_type, event_date, event_time")
            .eq("id", reminder.event_id)
            .maybeSingle();
          if (ev) eventType = ev.event_type ?? "compromisso";
        }
        // Seta pending_action na sessão do WhatsApp para capturar resposta do usuário
        await supabase.from("whatsapp_sessions").upsert(
          {
            user_id: reminder.user_id,
            phone_number: reminder.whatsapp_number,
            pending_action: "event_followup",
            pending_context: {
              event_id: reminder.event_id ?? null,
              event_title: reminder.title ?? "",
              event_type: eventType,
            },
            last_activity: now.toISOString(),
          },
          { onConflict: "phone_number" }
        );
      }

      // ── Recorrência: agenda próxima ocorrência ──────────────────
      if (reminder.recurrence && reminder.recurrence !== "none") {
        const sendAt = new Date(reminder.send_at);
        const next = nextOccurrence(sendAt, reminder.recurrence, reminder.recurrence_value ?? null);

        if (next) {
          const { error: nextErr } = await supabase.from("reminders").insert({
            user_id: reminder.user_id,
            whatsapp_number: reminder.whatsapp_number,
            title: reminder.title,
            message: reminder.message,
            send_at: next.toISOString(),
            recurrence: reminder.recurrence,
            recurrence_value: reminder.recurrence_value,
            source: reminder.source ?? "whatsapp",
            status: "pending",
          });
          if (nextErr) {
            console.error(`[send-reminder] Failed to schedule next occurrence for ${reminder.id}:`, nextErr.message);
          } else {
            scheduled++;
          }
        }
      }
    } catch (err) {
      console.error(`Failed to send reminder ${reminder.id}:`, err);

      await supabase
        .from("reminders")
        .update({ status: "failed" })
        .eq("id", reminder.id);

      failed++;
    }
  }

  console.log(`Reminders: ${sent} sent, ${failed} failed, ${scheduled} next scheduled`);
  return new Response(JSON.stringify({ sent, failed, scheduled }));
});
