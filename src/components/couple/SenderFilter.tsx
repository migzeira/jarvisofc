import { useCoupleContext } from "@/hooks/useCoupleContext";
import { Users, User } from "lucide-react";

/**
 * SenderFilter — botões "Todos / João / Maria" pra filtrar listas por quem
 * registrou.
 *
 * Não renderiza se:
 *  - User não tem plano casal
 *  - Não tem partners cadastrados ainda (filtro não tem o que dividir)
 *
 * Valor selecionado:
 *  - "all"  → mostra tudo
 *  - "me"   → só registros do master (sent_by_phone null OU = master phone)
 *  - <phone do partner>  → só registros desse partner
 */

export type SenderFilterValue = "all" | "me" | string; // string = phone do partner

export function SenderFilter({
  value,
  onChange,
  className = "",
}: {
  value: SenderFilterValue;
  onChange: (v: SenderFilterValue) => void;
  className?: string;
}) {
  const { isCouplePlan, partners, masterName, getSenderColorClass } = useCoupleContext();

  if (!isCouplePlan || partners.length === 0) return null;

  return (
    <div className={`inline-flex items-center gap-1 p-1 rounded-md bg-muted/30 border border-border ${className}`}>
      {/* Todos */}
      <button
        type="button"
        onClick={() => onChange("all")}
        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
          value === "all"
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Users className="h-3 w-3" />
        Todos
      </button>

      {/* Master (eu) */}
      {(() => {
        const c = getSenderColorClass(null);
        const active = value === "me";
        return (
          <button
            type="button"
            onClick={() => onChange("me")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              active ? `${c.bg} ${c.text}` : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="h-3 w-3" />
            {masterName}
          </button>
        );
      })()}

      {/* Partners */}
      {partners.map((p) => {
        const c = getSenderColorClass(p.partner_phone);
        const label = p.partner_nickname || p.partner_name.split(/\s+/)[0];
        const active = value === p.partner_phone;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.partner_phone)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              active ? `${c.bg} ${c.text}` : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="h-3 w-3" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Helper: verifica se um sent_by_phone bate com o filtro selecionado. */
export function matchesSenderFilter(
  sentByPhone: string | null | undefined,
  filterValue: SenderFilterValue,
  masterPhone: string | null
): boolean {
  if (filterValue === "all") return true;

  // Normaliza ambos
  const norm = (p: string | null | undefined): string => {
    if (!p) return "";
    let n = p.replace(/\D/g, "");
    if (n.length > 0 && !n.startsWith("55")) n = `55${n}`;
    return n;
  };

  const sent = norm(sentByPhone);
  const master = norm(masterPhone);

  if (filterValue === "me") {
    // Master = sent_by_phone null OU bate com phone do master
    return !sent || sent === master;
  }

  // Filtro por partner phone específico
  return sent === norm(filterValue);
}
