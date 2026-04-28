import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, ListChecks, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ListItem {
  id: string;
  list_id: string;
  content: string;
  completed: boolean;
  completed_at: string | null;
  position: number;
  source: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listId: string | null;
  listName: string;
  listSource?: string;
  onChanged?: () => void; // chamado quando algo muda (pra atualizar grid)
}

export function ListDetailModal({ open, onOpenChange, listId, listName, listSource, onChanged }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!listId || !user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("list_items")
      .select("*")
      .eq("list_id", listId)
      .order("completed", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error) setItems((data as ListItem[]) ?? []);
    setLoading(false);
  }, [listId, user]);

  useEffect(() => {
    if (open && listId) load();
  }, [open, listId, load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listId || !user) return;
    const trimmed = newItem.trim();
    if (trimmed.length < 1 || trimmed.length > 200) return;
    setAdding(true);

    // Calcula próxima position
    const maxPos = items.reduce((m, i) => Math.max(m, i.position), -1);
    const { error } = await supabase.from("list_items").insert({
      list_id: listId,
      content: trimmed,
      position: maxPos + 1,
      source: "manual",
    });

    if (error) {
      console.error("[ListDetailModal] insert error:", error);
      toast.error("Erro ao adicionar item.");
    } else {
      setNewItem("");
      await load();
      // Bump updated_at da lista pra reordenar grid
      await supabase
        .from("lists")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", listId);
      onChanged?.();
    }
    setAdding(false);
  };

  const handleToggle = async (item: ListItem) => {
    const newCompleted = !item.completed;
    // Optimistic
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }
          : i
      )
    );
    const { error } = await supabase
      .from("list_items")
      .update({
        completed: newCompleted,
        completed_at: newCompleted ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
    if (error) {
      toast.error("Erro ao atualizar item.");
      load(); // reverte buscando do banco
    } else {
      onChanged?.();
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Remover esse item?")) return;
    const { error } = await supabase.from("list_items").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover.");
    } else {
      setItems((prev) => prev.filter((i) => i.id !== id));
      onChanged?.();
    }
  };

  const handleClearCompleted = async () => {
    if (!listId) return;
    const completedIds = items.filter((i) => i.completed).map((i) => i.id);
    if (completedIds.length === 0) return;
    if (!window.confirm(`Remover ${completedIds.length} item${completedIds.length === 1 ? "" : "s"} concluído${completedIds.length === 1 ? "" : "s"}?`)) return;
    const { error } = await supabase.from("list_items").delete().in("id", completedIds);
    if (error) {
      toast.error("Erro ao limpar.");
    } else {
      await load();
      onChanged?.();
    }
  };

  const pending = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  const isWhatsApp = listSource === "whatsapp";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-primary" />
            <span className="capitalize">{listName}</span>
            {isWhatsApp && (
              <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-[10px] gap-1 h-5">
                <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Add new item */}
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Adicionar item..."
              maxLength={200}
              disabled={adding}
              autoComplete="off"
            />
            <Button type="submit" disabled={adding || newItem.trim().length === 0} size="sm">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </form>

          {/* List */}
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <ListChecks className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Lista vazia</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Adicione itens acima ou pelo WhatsApp:
                <br />
                <em>"adiciona X, Y, Z na lista de {listName}"</em>
              </p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto pr-1 space-y-3">
              {/* Pendentes */}
              {pending.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Pendentes ({pending.length})
                  </p>
                  {pending.map((item) => (
                    <ItemRow key={item.id} item={item} onToggle={handleToggle} onDelete={handleDelete} />
                  ))}
                </div>
              )}
              {/* Concluídos */}
              {done.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Concluídos ({done.length})
                    </p>
                    <button
                      onClick={handleClearCompleted}
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Limpar concluídos
                    </button>
                  </div>
                  {done.map((item) => (
                    <ItemRow key={item.id} item={item} onToggle={handleToggle} onDelete={handleDelete} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer info */}
          {items.length > 0 && (
            <div className="pt-2 border-t border-border text-[10px] text-muted-foreground/60 flex justify-between">
              <span>
                {pending.length} pendente{pending.length === 1 ? "" : "s"} • {done.length} concluído{done.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ListItem;
  onToggle: (i: ListItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex items-start gap-2 py-1.5 px-2 rounded hover:bg-accent/30 transition-colors">
      <Checkbox
        checked={item.completed}
        onCheckedChange={() => onToggle(item)}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-snug ${
            item.completed ? "line-through text-muted-foreground/60" : "text-foreground"
          }`}
        >
          {item.content}
        </p>
        {item.completed && item.completed_at && (
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            {format(new Date(item.completed_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
          </p>
        )}
      </div>
      <button
        onClick={() => onDelete(item.id)}
        title="Remover"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
