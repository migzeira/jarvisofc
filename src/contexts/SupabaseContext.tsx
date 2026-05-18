/**
 * SupabaseContext
 *
 * Provê o cliente Supabase ativo pra árvore React. Em rotas normais, retorna
 * o cliente principal (`./integrations/supabase/client`). Em rotas de
 * impersonation (`/admin/view-as/:userId`, na Fase 3), o ImpersonationProvider
 * sobrescreve o context com o `impersonationClient` — daí os componentes
 * filhos passam a fazer queries como se fossem o user-alvo.
 *
 * USO ATUAL (Fase 1):
 *   - Provider envolve <App /> com o cliente default
 *   - Componentes ainda usam `import { supabase }` direto — context é inerte
 *   - Migração progressiva via `useSupabase()` na Fase 2
 *
 * USO FUTURO (Fase 3):
 *   - `<ImpersonationProvider>` envolve rotas /admin/view-as/* com o cliente
 *     secundário (impersonationClient)
 *   - Componentes que migraram pra `useSupabase()` automaticamente usam o
 *     cliente certo dependendo da rota
 */
import { createContext, useContext, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabaseClient } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TypedSupabase = SupabaseClient<Database>;

const SupabaseContext = createContext<TypedSupabase>(defaultSupabaseClient);

interface SupabaseProviderProps {
  children: ReactNode;
  client?: TypedSupabase;  // optional override (usado no ImpersonationProvider)
}

export function SupabaseProvider({ children, client }: SupabaseProviderProps) {
  return (
    <SupabaseContext.Provider value={client ?? defaultSupabaseClient}>
      {children}
    </SupabaseContext.Provider>
  );
}

/**
 * Hook que retorna o cliente Supabase ativo no escopo atual.
 * Em rotas normais: retorna o cliente default (admin/user logado).
 * Em rotas /admin/view-as/*: retorna o cliente de impersonation.
 *
 * USO: const supabase = useSupabase();
 *      const { data } = await supabase.from("transactions").select(...);
 */
export function useSupabase(): TypedSupabase {
  return useContext(SupabaseContext);
}
