import { useLocation } from "react-router-dom";

/**
 * useDashboardBasePath
 *
 * Retorna o base path correto pra links/navegações DENTRO do dashboard,
 * adaptando entre:
 *   - Modo normal:   /dashboard
 *   - Modo view-as:  /admin/view-as/<userId>
 *
 * Como usar:
 *   const base = useDashboardBasePath();
 *   <Link to={`${base}/financas`}>Finanças</Link>
 *   navigate(`${base}/lembretes`)
 *
 * Por que existe:
 * Componentes do dashboard (TrialBanner, DashboardHome, AppSidebar, etc) tinham
 * URLs hardcoded `/dashboard/*`. Quando admin entrava em /admin/view-as/<id>,
 * clicar nesses links saía do view-as e voltava pro dashboard do admin.
 *
 * Esse hook detecta o contexto via pathname e retorna o prefixo certo.
 * Em qualquer rota fora do dashboard (Login, Signup, etc) retorna /dashboard
 * como fallback razoável (uso esperado é dentro do dashboard).
 */
export function useDashboardBasePath(): string {
  const location = useLocation();
  if (location.pathname.startsWith("/admin/view-as/")) {
    const userId = location.pathname.split("/")[3];
    if (userId) return `/admin/view-as/${userId}`;
  }
  return "/dashboard";
}

/**
 * useIsViewAs
 *
 * Retorna true se a rota atual está em modo view-as (admin vendo painel
 * de outro user). Útil pra esconder elementos de auto-serviço (botão
 * "ver planos", "sair", etc) que não fazem sentido pro admin.
 */
export function useIsViewAs(): boolean {
  const location = useLocation();
  return location.pathname.startsWith("/admin/view-as/");
}
