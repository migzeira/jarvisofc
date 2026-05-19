/**
 * WhatsApp provider switcher.
 *
 * Wrapper unificado que escolhe entre Evolution API (legado) e WPPConnect
 * Server (novo) baseado na variável de ambiente WHATSAPP_PROVIDER.
 *
 * Tudo no projeto (whatsapp-webhook, send-reminder, daily-briefing, etc)
 * importa de AQUI em vez de _shared/evolution.ts diretamente. Trocar de
 * provider = mudar env var, sem mexer em código.
 *
 * Migração feita em 19/05/2026 após bugs crônicos da Evolution v1.8.2.
 *
 * Como configurar:
 *   - WHATSAPP_PROVIDER=wppconnect  → usa _shared/wppconnect.ts
 *   - WHATSAPP_PROVIDER=evolution   → usa _shared/evolution.ts (default)
 *   - Sem set → fallback pra "evolution" pra retrocompat
 *
 * Rollback de emergência: troca WHATSAPP_PROVIDER pra "evolution" no
 * Supabase Secrets, redeploy não é necessário (env é lida a cada
 * invocação da edge function).
 *
 * IMPORTANTE: Os 2 módulos provider exportam a MESMA API pública:
 *   - sendText(to, text, options?)
 *   - sendButtons(to, title, description, buttons, footer?)
 *   - sendImage(to, media, caption, isUrl?)
 *   - sendPresence(to, presence?, delayMs?)
 *   - downloadMediaBase64(messageData)
 *   - resolvePhoneToLid(phone)
 *   - resolveLidToPhone(lid)
 *   - extractPhone(remoteJid)
 */

import * as evolution from "./evolution.ts";
import * as wppconnect from "./wppconnect.ts";

type Provider = "evolution" | "wppconnect";

/**
 * Lê WHATSAPP_PROVIDER da env. Default = "evolution" pra retrocompat
 * com setup antigo (não quebra se var não foi configurada).
 */
function getProvider(): Provider {
  const raw = (Deno.env.get("WHATSAPP_PROVIDER") ?? "evolution").toLowerCase().trim();
  if (raw === "wppconnect") return "wppconnect";
  if (raw === "evolution") return "evolution";
  // Valor inválido → loga e cai pro default
  console.warn(`[whatsapp] WHATSAPP_PROVIDER inválido: "${raw}" — usando evolution`);
  return "evolution";
}

// ─────────────────────────────────────────────────────────────
// Public API — espelha a API dos providers
// ─────────────────────────────────────────────────────────────

export async function sendText(
  to: string,
  text: string,
  options: { warmUp?: boolean } = {}
): Promise<string | null> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.sendText(to, text, options)
    : evolution.sendText(to, text, options);
}

export async function sendButtons(
  to: string,
  title: string,
  description: string,
  buttons: Array<{ id: string; text: string }>,
  footer = "Jarvis"
): Promise<void> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.sendButtons(to, title, description, buttons, footer)
    : evolution.sendButtons(to, title, description, buttons, footer);
}

export async function sendImage(
  to: string,
  media: string,
  caption: string,
  isUrl = false
): Promise<void> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.sendImage(to, media, caption, isUrl)
    : evolution.sendImage(to, media, caption, isUrl);
}

export async function sendPresence(
  to: string,
  presence: "available" | "unavailable" | "composing" | "recording" | "paused" = "composing",
  delayMs = 1500
): Promise<void> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.sendPresence(to, presence, delayMs)
    : evolution.sendPresence(to, presence, delayMs);
}

export async function downloadMediaBase64(
  messageData: Record<string, unknown>
): Promise<{ base64: string; mimetype: string } | null> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.downloadMediaBase64(messageData)
    : evolution.downloadMediaBase64(messageData);
}

export async function resolvePhoneToLid(phone: string): Promise<string | null> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.resolvePhoneToLid(phone)
    : evolution.resolvePhoneToLid(phone);
}

export async function resolveLidToPhone(lid: string): Promise<string | null> {
  const p = getProvider();
  return p === "wppconnect"
    ? wppconnect.resolveLidToPhone(lid)
    : evolution.resolveLidToPhone(lid);
}

/**
 * Extract phone do remoteJid. Não depende de provider — implementação
 * idêntica em ambos. Re-exportado aqui pra mantermos UM SÓ ponto de
 * import em todo o projeto.
 */
export function extractPhone(remoteJid: string): string {
  return remoteJid
    .replace(/@s\.whatsapp\.net$/, "")
    .replace(/@c\.us$/, "")
    .replace(/@g\.us$/, "")
    .replace(/:\d+$/, "");
}

/**
 * Helper de debug pra ver qual provider está ativo. Útil em logs do
 * webhook quando algo não bate (ex: "esperava resposta WPPConnect mas
 * veio shape do Evolution").
 */
export function getActiveProvider(): Provider {
  return getProvider();
}
