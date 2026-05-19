/**
 * WPPConnect Server provider — substituto do Evolution API.
 *
 * Migração feita em 19/05/2026 após bugs crônicos de Signal session na
 * Evolution API v1.8.2 ("Bad MAC", "No matching sessions", "conflict
 * replaced") causarem mensagens ficando em "Aguardando mensagem" no
 * WhatsApp dos destinatários. v2.4+ do Evolution introduziu licensing
 * server obrigatório (risco de dependência). WPPConnect tava rodando
 * estável no servidor há 13+ dias com WhatsApps da MayaZapp — escolhido
 * como alternativa.
 *
 * EXPORTA A MESMA API PÚBLICA do evolution.ts pra ser drop-in replacement
 * via _shared/whatsapp.ts (provider switcher).
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   WPPCONNECT_URL       — ex: "http://72.62.8.63:21465"
 *   WPPCONNECT_SESSION   — ex: "jarvis"
 *   WPPCONNECT_TOKEN     — token Bearer (gerado via /generate-token uma vez)
 *
 * Como gerar o WPPCONNECT_TOKEN inicialmente:
 *   curl -X POST "http://localhost:21465/api/jarvis/THISISMYSECURETOKEN/generate-token"
 *   → resposta inclui {"full": "wppconnect:$2b$10$..."}
 *   → usar o valor de "full" como WPPCONNECT_TOKEN
 */

const WPPCONNECT_URL = (Deno.env.get("WPPCONNECT_URL") ?? "").replace(/\/$/, "");
const WPPCONNECT_SESSION_DEFAULT = Deno.env.get("WPPCONNECT_SESSION") ?? "jarvis";
const WPPCONNECT_TOKEN_DEFAULT = Deno.env.get("WPPCONNECT_TOKEN") ?? "";

/**
 * Contexto de sessao opcional. Caller pode passar { session, token } pra
 * usar uma sessao especifica (multi-numero), OU omitir pra cair no env
 * default (legado, 1 numero).
 *
 * Adicionado na Fase 2 do multi-WhatsApp. Mantem retrocompat: se nenhum
 * caller passar ctx, usa env vars como antes.
 */
export interface WppCtx {
  session?: string;
  token?: string;
}

/** Resolve sessao/token efetivos: ctx > env default. */
function resolveCtx(ctx?: WppCtx): { session: string; token: string } {
  return {
    session: ctx?.session || WPPCONNECT_SESSION_DEFAULT,
    token: ctx?.token || WPPCONNECT_TOKEN_DEFAULT,
  };
}

// ─────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────

interface WppFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  /** Override de auth — se nao passado, usa env default. */
  token?: string;
}

/**
 * Wrapper unificado para chamadas REST ao WPPConnect Server.
 * Inclui timeout e tratamento padronizado de erros.
 *
 * `opts.token` permite override do Bearer (multi-sessao). Se omitido,
 * usa WPPCONNECT_TOKEN do env.
 */
async function wppFetch(path: string, opts: WppFetchOptions = {}): Promise<unknown> {
  const { method = "POST", body, timeoutMs = 15_000, token } = opts;

  if (!WPPCONNECT_URL) {
    throw new Error("WPPConnect env vars não configuradas (WPPCONNECT_URL)");
  }

  const effectiveToken = token || WPPCONNECT_TOKEN_DEFAULT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${WPPCONNECT_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Resposta não-JSON (HTML de erro, etc) — embrulha
      throw new Error(`WPPConnect resposta não-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      // WPPConnect costuma retornar {"status":"Error", "message":"..."}
      const errMsg = json?.message || json?.error || text.slice(0, 200);
      throw new Error(`WPPConnect ${res.status}: ${errMsg}`);
    }

    // Algumas APIs do WPPConnect retornam 200 com status=Error no body
    if (json && typeof json === "object" && json.status === "Error") {
      throw new Error(`WPPConnect error: ${json.message ?? JSON.stringify(json)}`);
    }

    return json;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`WPPConnect timeout after ${timeoutMs}ms (${path})`);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Phone helpers
// ─────────────────────────────────────────────────────────────

/**
 * Normaliza número para formato esperado pelo WPPConnect.
 * Aceita "+55 11 99999-9999" → "5511999999999".
 * Sem DDI 55 → adiciona 55 (assume Brasil).
 */
function normalizePhone(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (!n.startsWith("55")) n = `55${n}`;
  return n;
}

/**
 * Resolve "to" (pode ser número puro, @s.whatsapp.net, ou @lid) pro formato
 * que o WPPConnect espera no campo "phone": só dígitos.
 *
 * Diferença vs Evolution: WPPConnect usa SÓ phone (dígitos), sem @suffix.
 * Pra LIDs, precisa resolver pra phone real primeiro.
 *
 * `ctx` propagado pra resolveLidToPhone usar a mesma sessao do caller.
 */
async function resolvePhoneForSend(to: string, ctx?: WppCtx): Promise<string> {
  if (to.endsWith("@lid")) {
    const resolved = await resolveLidToPhone(to, ctx);
    if (resolved) return normalizePhone(resolved);
    // Fallback: tenta usar dígitos do LID (last resort)
    return to.replace(/@lid$/, "").replace(/\D/g, "");
  }
  if (to.includes("@")) {
    // @s.whatsapp.net → extrai phone
    return to.replace(/@.*$/, "").replace(/\D/g, "");
  }
  return normalizePhone(to);
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — espelha evolution.ts pra ser drop-in
// ─────────────────────────────────────────────────────────────

/**
 * Verifica se um número está registrado no WhatsApp e retorna o JID (@lid ou
 * @s.whatsapp.net) associado. Usado no signup pra já vincular whatsapp_lid no
 * profile e pular o "manda oi" do user.
 *
 * WPPConnect endpoint: POST /api/{session}/check-number-status
 * Response shape: { id: { user, server, _serialized }, status, isBusiness, ... }
 *   _serialized = "5511999999999@c.us" (WPPConnect usa @c.us em vez de @s.whatsapp.net)
 *
 * Normalizamos pro mesmo formato que o webhook recebe (@s.whatsapp.net ou @lid).
 */
export async function resolvePhoneToLid(phone: string, ctx?: WppCtx): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 12) return null;
  const { session, token } = resolveCtx(ctx);

  try {
    const res = await wppFetch(`/api/${session}/check-number-status`, {
      method: "POST",
      body: { phone: normalized },
      token,
    }) as any;

    // WPPConnect retorna { numberExists, id: { user, server, _serialized } }
    const exists = res?.numberExists ?? res?.exists ?? false;
    const serialized = res?.id?._serialized ?? res?.id ?? null;

    if (exists && typeof serialized === "string") {
      // Normaliza @c.us pra @s.whatsapp.net (formato esperado pelo nosso webhook)
      const normalized = serialized.replace(/@c\.us$/, "@s.whatsapp.net");
      if (normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@lid")) {
        return normalized;
      }
    }
  } catch (err) {
    console.warn("[wppconnect.resolvePhoneToLid] failed:", (err as Error).message?.slice(0, 100));
  }

  return null;
}

/**
 * Resolve LID (@lid) pra telefone real consultando contatos.
 *
 * WPPConnect endpoint: POST /api/{session}/contact/{contactId}
 *   Retorna detalhes do contato incluindo phone real.
 *
 * Fallback: lista todos os contatos e busca match.
 */
export async function resolveLidToPhone(lid: string, ctx?: WppCtx): Promise<string | null> {
  const lidId = lid.replace(/@lid$/, "");
  const { session, token } = resolveCtx(ctx);

  // Tentativa 1: endpoint direto de contato (WPPConnect aceita LID direto)
  try {
    const res = await wppFetch(`/api/${session}/contact/${encodeURIComponent(lid)}`, {
      method: "GET",
      token,
    }) as any;

    // Response tem id._serialized com phone real se for LID resolvível
    const phone = extractPhoneFromContact(res);
    if (phone) return phone;
  } catch { /* tenta próximo */ }

  // Tentativa 2: chat detalhes (alguns deployments expõem isso)
  try {
    const res = await wppFetch(`/api/${session}/chat-by-id/${encodeURIComponent(lid)}`, {
      method: "GET",
      token,
    }) as any;
    const phone = extractPhoneFromContact(res);
    if (phone) return phone;
  } catch { /* tenta próximo */ }

  // Tentativa 3: lista todos contatos e filtra (último recurso, caro)
  try {
    const contacts = await wppFetch(`/api/${session}/all-contacts`, {
      method: "GET",
      token,
    }) as unknown;

    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const obj = c as Record<string, unknown>;
        const cId = String(obj.id ?? "");
        if (cId === lid || cId === `${lidId}@lid` || cId.startsWith(`${lidId}@`)) {
          const phone = extractPhoneFromContact(obj);
          if (phone) return phone;
        }
      }
    }
  } catch { /* silent */ }

  return null;
}

/** Helper interno: extrai phone de objeto de contato do WPPConnect */
function extractPhoneFromContact(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;

  // Campos comuns no WPPConnect
  const candidates = [
    obj.id?._serialized,
    obj.id?.user,
    obj.phone,
    obj.number,
    obj.formattedName,
  ];

  for (const c of candidates) {
    if (typeof c === "string") {
      const clean = c.replace(/@.*$/, "").replace(/\D/g, "");
      if (clean.length >= 10 && clean.length <= 15) return clean;
    }
  }

  return null;
}

/**
 * Envia indicador de "digitando" / presença para forçar refresh da
 * sessão Signal. Usado como warmup antes de envios críticos.
 *
 * WPPConnect: POST /api/{session}/typing
 *   { phone, value: true }   → começa typing
 *   { phone, value: false }  → para typing
 */
export async function sendPresence(
  to: string,
  presence: "available" | "unavailable" | "composing" | "recording" | "paused" = "composing",
  delayMs = 1500,
  ctx?: WppCtx
): Promise<void> {
  const { session, token } = resolveCtx(ctx);
  const phone = await resolvePhoneForSend(to, ctx);

  // WPPConnect só suporta "typing" (composing) ou "recording" via /typing
  const isTyping = presence === "composing" || presence === "recording";

  try {
    await wppFetch(`/api/${session}/typing`, {
      method: "POST",
      body: { phone, value: isTyping },
      token,
    });

    // Aguarda delay pra "rascunho" aparecer no destinatário
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Para o typing
    if (isTyping) {
      await wppFetch(`/api/${session}/typing`, {
        method: "POST",
        body: { phone, value: false },
        token,
      }).catch(() => { /* best-effort */ });
    }
  } catch (err) {
    // Não joga — warm-up é best-effort
    console.warn("[wppconnect.sendPresence] failed:", (err as Error).message?.slice(0, 100));
  }
}

/**
 * Envia mensagem de texto via WPPConnect.
 * MESMA assinatura do evolution.ts:sendText pra drop-in replacement.
 *
 * WPPConnect endpoint: POST /api/{session}/send-message
 * Body: { phone: "5511999999999", message: "texto", isGroup?: false }
 * Response: array de objetos, cada um com .id (messageId)
 *
 * options.warmUp = true → typing indicator + 700ms antes do envio
 *
 * AUTO-WARMUP herdado do evolution.ts: ativa pra mensagens longas/formatadas
 * mesmo sem options.warmUp explícito.
 *
 * Retorna messageId do WPPConnect (string) ou null se não conseguir extrair.
 */
export async function sendText(
  to: string,
  text: string,
  options: { warmUp?: boolean } & WppCtx = {}
): Promise<string | null> {
  const { session, token } = resolveCtx(options);
  const phone = await resolvePhoneForSend(to, options);

  // Auto-warmup: mensagens complexas precisam de sessão Signal estabelecida
  const isLongOrFormatted =
    text.length > 200 ||
    /\*[^*]{2,}\*/.test(text) ||
    /\n.*\n/.test(text);
  const needsWarmup = options.warmUp || isLongOrFormatted;

  if (needsWarmup) {
    try {
      await wppFetch(`/api/${session}/typing`, {
        method: "POST",
        body: { phone, value: true },
        token,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
    } catch (warmErr) {
      console.warn(
        "[wppconnect.sendText] warm-up failed, proceeding:",
        (warmErr as Error).message?.slice(0, 100)
      );
    }
  }

  const res = await wppFetch(`/api/${session}/send-message`, {
    method: "POST",
    body: { phone, message: text, isGroup: false },
    token,
  }) as any;

  // WPPConnect retorna array [{ id: "xxx", ack: 1, ... }] ou objeto único.
  // Normaliza pra extrair messageId.
  const r = Array.isArray(res) ? res[0] : res;
  const id =
    r?.id?._serialized ??
    r?.id ??
    r?.messageId ??
    r?.response?.id ??
    null;

  if (!id) {
    try {
      const preview = JSON.stringify(res ?? {}).slice(0, 300);
      console.warn(`[wppconnect.sendText] messageId não extraído. Response: ${preview}`);
    } catch { /* ignore */ }
  }

  return (typeof id === "string" && id.length > 0) ? id : null;
}

/**
 * Envia mensagem com botões interativos.
 *
 * WPPConnect tem suporte a botões via /api/{session}/send-buttons mas é
 * MUITO limitado em WhatsApp regular (mesma limitação do Baileys). Pra
 * compatibilidade, fazemos fallback pra texto numerado SEMPRE — funciona
 * em qualquer cenário, e o webhook já tem lógica pra parsear respostas
 * tipo "1", "2", "3" como button clicks.
 */
export async function sendButtons(
  to: string,
  title: string,
  description: string,
  buttons: Array<{ id: string; text: string }>,
  footer = "Jarvis",
  ctx?: WppCtx
): Promise<void> {
  const { session, token } = resolveCtx(ctx);
  const phone = await resolvePhoneForSend(to, ctx);

  // Tenta botões nativos primeiro (raramente funciona em WhatsApp pessoal)
  try {
    await wppFetch(`/api/${session}/send-buttons`, {
      method: "POST",
      body: {
        phone,
        message: description,
        title,
        footer,
        buttons: buttons.slice(0, 3).map(b => ({
          buttonId: b.id,
          buttonText: { displayText: b.text },
          type: 1,
        })),
      },
      token,
    });
    return; // sucesso
  } catch (err) {
    console.warn(
      "[wppconnect.sendButtons] native buttons failed, falling back to text:",
      (err as Error).message?.slice(0, 80)
    );
  }

  // Fallback: texto formatado com opções numeradas
  const opts = buttons.slice(0, 3).map((b, i) => `*${i + 1}.* ${b.text}`).join("\n");
  const fallbackText =
    `*${title}*\n\n${description}\n\n${opts}\n\n_Responda com o número ou a opção._`;

  await wppFetch(`/api/${session}/send-message`, {
    method: "POST",
    body: { phone, message: fallbackText, isGroup: false },
    token,
  });
}

/**
 * Envia imagem (base64 ou URL pública).
 *
 * WPPConnect endpoints:
 *   - POST /api/{session}/send-image  (URL)
 *   - POST /api/{session}/send-image-base64  (base64)
 */
export async function sendImage(
  to: string,
  media: string,
  caption: string,
  isUrl = false,
  ctx?: WppCtx
): Promise<void> {
  const { session, token } = resolveCtx(ctx);
  const phone = await resolvePhoneForSend(to, ctx);

  if (isUrl) {
    await wppFetch(`/api/${session}/send-image`, {
      method: "POST",
      body: {
        phone,
        filename: "relatorio.png",
        caption,
        path: media,
      },
      token,
    });
  } else {
    // base64 com prefixo data:image/...;base64, se não tiver
    const base64 = media.startsWith("data:")
      ? media
      : `data:image/png;base64,${media}`;

    await wppFetch(`/api/${session}/send-image-base64`, {
      method: "POST",
      body: {
        phone,
        filename: "relatorio.png",
        caption,
        base64,
      },
      token,
    });
  }
}

/**
 * Baixa mídia (áudio, imagem) de uma mensagem recebida.
 *
 * WPPConnect endpoint: POST /api/{session}/get-media-by-message
 *   ou /download-media (varia por versão)
 *
 * Aceita o objeto messageData inteiro vindo do webhook (mesmo formato
 * que o evolution.ts recebe — o whatsapp.ts wrapper garante compat).
 */
export async function downloadMediaBase64(
  messageData: Record<string, unknown>,
  ctx?: WppCtx
): Promise<{ base64: string; mimetype: string } | null> {
  const { session, token } = resolveCtx(ctx);
  // WPPConnect aceita o messageId como referência
  const messageId =
    (messageData as any)?.id?._serialized ??
    (messageData as any)?.id ??
    (messageData as any)?.key?.id ??
    null;

  if (!messageId) {
    console.warn("[wppconnect.downloadMediaBase64] sem messageId no messageData");
    return null;
  }

  // Tentativa 1: get-media-by-message
  try {
    const res = await wppFetch(`/api/${session}/get-media-by-message`, {
      method: "POST",
      body: { messageId },
      token,
    }) as any;

    if (res?.base64 && res?.mimetype) {
      return { base64: res.base64, mimetype: res.mimetype };
    }
    if (res?.base64) {
      // Mimetype default por tipo
      const mt = (messageData as any)?.type === "audio" || (messageData as any)?.type === "ptt"
        ? "audio/ogg"
        : "application/octet-stream";
      return { base64: res.base64, mimetype: mt };
    }
  } catch { /* tenta próximo */ }

  // Tentativa 2: download-media
  try {
    const res = await wppFetch(`/api/${session}/download-media`, {
      method: "POST",
      body: { messageId },
      token,
    }) as any;

    if (res?.base64 && res?.mimetype) {
      return { base64: res.base64, mimetype: res.mimetype };
    }
  } catch { /* silent */ }

  return null;
}

/**
 * Extrai número de telefone limpo do remoteJid do WhatsApp.
 * Mesma implementação do evolution.ts — não depende do provider.
 */
export function extractPhone(remoteJid: string): string {
  return remoteJid
    .replace(/@s\.whatsapp\.net$/, "")
    .replace(/@c\.us$/, "")
    .replace(/@g\.us$/, "")
    .replace(/:\d+$/, ""); // remove índice de dispositivo multi-device ex: :22
}
