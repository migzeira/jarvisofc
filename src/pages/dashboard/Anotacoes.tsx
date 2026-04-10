import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useRealtimeBadge } from "@/hooks/useRealtimeBadge";
import { LiveBadge } from "@/components/LiveBadge";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, StickyNote, Search, Trash2, Pencil, Copy, MessageCircle, X } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Accent colors (determinísticos por ID da nota) ─────────────────────────
const ACCENTS = [
  { border: "border-l-blue-500",    bg: "bg-blue-500/8",    text: "text-blue-400"    },
  { border: "border-l-purple-500",  bg: "bg-purple-500/8",  text: "text-purple-400"  },
  { border: "border-l-emerald-500", bg: "bg-emerald-500/8", text: "text-emerald-400" },
  { border: "border-l-amber-500",   bg: "bg-amber-500/8",   text: "text-amber-400"   },
  { border: "border-l-pink-500",    bg: "bg-pink-500/8",    text: "text-pink-400"    },
  { border: "border-l-cyan-500",    bg: "bg-cyan-500/8",    text: "text-cyan-400"    },
  { border: "border-l-orange-500",  bg: "bg-orange-500/8",  text: "text-orange-400"  },
  { border: "border-l-rose-500",    bg: "bg-rose-500/8",    text: "text-rose-400"    },
];

function getAccent(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return ACCENTS[Math.abs(h) % ACCENTS.length];
}

interface Note {
  id: string;
  title: string | null;
  content: string;
  source: string;
  created_at: string;
}

// ─── Note Card ───────────────────────────────────────────────────────────────
function NoteCard({
  note,
  onDelete,
  onEdit,
  onClick,
}: {
  note: Note;
  onDelete: (id: string) => void;
  onEdit: (note: Note) => void;
  onClick: (note: Note) => void;
}) {
  const accent = getAccent(note.id);
  const isWhatsApp = note.source === "whatsapp";
  const ago = formatDistanceToNow(new Date(note.created_at), { locale: ptBR, addSuffix: true });

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(note.content);
    toast.success("Copiado!");
  };

  return (
    <Card
      className={`bg-card border-border border-l-4 ${accent.border} hover:shadow-md hover:shadow-black/20 hover:border-primary/20 transition-all duration-200 cursor-pointer mb-4 group`}
      onClick={() => onClick(note)}
    >
      <CardContent className="pt-4 pb-3 px-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            {note.title && (
              <h3 className="font-semibold text-sm leading-tight mb-1 truncate">{note.title}</h3>
            )}
            <p className={`text-sm text-muted-foreground leading-relaxed ${note.title ? "line-clamp-3" : "line-clamp-4"}`}>
              {note.content}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            {isWhatsApp ? (
              <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-[10px] gap-1 h-5">
                <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-5">
                <StickyNote className="w-2.5 h-2.5 mr-1" /> Manual
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground/60">{ago}</span>
          </div>

          {/* Action buttons (show on hover) */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              title="Copiar conteúdo"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(note); }}
              title="Editar"
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
              title="Excluir"
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function Anotacoes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });
  const [saving, setSaving] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "" });
  const [editSaving, setEditSaving] = useState(false);

  // View/expand dialog
  const [viewNote, setViewNote] = useState<Note | null>(null);

  useEffect(() => { if (user) loadData(); }, [user]);

  // Reload quando a aba volta ao foco (ex: nota criada pelo WhatsApp com página já aberta)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && user) loadData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);

  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(
    ["notes"],
    user?.id,
    () => { loadData(); triggerLive(); }
  );

  const loadData = async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    if (!error) {
      setNotes(data ?? []);
    }
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.content.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("notes").insert({
      user_id: user!.id,
      title: form.title.trim() || null,
      content: form.content.trim(),
      source: "manual",
    });
    if (error) toast.error("Erro ao salvar");
    else {
      toast.success("Anotação salva!");
      setCreateOpen(false);
      setForm({ title: "", content: "" });
      loadData();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Excluir esta anotação?")) return;
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) toast.error("Erro ao deletar");
    else { toast.success("Anotação excluída"); loadData(); }
  };

  const openEdit = (note: Note) => {
    setEditNote(note);
    setEditForm({ title: note.title ?? "", content: note.content });
    setEditOpen(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editNote) return;
    setEditSaving(true);
    const { error } = await supabase.from("notes").update({
      title: editForm.title.trim() || null,
      content: editForm.content.trim(),
    }).eq("id", editNote.id);
    if (error) toast.error("Erro ao atualizar");
    else { toast.success("Anotação atualizada!"); setEditOpen(false); loadData(); }
    setEditSaving(false);
  };

  const filtered = notes.filter(n => {
    const q = search.toLowerCase();
    return !q || n.title?.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <StickyNote className="h-6 w-6 text-primary" /> Anotações
            <LiveBadge isLive={isLive} className="ml-2" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {notes.length > 0
              ? `${notes.length} anotaç${notes.length === 1 ? "ão" : "ões"} salva${notes.length === 1 ? "" : "s"}`
              : "Ideias, lembretes e informações salvas pela Maya"}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nova anotação
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar em anotações..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 pr-10"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {search && (
        <p className="text-xs text-muted-foreground -mt-2">
          {filtered.length === 0 ? "Nenhum resultado" : `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""} para "${search}"`}
        </p>
      )}

      {/* Notes grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(n => (
            <NoteCard
              key={n.id}
              note={n}
              onDelete={handleDelete}
              onEdit={openEdit}
              onClick={setViewNote}
            />
          ))}
        </div>
      ) : (
        <Card className="bg-card border-border border-dashed">
          <CardContent className="py-16 text-center">
            <div className="flex justify-center mb-4 gap-3 opacity-20">
              <StickyNote className="h-10 w-10" />
            </div>
            <p className="text-muted-foreground font-medium">
              {search ? `Nada encontrado para "${search}"` : "Nenhuma anotação ainda"}
            </p>
            <p className="text-sm text-muted-foreground/60 mt-2 max-w-sm mx-auto">
              {search
                ? "Tente buscar por outro termo."
                : 'Crie uma acima ou diga no WhatsApp: "anota que preciso ligar pro João" ou "salva minha senha do email: xyz123"'}
            </p>
            {!search && (
              <Button variant="outline" className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Criar primeira anotação
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" /> Nova anotação
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-1">
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 border border-border">
              💡 Dica: Você também pode anotar pelo WhatsApp.<br />
              <em>"anota que a reunião mudou para quinta"</em>
            </p>
            <div className="space-y-2">
              <Label>Título <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Ex: Ideia para o produto"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Conteúdo</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                placeholder="Escreva aqui..."
                rows={5}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !form.content.trim()} className="flex-1">
                {saving ? "Salvando..." : "Salvar anotação"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Editar anotação
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>Título <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Ex: Ideia para o produto"
              />
            </div>
            <div className="space-y-2">
              <Label>Conteúdo</Label>
              <Textarea
                value={editForm.content}
                onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                rows={6}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editSaving || !editForm.content.trim()} className="flex-1">
                {editSaving ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── View/Expand Dialog ── */}
      {viewNote && (
        <Dialog open={!!viewNote} onOpenChange={() => setViewNote(null)}>
          <DialogContent className="bg-card border-border max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className={`w-3 h-3 rounded-full ${getAccent(viewNote.id).border.replace("border-l-", "bg-")}`} />
                {viewNote.title || "Anotação"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {viewNote.content}
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  {viewNote.source === "whatsapp" ? (
                    <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-xs gap-1">
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Manual</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(viewNote.created_at), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { navigator.clipboard.writeText(viewNote.content); toast.success("Copiado!"); }}
                  >
                    <Copy className="h-4 w-4 mr-1" /> Copiar
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { setViewNote(null); openEdit(viewNote); }}
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Editar
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
