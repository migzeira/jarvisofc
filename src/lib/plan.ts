/**
 * plan.ts — utilitários pra checar tipo de plano do user.
 *
 * Plans atuais:
 *  - maya_mensal       — solo mensal
 *  - maya_anual        — solo anual
 *  - maya_casal_mensal — casal mensal (libera aba Configurações > Casal)
 *  - maya_casal_anual  — casal anual (libera aba Configurações > Casal)
 *  - starter           — legacy / sem plano
 *
 * Single source of truth — qualquer feature que precise checar plano usa
 * essas funções pra evitar regex duplicado pelo código.
 */

export function isCouplePlan(plan: string | null | undefined): boolean {
  return !!plan && /^maya_casal/.test(plan);
}

export function isAnnualPlan(plan: string | null | undefined): boolean {
  return !!plan && /_anual$/.test(plan);
}

export function isActivePlan(plan: string | null | undefined): boolean {
  return !!plan && (plan.startsWith("maya_") || plan === "starter_active");
}

export function getPlanDisplayName(plan: string | null | undefined): string {
  if (!plan) return "Sem plano";
  if (plan === "maya_casal_anual") return "Casal Anual";
  if (plan === "maya_casal_mensal") return "Casal Mensal";
  if (plan === "maya_anual") return "Anual";
  if (plan === "maya_mensal") return "Mensal";
  return plan;
}

/**
 * Label completo pra exibir no card "Seu plano" e banners do dashboard.
 *
 * Formato unificado independente da origem (admin/kirvano/etc):
 *   - "Plano Jarvis — Mensal"   (maya_mensal)
 *   - "Plano Jarvis — Anual"    (maya_anual)
 *   - "Plano Casal — Mensal"    (maya_casal_mensal)
 *   - "Plano Casal — Anual"     (maya_casal_anual)
 *   - "Plano Jarvis — Gratuito" (admin_trial sem plano mensal/anual setado)
 *   - "Sem plano ativo"         (account_status != active)
 *
 * Sufixo "(cancelado)" se subscriptionCancelledAt estiver setado.
 *
 * Decisão "Gratuito": access_source = "admin_trial" e plano não bate com
 * mensal/anual — quando admin libera N dias via "Período teste / bônus" sem
 * clicar em Mensal/Anual, fica como "Gratuito" com a data de vencimento.
 */
export function buildPlanLabel(opts: {
  plan: string | null | undefined;
  accountStatus: string | null | undefined;
  accessSource: string | null | undefined;
  subscriptionCancelledAt?: Date | null;
}): string {
  if (opts.accountStatus !== "active") return "Sem plano ativo";

  const planValue = opts.plan ?? null;
  const isCasal = isCouplePlan(planValue);
  const planFamily = isCasal ? "Plano Casal" : "Plano Jarvis";

  let durationLabel: string;
  if (planValue === "maya_anual" || planValue === "maya_casal_anual") {
    durationLabel = "Anual";
  } else if (planValue === "maya_mensal" || planValue === "maya_casal_mensal") {
    durationLabel = "Mensal";
  } else if (opts.accessSource === "admin_trial") {
    // Período bônus liberado pelo admin sem plano pago atrelado
    durationLabel = "Gratuito";
  } else {
    // Plano legacy/desconhecido com conta ativa — fallback genérico
    durationLabel = "Ativo";
  }

  const base = `${planFamily} — ${durationLabel}`;
  return opts.subscriptionCancelledAt ? `${base} (cancelado)` : base;
}
