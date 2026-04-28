import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InsightResponse {
  insight: string;
  generated_at: string;
  from_cache?: boolean;
  state?: "rich" | "partial" | "empty";
  error?: string;
}

/**
 * Card "Resumo Inteligente do Jarvis" no topo da aba Finanças.
 *
 * - Carrega via edge function `generate-financial-insight` (cache 4h no banco)
 * - Botão "Atualizar" força regeneração (POST)
 * - Estados: loading, erro silencioso (esconde card), conteúdo
 * - Defesa: se a edge function falhar, o card NÃO renderiza nada
 *   (zero impacto no resto da página de Finanças)
 */
export function FinancialInsightCard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  const fetchInsight = useCallback(async (force: boolean) => {
    if (force) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const { data, error } = await supabase.functions.invoke<InsightResponse>(
        "generate-financial-insight",
        { method: force ? "POST" : "GET" }
      );
      if (error) throw error;
      if (!data?.insight) throw new Error("Resposta sem insight");
      setInsight(data.insight);
      setGeneratedAt(data.generated_at ?? null);
      setErrored(false);
      if (force) toast.success("Resumo atualizado.");
    } catch (e) {
      console.error("[FinancialInsightCard] erro:", e);
      setErrored(true);
      if (force) toast.error("Não consegui atualizar agora. Tenta de novo daqui a pouco.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInsight(false);
  }, [fetchInsight]);

  // Defesa: se errou no load inicial, esconde o card pra não poluir a tela.
  // (não há mensagem de erro ruidosa — Finanças continua funcionando perfeitamente)
  if (errored && !insight) return null;

  const lastUpdate = generatedAt
    ? new Date(generatedAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Card className="bg-gradient-to-br from-violet-500/10 via-card to-card border-violet-500/20">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-5 w-5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-xs uppercase tracking-wider text-violet-300/80 font-medium">
                Resumo do Jarvis
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchInsight(true)}
                disabled={loading || refreshing}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                title={lastUpdate ? `Atualizado em ${lastUpdate}` : "Atualizar resumo"}
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5 hidden sm:inline">
                  {refreshing ? "Atualizando..." : "Atualizar"}
                </span>
              </Button>
            </div>
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[85%]" />
                <Skeleton className="h-4 w-[60%]" />
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-foreground/90">{insight}</p>
            )}
            {lastUpdate && !loading && (
              <p className="text-[10px] text-muted-foreground mt-2">
                Atualizado {lastUpdate}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
