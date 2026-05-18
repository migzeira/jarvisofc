/**
 * AdminViewAs
 *
 * Rota /admin/view-as/:userId — permite ao admin "entrar no painel" de um user
 * específico, vendo TUDO exatamente como o user veria, com permissão de write.
 *
 * Como funciona:
 *   1. Pega user.id alvo da URL
 *   2. Chama edge function admin-impersonate-token (verifica is_admin no backend
 *      via JWT do admin atual)
 *   3. Recebe { access_token, refresh_token, target_user }
 *   4. Popula impersonationClient com setSession(tokens)
 *   5. Renderiza DashboardLayout dentro de:
 *        <SupabaseProvider client={impersonationClient}>
 *          <AuthProvider> (vai re-observar o impersonationClient)
 *            <DashboardLayout />
 *
 *   Resultado: todos os components do dashboard (que usam useSupabase() +
 *   useAuth()) automaticamente operam no contexto do user-alvo.
 *
 *   6. Banner persistente no topo: "👁️ Vendo o painel de [NAME]"
 *      Botão "Sair desse modo" → clearImpersonationSession() + navigate('/admin')
 *
 * Segurança:
 *   - Frontend faz verificação rápida de is_admin via useAuth (admin context)
 *   - Backend (edge function) faz a verificação REAL com service_role
 *   - Toda chamada registrada em admin_audit_log
 */
import { useEffect, useState, Suspense, lazy } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, X, Eye, AlertTriangle } from "lucide-react";
import { useAuth, AuthProvider } from "@/hooks/useAuth";
import { SupabaseProvider } from "@/contexts/SupabaseContext";
import { impersonationClient, setImpersonationSession, clearImpersonationSession } from "@/integrations/supabase/impersonationClient";
import logoIcon from "@/assets/logo_icon.webp";

// Lazy import do DashboardLayout pra evitar carga inicial pesada (mesmo pattern do App.tsx)
const DashboardLayout = lazy(() => import("@/components/DashboardLayout"));

interface TargetUser {
  id: string;
  email: string;
  display_name: string | null;
  phone_number: string | null;
}

function ViewAsBanner({ targetUser, onExit }: { targetUser: TargetUser; onExit: () => void }) {
  const name = targetUser.display_name || targetUser.email || "este usuário";
  // Banner com listras animadas + cor mais agressiva (laranja em vez de
  // violeta sutil) pra deixar OBVIO pro admin que ele NAO esta no proprio
  // painel. Risco: deletar/editar coisa do user-alvo achando que e o proprio.
  return (
    <div
      className="sticky top-0 z-[60] backdrop-blur text-white px-4 py-2.5 shadow-lg border-b border-amber-400/40 flex items-center justify-between gap-3"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.95) 0 12px, rgba(217, 119, 6, 0.95) 12px 24px)",
      }}
    >
      <div className="flex items-center gap-2.5 text-sm font-medium min-w-0">
        <Eye className="w-4 h-4 shrink-0" />
        <span className="truncate">
          <strong className="uppercase tracking-wide text-amber-50">[Admin view-as]</strong> Vendo painel de{" "}
          <strong>{name}</strong>
          {targetUser.email && (
            <span className="ml-2 text-amber-100 text-xs font-normal">({targetUser.email})</span>
          )}
          <span className="hidden md:inline ml-2 text-amber-100/80 text-xs font-normal">
            — Ações são registradas no audit log
          </span>
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onExit}
        className="text-white hover:bg-white/15 h-8 gap-1.5 shrink-0 font-semibold"
      >
        <X className="w-3.5 h-3.5" /> Sair
      </Button>
    </div>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-center max-w-md px-4">
        <img src={logoIcon} alt="" className="w-12 h-12 animate-spin" style={{ animationDuration: "1.2s" }} />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onBack }: { error: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="max-w-md w-full border-red-500/30">
        <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400" />
          <div>
            <h2 className="text-lg font-semibold">Não foi possível abrir o painel</h2>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <Button onClick={onBack}>Voltar ao Admin</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminViewAs() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { isAdmin, session, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [targetUser, setTargetUser] = useState<TargetUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Bootstrap: chama edge function pra gerar token + ativa session ──
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!userId) {
        setError("ID do usuário não informado na URL.");
        setPhase("error");
        return;
      }
      if (!session?.access_token) {
        setError("Sessão admin inválida. Faça login de novo.");
        setPhase("error");
        return;
      }

      try {
        // 1. Pede tokens do user-alvo pra edge function
        const supabaseUrl =
          (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
          "https://fnilyapvhhygfzcdxqjm.supabase.co";

        const res = await fetch(`${supabaseUrl}/functions/v1/admin-impersonate-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ target_user_id: userId }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            errBody?.error ||
              (res.status === 403
                ? "Você não tem permissão de admin."
                : res.status === 404
                ? "Usuário não encontrado."
                : `Erro do servidor (HTTP ${res.status})`)
          );
        }

        const data = (await res.json()) as {
          access_token: string;
          refresh_token: string;
          target_user: TargetUser;
        };

        if (cancelled) return;

        // 2. Popula impersonationClient com sessão do user-alvo
        const ok = await setImpersonationSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (!ok) {
          throw new Error("Falha ao ativar a sessão de visualização.");
        }

        if (cancelled) return;

        setTargetUser(data.target_user);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || "Erro desconhecido ao abrir o painel.");
        setPhase("error");
      }
    }

    if (!authLoading && isAdmin) {
      bootstrap();
    }

    return () => {
      cancelled = true;
    };
  }, [userId, session?.access_token, authLoading, isAdmin]);

  // ── Cleanup: ao desmontar (sair da rota), limpa a sessão de impersonation ──
  useEffect(() => {
    return () => {
      // Best-effort cleanup. Mesmo se falhar, próxima impersonation sobrescreve.
      clearImpersonationSession().catch(() => {});
    };
  }, []);

  // ── Guards ──
  if (authLoading) {
    return <LoadingScreen message="Verificando permissões..." />;
  }
  // Defesa: useAuth aqui usa o cliente DEFAULT (esse componente está fora do
  // SupabaseProvider de impersonation). Se não for admin, redireciona.
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  if (phase === "loading") {
    return <LoadingScreen message="Gerando acesso ao painel do usuário..." />;
  }
  if (phase === "error" || !targetUser) {
    return (
      <ErrorScreen
        error={error || "Erro desconhecido."}
        onBack={() => navigate("/admin")}
      />
    );
  }

  // ── Render: dashboard do user-alvo ──
  return (
    <div className="min-h-screen bg-background">
      <ViewAsBanner
        targetUser={targetUser}
        onExit={() => {
          // Limpeza síncrona + navegação. O useEffect cleanup também roda mas
          // garantimos consistência aqui.
          clearImpersonationSession().finally(() => navigate("/admin"));
        }}
      />
      {/*
       * Camadas:
       *  - SupabaseProvider injeta impersonationClient no Context.
       *  - AuthProvider (re-renderizado aqui) observa esse client e expõe
       *    user/session do user-alvo via useAuth().
       *  - DashboardLayout e filhos consomem useSupabase() + useAuth() e
       *    automaticamente operam no contexto certo.
       */}
      <SupabaseProvider client={impersonationClient}>
        <AuthProvider>
          <Suspense
            fallback={
              <div className="p-6">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <DashboardLayout />
          </Suspense>
        </AuthProvider>
      </SupabaseProvider>
    </div>
  );
}
