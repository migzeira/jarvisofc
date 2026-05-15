/**
 * FlagImg — renderiza bandeira de país via flagcdn.com.
 * Funciona em todos os OSes (Windows não tem emoji de bandeira).
 */
export function FlagImg({ code, className = "" }: { code: string; className?: string }) {
  return (
    <img
      src={`https://flagcdn.com/20x15/${code}.png`}
      srcSet={`https://flagcdn.com/40x30/${code}.png 2x`}
      width={20}
      height={15}
      alt={code.toUpperCase()}
      className={`rounded-[2px] object-cover shrink-0 ${className}`}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
