/**
 * WhatsApp provider switcher + multi-WhatsApp router.
 *
 * Wrapper unificado que escolhe entre Evolution API (legado) e WPPConnect
 * Server (atual) baseado em WHATSAPP_PROVIDER env, E roteia mensagens pelo
 * numero correto quando trabalhamos com multi-WhatsApp (Fase 2).
 *
 * USO DAS FUNCOES — 3 cenarios:
 *
 *   A) Single-number legado (env WPPCONNECT_SESSION/TOKEN fixo):
 *      sendText(phone, text)               // usa env default
 *
 *   B) Multi-numero sticky (recomendado pra todo envio direcionado a user):
 *      sendText(phone, text, { userId })   // resolve sessao via user_jarvis_assignments
 *
 *   C) Reply no webhook (responde DO MESMO numero que recebeu):
 *      sendText(phone, text, { userId, session: incomingSession })
 *      → session override garante que vai pelo numero certo MESMO que ainda
 *        nao tenha assignment criado.
 *
 * Migração feita em 19/05/2026 após bugs crônicos da Evolution v1.8.2.
 * Fase 2 multi-WhatsApp adicionada em 19/05/2026 (mesmo dia).
 */

import * as evolution from "./evolution.ts";
import * as wppconnect from "./wppconnect.ts";
import { resolveSessionForUser, incrementMsgCount, getWebhookCtx, type ResolvedSession } from "./whatsapp-router.ts";

type Provider = "evolution" | "wppconnect";

function getProvider(): Provider {
  const raw = (Deno.env.get("WHATSAPP_PROVIDER") ?? "evolution").toLowerCase().trim();
  if (raw === "wppconnect") return "wppconnect";
  if (raw === "evolution") return "evolution";
  console.warn(`[whatsapp] WHATSAPP_PROVIDER inválido: "${raw}" — usando evolution`);
  return "evolution";
}

// ─────────────────────────────────────────────────────────────
// Options shape (Fase 2)
// ─────────────────────────────────────────────────────────────

/**
 * Opcoes pra todas as funcoes outbound. Backward-compatible: tudo opcional.
 *
 *   warmUp   → forca typing indicator antes do envio (legacy do evolution)
 *   userId   → quando passado, resolve session via user_jarvis_assignments
 *              (Fase 2 multi-WhatsApp). Sem userId, usa env default.
 *   session  → override explicito de sessao. Tem prioridade sobre userId.
 *              Use no webhook: { userId, session: incomingSession } pra
 *              responder pelo mesmo numero que recebeu.
 *   token    → override do Bearer (avancado, normalmente derivado de session
 *              automaticamente)
 */
export interface SendOptions {
  warmUp?: boolean;
  userId?: string | null;
  session?: string;
  token?: string;
}

/**
 * Resolve sessao efetiva pra um envio.
 *
 * Ordem de precedencia:
 *   1. opts.session + opts.token (override explicito) → usa direto
 *   2. opts.userId               → resolveSessionForUser (busca assignment ou cria)
 *   3. sem nada                  → null (caller cai no env default)
 *
 * Retorna { ctx, numberId } onde:
 *   - ctx        → { session, token } pra passar ao provider
 *   - numberId   → id do jarvis_numbers pra incrementar counter (null se env)
 */
async function resolveCtxForSend(opts?: SendOptions): Promise<{
  ctx: { session?: string; token?: string };
  numberId: string | null;
}> {
  // Merge: opts > webhookCtx (AsyncLocalStorage) > env default
  // Permite que webhook chame withWebhookCtx({ userId, session }) uma vez no
  // inicio e qualquer sendText/etc transitivo herde sem precisar passar opts.
  const ambient = getWebhookCtx();
  const effective: SendOptions = {
    warmUp: opts?.warmUp,
    userId: opts?.userId ?? ambient.userId,
    session: opts?.session ?? ambient.session,
    token: opts?.token ?? ambient.token,
  };

  if (effective.session) {
    // Override explicito de sessao (webhook reply pelo mesmo numero que recebeu)
    return {
      ctx: { session: effective.session, token: effective.token },
      numberId: null, // sem id resolvido — counter nao incrementa (acceptable)
    };
  }
  if (effective.userId) {
    const resolved: ResolvedSession | null = await resolveSessionForUser(effective.userId);
    if (resolved) {
      return {
        ctx: { session: resolved.session, token: resolved.token },
        numberId: resolved.jarvis_number_id,
      };
    }
    // Nao conseguiu resolver — fallback pro env (logado em resolveSessionForUser)
  }
  return { ctx: {}, numberId: null };
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function sendText(
  to: string,
  text: string,
  options: SendOptions = {}
): Promise<string | null> {
  const p = getProvider();
  if (p === "evolution") {
    // Evolution nao suporta multi-sessao (legado). Ignora userId/session.
    return evolution.sendText(to, text, { warmUp: options.warmUp });
  }

  const { ctx, numberId } = await resolveCtxForSend(options);
  const id = await wppconnect.sendText(to, text, {
    warmUp: options.warmUp,
    session: ctx.session,
    token: ctx.token,
  });

  // Fire-and-forget: incrementa contador (nao bloqueia retorno)
  if (numberId) {
    incrementMsgCount(numberId).catch((e) => console.warn("[whatsapp.sendText] incrementMsgCount failed:", e));
  }

  return id;
}

export async function sendButtons(
  to: string,
  title: string,
  description: string,
  buttons: Array<{ id: string; text: string }>,
  footer = "Jarvis",
  options: SendOptions = {}
): Promise<void> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.sendButtons(to, title, description, buttons, footer);
  }
  const { ctx, numberId } = await resolveCtxForSend(options);
  await wppconnect.sendButtons(to, title, description, buttons, footer, ctx);
  if (numberId) incrementMsgCount(numberId).catch(() => {});
}

export async function sendImage(
  to: string,
  media: string,
  caption: string,
  isUrl = false,
  options: SendOptions = {}
): Promise<void> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.sendImage(to, media, caption, isUrl);
  }
  const { ctx, numberId } = await resolveCtxForSend(options);
  await wppconnect.sendImage(to, media, caption, isUrl, ctx);
  if (numberId) incrementMsgCount(numberId).catch(() => {});
}

export async function sendPresence(
  to: string,
  presence: "available" | "unavailable" | "composing" | "recording" | "paused" = "composing",
  delayMs = 1500,
  options: SendOptions = {}
): Promise<void> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.sendPresence(to, presence, delayMs);
  }
  const { ctx } = await resolveCtxForSend(options);
  return wppconnect.sendPresence(to, presence, delayMs, ctx);
}

export async function downloadMediaBase64(
  messageData: Record<string, unknown>,
  options: SendOptions = {}
): Promise<{ base64: string; mimetype: string } | null> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.downloadMediaBase64(messageData);
  }
  const { ctx } = await resolveCtxForSend(options);
  return wppconnect.downloadMediaBase64(messageData, ctx);
}

export async function resolvePhoneToLid(phone: string, options: SendOptions = {}): Promise<string | null> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.resolvePhoneToLid(phone);
  }
  const { ctx } = await resolveCtxForSend(options);
  return wppconnect.resolvePhoneToLid(phone, ctx);
}

export async function resolveLidToPhone(lid: string, options: SendOptions = {}): Promise<string | null> {
  const p = getProvider();
  if (p === "evolution") {
    return evolution.resolveLidToPhone(lid);
  }
  const { ctx } = await resolveCtxForSend(options);
  return wppconnect.resolveLidToPhone(lid, ctx);
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

export function getActiveProvider(): Provider {
  return getProvider();
}

// Re-export pra edge functions que precisam do roteador diretamente
// (ex: whatsapp-link-init pra criar assignment antes do welcome).
export {
  resolveSessionForUser,
  ensureAssignmentFromSession,
  withWebhookCtx,
  enterWebhookCtx,
} from "./whatsapp-router.ts";
export type { WebhookCtx } from "./whatsapp-router.ts";
