import { useEffect, useState } from "react";
import { useSupabase } from "@/contexts/SupabaseContext";

/**
 * Hook que busca o announcement ativo mais recente e mantém atualizado
 * via Realtime (Supabase channel). Quando o admin publica/desativa um
 * aviso no AdminPanel, todos os dashboards abertos atualizam sozinhos
 * sem precisar refresh.
 *
 * Filtros aplicados:
 *   - is_active = true
 *   - expires_at é null OU > now()
 *
 * Retorna o registro mais recente (created_at desc) ou null.
 */
export type SystemAnnouncement = {
  id: string;
  emoji: string;
  message: string;
  severity: "info" | "warning" | "critical";
  is_active: boolean;
  dismissible: boolean;
  expires_at: string | null;
  created_at: string;
};

export function useActiveAnnouncement() {
  const supabase = useSupabase();
  const [announcement, setAnnouncement] = useState<SystemAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch inicial — re-roda quando o cliente Supabase muda (entrar/sair de view-as).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from("system_announcements")
          .select("id, emoji, message, severity, is_active, dismissible, expires_at, created_at")
          .eq("is_active", true)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          // Tabela pode nao existir antes da migration rodar — silencia gracefully
          setAnnouncement(null);
        } else {
          setAnnouncement((data as SystemAnnouncement | null) ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Realtime: escuta qualquer mudanca na tabela e re-fetcha. Não tenta
    // ser esperto com payload incremental porque a regra "ativo mais
    // recente que nao expirou" exige re-query do banco.
    const channel = supabase
      .channel("system_announcements_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_announcements" },
        () => {
          if (!cancelled) load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return { announcement, loading };
}

/**
 * Helper localStorage pra rastrear avisos dismissados pelo user.
 * Chave = id do announcement. Quando admin publica novo aviso (novo id),
 * o banner reaparece naturalmente.
 *
 * Limpa entradas antigas (>30d) pra nao crescer indefinidamente.
 */
const DISMISS_KEY = "heyjarvis_announcement_dismissed";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

type DismissMap = Record<string, number>; // id -> timestamp

function readDismissMap(): DismissMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DismissMap;
    // Cleanup entradas velhas
    const now = Date.now();
    const cleaned: DismissMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && now - v < DISMISS_TTL_MS) cleaned[k] = v;
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function isAnnouncementDismissed(id: string): boolean {
  const map = readDismissMap();
  return id in map;
}

export function dismissAnnouncement(id: string): void {
  if (typeof window === "undefined") return;
  const map = readDismissMap();
  map[id] = Date.now();
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    // localStorage cheio ou bloqueado — ignora silenciosamente
  }
}
