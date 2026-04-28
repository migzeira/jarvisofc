import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (listId: string, listName: string) => void;
}

export function CreateListDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setSaving(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      toast.error("O nome precisa ter entre 1 e 60 caracteres.");
      return;
    }

    setSaving(true);

    // Verifica duplicata ANTES de tentar (UX melhor que esperar erro do constraint)
    const { data: existing } = await supabase
      .from("lists")
      .select("id, name")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .ilike("name", trimmed)
      .maybeSingle();

    if (existing) {
      toast.error(`Você já tem uma lista chamada "${(existing as any).name}".`);
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("lists")
      .insert({
        user_id: user.id,
        name: trimmed.toLowerCase(),
        source: "manual",
      })
      .select("id, name")
      .single();

    if (error) {
      console.error("[CreateListDialog] insert error:", error);
      toast.error("Erro ao criar lista.");
      setSaving(false);
      return;
    }

    toast.success(`Lista "${(data as any).name}" criada!`);
    onCreated?.((data as any).id, (data as any).name);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) {
          if (!o) reset();
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" /> Nova lista
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 border border-border">
            💡 Listas são pra coisas que você vai adicionando aos poucos: compras, presentes, filmes pra assistir.
            <br />
            Você também pode criar pelo WhatsApp: <em>"cria lista de compras"</em>
          </p>
          <div className="space-y-2">
            <Label>Nome da lista</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: compras, mercado, presentes natal"
              maxLength={60}
              autoFocus
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              {name.trim().length}/60 caracteres
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || name.trim().length < 1} className="flex-1">
              {saving ? "Criando..." : "Criar lista"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
