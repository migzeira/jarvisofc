const EVOLUTION_URL = Deno.env.get("EVOLUTION_API_URL") ?? "";
const EVOLUTION_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME") ?? "mayachat";

/**
 * Resolve um número de telefone para o JID/LID associado no WhatsApp.
 * Usado na HORA do cadastro pra já vincular o whatsapp_lid no profile.
 * Com isso, todas as mensagens futuras do cliente são identificadas
 * instantaneamente pelo LID — sem precisar de código MAYA nem "oi".
 *
 * Retorna o JID/LID (ex: "177945360519187@lid" ou "5519...@s.whatsapp.net")
 * ou null se o número não for WhatsApp válido ou Evolution não responder.
 */
export async function resolvePhoneToLid(phone: string): Promise<string | null> {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized || normalized.length < 10) return null;

  // Endpoint v2: /chat/whatsappNumbers retorna { jid, exists, number } pra cada
  try {
    const res = await evolutionPost(`/chat/whatsappNumbers/${INSTANCE}`, {
      numbers: [normalized],
    }) as unknown;

    if (Array.isArray(res)) {
      for (const item of res) {
        const obj = item as Record<string, unknown>;
        const jid = String(obj.jid ?? obj.remoteJid ?? obj.id ?? "");
        const exists = obj.exists === true || obj.exists === "true";
        if (exists && jid && (jid.endsWith("@lid") || jid.endsWith("@s.whatsapp.net"))) {
          return jid;
        }
      }
    }
  } catch { /* fallback pra próximo método */ }

  // Fallback: fetchProfile retorna profile info incluindo jid
  try {
    const res = await evolutionPost(`/chat/fetchProfile/${INSTANCE}`, {
      number: normalized,
    }) as Record<string, unknown>;
    const jid = String(res?.wuid ?? res?.id ?? res?.jid ?? "");
    if (jid && (jid.endsWith("@lid") || jid.endsWith("@s.whatsapp.net"))) {
      return jid;
    }
  } catch { /* silent */ }

  return null;
}

/**
 * Resolve um LID (@lid) para o número de telefone real consultando os contatos
 * armazenados pelo Evolution API. Tenta múltiplos endpoints (v1 e v2) porque
 * o Evolution API v2 mudou a estrutura do endpoint de contatos.
 * Retorna null se nenhum endpoint conseguir resolver.
 */
export async function resolveLidToPhone(lid: string): Promise<string | null> {
  // Normaliza o LID — remove sufixo @lid pra usar só o ID numérico
  const lidId = lid.replace(/@lid$/, "");

  // Helper: extrai phone de um objeto de contato do Evolution
  const extractPhone = (obj: Record<string, unknown>): string | null => {
    const jid = String(obj.id ?? obj.remoteJid ?? obj.jid ?? "");
    if (jid.endsWith("@s.whatsapp.net")) {
      return jid.replace(/@s\.whatsapp\.net$/, "").replace(/:\d+$/, "");
    }
    // Campos alternativos que alguns Evolution versions retornam
    const alt = String(obj.pn ?? obj.phoneNumber ?? obj.phone ?? "");
    if (/^\d{10,15}$/.test(alt)) return alt;
    return null;
  };

  // Tentativa 1: Evolution v2 /chat/findContacts (POST com where)
  try {
    const contacts = await evolutionPost(`/chat/findContacts/${INSTANCE}`, {
      where: { id: lid },
    }) as unknown;

    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const phone = extractPhone(c as Record<string, unknown>);
        if (phone) return phone;
      }
    }
  } catch { /* fallback para próximo endpoint */ }

  // Tentativa 2: Evolution v1 /contact/getContacts (legacy)
  try {
    const contacts = await evolutionPost(`/contact/getContacts/${INSTANCE}`, {
      where: { id: lid },
    }) as unknown;

    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const phone = extractPhone(c as Record<string, unknown>);
        if (phone) return phone;
      }
    }
  } catch { /* fallback para próximo */ }

  // Tentativa 3: Buscar TODOS os contatos e filtrar localmente (último recurso)
  try {
    const contacts = await evolutionPost(`/chat/findContacts/${INSTANCE}`, {}) as unknown;
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const obj = c as Record<string, unknown>;
        const cId = String(obj.id ?? obj.remoteJid ?? "");
        // Bate com o LID inteiro ou só com o ID numérico
        if (cId === lid || cId === `${lidId}@lid` || cId.startsWith(`${lidId}@`)) {
          const phone = extractPhone(obj);
          if (phone) return phone;
        }
      }
    }
  } catch { /* silencioso */ }

  return null;
}

/**
 * Força refresh da sessão Signal com o destino enviando um typing indicator
 * (presence="composing"). Usado como "warm-up" antes de envios críticos para
 * destinos que podem estar offline há muito tempo. Reduz drasticamente o
 * problema de mensagens em branco causado por cipher session out-of-sync.
 * Best-effort: se falhar, não joga — quem chama segue com envio.
 */
export async function sendPresence(
  to: string,
  presence: "available" | "unavailable" | "composing" | "recording" | "paused" = "composing",
  delayMs = 1500
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

  await evolutionPost(`/chat/sendPresence/${INSTANCE}`, {
    number,
    presence,
    delay: delayMs,
  });
}

/**
 * Envia mensagem de texto via Evolution API.
 * Retorna o messageId (key.id) gerado pelo Baileys, usado pra correlacionar
 * com eventos MESSAGES_UPDATE no webhook (delivery tracking). Retorna null
 * se o Evolution não devolver id — chamadas existentes que ignoram o retorno
 * continuam funcionando idênticas (Promise<void> → Promise<string|null>).
 *
 * options.warmUp = true → força refresh da sessão Signal antes do envio
 * (typing indicator + 700ms wait). Use em envios programados pra destinos
 * que podem estar offline (daily-briefing, reminders agendados). NÃO usar em
 * respostas a mensagens recebidas (user obviamente online, é só latência extra).
 */
export async function sendText(
  to: string,
  text: string,
  options: { warmUp?: boolean } = {}
): Promise<string | null> {
  let number: string;

  if (to.endsWith("@lid")) {
    // LID não é aceito direto pelo sendText do Evolution —
    // tenta resolver para telefone real via contact store
    const resolved = await resolveLidToPhone(to);
    if (resolved) {
      number = normalizePhone(resolved);
    } else {
      // Se não conseguiu resolver LID, tenta usar direto como fallback
      // (pode ser que Evolution aceite em algumas versões)
      number = to;
    }
  } else if (to.includes("@")) {
    // JID @s.whatsapp.net — usa direto
    number = to;
  } else {
    // Número puro — normaliza
    number = normalizePhone(to);
  }

  // Warm-up: pinga presence pra forçar Baileys a estabelecer sessão fresca
  // antes do envio real. Resolve o problema de "mensagem em branco" quando o
  // destino está offline há horas/dias (cipher key dessincronizada). Custa
  // ~800ms — só vale pra envios agendados, não pra resposta de chat ao vivo.
  if (options.warmUp) {
    try {
      await evolutionPost(`/chat/sendPresence/${INSTANCE}`, {
        number,
        presence: "composing",
        delay: 1500,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
    } catch (warmErr) {
      console.warn(
        "[sendText] warm-up failed, proceeding anyway:",
        (warmErr as Error).message?.slice(0, 100)
      );
    }
  }

  const res = await evolutionPost(`/message/sendText/${INSTANCE}`, {
    number,
    textMessage: { text },
  }) as Record<string, unknown> | null;

  // Extrai messageId do response — Evolution v2 retorna { key: { id } }
  const key = res?.key as Record<string, unknown> | undefined;
  const id = (key?.id as string) ?? (res?.id as string) ?? null;
  return id || null;
}

/**
 * Envia mensagem com botoes interativos via Evolution API.
 * Maximo 3 botoes (limite do WhatsApp). Botoes do tipo "reply" retornam
 * buttonsResponseMessage.selectedButtonId no webhook.
 */
export async function sendButtons(
  to: string,
  title: string,
  description: string,
  buttons: Array<{ id: string; text: string }>,
  footer = "Jarvis"
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

  // Tenta botões interativos primeiro (funciona só com WhatsApp Business API / Cloud API)
  try {
    const body = {
      number,
      buttonMessage: {
        title,
        description,
        footer,
        buttons: buttons.slice(0, 3).map(b => ({
          buttonId: b.id,
          buttonText: b.text,
          type: 1,
        })),
      },
    };
    await evolutionPost(`/message/sendButtons/${INSTANCE}`, body);
    return; // sucesso com botões nativos
  } catch (err) {
    // Baileys não suporta botões → fallback para texto formatado
    console.warn("[sendButtons] Buttons not supported, falling back to text:", (err as Error).message?.slice(0, 80));
  }

  // Fallback: texto formatado com opções numeradas
  const opts = buttons.slice(0, 3).map((b, i) => `*${i + 1}.* ${b.text}`).join("\n");
  const fallbackText =
    `*${title}*\n\n${description}\n\n${opts}\n\n_Responda com o número ou a opção._`;
  await evolutionPost(`/message/sendText/${INSTANCE}`, {
    number,
    textMessage: { text: fallbackText },
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

  const body = {
    number,
    mediaMessage: {
      mediatype: "image",
      mimetype: "image/png",
      caption,
      media,
      fileName: "relatorio.png",
    },
  };

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
