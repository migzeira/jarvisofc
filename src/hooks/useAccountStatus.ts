import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSupabase } from "@/contexts/SupabaseContext";

export type AccountStatus = "pending" | "active" | "suspended" | null;

export function useAccountStatus() {
  const supabase = useSupabase();
  const { user } = useAuth();
  const [status, setStatus] = useState<AccountStatus>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single() as any)
      .then(({ data }: any) => {
        setStatus((data?.account_status as AccountStatus) ?? "pending");
        setLoading(false);
      });
  }, [user, supabase]);

  return { status, loading };
}
