const EVOLUTION_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME") ?? "mayachat";

/**
 * Resolve um LID (@lid) para o número de telefone real consultando os contatos
 * armazenados pelo Evolution API. Retorna null se não conseguir resolver.
 */
export async function resolveLidToPhone(lid: string): Promise<string | null> {
  try {
    const contacts = await evolutionPost(`/contact/getContacts/${INSTANCE}`, {
      where: { id: lid },
    }) as Array<Record<string, unknown>>;

    if (!Array.isArray(contacts)) return null;

    for (const c of contacts) {
      const jid = String(c.id ?? c.remoteJid ?? "");
      if (jid.endsWith("@s.whatsapp.net")) {
        return jid.replace(/@s\.whatsapp\.net$/, "").replace(/:\d+$/, "");
      }
    }
    return null;
  } catch {
    return null; // Falha silenciosa — LID não resolvível
  }
}

/** Envia mensagem de texto via Evolution API */
export async function sendText(to: string, text: string): Promise<void> {
  let number: string;

  if (to.endsWith("@lid")) {
    // LID não é aceito direto pelo sendText do Evolution v1.8 —
    // tenta resolver para telefone real via contact store
    const resolved = await resolveLidToPhone(to);
    number = resolved ? normalizePhone(resolved) : to;
  } else if (to.includes("@")) {
    // JID @s.whatsapp.net — usa direto
    number = to;
  } else {
    number = normalizePhone(to);
  }

  await evolutionPost(`/message/sendText/${INSTANCE}`, {
    number,
    textMessage: { text },
  });
}

/** Envia imagem via Evolution API (base64 ou URL) */
export async function sendImage(
  to: string,
  media: string,
  caption: string,
  isUrl = false
): Promise<void> {
  let number: string;

  if (to.endsWith("@lid")) {
    const resolved = await resolveLidToPhone(to);
    number = resolved ? normalizePhone(resolved) : to;
  } else if (to.includes("@")) {
    number = to;
  } else {
    number = normalizePhone(to);
  }

  const body: Record<string, unknown> = {
    number,
    mediatype: "image",
    mimetype: "image/png",
    caption,
  };

  // Evolution API aceita base64 puro ou URL
  body.media = media;

  await evolutionPost(`/message/sendMedia/${INSTANCE}`, body);
}

/**
 * Baixa mídia (áudio, imagem) de uma mensagem do Evolution API.
 * Retorna base64 + mimetype ou null se falhar.
 */
export async function downloadMediaBase64(
  messageData: Record<string, unknown>
): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const res = await evolutionPost(`/chat/getBase64FromMediaMessage/${INSTANCE}`, {
      message: messageData,
      convertToMp4: false,
    }) as Record<string, unknown>;
    if (res.base64 && res.mimetype) {
      return { base64: res.base64 as string, mimetype: res.mimetype as string };
    }
    return null;
  } catch {
    return null;
  }
}

/** Extrai número de telefone limpo do remoteJid do WhatsApp */
export function extractPhone(remoteJid: string): string {
  return remoteJid
    .replace(/@s\.whatsapp\.net$/, "")
    .replace(/@g\.us$/, "")
    .replace(/:\d+$/, ""); // remove índice de dispositivo multi-device ex: :22
}

/** Normaliza número para formato Evolution API */
function normalizePhone(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (!n.startsWith("55")) n = `55${n}`;
  return n;
}

async function evolutionPost(path: string, body: unknown): Promise<unknown> {
  // Timeout de 15s — impede que a função fique pendurada se a Evolution API travar
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${EVOLUTION_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Evolution API error ${res.status}: ${err}`);
    }
    const json = await res.json() as Record<string, unknown>;
    // Evolution API sometimes returns 200 with an error in the body
    if (json && typeof json === "object" && json.error) {
      throw new Error(`Evolution API error: ${JSON.stringify(json.error)}`);
    }
    return json;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Evolution API timeout after 15s");
    }
    throw err;
  }
}
