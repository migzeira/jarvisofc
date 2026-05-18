import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useSupabase } from "@/contexts/SupabaseContext";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isAdmin: false,
  signOut: async () => {},
});

// Emails com bootstrap de admin (fallback se is_admin ainda não estiver setado).
// Mantido para compatibilidade retroativa — deploy inicial não tinha coluna is_admin.
const BOOTSTRAP_ADMIN_EMAILS = new Set(["migueldrops@gmail.com"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // is_admin carregado do banco (profiles.is_admin). Null enquanto não resolveu.
  const [isAdminFromDb, setIsAdminFromDb] = useState<boolean | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
    // supabase mudou (ex: troca pra impersonationClient em /admin/view-as)
    // → re-subscribe pra observar o cliente correto.
  }, [supabase]);

  // Quando user muda, carrega o flag is_admin do profile.
  // Em caso de erro/coluna ausente, silenciosamente cai no fallback por email.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsAdminFromDb(null);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", user.id)
          .maybeSingle();
        if (!cancelled) setIsAdminFromDb((data as any)?.is_admin === true);
      } catch {
        if (!cancelled) setIsAdminFromDb(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, supabase]);

  // Admin se: flag no banco = true OU email está no bootstrap list
  // Bootstrap garante que o admin inicial sempre funciona mesmo se migration falhar
  const isAdmin = isAdminFromDb === true || (user?.email ? BOOTSTRAP_ADMIN_EMAILS.has(user.email) : false);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
