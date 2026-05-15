import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserAccessStatus } from "@/hooks/useUserAccessStatus";
import { PlanCTAButtons } from "@/components/PlanCTAButtons";

/**
 * Wrapper que bloqueia o conteúdo se o user NÃO tem plano ativo nem trial válido.
 *
 * Comportamento:
 *   - status='trial' (dentro de 3 dias) → renderiza children normalmente
 *   - status='active' (assinante) → renderiza children normalmente
 *   - status='loading' → mostra skeleton
 *   - status='expired'/'pending'/'suspended' → mostra PaywallScreen (bloqueia tudo)
 *
 * Usado nas rotas Lembretes, Finanças, Anotações, Agenda, Hábitos, Contatos.
 * Configurações e Início (DashboardHome) NÃO usam — user precisa acessar pra renovar.
 */
export function RequireActivePlan({ children }: { children: ReactNode }) {
  const { status, canUseJarvis, loading } = useUserAccessStatus();

  if (loading || status === "loading") {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Permite uso se está em trial OU active (ambos canUseJarvis=true)
  if (canUseJarvis) {
    return <>{children}</>;
  }

  // Status: expired | pending | suspended | unknown — bloqueia
  return <PaywallScreen status={status} />;
}

/**
 * Tela de paywall — bloqueia recurso quando user não tem plano ativo nem trial.
 * Mostra título contextual (expirado vs nunca teve plano) + planos + reassurance.
 */
function PaywallScreen({ status }: { status: string }) {
  const isExpired = status === "expired";
  const isSuspended = status === "suspended";

  const title = isExpired
    ? "Seu período de teste acabou"
    : isSuspended
      ? "Sua conta foi suspensa"
      : "Você precisa de um plano ativo";

  const subtitle = isExpired
    ? "Pra continuar acessando esse recurso, escolha um plano abaixo."
    : isSuspended
      ? "Sua conta foi suspensa. Reative escolhendo um plano abaixo."
      : "Pra usar essa funcionalidade do Jarvis, escolha um plano abaixo.";

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-12rem)] px-4">
      <Card className="w-full max-w-xl border-2 border-red-500/60 bg-gradient-to-br from-red-500/10 via-rose-500/5 to-red-500/10 shadow-xl shadow-red-500/10">
        <CardContent className="pt-8 pb-6 space-y-6">
          {/* Ícone + título */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 blur-2xl rounded-full" />
              <div className="relative bg-red-500/15 border-2 border-red-500/40 rounded-full p-4">
                <Lock className="h-8 w-8 text-red-300" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-red-100 flex items-center gap-2 justify-center">
                <AlertTriangle className="h-5 w-5 text-red-400 animate-pulse" />
                {title}
              </h2>
              <p className="text-sm text-red-200/90 mt-2 max-w-md">
                {subtitle}
              </p>
            </div>
          </div>

          {/* Planos lado a lado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-4">
              <p className="text-xs uppercase tracking-wide text-violet-300 font-semibold mb-1">
                💎 Plano Mensal
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Flexibilidade total — pague mês a mês.
              </p>
              <p className="text-2xl font-bold text-violet-100">
                R$ 39,90<span className="text-xs font-normal text-muted-foreground">/mês</span>
              </p>
            </div>
            <div className="relative rounded-lg border-2 border-emerald-500/50 bg-emerald-500/5 p-4">
              <span className="absolute -top-2.5 right-2 bg-emerald-500/40 text-emerald-100 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/60 font-bold tracking-wide">
                MAIS POPULAR
              </span>
              <p className="text-xs uppercase tracking-wide text-emerald-300 font-semibold mb-1">
                💰 Plano Anual
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                2 meses grátis — economize 25%.
              </p>
              <p className="text-2xl font-bold text-emerald-100">
                R$ 29,90<span className="text-xs font-normal text-muted-foreground">/mês</span>
              </p>
            </div>
          </div>

          {/* CTA principal — botões Kirvano */}
          <PlanCTAButtons />

          {/* Link sutil pra Configurações (perfil + plano) */}
          <div className="pt-2 border-t border-red-500/20">
            <Link to="/dashboard/configuracoes?tab=perfil">
              <Button variant="ghost" className="w-full text-sm gap-2 text-muted-foreground hover:text-foreground">
                Ver minha conta e configurações
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>

          {/* Reassurance */}
          <div className="flex items-start gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-200/90 leading-relaxed">
              Após pagar, o Jarvis volta a responder no WhatsApp{" "}
              <span className="font-semibold text-emerald-100">em segundos</span>{" "}
              e essa página é desbloqueada automaticamente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
