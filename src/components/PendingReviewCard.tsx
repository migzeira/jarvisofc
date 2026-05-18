import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, Edit3, X } from "lucide-react";
import { useSupabase } from "@/contexts/SupabaseContext";
import { toast } from "sonner";

interface PendingTx {
  id: string;
  description: string;
  amount: number;
  type: "expense" | "income";
  category: string;
  transaction_date: string;
  needs_review: boolean;
}

interface CategoryOption {
  name: string;
  label: string;
  icon?: string;
}

interface Props {
  /** Todas as transações da página (filtra `needs_review = true` internamente) */
  transactions: any[];
  /** Categorias disponíveis pra dropdown (default + custom) */
  categoryOptions: CategoryOption[];
  /** Callback chamado após update — caller deve recarregar dados */
  onUpdate: () => void;
}

/**
 * Card "Pendências de Categorização" — só renderiza quando há transações
 * com `needs_review = true`. Lista compacta com 3 ações por item:
 *   - Confirmar (mantém categoria atual, marca needs_review=false)
 *   - Mudar categoria (dropdown inline, ao selecionar atualiza + marca false)
 *   - Excluir (delete a transação)
 *
 * Por design: card desaparece sozinho quando lista fica vazia (não polui UI
 * pra users cuja IA categoriza tudo certo de primeira).
 */
export function PendingReviewCard({ transactions, categoryOptions, onUpdate }: Props) {
  const supabase = useSupabase();
  const [savingId, setSavingId] = useState<string | null>(null);

  const pending: PendingTx[] = transactions.filter((t) => t.needs_review === true);

  if (pending.length === 0) return null;

  /** Confirma a categoria atual — só marca needs_review=false */
  const handleConfirm = async (tx: PendingTx) => {
    setSavingId(tx.id);
    const { error } = await supabase
      .from("transactions")
      .update({ needs_review: false })
      .eq("id", tx.id);
    setSavingId(null);
    if (error) {
      toast.error("Erro ao confirmar — tenta de novo");
      return;
    }
    toast.success("Confirmado!");
    onUpdate();
  };

  /** Muda categoria e marca needs_review=false na mesma operação */
  const handleChangeCategory = async (tx: PendingTx, newCategory: string) => {
    if (!newCategory || newCategory === tx.category) return;
    setSavingId(tx.id);
    const { error } = await supabase
      .from("transactions")
      .update({ category: newCategory, needs_review: false })
      .eq("id", tx.id);
    setSavingId(null);
    if (error) {
      toast.error("Erro ao atualizar categoria");
      return;
    }
    toast.success(`Categoria alterada para ${newCategory}`);
    onUpdate();
  };

  /** Exclui transação (sem undo — ação consciente do user) */
  const handleDelete = async (tx: PendingTx) => {
    setSavingId(tx.id);
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", tx.id);
    setSavingId(null);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Transação removida");
    onUpdate();
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span>Pendências de Categorização</span>
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 ml-1">
            {pending.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Jarvis ficou em dúvida nessas. Confirme ou ajuste pra IA aprender com você.
        </p>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {pending.map((tx) => {
          const isSaving = savingId === tx.id;
          const emoji = tx.type === "expense" ? "🔴" : "🟢";
          return (
            <div
              key={tx.id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-card/40"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium truncate">
                  <span>{emoji}</span>
                  <span className="truncate">{tx.description}</span>
                  <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                    R$ {Number(tx.amount).toFixed(2).replace(".", ",")}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Atual: <span className="font-medium">{tx.category}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                  disabled={isSaving}
                  onClick={() => handleConfirm(tx)}
                  aria-label="Confirmar categoria"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Confirmar
                </Button>

                <Select
                  value=""
                  onValueChange={(val) => handleChangeCategory(tx, val)}
                  disabled={isSaving}
                >
                  <SelectTrigger
                    className="h-7 px-2 text-xs w-auto gap-1 [&>svg]:h-3 [&>svg]:w-3"
                    aria-label="Mudar categoria"
                  >
                    <Edit3 className="h-3 w-3" />
                    <SelectValue placeholder="Mudar" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.icon ? `${c.icon} ` : ""}{c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  disabled={isSaving}
                  onClick={() => handleDelete(tx)}
                  aria-label="Excluir transação"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
