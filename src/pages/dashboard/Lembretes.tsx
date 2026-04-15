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
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bell, Plus, Trash2, Clock, RefreshCw, CheckCircle2, XCircle,
  Pencil, Calendar, CalendarCheck,
} from "lucide-react";

interface Reminder {
  id: string;
  title: string | null;
  message: string;
  send_at: string;
  status: string;
  recurrence: string;
  recurrence_value: number | null;
  source: string;
  event_id: string | null;
  created_at: string;
}

const RECURRENCE_LABELS: Record<string, string> = {
  none: "Único",
  daily: "Todo dia",
  weekly: "Toda semana",
  monthly: "Todo mês",
  day_of_month: "Dia do mês",
  hourly: "A cada hora",
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

function getDateGroup(sendAt: string): string {
  const now = new Date();
  const marginMs = 2 * 60 * 1000;
  if (new Date(sendAt).getTime() + marginMs < now.getTime()) return "Atrasado";
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
  if (r.recurrence === "hourly" && r.recurrence_value != null) {
    return r.recurrence_value === 1 ? "A cada hora" : `A cada ${r.recurrence_value}h`;
  }
  return RECURRENCE_LABELS[r.recurrence] ?? r.recurrence;
}

function statusBadge(status: string, sendAt: string) {
  if (status === "sent") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Enviado</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="text-[10px]"><XCircle className="w-3 h-3 mr-1" />Falhou</Badge>;
  if (status === "done") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]"><CalendarCheck className="w-3 h-3 mr-1" />Concluído</Badge>;
  const marginMs = 2 * 60 * 1000;
  if (new Date(sendAt).getTime() + marginMs < Date.now()) return <Badge variant="secondary" className="text-[10px]">Atrasado</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
}

// Identifica se um lembrete veio da agenda (evento ou follow-up de evento)
function isAgendaReminder(r: Reminder) {
  return r.source === "event" || r.source === "event_followup";
}

export default function Lembretes() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "sent" | "recurring" | "agenda">("pending");

  // Sub-filtro dentro da aba "Lembretes de Agenda"
  const [agendaSubFilter, setAgendaSubFilter] = useState<"all" | "pending" | "sent" | "done">("all");

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

  // Reagendar lembrete de agenda
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(
    ["reminders"],
    user?.id,
    () => { load(); triggerLive(); }
  );

  const load = async () => {
    const { data } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", user!.id)
      .neq("status", "cancelled")
      .neq("source", "habit")
      .order("created_at", { ascending: false })
      .limit(500);

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
      .eq("status", "sent")
      .in("source", ["manual", "whatsapp"]);
    toast.success("Lembretes enviados removidos!");
    load();
  };

  // Confirmar que a reunião/evento aconteceu
  const handleAgendaConfirm = async (r: Reminder) => {
    const { error } = await supabase.from("reminders")
      .update({ status: "done" })
      .eq("id", r.id);

    if (!error && r.event_id) {
      await supabase.from("calendar_events")
        .update({ status: "done" })
        .eq("id", r.event_id);
    }

    if (error) toast.error("Erro ao confirmar evento");
    else { toast.success("Evento confirmado como realizado!"); load(); }
  };

  // Marcar evento como cancelado
  const handleAgendaCancel = async (r: Reminder) => {
    const { error } = await supabase.from("reminders")
      .update({ status: "cancelled" })
      .eq("id", r.id);

    if (!error && r.event_id) {
      await supabase.from("calendar_events")
        .update({ status: "cancelled" })
        .eq("id", r.event_id);
    }

    if (error) toast.error("Erro ao cancelar evento");
    else { toast.success("Evento marcado como cancelado!"); load(); }
  };

  // Abrir dialog de reagendamento de agenda
  const openReschedule = (r: Reminder) => {
    const d = new Date(r.send_at);
    const brasiliaStr = d.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
    setRescheduleAt(brasiliaStr);
    setRescheduleId(r.id);
    setRescheduleOpen(true);
  };

  const handleAgendaReschedule = async () => {
    if (!rescheduleId || !rescheduleAt) return;
    setRescheduleSaving(true);
    const { error } = await supabase.from("reminders")
      .update({ status: "pending", send_at: new Date(rescheduleAt).toISOString() })
      .eq("id", rescheduleId);
    if (error) toast.error("Erro ao reagendar");
    else { toast.success("Lembrete de agenda reagendado!"); setRescheduleOpen(false); load(); }
    setRescheduleSaving(false);
  };

  // Separação: lembretes da agenda vs lembretes manuais
  const regularReminders = reminders.filter(r => !isAgendaReminder(r) && r.status !== "done");
  const agendaReminders = reminders.filter(r => isAgendaReminder(r));

  const filtered = filter === "agenda"
    ? agendaReminders.filter(r => {
        if (agendaSubFilter === "pending") return r.status === "pending";
        if (agendaSubFilter === "sent") return r.status === "sent";
        if (agendaSubFilter === "done") return r.status === "done";
        return true;
      })
    : regularReminders.filter(r => {
        if (filter === "pending") return r.status === "pending";
        if (filter === "sent") return r.status === "sent";
        if (filter === "recurring") return r.recurrence && r.recurrence !== "none";
        return true;
      });

  const pendingCount = regularReminders.filter(r => r.status === "pending").length;
  const recurringCount = regularReminders.filter(r => r.recurrence && r.recurrence !== "none" && r.status === "pending").length;
  const sentCount = regularReminders.filter(r => r.status === "sent").length;
  const agendaPendingCount = agendaReminders.filter(r => r.status === "pending").length;

  const emptyStateMessage = () => {
    if (filter === "agenda") {
      const labels: Record<string, { title: string; subtitle: string }> = {
        all: { title: "Nenhum lembrete de agenda.", subtitle: "Os lembretes gerados a partir de eventos da sua agenda aparecerão aqui." },
        pending: { title: "Nenhum lembrete de agenda pendente.", subtitle: "Lembretes próximos de eventos aparecerão aqui antes do horário." },
        sent: { title: "Nenhum lembrete de agenda enviado.", subtitle: "Lembretes de eventos já enviados aparecerão aqui." },
        done: { title: "Nenhum evento concluído.", subtitle: 'Clique em "Sim, aconteceu" nos lembretes enviados para confirmá-los aqui.' },
      };
      return labels[agendaSubFilter];
    }
    switch (filter) {
      case "pending": return { title: "Nenhum lembrete pendente.", subtitle: 'Crie um acima ou mande mensagem no WhatsApp: "me lembra de X às 10h"' };
      case "sent": return { title: "Nenhum lembrete enviado ainda.", subtitle: "Os lembretes enviados aparecerão aqui após o disparo pelo Jarvis." };
      case "recurring": return { title: "Nenhum lembrete recorrente.", subtitle: 'Crie lembretes com repetição diária, semanal ou mensal. Ex: "me lembra todo dia 10 de pagar aluguel"' };
      default: return { title: "Nenhum lembrete ainda.", subtitle: 'Crie um acima ou mande mensagem no WhatsApp: "me lembra de X às 10h"' };
    }
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>;

  const empty = emptyStateMessage();

  const renderRegularCard = (r: Reminder) => {
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

  const renderAgendaCard = (r: Reminder) => {
    const isDone = r.status === "done";
    const isSent = r.status === "sent";
    const isPending = r.status === "pending";
    const isFollowUp = r.source === "event_followup";
    const sourceLabel = r.source === "event_followup" ? "follow-up de evento" : "evento da agenda";

    return (
      <Card key={r.id} className={`border transition-colors ${
        isDone ? "bg-emerald-950/20 border-emerald-800/30 hover:border-emerald-700/40" :
        isSent ? "bg-amber-950/20 border-amber-800/30 hover:border-amber-700/40" :
        "bg-card border-border hover:border-orange-500/20"
      }`}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={`mt-0.5 w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${
            isDone ? "bg-emerald-500/15" :
            isSent ? "bg-amber-500/15" : "bg-orange-500/10"
          }`}>
            {isDone
              ? <CalendarCheck className="h-4 w-4 text-emerald-400" />
              : <Calendar className="h-4 w-4 text-orange-400" />
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-medium text-sm">{r.title || r.message.slice(0, 60)}</p>
              {statusBadge(r.status, r.send_at)}
              {isFollowUp && (
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  follow-up
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{r.message}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {formatBrasilia(r.send_at)}
              <span className="ml-2 text-orange-400/70">• {sourceLabel}</span>
            </p>

            {/* Ações de resposta — só quando o lembrete foi enviado ou está pendente */}
            {!isDone && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {isSent && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 border-emerald-600/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500"
                      onClick={() => handleAgendaConfirm(r)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sim, aconteceu
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 border-red-600/40 text-red-400 hover:bg-red-500/10 hover:border-red-500"
                      onClick={() => handleAgendaCancel(r)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Foi cancelada
                    </Button>
                  </>
                )}
                {isPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-emerald-600/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500"
                    onClick={() => handleAgendaConfirm(r)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Marcar concluído
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => openReschedule(r)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reagendar
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1 flex-shrink-0">
            <button
              onClick={() => handleDelete(r.id)}
              title="Excluir lembrete de agenda"
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Lembretes
            <LiveBadge isLive={isLive} className="ml-2" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            O Jarvis te avisa no WhatsApp no horário certo — mesmo com o app fechado.
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
                    <SelectItem value="hourly">A cada X horas</SelectItem>
                    <SelectItem value="daily">Todo dia</SelectItem>
                    <SelectItem value="weekly">Toda semana (mesmo dia)</SelectItem>
                    <SelectItem value="monthly">Todo mês (mesmo dia)</SelectItem>
                    <SelectItem value="day_of_month">Dia fixo do mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {recurrence === "hourly" && (
                <div className="space-y-2">
                  <Label>Intervalo (em horas)</Label>
                  <Input type="number" min="1" max="23" value={recurrenceValue} onChange={e => setRecurrenceValue(e.target.value)} placeholder="Ex: 5 (a cada 5 horas)" />
                </div>
              )}
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

      {/* Dialog de reagendamento de lembrete de agenda */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Reagendar lembrete de agenda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nova data e hora (horário de Brasília)</Label>
              <Input
                type="datetime-local"
                value={rescheduleAt}
                onChange={e => setRescheduleAt(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O lembrete será reenviado no novo horário.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRescheduleOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAgendaReschedule} disabled={rescheduleSaving} className="flex-1">
                {rescheduleSaving ? "Reagendando..." : "Reagendar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filtros principais */}
      <div className="flex gap-2 flex-wrap">
        {(["pending", "recurring", "all", "sent"] as const).map(f => (
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

        {/* Botão Lembretes de Agenda */}
        <Button
          variant={filter === "agenda" ? "default" : "outline"}
          size="sm"
          onClick={() => { setFilter("agenda"); setAgendaSubFilter("all"); }}
          className={filter !== "agenda" ? "border-orange-500/40 text-orange-400 hover:border-orange-500 hover:text-orange-300" : ""}
        >
          <Calendar className="h-3.5 w-3.5 mr-1.5" />
          Lembretes de Agenda
          {agendaPendingCount > 0 && (
            <Badge className="ml-1.5 text-[10px] h-4 px-1 bg-orange-500">{agendaPendingCount}</Badge>
          )}
        </Button>
      </div>

      {/* Sub-filtros da aba Agenda */}
      {filter === "agenda" && (
        <div className="flex gap-2 flex-wrap pl-3 border-l-2 border-orange-500/30">
          {(["all", "pending", "sent", "done"] as const).map(sf => (
            <Button
              key={sf}
              variant={agendaSubFilter === sf ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAgendaSubFilter(sf)}
            >
              {sf === "all" && "Todos"}
              {sf === "pending" && <>Pendentes {agendaReminders.filter(r => r.status === "pending").length > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1">{agendaReminders.filter(r => r.status === "pending").length}</Badge>}</>}
              {sf === "sent" && "Enviados"}
              {sf === "done" && "Concluídos"}
            </Button>
          ))}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-14 text-center">
            {filter === "agenda"
              ? <Calendar className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              : <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            }
            <p className="text-muted-foreground font-medium">{empty.title}</p>
            <p className="text-sm text-muted-foreground/60 mt-1">{empty.subtitle}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Limpar enviados — só para lembretes regulares */}
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

          {filter === "agenda" ? (
            // Agenda: lista flat com cards especiais
            <div className="space-y-2">
              {filtered.map(r => renderAgendaCard(r))}
            </div>
          ) : (
            <>
              {filter === "pending" ? (
                // Pendentes regulares: agrupados por data
                (() => {
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
                          {groups[groupName].map(r => renderRegularCard(r))}
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                // Flat list para outros filtros regulares
                <>{filtered.map(r => renderRegularCard(r))}</>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
