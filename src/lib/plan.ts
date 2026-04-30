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
