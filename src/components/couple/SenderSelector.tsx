import { useCoupleContext } from "@/hooks/useCoupleContext";
import { Label } from "@/components/ui/label";
import { User, Users, Heart } from "lucide-react";

/**
 * SenderSelector — radio "Pra quem é? Eu / Parceiro / Os dois"
 *
 * Usado em FORMS DE CRIAÇÃO MANUAL (lembretes, hábitos, anotações,
 * finanças, eventos) pra definir:
 *  1. sent_by_phone do registro (badge no card)
 *  2. quem recebe notificação (lembretes/hábitos enviam pro phone correto)
 *
 * Renderiza nada se:
 *  - User não tem plano casal (cliente solo nem vê o seletor)
 *  - Plano casal sem partners cadastrados
 *
 * Valor:
 *  - "me"           → master (sent_by_phone = master.phone_number)
 *  - <partner_phone> → partner específico (sent_by_phone = partner_phone)
 *  - "both"         → ambos (caller cria 2 registros, 1 pra cada)
 */

export type SenderSelectorValue = "me" | "both" | string;

export function SenderSelector({
  value,
  onChange,
  showBoth = true,
  label = "Pra quem é?",
  className = "",
}: {
  value: SenderSelectorValue;
  onChange: (v: SenderSelectorValue) => void;
  /** Pra forms onde "Os dois" não faz sentido (ex: anotação compartilhada). */
  showBoth?: boolean;
  label?: string;
  className?: string;
}) {
  const { isCouplePlan, partners, masterName, getSenderColorClass } = useCoupleContext();

  // Plano solo OU casal sem partners → não mostra seletor
  if (!isCouplePlan || partners.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="text-sm">{label}</Label>
      <div className="grid gap-2">
        {/* Master (eu) */}
        <SenderOption
          icon={<User className="h-3.5 w-3.5" />}
          label={masterName}
          color={getSenderColorClass(null)}
          active={value === "me"}
          onClick={() => onChange("me")}
        />

        {/* Cada partner */}
        {partners.map((p) => {
          const partnerLabel = p.partner_nickname || p.partner_name.split(/\s+/)[0];
          return (
            <SenderOption
              key={p.id}
              icon={<User className="h-3.5 w-3.5" />}
              label={partnerLabel}
              color={getSenderColorClass(p.partner_phone)}
              active={value === p.partner_phone}
              onClick={() => onChange(p.partner_phone)}
            />
          );
        })}

        {/* Ambos (opcional) */}
        {showBoth && (
          <SenderOption
            icon={<Users className="h-3.5 w-3.5" />}
            label={`Os dois (${masterName} e ${partners.map((p) => p.partner_nickname || p.partner_name.split(/\s+/)[0]).join(", ")})`}
            color={{
              bg: "bg-pink-500/10",
              text: "text-pink-300",
              border: "border-pink-500/30",
            }}
            active={value === "both"}
            onClick={() => onChange("both")}
            iconOverride={<Heart className="h-3.5 w-3.5 text-pink-400" />}
          />
        )}
      </div>
    </div>
  );
}

function SenderOption({
  icon,
  iconOverride,
  label,
  color,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  iconOverride?: React.ReactNode;
  label: string;
  color: { bg: string; text: string; border: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-all text-left ${
        active
          ? `${color.bg} ${color.text} ${color.border}`
          : "border-border text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      }`}
    >
      <span className="shrink-0">{iconOverride ?? icon}</span>
      <span className="flex-1">{label}</span>
      {active && (
        <span className={`text-xs ${color.text}`}>✓</span>
      )}
    </button>
  );
}

/**
 * Helper pra resolver qual phone usar baseado no valor selecionado.
 * Recebe o valor + masterPhone + lista de partners.
 * Retorna array de targets (1 ou 2 entradas).
 *
 * Cada target tem:
 *  - sent_by_phone: pra grava no DB
 *  - notify_phone: pra usar como whatsapp_number do reminder/habit (notificação)
 *  - label: pra UI/toast
 */
export interface SenderTarget {
  sent_by_phone: string | null; // null = master
  notify_phone: string;          // phone que recebe (master ou partner)
  label: string;
}

export function resolveSenderTargets(
  value: SenderSelectorValue,
  masterPhone: string | null,
  masterName: string,
  partners: Array<{ partner_phone: string; partner_name: string; partner_nickname: string | null }>
): SenderTarget[] {
  const masterTarget: SenderTarget = {
    sent_by_phone: null,
    notify_phone: masterPhone ?? "",
    label: masterName,
  };

  const partnerToTarget = (p: { partner_phone: string; partner_name: string; partner_nickname: string | null }): SenderTarget => ({
    sent_by_phone: p.partner_phone,
    notify_phone: p.partner_phone,
    label: p.partner_nickname || p.partner_name.split(/\s+/)[0],
  });

  if (value === "me") return [masterTarget];

  if (value === "both") {
    return [masterTarget, ...partners.map(partnerToTarget)];
  }

  // Valor é phone de partner específico
  const partner = partners.find((p) => p.partner_phone === value);
  if (partner) return [partnerToTarget(partner)];

  // Fallback: master
  return [masterTarget];
}
