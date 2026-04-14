// whatsapp-link-init — Inicia vinculação zero-atrito do WhatsApp
//
// Fluxo pro cliente:
//  1. Cliente cadastra phone no MeuPerfil (ou clica "Reenviar mensagem")
//  2. Este endpoint envia uma mensagem amigável via Evolution pro phone:
//     "Oi [Nome]! Responda qualquer coisa aqui pra ativar seu Jarvis"
//  3. Salva um pending_whatsapp_link (janela de 15 min) pra o webhook
//     reconhecer quando o cliente responder
//  4. Cliente responde "oi" (ou qualquer coisa) no WhatsApp
//  5. Webhook procura pending_link ativo, vincula o LID ao profile
//  6. Pronto — todas as próximas mensagens funcionam direto
//
// Gera tambem um link_code JARVIS-XXXXXX como safety net (fallback caso
// haja múltiplos pending_links ativos no mesmo momento).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, resolvePhoneToLid } from "../_shared/evolution.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Gera código random de 6 chars alfanuméricos maiúsculos (sem 0/O/1/I)
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Valida auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "no_auth" }, 401);

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);

  const userId = userData.user.id;

  // Carrega profile
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, display_name, phone_number, account_status, whatsapp_lid, access_until")
    .eq("id", userId)
    .maybeSingle();

  if (profErr || !profile) return json({ error: "profile_not_found" }, 404);

  // Valida plano ativo
  if (profile.account_status !== "active") {
    return json({
      error: "no_active_plan",
      message: "Sua conta precisa de um plano ativo pra vincular o WhatsApp."
    }, 403);
  }

  // Valida phone cadastrado
  const phone = (profile.phone_number ?? "").replace(/\D/g, "");
  if (!phone || phone.length < 10) {
    return json({
      error: "no_phone",
      message: "Você precisa cadastrar seu número de WhatsApp antes."
    }, 400);
  }

  // ───────────────────────────────────────────────────────
  // PASSO 1 — Tenta resolver phone → LID DIRETO via Evolution
  // Se der certo, vincula na hora e cliente já pode usar sem reenviar nada.
  // ───────────────────────────────────────────────────────
  let resolvedJid: string | null = null;
  try {
    resolvedJid = await resolvePhoneToLid(phone);
  } catch (err) {
    console.warn("[link-init] resolvePhoneToLid error:", err);
  }

  if (resolvedJid) {
    await supabase
      .from("profiles")
      .update({
        whatsapp_lid: resolvedJid,
        link_code: null,
        link_code_expires_at: null,
      } as any)
      .eq("id", userId);

    // Remove qualquer pending_link antigo
    await (supabase as any).from("pending_whatsapp_links").delete().eq("user_id", userId);

    // SAFETY NET: mesmo com direct_link bem sucedido, cria pending_link de 24h.
    // Motivo: o JID que Evolution retorna pode ser diferente do remoteJid que chega
    // em mensagens reais (Multi-Device), então o LID match falha. Pending garante
    // que qualquer mensagem da usuaria nas proximas 24h linka o LID correto.
    const safetyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await (supabase as any)
      .from("pending_whatsapp_links")
      .upsert({
        user_id: userId,
        phone_number: phone,
        push_name_hint: profile.display_name,
        expires_at: safetyExpires,
        created_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    // Auto-ativa o agente (garante que funcione mesmo se frontend falhou)
    await (supabase as any)
      .from("agent_configs")
      .update({ is_active: true })
      .eq("user_id", userId);

    // Envia mensagem de boas-vindas (não crítica — se falhar, cliente manda "oi" e já tá vinculado)
    const firstName = (profile.display_name ?? "").split(/\s+/)[0] || "";
    const greeting = firstName ? `Oi ${firstName}! 👋` : "Oi! 👋";
    const welcomeMsg =
      `${greeting}\n\n` +
      `Sou o *Jarvis*, seu assistente pessoal. Tudo pronto! ✨\n\n` +
      `A partir de agora você pode me mandar mensagens aqui pra:\n` +
      `💰 Registrar gastos — _gastei 50 reais de almoço_\n` +
      `📅 Marcar compromissos — _reunião amanhã às 14h_\n` +
      `⏰ Criar lembretes — _me lembra de ligar pro Pedro_\n` +
      `📝 Salvar anotações\n\n` +
      `Manda um *"oi"* pra começar ou já envia seu primeiro registro! 😊`;

    let sent = false;
    try {
      await sendText(phone, welcomeMsg);
      sent = true;
    } catch (err) {
      console.warn("[link-init] welcome send failed:", err);
    }

    return json({
      ok: true,
      strategy: "direct_link",
      linked: true,
      jid: resolvedJid,
      sent,
    });
  }

  // ───────────────────────────────────────────────────────
  // PASSO 2 — Fallback: pending_link + mensagem "responda qualquer coisa"
  // Usado quando Evolution não consegue resolver o número direto.
  // Cliente responde "oi" → webhook vincula pelo pending_link único.
  // ───────────────────────────────────────────────────────
  const code = generateCode();
  const codeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from("profiles")
    .update({
      link_code: code,
      link_code_expires_at: codeExpires,
    } as any)
    .eq("id", userId);

  // Janela de 24h (era 15 min) — usuario pode demorar pra responder o "oi"
  const pendingExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await (supabase as any)
    .from("pending_whatsapp_links")
    .upsert({
      user_id: userId,
      phone_number: phone,
      push_name_hint: profile.display_name,
      expires_at: pendingExpires,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  // Auto-ativa o agente (garante que funcione mesmo se frontend falhou)
  await (supabase as any)
    .from("agent_configs")
    .update({ is_active: true })
    .eq("user_id", userId);

  const firstName = (profile.display_name ?? "").split(/\s+/)[0] || "";
  const greeting = firstName ? `Oi ${firstName}! 👋` : "Oi! 👋";
  const msg =
    `${greeting}\n\n` +
    `Sou o *Jarvis*, seu assistente pessoal.\n\n` +
    `Pra começar é só me mandar qualquer mensagem aqui — um *"oi"* já tá ótimo. 😊\n\n` +
    `Depois disso você vai poder:\n` +
    `💰 Registrar gastos\n` +
    `📅 Marcar compromissos\n` +
    `⏰ Criar lembretes\n` +
    `📝 Salvar anotações\n\n` +
    `Tudo direto por aqui pelo WhatsApp. ✨`;

  let sent = false;
  let sendError: string | null = null;
  try {
    await sendText(phone, msg);
    sent = true;
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err);
    console.error("[link-init] sendText error:", sendError);
  }

  return json({
    ok: true,
    strategy: "pending_link",
    linked: false,
    sent,
    send_error: sendError,
    expires_at: pendingExpires,
    code, // safety net pra UI mostrar caso usuário peça
  });
});
