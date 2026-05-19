import { useState } from "react";
import { X } from "lucide-react";
import {
  useActiveAnnouncement,
  isAnnouncementDismissed,
  dismissAnnouncement,
} from "@/hooks/useActiveAnnouncement";

/**
 * Banner global de aviso do sistema. Aparece no topo do dashboard quando
 * o admin publica algo via AdminPanel > aba "Avisos".
 *
 * Cores por severity:
 *   - info     → azul/ciano (novidade, comunicado)
 *   - warning  → amarelo (manutencao, lentidao)
 *   - critical → vermelho (sistema fora, problema grave)
 *
 * Empilhamento com outros banners (TrialBanner, ViewAsBanner): este vai
 * ABAIXO de tudo (entre header e onboarding) porque é o menos urgente
 * pro usuario do que pagamento expirado. Crítico em vermelho ainda chama
 * atencao pela cor.
 */
export function AnnouncementBanner() {
  const { announcement, loading } = useActiveAnnouncement();
  // Trigger re-render quando user dismissa (localStorage nao notifica React)
  const [, setTick] = useState(0);

  if (loading || !announcement) return null;
  if (isAnnouncementDismissed(announcement.id)) return null;

  const handleDismiss = () => {
    dismissAnnouncement(announcement.id);
    setTick((t) => t + 1);
  };

  const styles = getStylesForSeverity(announcement.severity);

  return (
    <div className={`border-b ${styles.bg} ${styles.border}`} role="status" aria-live="polite">
      <div className="px-4 py-2.5 flex items-center gap-3">
        <span className="text-lg shrink-0 leading-none" aria-hidden="true">
          {announcement.emoji}
        </span>
        <div className={`text-sm flex-1 min-w-0 ${styles.text}`}>
          <span className="whitespace-pre-wrap break-words">{announcement.message}</span>
        </div>
        {announcement.dismissible && (
          <button
            onClick={handleDismiss}
            aria-label="Dispensar aviso"
            className={`shrink-0 transition-opacity hover:opacity-100 opacity-70 p-1 ${styles.text}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function getStylesForSeverity(
  severity: "info" | "warning" | "critical"
): { bg: string; border: string; text: string } {
  switch (severity) {
    case "critical":
      return {
        bg: "bg-gradient-to-r from-red-500/15 via-rose-500/15 to-red-500/15",
        border: "border-red-500/30",
        text: "text-red-200",
      };
    case "warning":
      return {
        bg: "bg-gradient-to-r from-amber-500/15 via-yellow-500/15 to-amber-500/15",
        border: "border-amber-500/30",
        text: "text-amber-200",
      };
    case "info":
    default:
      return {
        bg: "bg-gradient-to-r from-sky-500/15 via-blue-500/15 to-sky-500/15",
        border: "border-sky-500/30",
        text: "text-sky-200",
      };
  }
}
