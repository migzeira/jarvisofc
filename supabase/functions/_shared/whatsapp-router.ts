/**
 * Multi-WhatsApp Router
 * ─────────────────────
 * Resolve qual sessao WPPConnect (= qual chip do Jarvis) deve atender
 * cada user. Estrategia: STICKY SMART ASSIGNMENT.
 *
 *   1. User fala 1a vez → busca em user_jarvis_assignments
 *   2. Se nao tem → chama pick_best_jarvis_number() (RPC) → cria assignment
 *   3. Se tem → usa o numero atribuido (gruda)
 *
 * Edge case (whatsapp-webhook receiver):
 *   - User chegou via session X (escolheu X "do nada" — provavelmente
 *     onboarding link-init mandou welcome de X). Nesse caso, criamos
 *     assignment user → X (preserva continuidade da conversa).
 *
 * Edge case (whatsapp-link-init outbound first):
 *   - Sistema vai mandar welcome ANTES do user interagir. Chama
 *     pick_best_jarvis_number() + cria assignment ANTES do send.
 *
 * Fallback:
 *   - Se nao tem numeros 'connected' + 'active' disponiveis, retorna null
 *     e caller DEVE cair pro env padrao (WPPCONNECT_SESSION/WPPCONNECT_TOKEN).
 *     Isso preserva o comportamento legado (1 numero unico) ate alguem
 *     parear pelo menos 1 numero via UI admin.
 *
 * Performance:
 *   - Resolve faz 1 query (SELECT) ou 2 queries (SELECT + RPC + INSERT) na
 *     primeira interacao. Resultado nao e cached em memoria pq edge functions
 *     sao stateless e short-lived — DB ja serve como cache via PK lookup.
 *
 * Notas tecnicas:
 *   - jarvis_numbers.notes guarda { "token": "<full>" } em JSON pra cada
 *     sessao (preenchido pelo whatsapp-session-manager.actionEnsureSessionToken).
 *   - Esse e um hack temporario (token em texto) — Fase 3 deve criar
 *     coluna dedicada encriptada (pgsodium).
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AsyncLocalStorage } from "node:async_hooks";

export interface ResolvedSession {
  jarvis_number_id: string;
  session: string;       // session_name no WPPConnect (ex: "jarvis2")
  token: string;         // token Bearer full (ex: "wppconnect:$2b$10$...")
  phone_number: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// AsyncLocalStorage para propagacao automatica de userId/session pelo
// webhook sem precisar passar ctx em cada chamada de sendText.
//
// Uso (webhook):
//   await withWebhookCtx({ userId, session }, async () => {
//     // qualquer sendText/sendImage/sendButtons dentro dessa async chain
//     // automaticamente recebe { userId, session } se nao passado explicitamente
//   });
//
// Race-condition safe: cada request HTTP roda em sua propria async context,
// AsyncLocalStorage isola automaticamente.
// ─────────────────────────────────────────────────────────────────────────

export interface WebhookCtx {
  userId?: string | null;
  session?: string;
  /** Token opcional — normalmente derivado de session via resolveSessionForUser. */
  token?: string;
}

const ctxStore = new AsyncLocalStorage<WebhookCtx>();

/** Executa fn dentro de um contexto webhook. Tudo dentro herda o ctx. */
export function withWebhookCtx<T>(ctx: WebhookCtx, fn: () => Promise<T> | T): Promise<T> | T {
  return ctxStore.run(ctx, fn);
}

/**
 * Seta o ctx para o async context atual (e descendentes), SEM precisar
 * envolver em callback. Use isso quando refactor de wrapping seria muito
 * invasivo (ex: whatsapp-webhook com 10k+ linhas).
 *
 * O objeto ctx passado e armazenado por REFERENCIA — mutar suas
 * propriedades depois (ex: ctx.userId = profile.id) funciona pra atualizar
 * o store em runtime.
 *
 * IMPORTANTE: cada request HTTP cria seu proprio async context, entao
 * enterWith e race-condition safe (handler concorrente nao vaza ctx).
 */
export function enterWebhookCtx(ctx: WebhookCtx): WebhookCtx {
  ctxStore.enterWith(ctx);
  return ctx;
}

/** Lê o ctx atual (se houver). Retorna {} se fora de qualquer withWebhookCtx. */
export function getWebhookCtx(): WebhookCtx {
  return ctxStore.getStore() ?? {};
}

// Cliente service_role compartilhado (Deno reutiliza modulos entre requests
// na mesma instancia — singleton best-effort).
let _supa: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (_supa) return _supa;
  _supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _supa;
}

/** Extrai token do campo notes (formato {"token":"..."}). */
function extractToken(notes: string | null | undefined): string | null {
  if (!notes) return null;
  try {
    const o = JSON.parse(notes);
    return typeof o?.token === "string" ? o.token : null;
  } catch {
    return null;
  }
}

/**
 * Busca um numero pelo ID e retorna ResolvedSession (incluindo token).
 * Retorna null se nao existe ou nao tem token configurado.
 */
async function fetchResolvedById(numberId: string): Promise<ResolvedSession | null> {
  const supa = getServiceClient();
  const { data, error } = await (supa.from("jarvis_numbers" as any) as any)
    .select("id, session_name, phone_number, notes")
    .eq("id", numberId)
    .maybeSingle();
  if (error || !data) return null;
  const token = extractToken((data as any).notes);
  if (!token) return null;
  return {
    jarvis_number_id: (data as any).id,
    session: (data as any).session_name,
    token,
    phone_number: (data as any).phone_number ?? null,
  };
}

/**
 * Resolve a sessao atribuida a um user. Cria assignment automaticamente se
 * nao existe (usando pick_best_jarvis_number).
 *
 * Retorna null em 3 casos:
 *   1. userId vazio
 *   2. Nenhum jarvis_number ativo+connected disponivel pra atribuir
 *   3. Numero atribuido nao tem token configurado (corrompido)
 *
 * Caller deve cair pro env WPPCONNECT_SESSION/TOKEN nesses casos.
 */
export async function resolveSessionForUser(userId: string | null | undefined): Promise<ResolvedSession | null> {
  if (!userId) return null;
  const supa = getServiceClient();

  // 1) Tenta achar assignment existente
  const { data: assignment } = await (supa.from("user_jarvis_assignments" as any) as any)
    .select("jarvis_number_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (assignment?.jarvis_number_id) {
    const resolved = await fetchResolvedById((assignment as any).jarvis_number_id);
    if (resolved) return resolved;
    // Numero existe mas sem token? Loga e cai pro fallback abaixo (cria novo)
    console.warn(`[router.resolveSessionForUser] assignment ${userId} -> ${(assignment as any).jarvis_number_id} sem token. Re-atribuindo.`);
  }

  // 2) Sem assignment (ou corrompido) → escolhe melhor numero via RPC
  const { data: bestId, error: rpcErr } = await (supa.rpc as any)("pick_best_jarvis_number");
  if (rpcErr || !bestId) {
    console.warn("[router.resolveSessionForUser] pick_best_jarvis_number sem candidatos:", rpcErr?.message);
    return null;
  }

  // 3) Cria assignment (upsert pra cobrir caso de corrupcao)
  const { error: upsertErr } = await (supa.from("user_jarvis_assignments" as any) as any)
    .upsert({
      user_id: userId,
      jarvis_number_id: bestId,
      reassign_reason: assignment ? "token_missing" : "initial",
    }, { onConflict: "user_id" });

  if (upsertErr) {
    console.error("[router.resolveSessionForUser] upsert assignment failed:", upsertErr.message);
    // Mesmo se falhou, tenta usar o numero igual — pior caso vai re-tentar na proxima
  }

  return await fetchResolvedById(bestId);
}

/**
 * Garante que existe assignment pro user, OU vinculando ao session que foi
 * passado (preserva continuidade quando mensagem chega DE um numero ainda
 * nao atribuido), OU usando pick_best como fallback.
 *
 * Usado pelo webhook quando recebe mensagem de user sem assignment.
 */
export async function ensureAssignmentFromSession(
  userId: string,
  sessionName: string
): Promise<ResolvedSession | null> {
  if (!userId) return null;
  const supa = getServiceClient();

  // Ja tem assignment? Retorna direto.
  const { data: existing } = await (supa.from("user_jarvis_assignments" as any) as any)
    .select("jarvis_number_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.jarvis_number_id) {
    return await fetchResolvedById((existing as any).jarvis_number_id);
  }

  // Sem assignment → tenta vincular ao numero que recebeu a msg (se ele
  // existe e ta ativo + connected)
  const { data: numByName } = await (supa.from("jarvis_numbers" as any) as any)
    .select("id, session_name, is_active, connection_status, notes, phone_number")
    .eq("session_name", sessionName)
    .maybeSingle();

  let targetId: string | null = null;
  if (numByName && (numByName as any).is_active && (numByName as any).connection_status === "connected") {
    targetId = (numByName as any).id;
  } else {
    // Numero da mensagem nao ta apto (desativado / desconectado) → fallback pick_best
    const { data: bestId } = await (supa.rpc as any)("pick_best_jarvis_number");
    targetId = bestId ?? null;
  }

  if (!targetId) return null;

  await (supa.from("user_jarvis_assignments" as any) as any)
    .upsert({
      user_id: userId,
      jarvis_number_id: targetId,
      reassign_reason: "incoming_message",
    }, { onConflict: "user_id" });

  return await fetchResolvedById(targetId);
}

/**
 * Incrementa daily_msg_count e total_msg_count de um numero.
 * Fire-and-forget: nao bloqueia o caller, erros logados.
 *
 * Reset diario do daily_msg_count e feito por cron (a criar na Fase 3).
 * Por ora, se daily_msg_reset_at < today, reseta inline aqui.
 */
export async function incrementMsgCount(numberId: string | null | undefined): Promise<void> {
  if (!numberId) return;
  const supa = getServiceClient();

  // Lê estado atual pra decidir se reseta o daily counter
  const { data: cur } = await (supa.from("jarvis_numbers" as any) as any)
    .select("daily_msg_count, daily_msg_reset_at, total_msg_count")
    .eq("id", numberId)
    .maybeSingle();
  if (!cur) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const lastReset = (cur as any).daily_msg_reset_at as string | null;
  const needsReset = !lastReset || lastReset.slice(0, 10) < todayStr;

  const updates: any = {
    total_msg_count: ((cur as any).total_msg_count ?? 0) + 1,
  };
  if (needsReset) {
    updates.daily_msg_count = 1;
    updates.daily_msg_reset_at = todayStr;
  } else {
    updates.daily_msg_count = ((cur as any).daily_msg_count ?? 0) + 1;
  }

  await (supa.from("jarvis_numbers" as any) as any)
    .update(updates)
    .eq("id", numberId);
}

/**
 * Cache do env fallback pra evitar re-leitura. Util pra quando nenhum
 * numero estiver pareado (deploy fresh) e caller precisar saber se ainda
 * tem fallback configurado.
 */
export function getEnvFallback(): { session: string; token: string } | null {
  const session = Deno.env.get("WPPCONNECT_SESSION") ?? "";
  const token = Deno.env.get("WPPCONNECT_TOKEN") ?? "";
  if (!session || !token) return null;
  return { session, token };
}
