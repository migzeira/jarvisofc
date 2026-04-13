/**
 * inactivity-alert
 * Roda a cada 6 horas via pg_cron.
 * Envia mensagem no WhatsApp para usuários que não interagiram
 * com o assistente nas últimas 48 horas.
 *
 * Critérios para enviar:
 *  - account_status = 'active'
 *  - phone_number não nulo
 *  - Última mensagem na conversa: entre 48h e 96h atrás
 *    (evita pingar contas que ficaram muito tempo inativas)
 *  - last_inactivity_alert_at é NULL ou foi há mais de 7 dias
 *    (evita spam se o usuário continuar inativo)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  // Só aceita chamadas autenticadas (cron usa CRON_SECRET)
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const ago96h = new Date(now.getTime() - 96 * 60 * 60 * 1000).toISOString();
  const ago7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();

  // Busca usuários elegíveis para alerta
  // Usa uma query que cruza profiles com a última conversa
  const { data: candidates, error } = await supabase.rpc(
    "get_inactivity_alert_candidates" as any,
    { p_ago48h: ago48h, p_ago96h: ago96h, p_ago7d: ago7d }
  ) as any;

  if (error) {
    console.error("[inactivity-alert] RPC error:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const users: { id: string; display_name: string; phone_number: string }[] =
    candidates ?? [];

  console.log(`[inactivity-alert] Found ${users.length} users to alert`);

  let sent = 0;
  for (const u of users) {
    // Prioriza user_nickname (nome que o cliente ESCOLHEU ser chamado na config do agente)
    // Fallback pra display_name (nome do cadastro) → "você" se nenhum existir
    const { data: agentCfg } = await supabase
      .from("agent_configs")
      .select("user_nickname")
      .eq("user_id", u.id)
      .maybeSingle();
    const name = (agentCfg?.user_nickname as string)?.trim() || u.display_name || "você";
    const message =
      `Oi, ${name}! 👋\n\n` +
      `Já faz um tempo que não te vejo por aqui. Tudo bem?\n\n` +
      `Sou a *Maya*, sua assistente pessoal, e estou aqui pra ajudar!\n\n` +
      `Me chama aqui sempre que precisar:\n` +
      `📝 *Anotar* algo importante\n` +
      `⏰ *Criar um lembrete*\n` +
      `📅 *Salvar um compromisso* na agenda\n` +
      `💰 *Registrar um gasto* ou receita\n\n` +
      `É só me chamar! 😊`;

    try {
      await sendText(u.phone_number.replace(/\D/g, ""), message);
      // Atualiza last_inactivity_alert_at para evitar reenvio
      await supabase
        .from("profiles")
        .update({ last_inactivity_alert_at: now.toISOString() } as any)
        .eq("id", u.id);
      sent++;
      console.log(`[inactivity-alert] Sent to ${u.phone_number}`);
    } catch (err) {
      console.error(`[inactivity-alert] Failed for ${u.phone_number}:`, err);
    }

    // Pequena pausa para não sobrecarregar a Evolution API
    await new Promise(r => setTimeout(r, 500));
  }

  return new Response(
    JSON.stringify({ ok: true, candidates: users.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
