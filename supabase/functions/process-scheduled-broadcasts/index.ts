/**
 * process-scheduled-broadcasts
 * Executa a cada minuto via pg_cron.
 * Pega broadcasts com status=pending e send_at <= now() e envia.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyTemplate(tpl: string, profile: { display_name?: string | null }): string {
  const full = (profile.display_name ?? "").trim();
  const first = full.split(/\s+/)[0] || "";
  return tpl
    .replace(/\{\{\s*(nome|user_name|first_name)\s*\}\}/gi, first)
    .replace(/\{\{\s*full_name\s*\}\}/gi, full);
}

serve(async (_req) => {
  // Busca broadcasts vencidos
  const { data: due, error } = await supabase
    .from("scheduled_broadcasts" as any)
    .select("id, admin_id, message, user_ids, send_at")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .limit(5); // no máx 5 por execução

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  const processed: { id: string; sent: number; failed: number; skipped: number }[] = [];

  for (const bc of due as any[]) {
    // Marca como processing (previne duplicação se cron rodar 2x)
    const { error: lockErr } = await supabase
      .from("scheduled_broadcasts" as any)
      .update({ status: "processing" })
      .eq("id", bc.id)
      .eq("status", "pending");
    if (lockErr) continue;

    const userIds: string[] = Array.isArray(bc.user_ids) ? bc.user_ids : [];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, phone_number, whatsapp_lid")
      .in("id", userIds);

    let sent = 0, failed = 0, skipped = 0;

    for (let i = 0; i < (profiles ?? []).length; i++) {
      const p = (profiles as any[])[i];
      const target = (p.phone_number ?? "").replace(/\D/g, "") || p.whatsapp_lid;
      if (!target) { skipped++; continue; }
      try {
        await sendText(target, applyTemplate(bc.message, p));
        sent++;
      } catch { failed++; }
      if (i < profiles!.length - 1) await sleep(250);
    }

    await supabase.from("scheduled_broadcasts" as any)
      .update({ status: "sent", sent, failed, skipped, processed_at: new Date().toISOString() })
      .eq("id", bc.id);

    await supabase.from("broadcast_logs" as any).insert({
      admin_id: bc.admin_id,
      message: bc.message,
      total: userIds.length,
      sent, failed, skipped,
      created_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});

    processed.push({ id: bc.id, sent, failed, skipped });
  }

  return new Response(JSON.stringify({ processed: processed.length, results: processed }), { status: 200 });
});
