// Endpoint temporário pra testar se o Evolution API está conectado e operante
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const EVOLUTION_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME") ?? "mayachat";

/** Tenta extrair messageId em múltiplos paths comuns do Evolution v2. */
function tryExtractIds(resp: unknown): Record<string, string | null> {
  const r = resp as any;
  return {
    "key.id":           r?.key?.id ?? null,
    "id":               r?.id ?? null,
    "messageId":        r?.messageId ?? null,
    "data.key.id":      r?.data?.key?.id ?? null,
    "data.id":          r?.data?.id ?? null,
    "message.key.id":   r?.message?.key?.id ?? null,
    "messageKeyId":     r?.messageKeyId ?? null,
  };
}

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "apikey": EVOLUTION_KEY,
  };

  try {
    // 2. Estado de conexão da instância específica
    const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${INSTANCE}`, { headers });
    const state = await stateRes.json();

    // 3. Webhook configurado
    const webhookRes = await fetch(`${EVOLUTION_URL}/webhook/find/${INSTANCE}`, { headers });
    const webhook = await webhookRes.json();

    // TEST_SEND: envia uma msg de teste e retorna o response CRU do Evolution.
    // Uso:
    //   ?test_send=5511999999999          → envia direto (sem warm-up)
    //   ?test_send=5511999999999&warmup=1 → envia COM warm-up (typing + 700ms)
    //                                        igual o daily-briefing faz
    const url4 = new URL(req.url);
    const testSendNumber = url4.searchParams.get("test_send");
    const useWarmup = url4.searchParams.get("warmup") === "1";
    if (testSendNumber) {
      const cleanNumber = testSendNumber.replace(/\D/g, "");
      const flow: Array<Record<string, unknown>> = [];

      // Warm-up opcional: presence "composing" + 700ms wait (mesmo do daily-briefing)
      // Evolution v2 exige envelope "options" no payload.
      if (useWarmup) {
        const presStart = Date.now();
        const presRes = await fetch(`${EVOLUTION_URL}/chat/sendPresence/${INSTANCE}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            number: cleanNumber,
            options: {
              presence: "composing",
              delay: 1500,
            },
          }),
        });
        const presText = await presRes.text();
        let presParsed: unknown = presText;
        try { presParsed = JSON.parse(presText); } catch {}
        flow.push({
          step: "warmup_presence",
          elapsed_ms: Date.now() - presStart,
          http_status: presRes.status,
          response: presParsed,
        });
        const waitStart = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 700));
        flow.push({ step: "wait_700ms", elapsed_ms: Date.now() - waitStart });
      }

      const sendStart = Date.now();
      const sendRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          number: cleanNumber,
          textMessage: {
            text: useWarmup
              ? "🧪 Teste COM warm-up (typing). Resp se chegou com texto."
              : "🧪 Teste SEM warm-up (direto). Resp se chegou com texto.",
          },
        }),
      });
      const respText = await sendRes.text();
      let parsed: unknown = respText;
      try { parsed = JSON.parse(respText); } catch { /* não é JSON */ }
      flow.push({
        step: "send_text",
        elapsed_ms: Date.now() - sendStart,
        http_status: sendRes.status,
      });

      return new Response(JSON.stringify({
        used_warmup: useWarmup,
        flow,
        response_body: parsed,
        extracted_id_attempts: tryExtractIds(parsed),
      }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // RESET WEBHOOK: reseta config do webhook
    const url3 = new URL(req.url);
    if (url3.searchParams.get("reset_webhook") === "1") {
      const payload = {
        enabled: true,
        url: "https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/whatsapp-webhook",
        webhook_by_events: false,
        webhook_base64: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "CONNECTION_UPDATE",
        ],
      };
      const setRes = await fetch(`${EVOLUTION_URL}/webhook/set/${INSTANCE}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const setBody = await setRes.text();
      return new Response(JSON.stringify({
        status: setRes.status,
        body: setBody,
      }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // DIAGNOSTICO: retorna info completa sobre a instancia
    const url2 = new URL(req.url);
    if (url2.searchParams.get("diag") === "1") {
      const allInstRes = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, { headers });
      const allInst = await allInstRes.json();

      // Busca settings atual
      const settingsRes = await fetch(`${EVOLUTION_URL}/settings/find/${INSTANCE}`, { headers });
      const settings = await settingsRes.json().catch(() => ({}));

      // Tenta buscar mensagens recentes direto na DB do Evolution
      const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findMessages/${INSTANCE}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ where: {}, limit: 5 }),
      }).catch(() => null);
      const chats = chatsRes ? await chatsRes.json().catch(() => ({})) : null;

      return new Response(JSON.stringify({
        state,
        webhook,
        settings,
        recent_messages: chats,
      }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // 4a. Logout forçado (se requerido via ?logout=1)
    const url = new URL(req?.url ?? "https://x.com/?logout=0");
    const forceLogout = url.searchParams.get("logout") === "1";
    if (forceLogout) {
      await fetch(`${EVOLUTION_URL}/instance/logout/${INSTANCE}`, { method: "DELETE", headers }).catch(() => null);
      // Aguarda 2s pro logout processar
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 4b. Gera QR code / código de conexão
    const connect = await fetch(`${EVOLUTION_URL}/instance/connect/${INSTANCE}`, { method: "GET", headers });
    const sendResult = await connect.json();

    // Retorna o QR code como imagem PNG direto — o browser renderiza
    const qrBase64 = sendResult?.base64 ?? "";
    if (qrBase64) {
      // Remove o prefixo "data:image/png;base64,"
      const base64Only = qrBase64.replace(/^data:image\/png;base64,/, "");
      const binary = Uint8Array.from(atob(base64Only), c => c.charCodeAt(0));
      return new Response(binary, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(JSON.stringify({
      evolution_url: EVOLUTION_URL,
      instance_name: INSTANCE,
      connection_state: state,
      webhook_config: webhook,
      send_test: sendResult,
      timestamp: new Date().toISOString(),
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: (err as Error).message,
      evolution_url: EVOLUTION_URL,
      instance_name: INSTANCE,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
