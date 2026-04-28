import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Modal pra criar OU editar categoria customizada.
 * - Sem mode="edit" + categoryToEdit=null → CRIAR
 * - Com categoryToEdit → EDITAR (permite trocar nome/emoji/cor + excluir)
 *
 * Defaults (is_default=true) NUNCA chegam aqui — UI só mostra editar em customs.
 */

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categoryToEdit?: CategoryRow | null;       // null/undefined = modo CRIAR
  onSaved?: () => void;                       // chamado após save/delete pra recarregar
}

// Paleta fixa (10 cores) — nome interno → classe tailwind / hex
export const CATEGORY_COLORS: Array<{ key: string; label: string; bg: string; ring: string }> = [
  { key: "violet",  label: "Violeta",  bg: "bg-violet-500",  ring: "ring-violet-400" },
  { key: "blue",    label: "Azul",     bg: "bg-blue-500",    ring: "ring-blue-400" },
  { key: "green",   label: "Verde",    bg: "bg-green-500",   ring: "ring-green-400" },
  { key: "yellow",  label: "Amarelo",  bg: "bg-yellow-500",  ring: "ring-yellow-400" },
  { key: "orange",  label: "Laranja",  bg: "bg-orange-500",  ring: "ring-orange-400" },
  { key: "red",     label: "Vermelho", bg: "bg-red-500",     ring: "ring-red-400" },
  { key: "pink",    label: "Rosa",     bg: "bg-pink-500",    ring: "ring-pink-400" },
  { key: "amber",   label: "Marrom",   bg: "bg-amber-700",   ring: "ring-amber-600" },
  { key: "slate",   label: "Cinza",    bg: "bg-slate-500",   ring: "ring-slate-400" },
  { key: "cyan",    label: "Ciano",    bg: "bg-cyan-500",    ring: "ring-cyan-400" },
];

const DEFAULT_COLOR = "violet";
const DEFAULT_EMOJI = "🏷️";

export function CategoryCreateModal({ open, onOpenChange, categoryToEdit, onSaved }: Props) {
  const { user } = useAuth();
  const isEdit = !!categoryToEdit;

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Carrega valores quando abre em modo edit
  useEffect(() => {
    if (!open) return;
    if (categoryToEdit) {
      setName(categoryToEdit.name);
      setEmoji(categoryToEdit.icon || DEFAULT_EMOJI);
      setColor(categoryToEdit.color || DEFAULT_COLOR);
    } else {
      setName("");
      setEmoji(DEFAULT_EMOJI);
      setColor(DEFAULT_COLOR);
    }
  }, [open, categoryToEdit]);

  const nameTrim = name.trim();
  const nameValid = nameTrim.length >= 2 && nameTrim.length <= 30;
  const canSubmit = nameValid && !submitting && !deleting;

  const handleClose = (next: boolean) => {
    if (submitting || deleting) return;
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    try {
      if (isEdit && categoryToEdit) {
        // UPDATE — aceita mudar nome, emoji, cor
        const { data, error } = await (supabase
          .from("categories")
          .update({ name: nameTrim, icon: emoji, color } as any)
          .eq("id", categoryToEdit.id)
          .select() as any);
        if (error) throw error;
        if (!data || data.length === 0) {
          toast.error("Sem permissão pra atualizar essa categoria.");
          return;
        }
        toast.success(`Categoria atualizada: ${nameTrim}`);
      } else {
        // INSERT — cria nova categoria custom
        const { error } = await (supabase
          .from("categories")
          .insert({
            user_id: user.id,
            name: nameTrim,
            icon: emoji,
            color,
            is_default: false,
          } as any) as any);
        if (error) {
          // 23505 = unique violation (provavelmente já tem categoria com esse nome)
          if ((error as any).code === "23505") {
            toast.error(`Você já tem uma categoria com o nome "${nameTrim}".`);
            return;
          }
          throw error;
        }
        toast.success(`Categoria criada: ${emoji} ${nameTrim}`);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[CategoryCreateModal] erro:", e);
      toast.error("Erro ao salvar categoria.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !categoryToEdit) return;
    if (!confirm(`Excluir a categoria "${categoryToEdit.name}"? As transações antigas continuam com esse nome (apenas como texto), mas a categoria some das opções.`)) return;
    setDeleting(true);
    try {
      const { data, error } = await (supabase
        .from("categories")
        .delete()
        .eq("id", categoryToEdit.id)
        .select() as any);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Sem permissão pra excluir.");
        return;
      }
      toast.success(`Categoria removida.`);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      console.error("[CategoryCreateModal] delete erro:", e);
      toast.error("Erro ao excluir categoria.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "Edite o nome, ícone ou cor. Transações antigas mantêm o nome anterior."
              : "Crie uma categoria custom (ex: Pet, Sibele, Babá). O Jarvis vai usar ela automaticamente nas mensagens do WhatsApp."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/30">
            <div className={`h-10 w-10 rounded-lg ${CATEGORY_COLORS.find(c => c.key === color)?.bg ?? "bg-violet-500"} flex items-center justify-center text-xl shadow-md`}>
              {emoji}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pré-visualização</p>
              <p className="text-sm font-semibold">{nameTrim || "Nome da categoria"}</p>
            </div>
          </div>

          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name" className="text-xs">Nome <span className="text-muted-foreground">(2-30 caracteres)</span></Label>
            <Input
              id="cat-name"
              placeholder="Ex: Pet, Sibele, Investimentos"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 30))}
              maxLength={30}
              disabled={submitting || deleting}
              autoComplete="off"
            />
          </div>

          {/* Emoji livre */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-emoji" className="text-xs">Ícone (emoji)</Label>
            <Input
              id="cat-emoji"
              placeholder="🏷️"
              value={emoji}
              onChange={(e) => {
                // Limita a 4 chars (alguns emoji compostos têm 2-4 chars unicode)
                const next = e.target.value.slice(0, 4);
                setEmoji(next || DEFAULT_EMOJI);
              }}
              disabled={submitting || deleting}
              className="text-2xl text-center font-emoji"
            />
            <p className="text-[10px] text-muted-foreground">
              Cole um emoji do teclado: 🐶 🚗 💼 ⚽ 🎮 🛒 📚 🎯
            </p>
          </div>

          {/* Cor */}
          <div className="space-y-1.5">
            <Label className="text-xs">Cor</Label>
            <div className="grid grid-cols-10 gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  disabled={submitting || deleting}
                  title={c.label}
                  className={`h-8 w-8 rounded-md ${c.bg} transition-all flex items-center justify-center ${
                    color === c.key ? `ring-2 ${c.ring} ring-offset-2 ring-offset-background scale-110` : "hover:scale-105"
                  }`}
                >
                  {color === c.key && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Botões */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {isEdit ? (
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
            ) : <span />}

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
                ) : (
                  isEdit ? "Salvar" : "Criar categoria"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
