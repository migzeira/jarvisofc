import { ExternalLink } from "lucide-react";

const KIRVANO_MENSAL = "https://pay.kirvano.com/4a308234-3702-4233-9d2a-4dce73bf0d2b";
const KIRVANO_ANUAL = "https://pay.kirvano.com/59bde07b-9a4a-41a6-9009-48bb1e37c364";

type Variant = "violet" | "default";

function PlanButton({
  href,
  label,
  price,
  suffix,
  variant = "violet",
  size = "md",
}: {
  href: string;
  label: string;
  price: string;
  suffix: string;
  variant?: Variant;
  size?: "sm" | "md";
}) {
  const violetStyles =
    "bg-violet-500/20 hover:bg-violet-500/30 border-violet-500/40 text-violet-100";
  const defaultStyles =
    "bg-primary/20 hover:bg-primary/30 border-primary/40 text-primary-foreground";
  const styles = variant === "violet" ? violetStyles : defaultStyles;
  const padding = size === "sm" ? "px-3 py-2" : "px-4 py-2.5";

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-initial">
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-[11px] sm:text-xs font-semibold leading-tight text-center">
          <span className="opacity-80">{label}</span>{" "}
          <span className="font-bold">{price}</span>
          <span className="opacity-70">{suffix}</span>
        </div>
        <button
          className={`w-full text-xs font-medium border rounded-lg flex items-center justify-center gap-1.5 transition-colors ${styles} ${padding}`}
        >
          <ExternalLink className="h-3.5 w-3.5" /> Assinar
        </button>
      </div>
    </a>
  );
}

export function PlanCTAButtons({
  variant = "violet",
  size = "md",
  className = "",
}: {
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={`flex flex-row gap-2 sm:gap-3 w-full sm:w-auto ${className}`}>
      <PlanButton
        href={KIRVANO_MENSAL}
        label="Mensal"
        price="R$ 29,90"
        suffix="/mês"
        variant={variant}
        size={size}
      />
      <PlanButton
        href={KIRVANO_ANUAL}
        label="Anual 12x"
        price="R$ 23,91"
        suffix=" ou R$ 287/ano"
        variant={variant}
        size={size}
      />
    </div>
  );
}
