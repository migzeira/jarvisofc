import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export type AccessStatus =
  | "loading"
  | "trial"          // dentro do trial gratuito (3 dias)
  | "active"         // assinante pagante
  | "expired"        // trial expirou OU access_until passou (cron ainda não converteu)
  | "pending"        // sem plano, sem trial
  | "suspended"      // estorno/reembolso
  | "unknown";

export interface UserAccessStatus {
  status: AccessStatus;
  trialDaysRemaining: number | null;
  trialEndsAt: Date | null;
  canUseJarvis: boolean;
  isTrial: boolean;
  isPaid: boolean;
  needsToPay: boolean;  // expired || pending
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook que retorna o status de acesso do user logado.
 * Lê direto da tabela profiles + calcula derivações.
 * Usar em componentes que precisam saber se user tá em trial, expirado, etc.
 *
 * @example
 *   const { status, trialDaysRemaining, needsToPay } = useUserAccessStatus();
 *   if (status === 'trial') return <TrialBanner daysRemaining={trialDaysRemaining} />;
 *   if (needsToPay) return <PaywallScreen />;
 */
export function useUserAccessStatus(): UserAccessStatus {
  const { user } = useAuth();
  const [data, setData] = useState<{
    account_status: string | null;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    access_until: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_status, trial_started_at, trial_ends_at, access_until")
      .eq("id", user.id)
      .maybeSingle();
    setData(profile as any);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Deriva status a partir do profile
  let status: AccessStatus = "loading";
  let trialDaysRemaining: number | null = null;
  let trialEndsAt: Date | null = null;
  let canUseJarvis = false;
  const now = new Date();

  if (!loading && data) {
    const accStatus = (data.account_status ?? "pending").toLowerCase();

    if (accStatus === "suspended") {
      status = "suspended";
    } else if (accStatus === "trial") {
      if (data.trial_ends_at) {
        const ends = new Date(data.trial_ends_at);
        trialEndsAt = ends;
        if (ends > now) {
          status = "trial";
          canUseJarvis = true;
          trialDaysRemaining = Math.max(
            0,
            Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
          );
        } else {
          // Trial expirou — DB ainda não foi atualizado, mas frontend mostra como expired
          status = "expired";
          trialDaysRemaining = 0;
        }
      } else {
        // trial sem trial_ends_at — caso edge, trata como pending
        status = "pending";
      }
    } else if (accStatus === "active") {
      if (data.access_until && new Date(data.access_until) < now) {
        status = "expired";
      } else {
        status = "active";
        canUseJarvis = true;
      }
    } else if (accStatus === "pending") {
      status = "pending";
    } else {
      status = "unknown";
    }
  } else if (!loading && !data) {
    status = "unknown";
  }

  return {
    status,
    trialDaysRemaining,
    trialEndsAt,
    canUseJarvis,
    isTrial: status === "trial",
    isPaid: status === "active",
    needsToPay: status === "expired" || status === "pending",
    loading,
    refresh: load,
  };
}
