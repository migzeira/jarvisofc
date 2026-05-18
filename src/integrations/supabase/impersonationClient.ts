/**
 * impersonationClient
 *
 * Cliente Supabase SECUNDÁRIO usado quando o admin entra no modo
 * "Ver painel do cliente" (impersonation).
 *
 * Por que um cliente separado:
 * O cliente principal (`./client.ts`) usa `localStorage` com a chave default
 * do Supabase pra persistir a sessão do admin. Se a gente tentasse trocar
 * a sessão diretamente nele via `auth.setSession()`, o admin SERIA DESLOGADO
 * do próprio painel — perdendo o acesso de admin.
 *
 * Esse cliente:
 *   - Usa storage com chave isolada (`sb-impersonation-auth`)
 *   - Não compartilha sessão com o cliente principal
 *   - É populado via `setImpersonationSession(tokens)` que o frontend chama
 *     após receber tokens da edge function `admin-impersonate-token`
 *
 * IMPORTANTE: esse arquivo só EXISTE — não é usado ainda na Fase 1.
 * Fase 2 migra componentes pra `useSupabase()` (que retorna o cliente certo
 * via Context). Fase 3 ativa a feature de fato.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://fnilyapvhhygfzcdxqjm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuaWx5YXB2aGh5Z2Z6Y2R4cWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0Mzc4NzYsImV4cCI6MjA5MTAxMzg3Nn0.A_fljSEuPD9ezUTBC9jBvQu-M3dtCk-fDfwm5CV07c4";

// Storage key isolada da do cliente principal. Sem isso, o setSession() embaixo
// SOBRESCREVERIA a sessão do admin no localStorage padrão e ele perderia acesso.
const IMPERSONATION_STORAGE_KEY = "sb-impersonation-auth";

/**
 * Wrapper de localStorage que usa uma chave fixa pra isolamento.
 * Necessário porque o Supabase normalmente derive a key do URL do projeto;
 * forçamos uma key custom pra evitar colisão.
 */
const impersonationStorage: Storage = {
  getItem(key) {
    // O Supabase chama com a key derivada (ex: 'sb-xxx-auth-token').
    // Redireciona TUDO pra nossa key custom + sufixo, mantendo isolamento.
    return localStorage.getItem(`${IMPERSONATION_STORAGE_KEY}-${key}`);
  },
  setItem(key, value) {
    localStorage.setItem(`${IMPERSONATION_STORAGE_KEY}-${key}`, value);
  },
  removeItem(key) {
    localStorage.removeItem(`${IMPERSONATION_STORAGE_KEY}-${key}`);
  },
  clear() {
    // Limpa apenas as chaves de impersonation, não toca em outras
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(IMPERSONATION_STORAGE_KEY)) {
        localStorage.removeItem(k);
      }
    }
  },
  get length() {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(IMPERSONATION_STORAGE_KEY)) count++;
    }
    return count;
  },
  key(index) {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(IMPERSONATION_STORAGE_KEY)) {
        if (count === index) return k.replace(`${IMPERSONATION_STORAGE_KEY}-`, "");
        count++;
      }
    }
    return null;
  },
};

export const impersonationClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: impersonationStorage,
      storageKey: "sb-impersonation",  // override pra garantir prefixo único
      persistSession: true,
      autoRefreshToken: true,
      // Não detecta sessão na URL — esse cliente é manipulado programaticamente
      detectSessionInUrl: false,
    },
  }
);

/**
 * Ativa o modo impersonation populando o cliente secundário com tokens.
 * Chamado após `admin-impersonate-token` retornar { access_token, refresh_token }.
 *
 * @returns true se ativou com sucesso, false caso contrário
 */
export async function setImpersonationSession(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<boolean> {
  const { error } = await impersonationClient.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error) {
    console.error("[impersonationClient] setSession failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Limpa a sessão de impersonation. Chamado quando admin clica "Sair desse modo"
 * no banner do view-as.
 */
export async function clearImpersonationSession(): Promise<void> {
  try {
    await impersonationClient.auth.signOut();
  } catch (e) {
    console.warn("[impersonationClient] signOut warning:", (e as Error).message);
  }
  // Garante limpeza mesmo se signOut falhar
  impersonationStorage.clear();
}

/**
 * Retorna o user atualmente impersonado (ou null se não houver sessão ativa).
 */
export async function getImpersonatedUser() {
  const { data, error } = await impersonationClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
