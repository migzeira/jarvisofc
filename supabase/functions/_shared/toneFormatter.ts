/**
 * toneFormatter.ts — aplica o tom de voz do user nas respostas do Jarvis
 *
 * As mensagens hardcoded dos handlers (handleAgendaCreate, handleNotesSave,
 * handleReminderSet, handleFinanceRecord, etc) usam um padrão CASUAL/AMIGÁVEL
 * com emojis moderados — esse é o estilo natural pra WhatsApp.
 *
 * Pra cada tone configurado, aplicamos transformações dirigidas:
 *
 * - amigavel  → padrão (casual com emojis moderados, ❤️ caloroso)
 * - casual    → padrão sem alterações
 * - profissional → remove emojis "festivos" (🎉✨🌟🔥💪 etc), reduz
 *                  exclamações múltiplas. Mantém status (✅❌⚠️) que são
 *                  informativos.
 * - tecnico   → remove TODOS emojis decorativos, troca exclamações por ponto.
 *               Mantém apenas marcadores estruturais essenciais (✅❌⚠️🔴🟢).
 *
 * Estratégia conservadora: nunca quebra estrutura (datas, números, links,
 * markdown). Trabalha com lista enumerada de emojis pra evitar regex Unicode
 * frágil. Idempotente: aplicar 2x dá o mesmo resultado da 1ª.
 */

export type Tone = "profissional" | "casual" | "amigavel" | "tecnico";

// Emojis "festivos" — celebração, energia, calor.
// Removidos em profissional/tecnico.
const FESTIVE_EMOJIS = [
  "🎉", "🌟", "✨", "🚀", "🔥", "💪", "❤️", "🎊", "🎁", "👏",
  "🎯", "💎", "🥳", "🎈", "🌈", "💖", "💕", "😊", "😄", "😃",
  "🤩", "🥰", "😍", "❤", "💝", "💗",
];

// Emojis decorativos extras (categorias, tipos, contexto).
// Removidos APENAS em tecnico (profissional ainda mantém pra clareza).
const DECORATIVE_EMOJIS = [
  "📌", "🗓", "🔔", "🌿", "🌱", "🍕", "🐕", "☀️", "🌙", "💧",
  "💊", "🧴", "🧘", "😴", "📞", "🙏", "🤗", "🐱", "🍔", "📚",
  "🎨", "🎬", "🎵", "⚽", "📖", "✏️", "📝", "📊", "📈", "📉",
  "💼", "💻", "📱", "💵", "💰", "🪙", "💳", "🛒", "🛍️", "🍔",
  "🍕", "🍱", "☕", "🥤", "🍺", "🍷", "🥗", "🍞", "🍿", "🍦",
  "🚗", "🚕", "🛵", "⛽", "🚌", "🚇", "🚆", "✈️", "🚲", "🛴",
  "🏥", "🩺", "💉", "🦷", "👓", "⏰", "🏠", "🏡", "🛏️", "💡",
  "🔧", "📺", "🚿", "🌹", "🛁", "✂️", "🎓", "🖊️", "🔬", "🌷",
  "🌻", "🌼", "🍀", "📦", "🎀", "🔖", "🪧",
];

/**
 * Remove ocorrências EXATAS de cada emoji da string.
 * Usa split/join (não regex) pra evitar issues com emojis multi-codepoint
 * (skin tones, ZWJ sequences, variation selectors).
 */
function stripEmojis(text: string, list: readonly string[]): string {
  let result = text;
  for (const emoji of list) {
    if (result.includes(emoji)) {
      result = result.split(emoji).join("");
    }
  }
  return result;
}

/**
 * Limpa whitespace residual depois de remover emojis:
 * - Espaços duplos viram simples
 * - " \n" vira "\n" (espaço antes de quebra)
 * - "\n " vira "\n" (espaço depois de quebra)
 * - 3+ quebras de linha viram 2
 * - Vírgulas/pontos com espaço antes ficam limpos
 */
function cleanWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.!?;:])/g, "$1") // espaço antes de pontuação
    .trim();
}

/**
 * Aplica o tom de voz à mensagem. Retorna a mensagem transformada.
 * Se tone é null/undefined ou inválido, defaulta pra "amigavel" (que = padrão).
 *
 * SEGURO: nunca lança. Se algo der errado, retorna a mensagem original.
 */
export function applyTone(message: string, tone: Tone | string | null | undefined): string {
  if (!message || typeof message !== "string") return message;

  try {
    // Normaliza tone — qualquer valor desconhecido vira "amigavel" (padrão atual)
    const normalizedTone: Tone =
      tone === "profissional" || tone === "casual" || tone === "amigavel" || tone === "tecnico"
        ? tone
        : "amigavel";

    // amigavel/casual: padrão atual com emojis moderados — sem alteração
    if (normalizedTone === "amigavel" || normalizedTone === "casual") {
      return message;
    }

    if (normalizedTone === "profissional") {
      let result = stripEmojis(message, FESTIVE_EMOJIS);
      // Reduz exclamações múltiplas mas mantém pelo menos uma (linguagem ainda
      // permite ênfase em confirmações).
      result = result.replace(/!{2,}/g, "!");
      // Remove "Aê!", "Beleza!", "Show!" no início se houver (gírias)
      result = result.replace(/^(\*\s*)?(Aê|Beleza|Show|Tá[\s,]|Bora|Maneiro|Tranquilo)[!,.\s]+/i, "$1");
      return cleanWhitespace(result);
    }

    if (normalizedTone === "tecnico") {
      // Remove festivos + decorativos
      let result = stripEmojis(message, FESTIVE_EMOJIS);
      result = stripEmojis(result, DECORATIVE_EMOJIS);
      // Exclamações viram pontos (linguagem técnica é seca)
      result = result.replace(/!+/g, ".");
      // Remove gírias iniciais
      result = result.replace(/^(\*\s*)?(Aê|Beleza|Show|Tá[\s,]|Bora|Maneiro|Tranquilo|Olha|Veja só)[!,.\s]+/i, "$1");
      return cleanWhitespace(result);
    }

    return message;
  } catch (e) {
    // Falha-safe: retorna mensagem original se algo der errado
    console.warn("[applyTone] error, returning original:", (e as Error).message?.slice(0, 100));
    return message;
  }
}
