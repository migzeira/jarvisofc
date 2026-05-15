/**
 * Phone helpers compartilhados — Signup e (futuramente) MeuPerfil.
 *
 * Filosofia:
 *  - User escolhe DDI explicitamente (via CountrySelect)
 *  - User digita SÓ a parte local (sem DDI)
 *  - Backend recebe `ddi + local` (só dígitos) — não assume nada
 *  - normalize_phone() do Postgres NÃO adiciona 55 magicamente
 */

export interface Country {
  ddi: string;
  code: string;       // ISO 2-letter, lowercase (br, us, es, ar...)
  name: string;
  placeholder: string;
  minLen: number;     // mínimo de dígitos da PARTE LOCAL (sem DDI)
  maxLen?: number;    // opcional, default = minLen + 2
}

/** Lista de países suportados — Brasil primeiro (default), depois ordem aproximada
 *  por relevância pro mercado lusófono/hispânico + Europa Ocidental. */
export const COUNTRIES: Country[] = [
  { ddi: "55",  code: "br", name: "Brasil",          placeholder: "11 99999-9999",  minLen: 10, maxLen: 11 },
  { ddi: "351", code: "pt", name: "Portugal",         placeholder: "912 345 678",    minLen: 9  },
  { ddi: "34",  code: "es", name: "Espanha",          placeholder: "612 345 678",    minLen: 9  },
  { ddi: "54",  code: "ar", name: "Argentina",        placeholder: "11 1234-5678",   minLen: 10 },
  { ddi: "1",   code: "us", name: "EUA / Canadá",    placeholder: "555 555-5555",   minLen: 10 },
  { ddi: "52",  code: "mx", name: "México",           placeholder: "55 1234-5678",   minLen: 10 },
  { ddi: "57",  code: "co", name: "Colômbia",         placeholder: "300 123 4567",   minLen: 10 },
  { ddi: "56",  code: "cl", name: "Chile",            placeholder: "9 1234 5678",    minLen: 9  },
  { ddi: "51",  code: "pe", name: "Peru",             placeholder: "912 345 678",    minLen: 9  },
  { ddi: "595", code: "py", name: "Paraguai",         placeholder: "981 123 456",    minLen: 9  },
  { ddi: "598", code: "uy", name: "Uruguai",          placeholder: "094 123 456",    minLen: 9  },
  { ddi: "58",  code: "ve", name: "Venezuela",        placeholder: "412 123 4567",   minLen: 10 },
  { ddi: "593", code: "ec", name: "Equador",          placeholder: "99 123 4567",    minLen: 9  },
  { ddi: "244", code: "ao", name: "Angola",           placeholder: "923 123 456",    minLen: 9  },
  { ddi: "258", code: "mz", name: "Moçambique",       placeholder: "82 123 4567",    minLen: 9  },
  { ddi: "44",  code: "gb", name: "Reino Unido",      placeholder: "7911 123456",    minLen: 10 },
  { ddi: "49",  code: "de", name: "Alemanha",         placeholder: "151 23456789",   minLen: 10 },
  { ddi: "33",  code: "fr", name: "França",           placeholder: "6 12 34 56 78",  minLen: 9  },
  { ddi: "39",  code: "it", name: "Itália",           placeholder: "312 345 6789",   minLen: 9  },
];

/** Encontra um país pelo DDI. Retorna Brasil como fallback. */
export function findCountry(ddi: string): Country {
  return COUNTRIES.find((c) => c.ddi === ddi) ?? COUNTRIES[0];
}

/** Remove tudo que não é dígito. */
export function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Formata o número LOCAL conforme país.
 *  Pra Brasil aplica (XX) XXXXX-XXXX. Outros países: agrupamento simples.
 *  NÃO inclui o DDI no resultado — esse fica visível no dropdown. */
export function formatLocalByCountry(value: string, country: Country): string {
  const d = digitsOnly(value).slice(0, (country.maxLen ?? country.minLen + 2));
  if (d.length === 0) return "";

  if (country.code === "br") {
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  // Outros países: agrupa em blocos de 3 (visual genérico)
  return d.match(/.{1,3}/g)?.join(" ") ?? d;
}

/** Valida que a parte LOCAL tem dígitos suficientes pro país escolhido. */
export function isValidLocalForCountry(value: string, country: Country): boolean {
  const d = digitsOnly(value);
  const max = country.maxLen ?? country.minLen + 2;
  return d.length >= country.minLen && d.length <= max;
}

/** Monta o phone completo pro backend: DDI + número local (só dígitos).
 *  Exemplo: ddi="55", local="(11) 99999-9999" → "5511999999999"
 *           ddi="34", local="612 345 678"    → "34612345678" */
export function buildFullPhone(ddi: string, local: string): string {
  return `${digitsOnly(ddi)}${digitsOnly(local)}`;
}
