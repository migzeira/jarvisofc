import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: "expense" | "income";
  category: string;
  transaction_date: string;
  source?: string | null;
  installment_group?: string | null;
}

interface CategoryOption {
  name: string;       // valor armazenado (lowercase)
  label: string;      // como exibir
  icon?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  transaction: Transaction | null;
  categoryOptions: CategoryOption[];   // todas (defaults + custom)
  onSaved?: () => void;
}

/**
 * Modal pra editar uma transação. Permite mudar descrição, valor, tipo,
 * categoria, data E excluir. Categoria é dropdown com defaults + customs.
 *
 * Importante: a coluna `category` em transactions é TEXT livre — guardamos
 * o NOME da categoria (lowercase). Apagar uma categoria não quebra
 * histórico (continua mostrando o texto).
 */
export function TransactionEditModal({ open, onOpenChange, transaction, categoryOptions, onSaved }: Props) {
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("outros");
  const [transactionDate, setTransactionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !transaction) return;
    setDescription(transaction.description ?? "");
    setAmount(String(transaction.amount ?? "").replace(".", ","));
    setType(transaction.type);
    setCategory((transaction.category ?? "outros").toLowerCase().trim());
    setTransactionDate(transaction.transaction_date);
  }, [open, transaction]);

  const handleClose = (next: boolean) => {
    if (submitting || deleting) return;
    onOpenChange(next);
  };

  const parseAmount = (raw: string): number | null => {
    const normalized = raw.replace(/\./g, "").replace(",", ".").trim();
    const n = parseFloat(normalized);
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  };

  const amountParsed = parseAmount(amount);
  const descTrim = description.trim();
  const canSubmit = !!transaction && !!user && descTrim.length >= 1 && amountParsed !== null && !!transactionDate && !submitting && !deleting;

  const handleSubmit = async () => {
    if (!canSubmit || !transaction) return;
    setSubmitting(true);
    try {
      const updates = {
        description: descTrim,
        amount: amountParsed!,
        type,
        category: category.toLowerCase().trim(),
        transaction_date: transactionDate,
      };
      const { data, error } = await (supabase
        .from("transactions")
        .update(updates as any)
        .eq("id", transaction.id)
        .select() as any);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Não consegui atualizar (sem permissão ou transação não encontrada).");
        return;
      }
      toast.success("Transação atualizada.");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[TransactionEditModal] erro:", e);
      toast.error("Erro ao atualizar transação.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!transaction) return;
    if (!confirm(`Excluir a transação "${transaction.description}" (R$ ${Number(transaction.amount).toFixed(2).replace(".", ",")})?`)) return;
    setDeleting(true);
    try {
      const { data, error } = await (supabase
        .from("transactions")
        .delete()
        .eq("id", transaction.id)
        .select() as any);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Sem permissão pra excluir.");
        return;
      }
      toast.success("Transação excluída.");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[TransactionEditModal] delete erro:", e);
      toast.error("Erro ao excluir transação.");
    } finally {
      setDeleting(false);
    }
  };

  // Garante que a categoria atual da tx aparece na lista mesmo se foi apagada
  const categoryInList = categoryOptions.some((c) => c.name === category);
  const allOptions = categoryInList
    ? categoryOptions
    : [{ name: category, label: category, icon: "🏷️" }, ...categoryOptions];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar transação</DialogTitle>
          <DialogDescription className="text-xs">
            Ajuste qualquer campo da transação. Mudanças são salvas no banco.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Tipo (toggle expense/income) */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={type === "expense" ? "default" : "outline"}
              size="sm"
              className={type === "expense" ? "bg-rose-600 hover:bg-rose-700" : ""}
              onClick={() => setType("expense")}
              disabled={submitting || deleting}
            >
              🔴 Gasto
            </Button>
            <Button
              type="button"
              variant={type === "income" ? "default" : "outline"}
              size="sm"
              className={type === "income" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              onClick={() => setType("income")}
              disabled={submitting || deleting}
            >
              🟢 Receita
            </Button>
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="tx-desc" className="text-xs">Descrição</Label>
            <Input
              id="tx-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 200))}
              placeholder="Ex: Almoço no shopping"
              disabled={submitting || deleting}
              autoComplete="off"
            />
          </div>

          {/* Valor + Data lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-amount" className="text-xs">Valor (R$)</Label>
              <Input
                id="tx-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0,00"
                inputMode="decimal"
                disabled={submitting || deleting}
                autoComplete="off"
              />
              {amountParsed === null && amount.length > 0 && (
                <p className="text-[10px] text-amber-400">Valor inválido</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date" className="text-xs">Data</Label>
              <Input
                id="tx-date"
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                disabled={submitting || deleting}
              />
            </div>
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <Label className="text-xs">Categoria</Label>
            <Select value={category} onValueChange={setCategory} disabled={submitting || deleting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allOptions.map((opt) => (
                  <SelectItem key={opt.name} value={opt.name}>
                    <span className="flex items-center gap-2">
                      {opt.icon && <span>{opt.icon}</span>}
                      <span>{opt.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Botões */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={submitting || deleting}
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
            >
              {deleting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Excluindo...</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5 mr-1" />Excluir</>
              )}
            </Button>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={submitting || deleting}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Salvando...</>
                ) : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
