import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Bell, Plus, Trash2, Clock, RefreshCw, CheckCircle2, XCircle, Pencil } from "lucide-react";
import { isPast } from "date-fns";

interface Reminder {
  id: string;
  title: string | null;
  message: string;
  send_at: string;
  status: string;
  recurrence: string;
  recurrence_value: number | null;
  source: string;
  created_at: string;
}

const RECURRENCE_LABELS: Record<string, string> = {
  none: "Único",
  daily: "Todo dia",
  weekly: "Toda semana",
  monthly: "Todo mês",
  day_of_month: "Dia do mês",
};

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function formatBrasilia(isoString: string): string {
  return new Date(isoString).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Retorna o grupo de data para um lembrete pendente (em BRT)
function getDateGroup(sendAt: string): string {
  const now = new Date();
  if (new Date(sendAt) < now) return "Atrasado";
  const todayBRT = now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const tomorrowBRT = new Date(now.getTime() + 86400000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const weekEndBRT = new Date(now.getTime() + 7 * 86400000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const sendBRT = new Date(sendAt).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  if (sendBRT === todayBRT) return "Hoje";
  if (sendBRT === tomorrowBRT) return "Amanhã";
  if (sendBRT <= weekEndBRT) return "Esta semana";
  return "Depois";
}

const GROUP_ICONS: Record<string, string> = {
  "Atrasado": "⚠️",
  "Hoje": "📍",
  "Amanhã": "⏰",
  "Esta semana": "📅",
  "Depois": "🗓",
};
const GROUP_ORDER = ["Atrasado", "Hoje", "Amanhã", "Esta semana", "Depois"];

function recurrenceLabel(r: Reminder) {
  if (r.recurrence === "none" || !r.recurrence) return null;
  if (r.recurrence === "weekly" && r.recurrence_value != null) {
    return `Toda ${WEEKDAYS[r.recurrence_value]}`;
  }
  if (r.recurrence === "day_of_month" && r.recurrence_value != null) {
    return `Todo dia ${r.recurrence_value}`;
  }
  return RECURRENCE_LABELS[r.recurrence] ?? r.recurrence;
}

function statusBadge(status: string, sendAt: string) {
  if (status === "sent") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Enviado</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="text-[10px]"><XCircle className="w-3 h-3 mr-1" />Falhou</Badge>;
  if (isPast(new Date(sendAt))) return <Badge variant="secondary" className="text-[10px]">Atrasado</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
}

export default function Lembretes() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "sent" | "recurring">("all");

  // Form state
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceValue, setRecurrenceValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSendAt, setEditSendAt] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    const { data } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", user!.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false });

    const sorted = ((data as any[]) ?? []).sort((a, b) => {
      const aIsPending = a.status === "pending";
      const bIsPending = b.status === "pending";
      if (aIsPending && !bIsPending) return -1;
      if (!aIsPending && bIsPending) return 1;
      if (aIsPending && bIsPending) return new Date(a.send_at).getTime() - new Date(b.send_at).getTime();
      return new Date(b.send_at).getTime() - new Date(a.send_at).getTime();
    });

    setReminders(sorted);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!title.trim() || !message.trim() || !sendAt) {
      toast.error("Preencha título, mensagem e data/hora");
      return;
    }

    setSaving(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", user!.id)
      .single();

    const phone = profile?.phone_number ?? "";
    if (!phone) {
      toast.error("Cadastre seu número de WhatsApp em Meu Perfil primeiro");
      setSaving(false);
      return;
    }

    const rv = recurrenceValue ? parseInt(recurrenceValue) : null;

    const { error } = await supabase.from("reminders").insert({
      user_id: user!.id,
      whatsapp_number: phone,
      title: title.trim(),
      message: message.trim(),
      send_at: new Date(sendAt).toISOString(),
      recurrence,
      recurrence_value: rv,
      source: "manual",
      status: "pending",
    });

    if (error) {
      toast.error("Erro ao criar lembrete");
    } else {
      toast.success("Lembrete criado!");
      setTitle(""); setMessage(""); setSendAt(""); setRecurrence("none"); setRecurrenceValue("");
      setOpen(false);
      load();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("reminders").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Lembrete excluído"); load(); }
  };

  const handleRetry = async (id: string, currentStatus?: string) => {
    const retryAt = new Date(Date.now() + 60 * 1000).toISOString();
    const { error } = await supabase.from("reminders")
      .update({ status: "pending", send_at: retryAt })
      .eq("id", id);
    if (error) toast.error("Erro ao reagendar");
    else {
      toast.success(currentStatus === "sent" ? "Reenvio agendado para daqui 1 minuto!" : "Reagendado para daqui 1 minuto!");
      load();
    }
  };

  const openEdit = (r: Reminder) => {
    const d = new Date(r.send_at);
    // Format as datetime-local value (YYYY-MM-DDTHH:mm) in Brasilia time
    const brasiliaStr = d.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
    setEditSendAt(brasiliaStr);
    setEditMessage(r.message);
    setEditingId(r.id);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    const { error } = await supabase.from("reminders")
      .update({
        message: editMessage,
        send_at: new Date(editSendAt).toISOString(),
        status: "pending",
      })
      .eq("id", editingId);
    if (error) toast.error("Erro ao atualizar");
    else { toast.success("Lembrete atualizado!"); setEditOpen(false); load(); }
    setEditSaving(false);
  };

  const handleClearSent = async () => {
    if (!window.confirm("Excluir todos os lembretes enviados?")) return;
    await supabase.from("reminders")
      .delete()
      .eq("user_id", user!.id)
      .eq("status", "sent");
    toast.success("Lembretes enviados removidos!");
    load();
  };

  const filtered = reminders.filter(r => {
    if (filter === "pending") return r.status === "pending";
    if (filter === "sent") return r.status === "sent";
    if (filter === "recurring") return r.recurrence && r.recurrence !== "none";
    return true;
  });

  const pendingCount = reminders.filter(r => r.status === "pending").length;
  const recurringCount = reminders.filter(r => r.recurrence && r.recurrence !== "none" && r.status === "pending").length;
  const sentCount = reminders.filter(r => r.status === "sent").length;

  const emptyStateMessage = () => {
    switch (filter) {
      case "pending":
        return {
          title: "Nenhum lembrete pendente.",
          subtitle: 'Crie um acima ou mande mensagem no WhatsApp: "me lembra de X às 10h"',
        };
      case "sent":
        return {
          title: "Nenhum lembrete enviado ainda.",
          subtitle: "Os lembretes enviados aparecerão aqui após o disparo pela Maya.",
        };
      case "recurring":
        return {
          title: "Nenhum lembrete recorrente.",
          subtitle: 'Crie lembretes com repetição diária, semanal ou mensal. Ex: "me lembra todo dia 10 de pagar aluguel"',
        };
      default:
        return {
          title: "Nenhum lembrete ainda.",
          subtitle: 'Crie um acima ou mande mensagem no WhatsApp: "me lembra de X às 10h"',
        };
    }
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>;

  const empty = emptyStateMessage();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Lembretes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            A Maya te avisa no WhatsApp no horário certo — mesmo com o app fechado.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> Novo lembrete</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Criar lembrete manual</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 border border-border">
                Dica: Você também pode criar lembretes diretamente no WhatsApp. Basta dizer:<br />
                <em>"me lembra de X amanhã às 10h"</em> ou <em>"me lembra todo dia 10 de pagar aluguel"</em>
              </p>

              <div className="space-y-2">
                <Label>Título</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Pagar aluguel" />
              </div>
              <div className="space-y-2">
                <Label>Mensagem que será enviada</Label>
                <Textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Lembrete: Pagar aluguel!"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Data e hora (horário de Brasília)</Label>
                <Input type="datetime-local" value={sendAt} onChange={e => setSendAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Recorrência</Label>
                <Select value={recurrence} onValueChange={v => { setRecurrence(v); setRecurrenceValue(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Único (não repetir)</SelectItem>
                    <SelectItem value="daily">Todo dia</SelectItem>
                    <SelectItem value="weekly">Toda semana (mesmo dia)</SelectItem>
                    <SelectItem value="monthly">Todo mês (mesmo dia)</SelectItem>
                    <SelectItem value="day_of_month">Dia fixo do mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {recurrence === "weekly" && (
                <div className="space-y-2">
                  <Label>Dia da semana</Label>
                  <Select value={recurrenceValue} onValueChange={setRecurrenceValue}>
                    <SelectTrigger><SelectValue placeholder="Escolha o dia" /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {recurrence === "day_of_month" && (
                <div className="space-y-2">
                  <Label>Dia do mês (1-31)</Label>
                  <Input type="number" min="1" max="31" value={recurrenceValue} onChange={e => setRecurrenceValue(e.target.value)} placeholder="Ex: 10" />
                </div>
              )}

              <Button onClick={handleCreate} disabled={saving} className="w-full">
                {saving ? "Criando..." : "Criar lembrete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Editar lembrete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={editMessage}
                onChange={e => setEditMessage(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Data e hora (horário de Brasília)</Label>
              <Input
                type="datetime-local"
                value={editSendAt}
                onChange={e => setEditSendAt(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ao salvar, o lembrete volta para status pendente com o novo horário.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleEdit} disabled={editSaving} className="flex-1">
                {editSaving ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {(["all","pending","recurring","sent"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" && "Todos"}
            {f === "pending" && <>Pendentes {pendingCount > 0 && <Badge className="ml-1.5 text-[10px] h-4 px-1">{pendingCount}</Badge>}</>}
            {f === "recurring" && <>Recorrentes {recurringCount > 0 && <Badge className="ml-1.5 text-[10px] h-4 px-1 bg-violet-500">{recurringCount}</Badge>}</>}
            {f === "sent" && <>Enviados {sentCount > 0 && <Badge className="ml-1.5 text-[10px] h-4 px-1 bg-green-600">{sentCount}</Badge>}</>}
          </Button>
        ))}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-14 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">{empty.title}</p>
            <p className="text-sm text-muted-foreground/60 mt-1">{empty.subtitle}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Limpar enviados */}
          {filter === "sent" && filtered.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
                onClick={handleClearSent}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpar todos enviados
              </Button>
            </div>
          )}

          {(() => {
            const renderCard = (r: Reminder) => {
              const rec = recurrenceLabel(r);
              const isRecurringPending = rec && r.status === "pending";
              return (
                <Card key={r.id} className="bg-card border-border hover:border-primary/20 transition-colors">
                  <CardContent className="py-4 flex items-start gap-4">
                    <div className={`mt-0.5 w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${
                      r.status === "sent" ? "bg-green-500/10" :
                      r.status === "failed" ? "bg-red-500/10" : "bg-primary/10"
                    }`}>
                      {r.status === "sent" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
                       r.status === "failed" ? <XCircle className="h-4 w-4 text-red-500" /> :
                       rec ? <RefreshCw className="h-4 w-4 text-primary" /> :
                       <Bell className="h-4 w-4 text-primary" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="font-medium text-sm">{r.title || r.message.slice(0, 60)}</p>
                        {statusBadge(r.status, r.send_at)}
                        {rec && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <RefreshCw className="w-2.5 h-2.5" />{rec}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{r.message}</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {isRecurringPending
                          ? <span className="text-violet-400/80 mr-1">próximo disparo:</span>
                          : <span className="mr-1"></span>
                        }
                        {formatBrasilia(r.send_at)}
                        {r.source === "whatsapp" && <span className="ml-2 text-green-500/70">• via WhatsApp</span>}
                        {r.source === "manual" && <span className="ml-2 text-blue-500/70">• manual</span>}
                        {r.source === "event_followup" && <span className="ml-2 text-amber-500/70">• pós-evento</span>}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 flex-shrink-0">
                      {(r.status === "failed" || r.status === "sent") && (
                        <button
                          onClick={() => handleRetry(r.id, r.status)}
                          title={r.status === "sent" ? "Reenviar este lembrete" : "Reagendar para daqui 1 minuto"}
                          className="text-muted-foreground hover:text-amber-400 transition-colors"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(r)}
                        title="Editar lembrete"
                        className="text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        title="Excluir lembrete"
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            };

            // Agrupamento por data — só para o filtro "pending"
            if (filter === "pending") {
              const groups: Record<string, Reminder[]> = {};
              for (const r of filtered) {
                const g = getDateGroup(r.send_at);
                if (!groups[g]) groups[g] = [];
                groups[g].push(r);
              }
              return (
                <div className="space-y-6">
                  {GROUP_ORDER.filter(g => groups[g]?.length > 0).map(groupName => (
                    <div key={groupName} className="space-y-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {GROUP_ICONS[groupName]} {groupName}
                        </span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {groups[groupName].length}
                        </Badge>
                        <div className="flex-1 h-px bg-border/50" />
                      </div>
                      {groups[groupName].map(r => renderCard(r))}
                    </div>
                  ))}
                </div>
              );
            }

            // Flat list para outros filtros
            return <>{filtered.map(r => renderCard(r))}</>;
          })()}
        </div>
      )}
    </div>
  );
}
