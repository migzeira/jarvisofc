import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Zap, ExternalLink, Heart, Sparkles, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { isCouplePlan } from "@/lib/plan";
import { PlanCTAButtons } from "@/components/PlanCTAButtons";
import { useUserAccessStatus } from "@/hooks/useUserAccessStatus";

const FEATURES = [
  "Assistente pessoal 24/7 no WhatsApp",
  "Agenda e compromissos inteligentes",
  "Lembretes automáticos",
  "Anotações e notas rápidas",
  "Controle financeiro",
  "Briefing diário personalizado",
  "Sem limite de mensagens",
];

export default function MeuPlano() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const access = useUserAccessStatus();

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("account_status, access_until, kirvano_subscription_id, plan, created_at, trial_started_at, trial_ends_at")
      .eq("id", user!.id)
      .single();
    setProfile(data);
    setLoading(false);
  };

  if (loading || access.loading) {
    return (
      <div className="space-y-4 max-w-lg">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!profile) return null;

  const isActive = profile.account_status === "active";
  const isSuspended = profile.account_status === "suspended";
  const isTrial = access.status === "trial";
  const isExpired = access.status === "expired";
  const isPending = access.status === "pending";
  const needsToPay = isExpired || isPending || isSuspended;

  const accessUntil = profile.access_until ? new Date(profile.access_until) : null;
  const isCancelling = isActive && accessUntil && accessUntil > new Date();
  const isAnnual =
    (profile.plan as string)?.includes("anual") ||
    (profile.plan as string)?.includes("annual") ||
    (profile.plan as string)?.includes("annually");
  const isCasal = isCouplePlan(profile.plan);
  const planTitle = isCasal ? "Plano Casal" : "Plano Jarvis";

  // ── Render principal ──
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Minha Assinatura</h1>

      {/* ─── TRIAL ATIVO ─── */}
      {isTrial && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Sparkles className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-emerald-100">Período de Teste Ativo</h2>
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Gratuito</Badge>
                </div>
                <p className="text-sm text-emerald-200/80">
                  Você tem <span className="font-bold text-emerald-100">{access.trialDaysRemaining ?? 0} {access.trialDaysRemaining === 1 ? "dia restante" : "dias restantes"}</span> pra
                  testar tudo que o Jarvis pode fazer.
                </p>
                {access.trialEndsAt && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
                    <Clock className="h-3 w-3" />
                    Trial expira em {format(access.trialEndsAt, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 p-3 rounded-lg bg-background/40 border border-emerald-500/20">
              <p className="text-sm font-medium mb-2">💡 Antes de acabar o trial, escolha seu plano:</p>
              <PlanCTAButtons />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── TRIAL EXPIRADO ou PENDENTE — paywall ─── */}
      {needsToPay && !isCancelling && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Clock className="h-6 w-6 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h2 className="text-xl font-bold text-red-100">
                  {isExpired
                    ? "Período de teste expirou"
                    : isSuspended
                      ? "Conta suspensa"
                      : "Sem plano ativo"}
                </h2>
                <p className="text-sm text-red-200/80">
                  {isExpired
                    ? "Seu trial gratuito terminou. Escolha um plano abaixo pra continuar usando o Jarvis no WhatsApp."
                    : isSuspended
                      ? "Sua conta foi suspensa. Pra reativar, escolha um plano abaixo."
                      : "Você ainda não tem plano ativo. Escolha um abaixo pra começar a usar o Jarvis."}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <PlanCTAButtons />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── PLANO ATIVO (assinante) ─── */}
      {isActive && (
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {isCasal ? (
                    <Heart className="h-5 w-5 text-pink-400 fill-pink-400/30" />
                  ) : (
                    <Zap className="h-5 w-5 text-primary" />
                  )}
                  <h2 className="text-xl font-bold">{planTitle}</h2>
                  {isAnnual ? (
                    <Badge className={isCasal ? "bg-pink-500/20 text-pink-300 border-pink-500/30" : "bg-primary/20 text-primary border-primary/30"}>
                      Anual
                    </Badge>
                  ) : (
                    <Badge className={isCasal ? "bg-pink-400/20 text-pink-200 border-pink-400/30" : "bg-blue-500/20 text-blue-300 border-blue-500/30"}>
                      Mensal
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {isCasal
                    ? "Acesso completo + 1 parceiro compartilhando"
                    : "Acesso completo a todos os recursos"}
                </p>
              </div>

              {!isCancelling && (
                <Badge className="bg-green-500/20 text-green-300 border-green-500/30 shrink-0">Ativa</Badge>
              )}
              {isCancelling && (
                <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 shrink-0">Cancelada</Badge>
              )}
            </div>

            {isCancelling && accessUntil && (
              <p className="mt-4 text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                ⚠️ Assinatura cancelada. Seu acesso continua até{" "}
                <span className="font-semibold">
                  {format(accessUntil, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </span>.
              </p>
            )}

            {!isCancelling && (
              <p className="mt-4 text-sm text-green-300 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                ✅ Tudo ativo! O Jarvis está disponível 24/7 para você no WhatsApp.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* O que está incluso */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">O que você tem acesso</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {FEATURES.map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Botões de planos (sempre visíveis, exceto pra ativo) */}
      {!isActive && !isTrial && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Escolha seu plano</h3>
          <PlanCTAButtons />
        </div>
      )}

      {/* Renovar/Reativar quando cancelado/suspenso */}
      {(isSuspended || isCancelling) && (
        <Button
          className="w-full"
          onClick={() => window.open("https://pay.kirvano.com/maya", "_blank")}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          {isSuspended ? "Reativar assinatura" : "Renovar assinatura"}
        </Button>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Sua assinatura é gerenciada pela Kirvano. Em caso de dúvidas sobre cobranças, acesse o painel da Kirvano ou fale com nosso suporte.
      </p>
    </div>
  );
}
