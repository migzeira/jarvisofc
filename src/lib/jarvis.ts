/**
 * Constantes oficiais do Jarvis no WhatsApp.
 *
 * Single source of truth pra TODOS os botões/links que abrem o WhatsApp
 * do Jarvis em qualquer parte do app (sidebar, dashboard, MeuPerfil, etc).
 *
 * Histórico:
 * - Antes ficavam duplicadas em MeuPerfil.tsx + Sidebar (commit antigo)
 * - Centralizadas aqui em 19/05/2026 quando feedback da Gabriela mostrou
 *   que usuários novos não achavam o número facilmente — vários botões
 *   "Conversar com Jarvis" foram espalhados pela UI, todos devem usar
 *   essas constantes (e não números hardcoded).
 *
 * Se o número mudar, troca aqui — todos os botões atualizam.
 */

/** Número limpo só com dígitos. Usado em wa.me/<numero>. */
export const JARVIS_WHATSAPP = "5511936196103";

/** Versão formatada pra exibir em UI (ex: ao lado de "Salve nos contatos"). */
export const JARVIS_WHATSAPP_FORMATTED = "+55 11 93619-6103";

/**
 * Link wa.me com mensagem inicial pré-preenchida.
 * Abre o WhatsApp direto na conversa com o Jarvis com "Oi Jarvis!" já no input.
 *
 * Usar em todos os botões de "Conversar com Jarvis":
 *   <a href={JARVIS_WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
 */
export const JARVIS_WHATSAPP_LINK = `https://wa.me/${JARVIS_WHATSAPP}?text=Oi%20Jarvis!`;
