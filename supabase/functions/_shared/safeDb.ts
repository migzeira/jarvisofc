// ─────────────────────────────────────────────────────────────────────────────
// safeDb — wrapper defensivo para operações Supabase
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPORTANTE: supabase-js v2 retorna PostgrestBuilder/FilterBuilder que
// implementam PromiseLike (só têm .then()) mas NÃO têm .catch() nativo.
//
// BUG HISTÓRICO: chamadas como `supabase.from("x").insert({...}).catch(() => {})`
// lançavam "catch is not a function" e quebravam TODA a Edge Function
// silenciosamente, matando o fluxo antes de completar (mensagens não enviadas,
// sessões não atualizadas, pedidos não processados).
//
// USO CORRETO:
//   const ok = await safeDb(supabase.from("x").insert({...}));
//   if (!ok) { /* erro já logado em console.error */ }
//
// OU quando precisa do dado:
//   const { data } = await safeDbFetch(supabase.from("x").select("*"));
//
// NUNCA FAÇA:
//   supabase.from("x").insert({...}).catch(() => {});  ❌ QUEBRA A FUNÇÃO
//   await supabase.from("x").insert({...}).catch(() => {});  ❌ QUEBRA A FUNÇÃO

/**
 * Executa uma operação Supabase (insert/update/upsert/delete) capturando
 * qualquer erro silenciosamente. Retorna true se sucesso, false se erro.
 * O erro é logado em console.error (visível nos logs da Edge Function).
 */
export async function safeDb(
  query: PromiseLike<{ error?: { message?: string } | null }>,
  context: string = "db",
): Promise<boolean> {
  try {
    const result = await query;
    const err = (result as { error?: { message?: string } | null })?.error;
    if (err) {
      console.error(`[safeDb:${context}] ${err.message ?? "unknown error"}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[safeDb:${context}] exception: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Fire-and-forget: dispara a query sem esperar. Útil pra operações não-críticas.
 * NUNCA use .catch() direto nela — sempre passe por aqui.
 */
export function safeDbFireAndForget(
  query: PromiseLike<unknown>,
  context: string = "db-fnf",
): void {
  Promise.resolve(query).then(
    () => {},
    (e) => console.error(`[safeDb:${context}] ${(e as Error).message}`),
  );
}
