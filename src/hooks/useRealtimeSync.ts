import { useEffect, useRef } from "react";
import { useSupabase } from "@/contexts/SupabaseContext";

/**
 * Subscribes to Supabase Realtime postgres_changes for the given tables.
 * Calls onUpdate() whenever INSERT, UPDATE, or DELETE happens on any table.
 * Stable across re-renders via useRef for the callback.
 *
 * Migrado pra useSupabase() na Fase 2 da feature view-as: usa o cliente do
 * Context (default em rotas normais, impersonationClient em /admin/view-as/*).
 */
export function useRealtimeSync(
  tables: string[],
  userId: string | undefined,
  onUpdate: () => void
): void {
  const supabase = useSupabase();
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  const tableKey = tables.join(",");

  useEffect(() => {
    if (!userId) return;

    const channelName = `realtime-${tableKey.replace(/,/g, "-")}-${userId.slice(0, 8)}`;
    const channel = supabase.channel(channelName);

    for (const table of tables) {
      channel.on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table,
          filter: `user_id=eq.${userId}`,
        },
        () => {
          callbackRef.current();
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // supabase no dep array pra forçar re-subscribe se Context trocar de cliente
    // (ex: entrar/sair de /admin/view-as/*). Re-subscribe via cleanup → setup.
  }, [tableKey, userId, supabase]);
}
