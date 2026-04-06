import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export interface ErrorLogEntry {
  context: string;
  message: string;
  stack?: string;
  user_id?: string;
  phone_number?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Centralised error logger.
 * Writes to `error_logs` table AND to console.error (visible in Supabase Edge Fn logs).
 */
export async function logError(entry: ErrorLogEntry): Promise<void> {
  const payload = {
    context: entry.context,
    message: entry.message,
    stack: entry.stack ?? null,
    user_id: entry.user_id ?? null,
    phone_number: entry.phone_number ?? null,
    metadata: entry.metadata ?? null,
    created_at: new Date().toISOString(),
  };

  // Always log to console (shows in Supabase Edge Function logs UI)
  console.error(`[${entry.context}] ${entry.message}`, entry.metadata ?? "");

  // Best-effort insert — never throw from logger
  try {
    await supabase.from("error_logs").insert(payload);
  } catch (e) {
    console.error("[logger] Failed to write error_log:", e);
  }
}

/**
 * Helper: convert any thrown value to ErrorLogEntry fields
 */
export function fromThrown(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}
