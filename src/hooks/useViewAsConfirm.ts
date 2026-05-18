import { useIsViewAs } from "@/hooks/useDashboardBasePath";

/**
 * useViewAsConfirm
 *
 * Hook que retorna uma função pra confirmar ações destrutivas/sensíveis
 * quando o admin está em modo view-as.
 *
 * Em modo NORMAL (não view-as), `confirmIfViewAs` é no-op e retorna true
 * imediatamente — o caller pode prosseguir.
 *
 * Em modo VIEW-AS, mostra um confirm() do navegador com mensagem
 * explicativa, dizendo que a ação será registrada no audit log.
 *
 * USO:
 *
 *   const confirmIfViewAs = useViewAsConfirm();
 *
 *   const handleDelete = async (id) => {
 *     if (!confirmIfViewAs("excluir essa transação")) return;
 *     // ... delete
 *   };
 *
 * Padroniza o atrito extra em todas as ações destrutivas sem cada handler
 * precisar reimplementar a lógica.
 */
export function useViewAsConfirm(): (actionDescription: string) => boolean {
  const isViewAs = useIsViewAs();
  return (actionDescription: string) => {
    if (!isViewAs) return true;
    return confirm(
      `⚠️ MODO VIEW-AS\n\n` +
        `Você está prestes a ${actionDescription} no painel deste usuário, ` +
        `como se fosse ele.\n\n` +
        `Essa ação é registrada no audit log. Confirma?`
    );
  };
}
