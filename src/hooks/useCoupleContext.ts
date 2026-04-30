import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { isCouplePlan } from "@/lib/plan";

/**
 * useCoupleContext — hook que carrega o contexto de plano casal:
 *   - isCouplePlan: true se o user tem plano casal
 *   - partners: lista de partners ativos (até 2)
 *   - masterPhone: phone do master (próprio user)
 *   - masterName: nome de exibição do master (display_name → primeiro nome)
 *   - getSenderLabel(sent_by_phone): retorna o nome a exibir no badge
 *   - getSenderColorClass(sent_by_phone): retorna classe Tailwind pra cor do badge
 *
 * Cliente solo: isCouplePlan=false, partners=[], badges não são renderizados.
 */

export interface PartnerInfo {
  id: string;
  slot: 1 | 2;
  partner_name: string;
  partner_phone: string;
  partner_nickname: string | null;
}

interface CoupleContext {
  isCouplePlan: boolean;
  loading: boolean;
  partners: PartnerInfo[];
  masterPhone: string | null;
  masterName: string;
  /** Retorna label a mostrar no badge ("João", "Maria"). Null se não souber. */
  getSenderLabel: (sentByPhone: string | null | undefined) => string | null;
  /** Retorna par de classes Tailwind pra cor do badge: { bg, text, border } */
  getSenderColorClass: (sentByPhone: string | null | undefined) => {
    bg: string;
    text: string;
    border: string;
  };
  /** Refetch dos partners (depois de cadastrar/remover). */
  reload: () => void;
}

/** Normaliza phone (só dígitos, com 55 prefix). Igual ao normalizePhone do ConfigCasal. */
function normalize(phone: string | null | undefined): string {
  if (!phone) return "";
  let n = phone.replace(/\D/g, "");
  if (n.length > 0 && !n.startsWith("55")) n = `55${n}`;
  return n;
}

/** Pega primeiro nome de "Maria Silva" → "Maria" */
function firstName(full: string | null | undefined): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] ?? "";
}

const COLOR_BY_SLOT: Record<string, { bg: string; text: string; border: string }> = {
  master: {
    bg: "bg-violet-500/10",
    text: "text-violet-300",
    border: "border-violet-500/30",
  },
  slot1: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-300",
    border: "border-cyan-500/30",
  },
  slot2: {
    bg: "bg-pink-500/10",
    text: "text-pink-300",
    border: "border-pink-500/30",
  },
  unknown: {
    bg: "bg-slate-500/10",
    text: "text-slate-300",
    border: "border-slate-500/30",
  },
};

export function useCoupleContext(): CoupleContext {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{
    plan: string | null;
    phone_number: string | null;
    display_name: string | null;
  } | null>(null);
  const [partners, setPartners] = useState<PartnerInfo[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Profile + partners em paralelo
    const [profileRes, partnersRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("plan, phone_number, display_name")
        .eq("id", user.id)
        .maybeSingle(),
      (supabase as any)
        .from("profile_partners")
        .select("id, slot, partner_name, partner_phone, partner_nickname")
        .eq("master_user_id", user.id)
        .eq("is_active", true)
        .order("slot"),
    ]);

    setProfile((profileRes.data as any) ?? null);
    setPartners(((partnersRes.data as PartnerInfo[]) ?? []));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: re-carrega partners quando há mudança em profile_partners
  // (cadastro/remoção pelo ConfigCasal). Sem isso, dashboard precisava recarregar
  // pra ver badges aparecerem após cadastrar partner.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`profile_partners_${user.id.slice(0, 8)}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "profile_partners",
          filter: `master_user_id=eq.${user.id}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  const couplePlan = isCouplePlan(profile?.plan ?? null);
  const masterPhone = useMemo(() => normalize(profile?.phone_number), [profile?.phone_number]);
  const masterName = useMemo(() => firstName(profile?.display_name) || "Você", [profile?.display_name]);

  // Mapa pre-computado: phone normalizado → partner info
  const partnerByPhone = useMemo(() => {
    const m = new Map<string, PartnerInfo>();
    for (const p of partners) {
      m.set(normalize(p.partner_phone), p);
    }
    return m;
  }, [partners]);

  const getSenderLabel = useCallback(
    (sentByPhone: string | null | undefined): string | null => {
      if (!couplePlan) return null;
      // sent_by_phone = NULL → registro do master
      if (!sentByPhone) return masterName;
      const norm = normalize(sentByPhone);
      // Bate com phone do master
      if (norm === masterPhone) return masterName;
      // Bate com algum partner
      const partner = partnerByPhone.get(norm);
      if (partner) {
        return partner.partner_nickname || firstName(partner.partner_name) || partner.partner_name;
      }
      return null; // não reconheceu
    },
    [couplePlan, masterName, masterPhone, partnerByPhone]
  );

  const getSenderColorClass = useCallback(
    (sentByPhone: string | null | undefined) => {
      if (!sentByPhone) return COLOR_BY_SLOT.master;
      const norm = normalize(sentByPhone);
      if (norm === masterPhone) return COLOR_BY_SLOT.master;
      const partner = partnerByPhone.get(norm);
      if (partner?.slot === 1) return COLOR_BY_SLOT.slot1;
      if (partner?.slot === 2) return COLOR_BY_SLOT.slot2;
      return COLOR_BY_SLOT.unknown;
    },
    [masterPhone, partnerByPhone]
  );

  return {
    isCouplePlan: couplePlan,
    loading,
    partners,
    masterPhone: masterPhone || null,
    masterName,
    getSenderLabel,
    getSenderColorClass,
    reload: load,
  };
}
