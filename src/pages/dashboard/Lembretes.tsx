import { useEffect, useState, useMemo, type ReactNode } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { SenderBadge } from "@/components/couple/SenderBadge";
import { SenderFilter, matchesSenderFilter, type SenderFilterValue } from "@/components/couple/SenderFilter";
import { SenderSelector, resolveSenderTargets, type SenderSelectorValue } from "@/components/couple/SenderSelector";
import { useCoupleContext } from "@/hooks/useCoupleContext";
import {
  Bell, Plus, Trash2, Clock, RefreshCw, CheckCircle2, XCircle,
  Pencil, Calendar, CalendarCheck, MessageSquare, Search, User,
} from "lucide-react";

// ── Interfaces ────────────────────────────────────────────────────────────────

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
  sent_by_phone: string | null;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const RECURRENCE_LABELS: Record<string, string> = {
  none: "Único", daily: "Todo dia", weekly: "Toda semana",
  monthly: "Todo mês", day_of_month: "Dia do mês", hourly: "A cada hora",
};

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const EVENT_TYPES = [
  { value: "reuniao", label: "Reunião" },
  { value: "compromisso", label: "Compromisso" },
  { value: "consulta", label: "Consulta" },
  { value: "evento", label: "Evento" },
  { value: "tarefa", label: "Tarefa" },
];

const REMINDER_OPTIONS = [
  { value: "5", label: "5 minutos antes" },
  { value: "10", label: "10 minutos antes" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBrasilia(isoString: string): string {
  return new Date(isoString).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
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
  "Atrasado": "⚠️", "Hoje": "📍", "Amanhã": "⏰", "Esta semana": "📅", "Depois": "🗓",
};
const GROUP_ORDER = ["Atrasado", "Hoje", "Amanhã", "Esta semana", "Depois"];

function recurrenceLabel(r: Reminder) {
  if (r.recurrence === "none" || !r.recurrence) return null;
  if (r.recurrence === "weekly" && r.recurrence_value != null) return `Toda ${WEEKDAYS[r.recurrence_value]}`;
  if (r.recurrence === "day_of_month" && r.recurrence_value != null) return `Todo dia ${r.recurrence_value}`;
  if (r.recurrence === "hourly" && r.recurrence_value != null)
    return r.recurrence_value === 1 ? "A cada hora" : `A cada ${r.recurrence_value}h`;
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

function buildGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function isAgendaReminder(r: Reminder) {
  if (r.source === "send_to_contact") return false; // mensagem para contato nunca é agenda
  return r.source === "event" || r.source === "event_followup" || r.event_id !== null;
}

function isMessageReminder(r: Reminder) {
  return r.source === "send_to_contact";
}

type MainTab = "reminders" | "agenda" | "message";
type RegularSub = "all" | "pending" | "recurring" | "sent";
type AgendaSub = "all" | "pending" | "sent" | "done";
type MessageSub = "all" | "pending" | "sent";

// ── Componente principal ──────────────────────────────────────────────────────

export default function Lembretes() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  // Plano casal: filtro de quem registrou
  const couple = useCoupleContext();
  const [senderFilter, setSenderFilter] = useState<SenderFilterValue>("all");

  const [mainTab, setMainTab] = useState<MainTab>("reminders");
  const [regularSub, setRegularSub] = useState<RegularSub>("pending");
  const [agendaSub, setAgendaSub] = useState<AgendaSub>("all");
  const [messageSub, setMessageSub] = useState<MessageSub>("all");

  // ── Dialog: Lembrete regular ──
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceValue, setRecurrenceValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // Plano casal: destinatário do lembrete (default = "me" = master)
  const [reminderTarget, setReminderTarget] = useState<SenderSelectorValue>("me");

  // ── Dialog: Editar lembrete regular ──
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSendAt, setEditSendAt] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ── Dialog: Reagendar lembrete de agenda ──
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  // ── Dialog: Novo lembrete de agenda ──
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaTitle, setAgendaTitle] = useState("");
  const [agendaDate, setAgendaDate] = useState("");
  const [agendaTime, setAgendaTime] = useState("");
  const [agendaEndTime, setAgendaEndTime] = useState("");
  const [agendaEventType, setAgendaEventType] = useState("reuniao");
  const [agendaReminderMinutes, setAgendaReminderMinutes] = useState("30");
  const [agendaDesc, setAgendaDesc] = useState("");
  const [agendaSaving, setAgendaSaving] = useState(false);

  // ── Dialog: Novo lembrete de mensagem ──
  const [msgOpen, setMsgOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [msgContent, setMsgContent] = useState("");
  const [msgSendAt, setMsgSendAt] = useState("");
  const [msgSaving, setMsgSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(["reminders"], user?.id, () => { load(); triggerLive(); });

  const load = async () => {
    const { data } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", user!.id)
      .neq("status", "cancelled")
      .neq("source", "habit")
      .is("habit_id", null)
      .order("created_at", { ascending: false })
      .limit(500);

    const sorted = ((data as any[]) ?? []).sort((a, b) => {
      const aP = a.status === "pending", bP = b.status === "pending";
      if (aP && !bP) return -1;
      if (!aP && bP) return 1;
      if (aP && bP) return new Date(a.send_at).getTime() - new Date(b.send_at).getTime();
      return new Date(b.send_at).getTime() - new Date(a.send_at).getTime();
    });
    setReminders(sorted);
    setLoading(false);
  };

  const loadContacts = async () => {
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone")
      .eq("user_id", user!.id)
      .order("name");
    setContacts((data as any[]) ?? []);
  };

  // ── Filtros de contatos por busca ──
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return contacts.filter(c =>
      c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q) ||
      c.phone.includes(q)
    );
  }, [contacts, contactSearch]);

  // ── Handlers: lembrete regular ───────────────────────────────────────────────

  const handleCreate = async () => {
    if (!title.trim() || !message.trim() || !sendAt) {
      toast.error("Preencha título, mensagem e data/hora"); return;
    }
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user!.id).single();
    const phone = profile?.phone_number ?? "";
    if (!phone) { toast.error("Cadastre seu número de WhatsApp em Meu Perfil primeiro"); setSaving(false); return; }
    const rv = recurrenceValue ? parseInt(recurrenceValue) : null;

    // Plano casal: resolve destinatários (1 ou 2 baseado em reminderTarget).
    // Cliente solo: targets sempre [{master}] e nada muda no fluxo.
    const targets = couple.isCouplePlan && couple.partners.length > 0
      ? resolveSenderTargets(reminderTarget, phone, couple.masterName, couple.partners)
      : [{ sent_by_phone: null, notify_phone: phone, label: "Você" }];

    // Cria 1 reminder por target (se "Os dois", são 2 reminders idênticos
    // mas com whatsapp_number e sent_by_phone próprios)
    const rows = targets.map((t) => ({
      user_id: user!.id,
      whatsapp_number: t.notify_phone || phone,
      title: title.trim(),
      message: message.trim(),
      send_at: new Date(sendAt).toISOString(),
      recurrence,
      recurrence_value: rv,
      source: "manual",
      status: "pending",
      sent_by_phone: t.sent_by_phone,
    }));

    const { error } = await (supabase.from("reminders").insert(rows as any) as any);
    if (error) toast.error("Erro ao criar lembrete");
    else {
      const targetLabels = targets.map((t) => t.label).join(" e ");
      toast.success(targets.length > 1 ? `Lembrete criado pra ${targetLabels}!` : `Lembrete criado pra ${targetLabels}!`);
      setTitle(""); setMessage(""); setSendAt(""); setRecurrence("none"); setRecurrenceValue("");
      setReminderTarget("me");
      setOpen(false); load();
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
    const { error } = await supabase.from("reminders").update({ status: "pending", send_at: retryAt }).eq("id", id);
    if (error) toast.error("Erro ao reagendar");
    else { toast.success(currentStatus === "sent" ? "Reenvio agendado para daqui 1 minuto!" : "Reagendado para daqui 1 minuto!"); load(); }
  };

  const openEdit = (r: Reminder) => {
    const brasiliaStr = new Date(r.send_at).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
    setEditSendAt(brasiliaStr); setEditMessage(r.message); setEditingId(r.id); setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    const { error } = await supabase.from("reminders")
      .update({ message: editMessage, send_at: new Date(editSendAt).toISOString(), status: "pending" })
      .eq("id", editingId);
    if (error) toast.error("Erro ao atualizar");
    else { toast.success("Lembrete atualizado!"); setEditOpen(false); load(); }
    setEditSaving(false);
  };

  const handleClearSent = async () => {
    if (!window.confirm("Excluir todos os lembretes enviados?")) return;
    await supabase.from("reminders").delete().eq("user_id", user!.id).eq("status", "sent").in("source", ["manual", "whatsapp"]);
    toast.success("Lembretes enviados removidos!"); load();
  };

  // ── Handlers: lembrete de agenda ─────────────────────────────────────────────

  const handleCreateAgenda = async () => {
    if (!agendaTitle.trim() || !agendaDate) {
      toast.error("Preencha o título e a data do evento"); return;
    }
    setAgendaSaving(true);

    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user!.id).single();
    const phone = profile?.phone_number ?? "";
    if (!phone) { toast.error("Cadastre seu número de WhatsApp em Meu Perfil primeiro"); setAgendaSaving(false); return; }

    // Cria o evento na agenda
    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .insert({
        user_id: user!.id,
        title: agendaTitle.trim(),
        description: agendaDesc.trim() || null,
        event_date: agendaDate,
        event_time: agendaTime || null,
        end_time: agendaEndTime || null,
        event_type: agendaEventType || null,
        reminder: true,
        reminder_minutes_before: parseInt(agendaReminderMinutes),
        source: "manual",
        status: "pending",
      })
      .select()
      .single();

    if (eventError || !eventData) {
      toast.error("Erro ao criar evento na agenda");
      setAgendaSaving(false);
      return;
    }

    // Calcula horário do lembrete (X minutos antes do evento)
    // Interpreta a data/hora como horário de Brasília (BRT = UTC-3) para armazenar UTC correto
    const timeStr = agendaTime || "00:00";
    const brtDateString = `${agendaDate}T${timeStr}:00-03:00`; // força offset BRT
    const eventDateTime = new Date(brtDateString);
    const reminderMinutes = parseInt(agendaReminderMinutes);
    const reminderSendAt = new Date(eventDateTime.getTime() - reminderMinutes * 60 * 1000);

    // Monta mensagem do lembrete
    const reminderMsg = agendaTime
      ? `⏰ Lembrete: Você tem *${agendaTitle.trim()}* em ${reminderMinutes} minutos! (${agendaTime.replace(":", "h")})`
      : `⏰ Lembrete: Você tem *${agendaTitle.trim()}* hoje!`;

    // Cria o lembrete vinculado ao evento
    const { error: reminderError } = await supabase.from("reminders").insert({
      user_id: user!.id,
      whatsapp_number: phone,
      title: agendaTitle.trim(),
      message: reminderMsg,
      send_at: reminderSendAt.toISOString(),
      recurrence: "none",
      recurrence_value: null,
      source: "event",
      event_id: (eventData as any).id,
      status: "pending",
    });

    if (reminderError) {
      toast.error("Evento criado, mas houve um erro ao criar o lembrete associado");
    } else {
      toast.success("Evento e lembrete de agenda criados com sucesso!");
      setAgendaTitle(""); setAgendaDate(""); setAgendaTime(""); setAgendaEndTime("");
      setAgendaEventType("reuniao"); setAgendaReminderMinutes("30"); setAgendaDesc("");
      setAgendaOpen(false);
      load();
    }
    setAgendaSaving(false);
  };

  const handleAgendaConfirm = async (r: Reminder) => {
    const { error } = await supabase.from("reminders").update({ status: "done" }).eq("id", r.id);
    if (!error && r.event_id) await supabase.from("events").update({ status: "done" }).eq("id", r.event_id);
    if (error) toast.error("Erro ao confirmar evento");
    else { toast.success("Evento confirmado como realizado!"); load(); }
  };

  const handleAgendaCancel = async (r: Reminder) => {
    const { error } = await supabase.from("reminders").update({ status: "cancelled" }).eq("id", r.id);
    if (!error && r.event_id) await supabase.from("events").update({ status: "cancelled" }).eq("id", r.event_id);
    if (error) toast.error("Erro ao cancelar evento");
    else { toast.success("Evento marcado como cancelado!"); load(); }
  };

  const openReschedule = (r: Reminder) => {
    const brasiliaStr = new Date(r.send_at).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
    setRescheduleAt(brasiliaStr); setRescheduleId(r.id); setRescheduleOpen(true);
  };

  const handleAgendaReschedule = async () => {
    if (!rescheduleId || !rescheduleAt) return;
    setRescheduleSaving(true);
    const { error } = await supabase.from("reminders")
      .update({ status: "pending", send_at: new Date(rescheduleAt).toISOString() })
      .eq("id", rescheduleId);
    if (error) toast.error("Erro ao reagendar");
    else { toast.success("Reagendado!"); setRescheduleOpen(false); load(); }
    setRescheduleSaving(false);
  };

  // ── Handlers: lembrete de mensagem ──────────────────────────────────────────

  const handleCreateMessage = async () => {
    if (!selectedContact) { toast.error("Selecione um contato"); return; }
    if (!msgContent.trim()) { toast.error("Escreva a mensagem a ser enviada"); return; }
    if (!msgSendAt) { toast.error("Escolha quando enviar"); return; }

    setMsgSaving(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number, display_name")
      .eq("id", user!.id)
      .single();

    const userPhone = profile?.phone_number ?? "";
    const userName = profile?.display_name || "seu contato";

    if (!userPhone) { toast.error("Cadastre seu número de WhatsApp em Meu Perfil primeiro"); setMsgSaving(false); return; }

    const contactFirst = selectedContact.name.split(" ")[0];
    const greeting = buildGreeting();

    // Monta a mensagem completa no estilo Jarvis
    const fullMessage =
      `${greeting}, *${contactFirst}*! 👋\n\n` +
      `Aqui é o *Jarvis*, assistente virtual de *${userName}*.\n\n` +
      `${userName} me pediu para te passar um recado:\n\n` +
      `💬 _"${msgContent.trim()}"_\n\n` +
      `——————————————\n` +
      `_Mensagem enviada via Jarvis_ 🤖`;

    const { error } = await supabase.from("reminders").insert({
      user_id: user!.id,
      whatsapp_number: selectedContact.phone,
      title: `Mensagem para ${selectedContact.name}`,
      message: fullMessage,
      send_at: new Date(msgSendAt).toISOString(),
      recurrence: "none",
      recurrence_value: null,
      source: "send_to_contact",
      event_id: null,
      status: "pending",
    });

    if (error) toast.error("Erro ao criar lembrete de mensagem");
    else {
      toast.success(`Mensagem para ${selectedContact.name} agendada!`);
      setSelectedContact(null); setContactSearch(""); setMsgContent(""); setMsgSendAt("");
      setMsgOpen(false); load();
    }
    setMsgSaving(false);
  };

  // ── Separação dos dados ──────────────────────────────────────────────────────

  // Plano casal: aplica filtro de quem registrou ANTES de splittar por categoria
  const reminders_filtered = reminders.filter(r =>
    matchesSenderFilter(r.sent_by_phone, senderFilter, couple.masterPhone)
  );
  const agendaReminders = reminders_filtered.filter(r => isAgendaReminder(r));
  const messageReminders = reminders_filtered.filter(r => isMessageReminder(r));
  const regularReminders = reminders_filtered.filter(r => !isAgendaReminder(r) && !isMessageReminder(r) && r.status !== "done");

  const isRecurring = (r: Reminder) => !!r.recurrence && r.recurrence !== "none";

  const filteredRegular = regularReminders.filter(r => {
    if (regularSub === "pending") return r.status === "pending" && !isRecurring(r);
    if (regularSub === "sent") return r.status === "sent";
    if (regularSub === "recurring") return isRecurring(r) && r.status === "pending";
    return true;
  });

  const filteredAgenda = agendaReminders.filter(r => {
    if (agendaSub === "pending") return r.status === "pending";
    if (agendaSub === "sent") return r.status === "sent";
    if (agendaSub === "done") return r.status === "done";
    return true;
  });

  const filteredMessage = messageReminders.filter(r => {
    if (messageSub === "pending") return r.status === "pending";
    if (messageSub === "sent") return r.status === "sent";
    return true;
  });

  const regPending = regularReminders.filter(r => r.status === "pending" && !isRecurring(r)).length;
  const regRecurring = regularReminders.filter(r => isRecurring(r) && r.status === "pending").length;
  const regSent = regularReminders.filter(r => r.status === "sent").length;
  const agendaPending = agendaReminders.filter(r => r.status === "pending").length;
  const msgPending = messageReminders.filter(r => r.status === "pending").length;

  // ── Render helpers ───────────────────────────────────────────────────────────

  const renderRegularCard = (r: Reminder) => {
    const rec = recurrenceLabel(r);
    const isRecurringPending = rec && r.status === "pending";
    return (
      <Card key={r.id} className="bg-card border-border hover:border-primary/20 transition-colors">
        <CardContent className="py-4 flex items-start gap-4">
          <div className={`mt-0.5 w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${
            r.status === "sent" ? "bg-green-500/10" : r.status === "failed" ? "bg-red-500/10" : "bg-primary/10"
          }`}>
            {r.status === "sent" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
             r.status === "failed" ? <XCircle className="h-4 w-4 text-red-500" /> :
             rec ? <RefreshCw className="h-4 w-4 text-primary" /> : <Bell className="h-4 w-4 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-medium text-sm">{r.title || r.message.slice(0, 60)}</p>
              {statusBadge(r.status, r.send_at)}
              {rec && <Badge variant="outline" className="text-[10px] gap-1"><RefreshCw className="w-2.5 h-2.5" />{rec}</Badge>}
              <SenderBadge sentByPhone={r.sent_by_phone} size="xs" />
            </div>
            <p className="text-xs text-muted-foreground truncate">{r.message}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {isRecurringPending && <span className="text-violet-400/80 mr-1">próximo disparo:</span>}
              {formatBrasilia(r.send_at)}
              {r.source === "whatsapp" && <span className="ml-2 text-green-500/70">• via WhatsApp</span>}
              {r.source === "manual" && <span className="ml-2 text-blue-500/70">• manual</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-shrink-0">
            {(r.status === "failed" || r.status === "sent") && (
              <button onClick={() => handleRetry(r.id, r.status)} title="Reagendar" className="text-muted-foreground hover:text-amber-400 transition-colors">
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => openEdit(r)} title="Editar" className="text-muted-foreground hover:text-primary transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => handleDelete(r.id)} title="Excluir" className="text-muted-foreground hover:text-destructive transition-colors">
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
    return (
      <Card key={r.id} className={`border transition-colors ${
        isDone ? "bg-emerald-950/20 border-emerald-800/30 hover:border-emerald-700/40" :
        isSent ? "bg-amber-950/20 border-amber-800/30 hover:border-amber-700/40" :
        "bg-card border-border hover:border-orange-500/20"
      }`}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={`mt-0.5 w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${
            isDone ? "bg-emerald-500/15" : isSent ? "bg-amber-500/15" : "bg-orange-500/10"
          }`}>
            {isDone ? <CalendarCheck className="h-4 w-4 text-emerald-400" /> : <Calendar className="h-4 w-4 text-orange-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-medium text-sm">{r.title || r.message.slice(0, 60)}</p>
              {statusBadge(r.status, r.send_at)}
              {isFollowUp && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">follow-up</Badge>}
              <SenderBadge sentByPhone={r.sent_by_phone} size="xs" />
            </div>
            <p className="text-xs text-muted-foreground truncate">{r.message}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {formatBrasilia(r.send_at)}
              <span className="ml-2 text-orange-400/70">• {isFollowUp ? "follow-up de evento" : "evento da agenda"}</span>
            </p>
            {!isDone && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {isSent && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-emerald-600/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500" onClick={() => handleAgendaConfirm(r)}>
                      <CheckCircle2 className="h-3.5 w-3.5" />Sim, aconteceu
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-red-600/40 text-red-400 hover:bg-red-500/10 hover:border-red-500" onClick={() => handleAgendaCancel(r)}>
                      <XCircle className="h-3.5 w-3.5" />Foi cancelada
                    </Button>
                  </>
                )}
                {isPending && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-emerald-600/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500" onClick={() => handleAgendaConfirm(r)}>
                    <CheckCircle2 className="h-3.5 w-3.5" />Marcar concluído
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => openReschedule(r)}>
                  <RefreshCw className="h-3.5 w-3.5" />Reagendar
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-shrink-0">
            <button onClick={() => handleDelete(r.id)} title="Excluir" className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMessageCard = (r: Reminder) => (
    <Card key={r.id} className={`border transition-colors ${
      r.status === "sent" ? "bg-indigo-950/20 border-indigo-800/30 hover:border-indigo-700/40" :
      r.status === "failed" ? "bg-red-950/20 border-red-800/30" :
      "bg-card border-border hover:border-indigo-500/20"
    }`}>
      <CardContent className="py-4 flex items-start gap-4">
        <div className={`mt-0.5 w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${
          r.status === "sent" ? "bg-indigo-500/15" : r.status === "failed" ? "bg-red-500/10" : "bg-indigo-500/10"
        }`}>
          {r.status === "sent" ? <CheckCircle2 className="h-4 w-4 text-indigo-400" /> :
           r.status === "failed" ? <XCircle className="h-4 w-4 text-red-500" /> :
           <MessageSquare className="h-4 w-4 text-indigo-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-medium text-sm">{r.title || r.message.slice(0, 60)}</p>
            {statusBadge(r.status, r.send_at)}
            <SenderBadge sentByPhone={r.sent_by_phone} size="xs" />
          </div>
          <p className="text-xs text-muted-foreground truncate">{r.message}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {formatBrasilia(r.send_at)}
            <span className="ml-2 text-indigo-400/70">• mensagem para contato</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-shrink-0">
          {(r.status === "failed" || r.status === "sent") && (
            <button onClick={() => handleRetry(r.id, r.status)} title="Reagendar" className="text-muted-foreground hover:text-amber-400 transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => handleDelete(r.id)} title="Excluir" className="text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );

  const renderEmptyState = (icon: ReactNode, title: string, subtitle: string) => (
    <Card className="bg-card border-border">
      <CardContent className="py-14 text-center">
        <div className="flex justify-center mb-3 text-muted-foreground/30">{icon}</div>
        <p className="text-muted-foreground font-medium">{title}</p>
        <p className="text-sm text-muted-foreground/60 mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
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

        {/* Botão "Novo" dinâmico por aba */}
        {mainTab === "reminders" && (
          <Button className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Novo lembrete
          </Button>
        )}
        {mainTab === "agenda" && (
          <Button className="gap-2 bg-orange-600 hover:bg-orange-700" onClick={() => setAgendaOpen(true)}>
            <Plus className="h-4 w-4" /> Novo evento + lembrete
          </Button>
        )}
        {mainTab === "message" && (
          <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700" onClick={() => { loadContacts(); setMsgOpen(true); }}>
            <Plus className="h-4 w-4" /> Nova mensagem agendada
          </Button>
        )}
      </div>

      {/* Plano casal: filtro de quem registrou */}
      {couple.isCouplePlan && couple.partners.length > 0 && (
        <SenderFilter value={senderFilter} onChange={setSenderFilter} />
      )}

      {/* ── Dialog: Lembrete regular ─────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Criar lembrete manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 border border-border">
              Dica: Você também pode criar lembretes no WhatsApp:<br />
              <em>"me lembra de X amanhã às 10h"</em> ou <em>"me lembra todo dia 10 de pagar aluguel"</em>
            </p>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Pagar aluguel" />
            </div>
            <div className="space-y-2">
              <Label>Mensagem que será enviada</Label>
              <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Lembrete: Pagar aluguel!" rows={2} />
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

            {/* Plano casal: pra quem é o lembrete */}
            <SenderSelector
              value={reminderTarget}
              onChange={setReminderTarget}
              label="Pra quem é esse lembrete?"
            />

            <Button onClick={handleCreate} disabled={saving} className="w-full">
              {saving ? "Criando..." : "Criar lembrete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Editar lembrete regular ──────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Editar lembrete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea value={editMessage} onChange={e => setEditMessage(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Data e hora (horário de Brasília)</Label>
              <Input type="datetime-local" value={editSendAt} onChange={e => setEditSendAt(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Ao salvar, o lembrete volta para status pendente com o novo horário.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button onClick={handleEdit} disabled={editSaving} className="flex-1">{editSaving ? "Salvando..." : "Salvar alterações"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Reagendar lembrete de agenda ─────────────────────────────── */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Reagendar lembrete de agenda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nova data e hora (horário de Brasília)</Label>
              <Input type="datetime-local" value={rescheduleAt} onChange={e => setRescheduleAt(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">O lembrete será reenviado no novo horário.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRescheduleOpen(false)}>Cancelar</Button>
              <Button onClick={handleAgendaReschedule} disabled={rescheduleSaving} className="flex-1">{rescheduleSaving ? "Reagendando..." : "Reagendar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Novo evento + lembrete de agenda ──────────────────────────── */}
      <Dialog open={agendaOpen} onOpenChange={v => {
        setAgendaOpen(v);
        if (!v) {
          setAgendaTitle(""); setAgendaDate(""); setAgendaTime(""); setAgendaEndTime("");
          setAgendaEventType("reuniao"); setAgendaReminderMinutes("30"); setAgendaDesc("");
        }
      }}>
        <DialogContent className="bg-card border-border max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-400">
              <Calendar className="h-4 w-4" /> Novo evento + lembrete de agenda
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground bg-orange-500/5 border border-orange-500/20 rounded-md p-3">
              Cria o evento na sua agenda e um lembrete automático no WhatsApp antes do horário.
              Se o Google Calendar estiver conectado, o link do Meet é gerado automaticamente.
            </p>
            <div className="space-y-2">
              <Label>Título do evento <span className="text-destructive">*</span></Label>
              <Input
                value={agendaTitle}
                onChange={e => setAgendaTitle(e.target.value)}
                placeholder="Ex: Reunião com cliente, Consulta médica..."
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de evento</Label>
              <Select value={agendaEventType} onValueChange={setAgendaEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data <span className="text-destructive">*</span></Label>
                <Input type="date" value={agendaDate} onChange={e => setAgendaDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Horário de início</Label>
                <Input type="time" value={agendaTime} onChange={e => setAgendaTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Horário de término (opcional)</Label>
              <Input type="time" value={agendaEndTime} onChange={e => setAgendaEndTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Lembrete via WhatsApp</Label>
              <Select value={agendaReminderMinutes} onValueChange={setAgendaReminderMinutes}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição / observações (opcional)</Label>
              <Textarea
                value={agendaDesc}
                onChange={e => setAgendaDesc(e.target.value)}
                placeholder="Detalhes, pauta, endereço..."
                rows={2}
              />
            </div>
            <div className="flex items-start gap-2 bg-muted/30 rounded-md p-3 border border-border">
              <CalendarCheck className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Google Meet:</strong> gerado automaticamente quando o Google Calendar está conectado em Integrações.
              </p>
            </div>
            <Button
              onClick={handleCreateAgenda}
              disabled={agendaSaving}
              className="w-full bg-orange-600 hover:bg-orange-700"
            >
              {agendaSaving ? "Criando..." : "Criar evento e lembrete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Nova mensagem agendada ────────────────────────────────────── */}
      <Dialog open={msgOpen} onOpenChange={v => {
        setMsgOpen(v);
        if (!v) {
          setSelectedContact(null); setContactSearch("");
          setMsgContent(""); setMsgSendAt("");
        }
      }}>
        <DialogContent className="bg-card border-border max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-400">
              <MessageSquare className="h-4 w-4" /> Nova mensagem agendada
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground bg-indigo-500/5 border border-indigo-500/20 rounded-md p-3">
              O Jarvis envia a mensagem para o contato no horário escolhido, com apresentação profissional automática.
            </p>

            {/* Busca de contato */}
            <div className="space-y-2">
              <Label>Contato destinatário <span className="text-destructive">*</span></Label>
              {selectedContact ? (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-indigo-400" />
                    <div>
                      <p className="text-sm font-medium">{selectedContact.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedContact.phone}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setSelectedContact(null); setContactSearch(""); }}
                  >
                    Trocar
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={contactSearch}
                      onChange={e => setContactSearch(e.target.value)}
                      placeholder="Buscar contato por nome ou número..."
                      className="pl-9"
                    />
                  </div>
                  {contacts.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 text-center py-2">
                      Nenhum contato encontrado. Adicione contatos no menu Contatos.
                    </p>
                  )}
                  {contacts.length > 0 && filteredContacts.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 text-center py-2">
                      Nenhum contato com "{contactSearch}"
                    </p>
                  )}
                  {filteredContacts.length > 0 && (
                    <div className="border border-border rounded-md overflow-hidden max-h-40 overflow-y-auto">
                      {filteredContacts.map(c => (
                        <button
                          key={c.id}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left border-b border-border/50 last:border-0"
                          onClick={() => { setSelectedContact(c); setContactSearch(""); }}
                        >
                          <div className="w-7 h-7 rounded-full bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                            <User className="h-3.5 w-3.5 text-indigo-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mensagem */}
            <div className="space-y-2">
              <Label>Mensagem <span className="text-destructive">*</span></Label>
              <Textarea
                value={msgContent}
                onChange={e => setMsgContent(e.target.value)}
                placeholder="Ex: Que amanhã estaremos online às 10h para a reunião."
                rows={3}
              />
              <p className="text-xs text-muted-foreground/60">
                O Jarvis adiciona apresentação e assinatura automaticamente.
              </p>
            </div>

            {/* Horário de envio */}
            <div className="space-y-2">
              <Label>Quando enviar (horário de Brasília) <span className="text-destructive">*</span></Label>
              <Input type="datetime-local" value={msgSendAt} onChange={e => setMsgSendAt(e.target.value)} />
            </div>

            {/* Preview da mensagem */}
            {selectedContact && msgContent.trim() && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Prévia da mensagem:</p>
                <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {`${buildGreeting()}, *${selectedContact.name.split(" ")[0]}*! 👋\n\nAqui é o *Jarvis*, assistente virtual.\n\nSeu contato me pediu para te passar um recado:\n\n💬 _"${msgContent.trim()}"_\n\n——————————————\n_Mensagem enviada via Jarvis_ 🤖`}
                </div>
              </div>
            )}

            <Button
              onClick={handleCreateMessage}
              disabled={msgSaving || !selectedContact}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {msgSaving ? "Agendando..." : "Agendar mensagem"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 3 abas principais ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        <Button variant={mainTab === "reminders" ? "default" : "outline"} size="sm" onClick={() => setMainTab("reminders")} className="gap-1.5">
          <Bell className="h-3.5 w-3.5" />
          Lembretes
          {regPending > 0 && <Badge className="ml-0.5 text-[10px] h-4 px-1">{regPending}</Badge>}
        </Button>
        <Button
          variant={mainTab === "agenda" ? "default" : "outline"} size="sm" onClick={() => setMainTab("agenda")}
          className={`gap-1.5 ${mainTab !== "agenda" ? "border-orange-500/40 text-orange-400 hover:border-orange-500 hover:text-orange-300" : ""}`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Lembretes de Agenda
          {agendaPending > 0 && <Badge className="ml-0.5 text-[10px] h-4 px-1 bg-orange-500">{agendaPending}</Badge>}
        </Button>
        <Button
          variant={mainTab === "message" ? "default" : "outline"} size="sm" onClick={() => setMainTab("message")}
          className={`gap-1.5 ${mainTab !== "message" ? "border-indigo-500/40 text-indigo-400 hover:border-indigo-500 hover:text-indigo-300" : ""}`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Lembretes de Mensagem
          {msgPending > 0 && <Badge className="ml-0.5 text-[10px] h-4 px-1 bg-indigo-500">{msgPending}</Badge>}
        </Button>
      </div>

      {/* ── Sub-abas ──────────────────────────────────────────────────────────── */}
      {mainTab === "reminders" && (
        <div className="flex gap-2 flex-wrap pl-3 border-l-2 border-primary/30">
          {(["pending", "recurring", "all", "sent"] as RegularSub[]).map(sf => (
            <Button key={sf} variant={regularSub === sf ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setRegularSub(sf)}>
              {sf === "all" && "Todos"}
              {sf === "pending" && <>Pendentes {regPending > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1">{regPending}</Badge>}</>}
              {sf === "recurring" && <>Recorrentes {regRecurring > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1 bg-violet-500">{regRecurring}</Badge>}</>}
              {sf === "sent" && <>Enviados {regSent > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1 bg-green-600">{regSent}</Badge>}</>}
            </Button>
          ))}
        </div>
      )}
      {mainTab === "agenda" && (
        <div className="flex gap-2 flex-wrap pl-3 border-l-2 border-orange-500/30">
          {(["pending", "done", "all", "sent"] as AgendaSub[]).map(sf => (
            <Button key={sf} variant={agendaSub === sf ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setAgendaSub(sf)}>
              {sf === "all" && "Todos"}
              {sf === "pending" && <>Pendentes {agendaPending > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1">{agendaPending}</Badge>}</>}
              {sf === "sent" && "Enviados"}
              {sf === "done" && "Concluídos"}
            </Button>
          ))}
        </div>
      )}
      {mainTab === "message" && (
        <div className="flex gap-2 flex-wrap pl-3 border-l-2 border-indigo-500/30">
          {(["pending", "all", "sent"] as MessageSub[]).map(sf => (
            <Button key={sf} variant={messageSub === sf ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setMessageSub(sf)}>
              {sf === "all" && "Todos"}
              {sf === "pending" && <>Pendentes {msgPending > 0 && <Badge className="ml-1 text-[10px] h-3.5 px-1">{msgPending}</Badge>}</>}
              {sf === "sent" && "Enviados"}
            </Button>
          ))}
        </div>
      )}

      {/* ── Conteúdo: Lembretes regulares ─────────────────────────────────────── */}
      {mainTab === "reminders" && (
        filteredRegular.length === 0
          ? renderEmptyState(
              <Bell className="h-10 w-10" />,
              regularSub === "pending" ? "Nenhum lembrete pendente." :
              regularSub === "sent" ? "Nenhum lembrete enviado ainda." :
              regularSub === "recurring" ? "Nenhum lembrete recorrente." : "Nenhum lembrete ainda.",
              regularSub === "pending" ? 'Crie um acima ou mande no WhatsApp: "me lembra de X às 10h"' :
              regularSub === "sent" ? "Os lembretes enviados aparecerão aqui após o disparo pelo Jarvis." :
              regularSub === "recurring" ? 'Ex: "me lembra todo dia 10 de pagar aluguel"' :
              'Crie um acima ou mande no WhatsApp: "me lembra de X às 10h"'
            )
          : (
            <div className="space-y-2">
              {regularSub === "sent" && filteredRegular.length > 0 && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60" onClick={handleClearSent}>
                    <Trash2 className="h-3.5 w-3.5" />Limpar todos enviados
                  </Button>
                </div>
              )}
              {regularSub === "pending"
                ? (() => {
                    const groups: Record<string, Reminder[]> = {};
                    for (const r of filteredRegular) {
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
                              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{groups[groupName].length}</Badge>
                              <div className="flex-1 h-px bg-border/50" />
                            </div>
                            {groups[groupName].map(r => renderRegularCard(r))}
                          </div>
                        ))}
                      </div>
                    );
                  })()
                : <>{filteredRegular.map(r => renderRegularCard(r))}</>
              }
            </div>
          )
      )}

      {/* ── Conteúdo: Lembretes de Agenda ─────────────────────────────────────── */}
      {mainTab === "agenda" && (
        filteredAgenda.length === 0
          ? renderEmptyState(
              <Calendar className="h-10 w-10" />,
              agendaSub === "pending" ? "Nenhum lembrete de agenda pendente." :
              agendaSub === "sent" ? "Nenhum lembrete de agenda enviado." :
              agendaSub === "done" ? "Nenhum evento concluído." : "Nenhum lembrete de agenda.",
              agendaSub === "done"
                ? 'Clique em "Sim, aconteceu" nos lembretes enviados para confirmá-los aqui.'
                : "Os lembretes gerados a partir de eventos da sua agenda aparecerão aqui."
            )
          : <div className="space-y-2">{filteredAgenda.map(r => renderAgendaCard(r))}</div>
      )}

      {/* ── Conteúdo: Lembretes de Mensagem ───────────────────────────────────── */}
      {mainTab === "message" && (
        filteredMessage.length === 0
          ? renderEmptyState(
              <MessageSquare className="h-10 w-10" />,
              messageSub === "pending" ? "Nenhuma mensagem agendada pendente." :
              messageSub === "sent" ? "Nenhuma mensagem enviada ainda." : "Nenhum lembrete de mensagem.",
              'Clique em "Nova mensagem agendada" para agendar uma mensagem para um contato.'
            )
          : <div className="space-y-2">{filteredMessage.map(r => renderMessageCard(r))}</div>
      )}
    </div>
  );
}
