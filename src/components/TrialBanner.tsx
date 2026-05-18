import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useUserAccessStatus } from "@/hooks/useUserAccessStatus";
import { useDashboardBasePath, useIsViewAs } from "@/hooks/useDashboardBasePath";
import { useAuth } from "@/hooks/useAuth";

// Escopa a key por user.id pra evitar que admin (em modo view-as) dismiss
// o banner do user-alvo e isso fique salvo na sessão admin tb (localStorage
// é compartilhado entre admin e impersonation).
const DISMISS_STORAGE_KEY_PREFIX = "heyjarvis_trial_banner_dismissed_at";
const DISMISS_DURATION_MS = 6 * 60 * 60 * 1000; // 6 horas — depois reaparece

/**
 * Banner sutil que aparece no topo do dashboard quando user tá em trial.
 * Mostra dias restantes + CTA pra ver planos.
 *
 * Comportamento:
 *   - Status 'trial' + dias > 0 → mostra banner verde com countdown
 *   - Status 'expired' ou 'pending' → mostra banner âmbar mais agressivo
 *   - Status 'active' / 'suspended' / 'loading' → não renderiza nada
 *   - User pode dispensar (X) — esconde por 6h, depois reaparece
 *
 * NÃO bloqueia uso do dashboard. Só informa. Bloqueio é via webhook
 * (WhatsApp não responde) e via MeuPlano (mostra paywall).
 */
export function TrialBanner() {
  const { status, trialDaysRemaining, needsToPay, loading } = useUserAccessStatus();
  const basePath = useDashboardBasePath();
  const isViewAs = useIsViewAs();
  const { user } = useAuth();
  // Key escopada por user.id pra evitar vazamento entre admin e impersonation
  const dismissKey = user?.id ? `${DISMISS_STORAGE_KEY_PREFIX}_${user.id}` : DISMISS_STORAGE_KEY_PREFIX;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem(dismissKey);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_DURATION_MS;
  });

  if (loading || dismissed) return null;
  if (status !== "trial" && status !== "expired" && status !== "pending") return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, String(Date.now()));
    setDismissed(true);
  };

  // ── Variante TRIAL ATIVO ──
  if (status === "trial") {
    const days = trialDaysRemaining ?? 0;
    const isUrgent = days <= 1;

    return (
      <div
        className={
          isUrgent
            ? "bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-500/15 border-b border-amber-500/30"
            : "bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 border-b border-emerald-500/20"
        }
      >
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <Sparkles className={isUrgent ? "h-4 w-4 text-amber-400 shrink-0" : "h-4 w-4 text-emerald-400 shrink-0"} />
            <div className="text-sm min-w-0">
              <span className={isUrgent ? "font-semibold text-amber-200" : "font-semibold text-emerald-200"}>
                {days > 1
                  ? `${days} dias grátis restantes`
                  : days === 1
                    ? "Último dia do trial!"
                    : "Trial expira hoje!"}
              </span>
              <span className="hidden sm:inline text-muted-foreground ml-2">
                {isUrgent ? "Garante seu plano antes que expire" : "Aproveite tudo que o Jarvis pode fazer"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Botão 'Ver planos' removido 18/05/2026:
                1. Em modo view-as ele jogava o admin pro proprio /dashboard/configuracoes (sai do view-as)
                2. Visualmente poluido — usuario ja sabe que tem plano clicando em Configuracoes
                Mantém apenas o X pra dispensar. */}
            <button
              onClick={handleDismiss}
              aria-label="Dispensar aviso"
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Variante EXPIRADO / PENDING — banner informativo ──
  // Em modo view-as, banner NÃO clica em lugar nenhum (admin não vai pagar
  // o plano do user-alvo). Em modo normal, leva pra configuracoes.
  if (needsToPay) {
    const innerContent = (
      <div className="bg-gradient-to-r from-red-500/15 via-rose-500/15 to-red-500/15 border-b border-red-500/30">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-red-400 shrink-0" />
          <div className="text-sm min-w-0 flex-1">
            <span className="font-semibold text-red-200">
              {status === "expired" ? "Período de teste expirou" : "Sem plano ativo"}
            </span>
            {!isViewAs && (
              <span className="hidden sm:inline text-muted-foreground ml-2">
                — clique aqui pra ver os planos e renovar
              </span>
            )}
          </div>
          {!isViewAs && <ArrowRight className="h-4 w-4 text-red-300 shrink-0" />}
        </div>
      </div>
    );

    if (isViewAs) {
      // Em view-as, banner é só informativo (sem link). Evita admin clicar
      // e ser redirecionado pra fora do view-as.
      return innerContent;
    }
    return (
      <Link
        to={`${basePath}/configuracoes?tab=perfil`}
        className="block hover:opacity-90 transition-opacity"
      >
        {innerContent}
      </Link>
    );
  }

  return null;
}
