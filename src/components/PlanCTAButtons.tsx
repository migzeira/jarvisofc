import { ExternalLink } from "lucide-react";

const KIRVANO_MENSAL = "https://pay.kirvano.com/4a308234-3702-4233-9d2a-4dce73bf0d2b";
const KIRVANO_ANUAL = "https://pay.kirvano.com/59bde07b-9a4a-41a6-9009-48bb1e37c364";

type Variant = "violet" | "default";

function PlanButton({
  href,
  line1,
  line2,
  variant = "violet",
  size = "md",
}: {
  href: string;
  line1: React.ReactNode;
  line2: React.ReactNode;
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
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 flex flex-col items-stretch gap-1.5"
    >
      <div className="text-[11px] sm:text-xs leading-tight text-center">
        <div className="font-semibold">{line1}</div>
        <div className="opacity-70">{line2}</div>
      </div>
      <button
        className={`mt-auto w-full text-xs font-medium border rounded-lg flex items-center justify-center gap-1.5 transition-colors ${styles} ${padding}`}
      >
        <ExternalLink className="h-3.5 w-3.5" /> Assinar
      </button>
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
    <div className={`flex flex-row items-stretch gap-2 sm:gap-3 w-full sm:w-auto ${className}`}>
      <PlanButton
        href={KIRVANO_MENSAL}
        line1="Mensal"
        line2="R$ 39,90/mês"
        variant={variant}
        size={size}
      />
      <PlanButton
        href={KIRVANO_ANUAL}
        line1="Anual"
        line2="R$ 29,90/mês cobrado anualmente"
        variant={variant}
        size={size}
      />
    </div>
  );
}
