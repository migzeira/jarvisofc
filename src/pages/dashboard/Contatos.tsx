import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, UserCircle2, Search, Phone, Pencil, Check, X, Store, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Contact {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  source: string;
  created_at: string;
  type: "person" | "business";
  category: string | null;
}

const BUSINESS_CATEGORIES = [
  { value: "pizzaria",    label: "Pizzaria" },
  { value: "restaurante", label: "Restaurante" },
  { value: "farmacia",    label: "Farmácia" },
  { value: "mercado",     label: "Mercado / Supermercado" },
  { value: "padaria",     label: "Padaria / Confeitaria" },
  { value: "lanchonete",  label: "Lanchonete / Fast Food" },
  { value: "sushi",       label: "Japonês / Sushi" },
  { value: "hamburguer",  label: "Hamburgueria" },
  { value: "acai",        label: "Açaí / Sorveteria" },
  { value: "servico",     label: "Serviço (encanador, eletricista...)" },
  { value: "outro",       label: "Outro estabelecimento" },
];

export default function Contatos() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "person" | "business">("all");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newType, setNewType] = useState<"person" | "business">("person");
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Load & realtime ──────────────────────────────────────────────────────

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", user.id)
      .order("name");
    if (error) toast.error("Erro ao carregar contatos");
    else setContacts((data ?? []) as unknown as Contact[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  // Realtime: aparece na tela imediatamente quando Jarvis salva pelo WhatsApp
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`contacts:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const c = payload.new as Contact;
            setContacts(prev => {
              if (prev.some(x => x.id === c.id)) return prev;
              const updated = [...prev, c];
              updated.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
              return updated;
            });
          } else if (payload.eventType === "UPDATE") {
            const c = payload.new as Contact;
            setContacts(prev => prev.map(x => x.id === c.id ? c : x));
          } else if (payload.eventType === "DELETE") {
            setContacts(prev => prev.filter(x => x.id !== payload.old?.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Auto-focus inline edit input
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    setSaving(true);
    let phone = newPhone.replace(/\D/g, "");
    if (!phone.startsWith("55") && phone.length <= 11) phone = `55${phone}`;

    const { error } = await supabase.from("contacts").upsert(
      {
        user_id: user!.id,
        name: newName.trim(),
        phone,
        notes: newNotes.trim() || null,
        source: "manual",
        type: newType,
        category: newType === "business" ? (newCategory || null) : null,
      },
      { onConflict: "user_id,phone" }
    );
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar contato");
    } else {
      toast.success("Contato adicionado!");
      setAdding(false);
      setNewName(""); setNewPhone(""); setNewNotes("");
      setNewType("person"); setNewCategory("");
      load();
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) toast.error("Erro ao remover");
    else {
      toast.success(`${name} removido`);
      setContacts(c => c.filter(x => x.id !== id));
    }
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setEditName(c.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) { toast.error("Nome não pode estar vazio"); return; }

    const { error } = await supabase
      .from("contacts")
      .update({ name: trimmed })
      .eq("id", id);

    if (error) {
      toast.error("Erro ao atualizar nome");
    } else {
      setContacts(prev => prev.map(c => c.id === id ? { ...c, name: trimmed } : c));
      toast.success("Nome atualizado! 🙌");
      setEditingId(null);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") saveEdit(id);
    if (e.key === "Escape") cancelEdit();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const filtered = contacts.filter(c => {
    if (typeFilter === "person" && c.type !== "person") return false;
    if (typeFilter === "business" && c.type !== "business") return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(search);
  });

  const countPerson = contacts.filter(c => c.type === "person").length;
  const countBusiness = contacts.filter(c => c.type === "business").length;

  const formatPhone = (phone: string) => {
    const n = phone.replace(/\D/g, "");
    if (n.startsWith("55") && n.length === 13)
      return `+55 (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
    if (n.startsWith("55") && n.length === 12)
      return `+55 (${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`;
    return phone;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contatos</h1>
        <Button onClick={() => setAdding(a => !a)} variant={adding ? "outline" : "default"} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {adding ? "Cancelar" : "Adicionar"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Compartilhe um contato do WhatsApp com o Jarvis e ele salva automaticamente aqui — em tempo real. Depois é só pedir:{" "}
        <em>"Marca reunião com [Nome]"</em> ou <em>"Manda mensagem pra [Nome] dizendo..."</em>
      </p>

      {adding && (
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-base">Novo contato</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* Tipo: Pessoa ou Estabelecimento */}
            <div className="space-y-1">
              <Label className="text-xs">Tipo *</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setNewType("person"); setNewCategory(""); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                    newType === "person"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <User className="h-3.5 w-3.5" /> Pessoa
                </button>
                <button
                  type="button"
                  onClick={() => setNewType("business")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                    newType === "business"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Store className="h-3.5 w-3.5" /> Estabelecimento
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{newType === "business" ? "Nome do estabelecimento *" : "Nome *"}</Label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={newType === "business" ? "Ex: Pizzaria Kadalora" : "Ex: Cibele Fernandes"}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone (com DDD) *</Label>
                <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="11 99999-9999" />
              </div>
            </div>

            {/* Categoria — só para estabelecimentos */}
            {newType === "business" && (
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Selecione o tipo de estabelecimento" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{newType === "business" ? "Observações (ex: horário de funcionamento)" : "Observações"}</Label>
              <Input
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                placeholder={newType === "business" ? "Ex: Aberto até 23h, pede mínimo R$30" : "Ex: minha esposa, cliente VIP..."}
              />
            </div>
            <Button
              onClick={handleAdd}
              disabled={saving || !newName.trim() || !newPhone.trim()}
              size="sm"
            >
              {saving ? "Salvando..." : "Salvar contato"}
            </Button>
          </CardContent>
        </Card>
      )}

      {contacts.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                typeFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              Todos
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{contacts.length}</Badge>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("person")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                typeFilter === "person"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              <User className="h-3.5 w-3.5" /> Pessoas
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{countPerson}</Badge>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("business")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                typeFilter === "business"
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-card border-border text-muted-foreground hover:border-amber-500/50"
              }`}
            >
              <Store className="h-3.5 w-3.5" /> Estabelecimentos
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{countBusiness}</Badge>
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {filtered.length === 0 && !adding && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <UserCircle2 className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">
              {search
                ? "Nenhum contato encontrado."
                : "Nenhum contato ainda. Compartilhe um contato do WhatsApp com o Jarvis para começar!"}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map(c => (
          <Card key={c.id} className="bg-card border-border">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center ${
                    c.type === "business" ? "bg-amber-500/10" : "bg-primary/10"
                  }`}>
                    {c.type === "business"
                      ? <Store className="h-4 w-4 text-amber-400" />
                      : <span className="text-sm font-semibold text-primary">{c.name.charAt(0).toUpperCase()}</span>
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Inline name edit */}
                    {editingId === c.id ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          ref={editInputRef}
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => handleEditKeyDown(e, c.id)}
                          className="h-7 text-sm py-0 px-2 w-full max-w-[200px]"
                        />
                        <button
                          onClick={() => saveEdit(c.id)}
                          className="p-1 rounded-md text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                          title="Salvar"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
                          title="Cancelar"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group/name">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <button
                          onClick={() => startEdit(c)}
                          className="opacity-0 group-hover/name:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                          title="Editar nome"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 flex-shrink-0" />
                      <span className="font-mono">{formatPhone(c.phone)}</span>
                    </div>
                    {c.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.type === "business" ? (
                    <Badge variant="outline" className="text-xs hidden sm:flex items-center gap-1 border-amber-500/40 text-amber-400">
                      <Store className="h-3 w-3" />
                      {BUSINESS_CATEGORIES.find(cat => cat.value === c.category)?.label ?? "Estabelecimento"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs hidden sm:flex">
                      {c.source === "whatsapp" ? "📱 WhatsApp" : "✏️ Manual"}
                    </Badge>
                  )}
                  <button
                    onClick={() => handleDelete(c.id, c.name)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
