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
 *   - "Plano Jarvis — Mensal"   (admin_plan/kirvano com maya_mensal)
 *   - "Plano Jarvis — Anual"    (admin_plan/kirvano com maya_anual)
 *   - "Plano Casal — Mensal"    (admin_plan/kirvano com maya_casal_mensal)
 *   - "Plano Casal — Anual"     (admin_plan/kirvano com maya_casal_anual)
 *   - "Plano Jarvis — Gratuito" (qualquer plan + access_source = admin_trial)
 *   - "Sem plano ativo"         (account_status != active)
 *
 * Sufixo "(cancelado)" se subscriptionCancelledAt estiver setado.
 *
 * REGRA CRÍTICA: access_source vence sobre o campo plan na hora de decidir
 * o duration label. Motivo: o botão "Período teste / bônus" do admin só
 * altera access_source pra "admin_trial" e estende access_until, mas NÃO
 * mexe em plan — então uma conta que estava em maya_mensal e ganhou 2 dias
 * bônus continua com plan=maya_mensal. Sem essa precedência, o label
 * mostraria "Mensal" mesmo sendo período gratuito de extensão.
 *
 * Family (Jarvis/Casal) continua vindo do campo plan via isCouplePlan(),
 * porque mesmo em trial o sistema sabe se a conta é compartilhada ou solo.
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
  // ORDEM IMPORTA: admin_trial vence sobre plan field — significa extensão
  // de acesso bonificada, não plano pago, mesmo que o plan herdado diga outro.
  if (opts.accessSource === "admin_trial") {
    durationLabel = "Gratuito";
  } else if (planValue === "maya_anual" || planValue === "maya_casal_anual") {
    durationLabel = "Anual";
  } else if (planValue === "maya_mensal" || planValue === "maya_casal_mensal") {
    durationLabel = "Mensal";
  } else {
    // Plano legacy/desconhecido com conta ativa — fallback genérico
    durationLabel = "Ativo";
  }

  const base = `${planFamily} — ${durationLabel}`;
  return opts.subscriptionCancelledAt ? `${base} (cancelado)` : base;
}
