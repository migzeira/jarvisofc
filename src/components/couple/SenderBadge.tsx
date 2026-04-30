import { User } from "lucide-react";
import { useCoupleContext } from "@/hooks/useCoupleContext";

/**
 * SenderBadge — badge "👤 João" / "👤 Maria" mostrando quem registrou.
 *
 * Renderiza nada se:
 *  - User não tem plano casal (cliente solo nem vê o badge)
 *  - sentByPhone é null E não tem partners ainda (sem necessidade de tag)
 *  - Phone não bate com master nem com nenhum partner conhecido
 *
 * Cor adapta:
 *  - Master (sent_by_phone null OU bate com phone do master) → violeta
 *  - Slot 1 → ciano
 *  - Slot 2 → rosa
 */
export function SenderBadge({
  sentByPhone,
  size = "sm",
  className = "",
}: {
  sentByPhone: string | null | undefined;
  size?: "xs" | "sm";
  className?: string;
}) {
  const { isCouplePlan, partners, getSenderLabel, getSenderColorClass } = useCoupleContext();

  // Plano solo: nunca mostra badge (zero impacto na UI atual)
  if (!isCouplePlan) return null;

  // Sem partners cadastrados ainda E sem sent_by → não mostra (UI ficaria confusa)
  if (partners.length === 0 && !sentByPhone) return null;

  const label = getSenderLabel(sentByPhone);
  if (!label) return null;

  const color = getSenderColorClass(sentByPhone);

  const sizeClasses =
    size === "xs"
      ? "text-[9px] h-4 gap-0.5 px-1.5"
      : "text-[10px] h-5 gap-1 px-1.5";
  const iconSize = size === "xs" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <span
      className={`inline-flex items-center rounded border ${color.bg} ${color.text} ${color.border} ${sizeClasses} font-medium ${className}`}
      title={`Registrado por ${label}`}
    >
      <User className={iconSize} />
      <span className="leading-none">{label}</span>
    </span>
  );
}
