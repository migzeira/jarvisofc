import { useEffect, useState, useMemo, useCallback } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Plus,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Trash2,
  Pencil,
  X,
  Check,
  MessageCircle,
  Bell,
  AlertCircle,
  Link as LinkIcon,
} from "lucide-react";
import {
  format,
  isToday,
  isSameDay,
  isSameMonth,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  eachDayOfInterval,
  getHours,
  getMinutes,
  parseISO,
  setHours,
  setMinutes,
  differenceInMinutes,
  isBefore,
  isAfter,
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "month" | "week" | "day";
type EventType = "compromisso" | "reuniao" | "consulta" | "evento" | "tarefa";
type Priority = "baixa" | "media" | "alta";
type EventStatus = "pending" | "done" | "cancelled";

interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  end_time: string | null;
  location: string | null;
  meeting_url: string | null;
  event_type: EventType | null;
  priority: Priority | null;
  color: string | null;
  reminder: boolean;
  reminder_minutes_before: number | null;
  status: EventStatus;
  source: "manual" | "whatsapp";
  google_event_id: string | null;
  created_at: string;
}

interface EventFormData {
  title: string;
  description: string;
  event_date: string;
  event_time: string;
  end_time: string;
  location: string;
  event_type: EventType | "";
  priority: Priority | "";
  color: string;
  reminder: boolean;
  reminder_minutes_before: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  { value: "#3b82f6", label: "Azul" },
  { value: "#8b5cf6", label: "Roxo" },
  { value: "#22c55e", label: "Verde" },
  { value: "#ef4444", label: "Vermelho" },
  { value: "#f97316", label: "Laranja" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#eab308", label: "Amarelo" },
];

const EVENT_TYPE_COLORS: Record<EventType, string> = {
  compromisso: "#3b82f6",
  reuniao: "#8b5cf6",
  consulta: "#22c55e",
  evento: "#f97316",
  tarefa: "#14b8a6",
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  compromisso: "Compromisso",
  reuniao: "Reuniao",
  consulta: "Consulta",
  evento: "Evento",
  tarefa: "Tarefa",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  baixa: "Baixa",
  media: "Media",
  alta: "Alta",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const BUSINESS_HOURS_START = 6;

const emptyForm = (): EventFormData => ({
  title: "",
  description: "",
  event_date: format(new Date(), "yyyy-MM-dd"),
  event_time: "",
  end_time: "",
  location: "",
  event_type: "",
  priority: "",
  color: "",
  reminder: false,
  reminder_minutes_before: 30,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEventColor(event: CalendarEvent): string {
  if (event.color) return event.color;
  if (event.event_type && EVENT_TYPE_COLORS[event.event_type])
    return EVENT_TYPE_COLORS[event.event_type];
  return "#3b82f6";
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatTimeShort(time: string | null): string {
  if (!time) return "";
  return time.slice(0, 5);
}

function getEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dateStr = format(day, "yyyy-MM-dd");
  return events
    .filter((e) => e.event_date === dateStr)
    .sort((a, b) => {
      if (!a.event_time) return -1;
      if (!b.event_time) return 1;
      return a.event_time.localeCompare(b.event_time);
    });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventPill({
  event,
  onClick,
  compact = false,
}: {
  event: CalendarEvent;
  onClick: () => void;
  compact?: boolean;
}) {
  const color = getEventColor(event);
  const isDone = event.status === "done";
  const isCancelled = event.status === "cancelled";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`w-full text-left rounded px-1.5 py-0.5 text-xs truncate transition-opacity hover:opacity-80 ${
        isCancelled ? "opacity-40" : isDone ? "opacity-60" : ""
      }`}
      style={{
        backgroundColor: `${color}20`,
        borderLeft: `3px solid ${color}`,
        color: "inherit",
      }}
      title={event.title}
    >
      <span className={isDone ? "line-through" : ""}>
        {!compact && event.event_time && (
          <span className="font-medium mr-1">
            {formatTimeShort(event.event_time)}
          </span>
        )}
        {event.title}
      </span>
    </button>
  );
}

function TimeSlotEvent({
  event,
  onClick,
}: {
  event: CalendarEvent;
  onClick: () => void;
}) {
  const color = getEventColor(event);
  const isDone = event.status === "done";
  const isCancelled = event.status === "cancelled";

  const startMin = event.event_time ? timeToMinutes(event.event_time) : 0;
  const endMin = event.end_time
    ? timeToMinutes(event.end_time)
    : startMin + 60;
  const duration = Math.max(endMin - startMin, 30);
  const top = ((startMin % 60) / 60) * 64;
  const height = Math.max((duration / 60) * 64, 24);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`absolute left-1 right-1 rounded-md px-2 py-1 text-xs overflow-hidden transition-opacity hover:opacity-90 cursor-pointer z-10 ${
        isCancelled ? "opacity-40" : isDone ? "opacity-60" : ""
      }`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        backgroundColor: `${color}25`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className={`font-medium truncate ${isDone ? "line-through" : ""}`}>
        {event.title}
      </div>
      {height > 30 && (
        <div className="text-muted-foreground truncate">
          {formatTimeShort(event.event_time)}
          {event.end_time && ` - ${formatTimeShort(event.end_time)}`}
        </div>
      )}
      {height > 50 && event.location && (
        <div className="text-muted-foreground/70 truncate flex items-center gap-0.5">
          <MapPin className="h-3 w-3 flex-shrink-0" />
          {event.location}
        </div>
      )}
    </button>
  );
}

function HourGrid({
  day,
  events,
  onEventClick,
  onSlotClick,
}: {
  day: Date;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
  onSlotClick: (date: string, time: string) => void;
}) {
  const dayEvents = getEventsForDay(events, day);
  const timedEvents = dayEvents.filter((e) => e.event_time);
  const allDayEvents = dayEvents.filter((e) => !e.event_time);
  const dateStr = format(day, "yyyy-MM-dd");

  return (
    <div className="flex-1 min-w-0">
      {allDayEvents.length > 0 && (
        <div className="border-b border-border p-1 space-y-0.5">
          {allDayEvents.map((ev) => (
            <EventPill
              key={ev.id}
              event={ev}
              onClick={() => onEventClick(ev)}
              compact
            />
          ))}
        </div>
      )}
      <div className="relative">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="h-16 border-b border-border/50 hover:bg-accent/30 cursor-pointer"
            onClick={() =>
              onSlotClick(dateStr, `${String(hour).padStart(2, "0")}:00`)
            }
          >
            {timedEvents
              .filter((e) => {
                const h = parseInt(e.event_time!.split(":")[0], 10);
                return h === hour;
              })
              .map((ev) => (
                <TimeSlotEvent
                  key={ev.id}
                  event={ev}
                  onClick={() => onEventClick(ev)}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Agenda() {
  const { user, session } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<EventFormData>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Todos os eventos (nativos + Google Calendar)
  const allEvents = useMemo(() => {
    if (!googleConnected) return events;
    // Merge: eventos locais + eventos Google (evita duplicatas por google_event_id)
    const localGoogleIds = new Set(events.filter(e => e.google_event_id).map(e => e.google_event_id));
    const uniqueGoogleEvents = googleEvents.filter(ge => !localGoogleIds.has(ge.google_event_id));
    return [...events, ...uniqueGoogleEvents];
  }, [events, googleEvents, googleConnected]);

  // Responsive: use day view on mobile
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    if (mq.matches) setView("day");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setView("day");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Fetch local events
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Limita a janela de 60 dias atrás até 180 dias à frente + limit defensivo de 500.
    // Sem filtro, um cliente com histórico grande carregava TODOS os eventos
    // (inclusive de anos passados) pro browser. Agenda só mostra month/week/day
    // view, então eventos antigos não precisam estar na memória.
    const minDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const maxDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .gte("event_date", minDate)
      .lte("event_date", maxDate)
      .order("event_date")
      .order("event_time")
      .limit(500);
    if (error) {
      toast.error("Erro ao carregar eventos");
    }
    setEvents((data as unknown as CalendarEvent[]) ?? []);
    setLoading(false);
  }, [user]);

  // Fetch Google Calendar events
  const loadGoogleEvents = useCallback(async () => {
    if (!user || !session?.access_token) return;
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "https://fnilyapvhhygfzcdxqjm.supabase.co");
      // Range: 60 dias atras ate 90 dias a frente
      const timeMin = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `${supabaseUrl}/functions/v1/google-calendar-events?timeMin=${timeMin}&timeMax=${timeMax}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const json = await res.json();
      setGoogleConnected(!!json.connected);
      setGoogleEmail(json.email || null);
      if (json.connected && Array.isArray(json.events)) {
        setGoogleEvents(json.events as CalendarEvent[]);
      } else {
        setGoogleEvents([]);
      }
    } catch {
      // Silenciosamente falha — mostra agenda nativa
      setGoogleConnected(false);
      setGoogleEvents([]);
    }
  }, [user, session]);

  useEffect(() => {
    if (user) {
      loadData();
      loadGoogleEvents();
    }
  }, [user, loadData, loadGoogleEvents]);

  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(
    ["events", "reminders"],
    user?.id,
    () => { loadData(); triggerLive(); }
  );

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goToday = () => setCurrentDate(new Date());

  const goPrev = () => {
    if (view === "month") setCurrentDate((d) => subMonths(d, 1));
    else if (view === "week") setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => subDays(d, 1));
  };

  const goNext = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else if (view === "week") setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addDays(d, 1));
  };

  const headerLabel = useMemo(() => {
    if (view === "month")
      return format(currentDate, "MMMM yyyy", { locale: ptBR });
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      if (isSameMonth(ws, we)) {
        return `${format(ws, "d")} - ${format(we, "d 'de' MMMM yyyy", { locale: ptBR })}`;
      }
      return `${format(ws, "d MMM", { locale: ptBR })} - ${format(we, "d MMM yyyy", { locale: ptBR })}`;
    }
    return format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: ptBR });
  }, [view, currentDate]);

  // ---------------------------------------------------------------------------
  // Calendar grid data
  // ---------------------------------------------------------------------------

  const monthDays = useMemo(() => {
    const ms = startOfMonth(currentDate);
    const me = endOfMonth(currentDate);
    const gridStart = startOfWeek(ms, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(me, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: ws, end: addDays(ws, 6) });
  }, [currentDate]);

  // ---------------------------------------------------------------------------
  // Form handlers
  // ---------------------------------------------------------------------------

  const openCreateDialog = (date?: string, time?: string) => {
    setEditingEvent(null);
    setForm({
      ...emptyForm(),
      event_date: date || format(currentDate, "yyyy-MM-dd"),
      event_time: time || "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (event: CalendarEvent) => {
    setEditingEvent(event);
    setForm({
      title: event.title,
      description: event.description || "",
      event_date: event.event_date,
      event_time: event.event_time ? formatTimeShort(event.event_time) : "",
      end_time: event.end_time ? formatTimeShort(event.end_time) : "",
      location: event.location || "",
      event_type: (event.event_type as EventType) || "",
      priority: (event.priority as Priority) || "",
      color: event.color || "",
      reminder: event.reminder,
      reminder_minutes_before: event.reminder_minutes_before || 30,
    });
    setDialogOpen(true);
    setSheetOpen(false);
  };

  const openEventDetail = (event: CalendarEvent) => {
    setDetailEvent(event);
    setSheetOpen(true);
  };

  const handleSlotClick = (date: string, time: string) => {
    openCreateDialog(date, time);
  };

  const handleDayClick = (day: Date) => {
    if (view === "month") {
      setCurrentDate(day);
      setView("day");
    }
  };

  // Sync com Google Calendar (fire-and-forget, nao bloqueia UI)
  const syncGoogle = async (action: "create" | "update" | "delete", data: Record<string, any>) => {
    if (!googleConnected || !session?.access_token) return;
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "https://fnilyapvhhygfzcdxqjm.supabase.co");
      await fetch(`${supabaseUrl}/functions/v1/google-calendar-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, ...data }),
      });
    } catch (err) {
      console.error("Google Calendar sync error:", err);
    }
  };

  // Detecta conflitos de horario com eventos existentes
  const checkConflicts = (date: string, startTime: string, endTime: string | null): CalendarEvent[] => {
    if (!startTime) return [];
    const startMin = timeToMinutes(startTime);
    const endMin = endTime ? timeToMinutes(endTime) : startMin + 60; // assume 1h se nao tiver end_time

    return allEvents.filter(ev => {
      if (ev.event_date !== date) return false;
      if (!ev.event_time) return false;
      if (ev.status === "cancelled") return false;
      if (editingEvent && ev.id === editingEvent.id) return false; // ignora o proprio evento sendo editado

      const evStart = timeToMinutes(ev.event_time);
      const evEnd = ev.end_time ? timeToMinutes(ev.end_time) : evStart + 60;

      // Dois eventos conflitam se um comeca antes do outro terminar
      return startMin < evEnd && endMin > evStart;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Titulo e obrigatorio");
      return;
    }

    // Verifica conflitos
    if (form.event_time) {
      const conflicts = checkConflicts(form.event_date, form.event_time, form.end_time || null);
      if (conflicts.length > 0) {
        const names = conflicts.map(c => `"${c.title}" (${formatTimeShort(c.event_time)})`).join(", ");
        const confirmed = window.confirm(
          `Conflito de horario detectado com: ${names}.\n\nDeseja salvar mesmo assim?`
        );
        if (!confirmed) return;
      }
    }

    setSaving(true);

    const payload: Record<string, any> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_date: form.event_date,
      event_time: form.event_time || null,
      end_time: form.end_time || null,
      location: form.location.trim() || null,
      event_type: form.event_type || null,
      priority: form.priority || null,
      color: form.color || null,
      reminder: form.reminder,
      reminder_minutes_before: form.reminder ? form.reminder_minutes_before : null,
    };

    if (editingEvent) {
      const { error } = await supabase
        .from("events")
        .update(payload)
        .eq("id", editingEvent.id);
      if (error) toast.error("Erro ao atualizar evento");
      else {
        toast.success("Evento atualizado!");
        setDialogOpen(false);
        // Sync com Google Calendar (se conectado e evento tem google_event_id)
        if (editingEvent.google_event_id) {
          syncGoogle("update", { event: { ...payload, google_event_id: editingEvent.google_event_id } });
        }
        loadData();
        loadGoogleEvents();
      }
    } else {
      const { data: inserted, error } = await supabase.from("events").insert({
        ...payload,
        user_id: user!.id,
        source: "manual",
        status: "pending",
      } as any).select("id").single();
      if (error) toast.error("Erro ao criar evento");
      else {
        toast.success("Evento criado!");
        setDialogOpen(false);
        // Sync com Google Calendar (cria evento la tambem)
        if (inserted?.id) {
          syncGoogle("create", { event: payload, eventId: inserted.id });
        }
        loadData();
        loadGoogleEvents();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    // Busca google_event_id antes de deletar
    const eventToDelete = events.find(e => e.id === id);
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Evento excluido!");
      setSheetOpen(false);
      setDetailEvent(null);
      // Sync: remove do Google Calendar tambem
      if (eventToDelete?.google_event_id) {
        syncGoogle("delete", { google_event_id: eventToDelete.google_event_id });
      }
      loadData();
      loadGoogleEvents();
    }
  };

  const toggleStatus = async (event: CalendarEvent) => {
    const next: EventStatus =
      event.status === "done" ? "pending" : "done";
    await supabase.from("events").update({ status: next }).eq("id", event.id);
    toast.success(next === "done" ? "Concluido!" : "Reaberto!");
    loadData();
    if (detailEvent?.id === event.id) {
      setDetailEvent({ ...event, status: next });
    }
  };

  const cancelEvent = async (event: CalendarEvent) => {
    await supabase
      .from("events")
      .update({ status: "cancelled" })
      .eq("id", event.id);
    toast.success("Evento cancelado");
    setSheetOpen(false);
    loadData();
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Month View
  // ---------------------------------------------------------------------------

  const renderMonthView = () => {
    const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

    return (
      <div>
        <div className="grid grid-cols-7 mb-1">
          {dayNames.map((d) => (
            <div
              key={d}
              className="text-center text-xs font-medium text-muted-foreground py-2"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border/50 rounded-lg overflow-hidden">
          {monthDays.map((day) => {
            const dayEvents = getEventsForDay(allEvents, day);
            const inMonth = isSameMonth(day, currentDate);
            const today = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[100px] md:min-h-[120px] p-1.5 cursor-pointer transition-colors hover:bg-accent/50 ${
                  inMonth ? "bg-card" : "bg-card/40"
                } ${today ? "ring-2 ring-primary/50 ring-inset" : ""}`}
                onClick={() => handleDayClick(day)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                      today
                        ? "bg-primary text-primary-foreground"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {dayEvents.length}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <EventPill
                      key={ev.id}
                      event={ev}
                      onClick={() => openEventDetail(ev)}
                      compact
                    />
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-muted-foreground pl-1">
                      +{dayEvents.length - 3} mais
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Week View
  // ---------------------------------------------------------------------------

  const renderWeekView = () => {
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
          <div className="border-r border-border" />
          {weekDays.map((day) => {
            const today = isToday(day);
            return (
              <div
                key={day.toISOString()}
                className={`text-center py-2 border-r border-border last:border-r-0 ${
                  today ? "bg-primary/10" : ""
                }`}
              >
                <div className="text-xs text-muted-foreground">
                  {format(day, "EEE", { locale: ptBR })}
                </div>
                <div
                  className={`text-sm font-semibold w-8 h-8 mx-auto flex items-center justify-center rounded-full ${
                    today ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  {format(day, "d")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <ScrollArea className="h-[600px]">
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {/* Time labels */}
            <div className="border-r border-border">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-16 flex items-start justify-end pr-2 pt-0"
                >
                  <span className="text-[10px] text-muted-foreground -mt-2">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map((day) => {
              const dayEvents = getEventsForDay(allEvents, day);
              const timedEvents = dayEvents.filter((e) => e.event_time);
              const dateStr = format(day, "yyyy-MM-dd");
              const today = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`border-r border-border last:border-r-0 relative ${
                    today ? "bg-primary/5" : ""
                  }`}
                >
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="h-16 border-b border-border/30 hover:bg-accent/20 cursor-pointer"
                      onClick={() =>
                        handleSlotClick(
                          dateStr,
                          `${String(hour).padStart(2, "0")}:00`
                        )
                      }
                    />
                  ))}
                  {/* Positioned events */}
                  {timedEvents.map((ev) => {
                    const startMin = timeToMinutes(ev.event_time!);
                    const endMin = ev.end_time
                      ? timeToMinutes(ev.end_time)
                      : startMin + 60;
                    const dur = Math.max(endMin - startMin, 15);
                    const topPx = (startMin / 60) * 64;
                    const heightPx = Math.max((dur / 60) * 64, 20);
                    const color = getEventColor(ev);
                    const isDone = ev.status === "done";
                    const isCancelled = ev.status === "cancelled";

                    return (
                      <button
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEventDetail(ev);
                        }}
                        className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-[10px] leading-tight overflow-hidden hover:opacity-90 z-10 text-left ${
                          isCancelled
                            ? "opacity-40"
                            : isDone
                              ? "opacity-60"
                              : ""
                        }`}
                        style={{
                          top: `${topPx}px`,
                          height: `${heightPx}px`,
                          backgroundColor: `${color}20`,
                          borderLeft: `2px solid ${color}`,
                        }}
                        title={ev.title}
                      >
                        <span
                          className={`font-medium block truncate ${isDone ? "line-through" : ""}`}
                        >
                          {ev.title}
                        </span>
                        {heightPx > 24 && (
                          <span className="text-muted-foreground block truncate">
                            {formatTimeShort(ev.event_time)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Day View
  // ---------------------------------------------------------------------------

  const renderDayView = () => {
    const dayEvents = getEventsForDay(allEvents, currentDate);
    const timedEvents = dayEvents.filter((e) => e.event_time);
    const allDayEvents = dayEvents.filter((e) => !e.event_time);
    const dateStr = format(currentDate, "yyyy-MM-dd");

    return (
      <div className="border border-border rounded-lg overflow-hidden">
        {/* All-day events */}
        {allDayEvents.length > 0 && (
          <div className="border-b border-border p-2 space-y-1">
            <div className="text-xs text-muted-foreground mb-1">Dia todo</div>
            {allDayEvents.map((ev) => (
              <EventPill
                key={ev.id}
                event={ev}
                onClick={() => openEventDetail(ev)}
              />
            ))}
          </div>
        )}

        {/* Hour grid */}
        <ScrollArea className="h-[600px] md:h-[700px]">
          <div className="relative">
            {HOURS.map((hour) => {
              const hourEvents = timedEvents.filter((e) => {
                const h = parseInt(e.event_time!.split(":")[0], 10);
                return h === hour;
              });

              return (
                <div key={hour} className="flex border-b border-border/30">
                  <div className="w-16 flex-shrink-0 text-right pr-3 pt-1 border-r border-border">
                    <span className="text-xs text-muted-foreground">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  </div>
                  <div
                    className="flex-1 relative h-16 hover:bg-accent/20 cursor-pointer"
                    onClick={() =>
                      handleSlotClick(
                        dateStr,
                        `${String(hour).padStart(2, "0")}:00`
                      )
                    }
                  >
                    {hourEvents.map((ev) => {
                      const startMin = timeToMinutes(ev.event_time!);
                      const endMin = ev.end_time
                        ? timeToMinutes(ev.end_time)
                        : startMin + 60;
                      const dur = Math.max(endMin - startMin, 30);
                      const topPx = ((startMin % 60) / 60) * 64;
                      const heightPx = Math.max((dur / 60) * 64, 28);
                      const color = getEventColor(ev);
                      const isDone = ev.status === "done";
                      const isCancelled = ev.status === "cancelled";

                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEventDetail(ev);
                          }}
                          className={`absolute left-1 right-4 rounded-md px-3 py-1 text-sm overflow-hidden hover:opacity-90 z-10 text-left ${
                            isCancelled
                              ? "opacity-40"
                              : isDone
                                ? "opacity-60"
                                : ""
                          }`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            backgroundColor: `${color}20`,
                            borderLeft: `3px solid ${color}`,
                          }}
                        >
                          <div
                            className={`font-medium truncate ${isDone ? "line-through" : ""}`}
                          >
                            {ev.title}
                          </div>
                          {heightPx > 36 && (
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <span>
                                {formatTimeShort(ev.event_time)}
                                {ev.end_time &&
                                  ` - ${formatTimeShort(ev.end_time)}`}
                              </span>
                              {ev.location && (
                                <span className="flex items-center gap-0.5">
                                  <MapPin className="h-3 w-3" />
                                  {ev.location}
                                </span>
                              )}
                            </div>
                          )}
                          {heightPx > 56 && ev.source === "whatsapp" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 mt-0.5 border-green-600 text-green-500"
                            >
                              <MessageCircle className="h-2.5 w-2.5 mr-0.5" />
                              WhatsApp
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Empty state for day */}
        {dayEvents.length === 0 && (
          <div className="py-16 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">
              Nenhum evento para este dia.
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => openCreateDialog(dateStr)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Criar evento
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Event Form Dialog
  // ---------------------------------------------------------------------------

  const renderEventDialog = () => (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingEvent ? "Editar evento" : "Novo evento"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-title">Titulo *</Label>
            <Input
              id="ev-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Reuniao com cliente"
              required
            />
          </div>

          {/* Date & Times */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">Data</Label>
              <Input
                id="ev-date"
                type="date"
                value={form.event_date}
                onChange={(e) =>
                  setForm({ ...form, event_date: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">Inicio</Label>
              <Input
                id="ev-start"
                type="time"
                value={form.event_time}
                onChange={(e) =>
                  setForm({ ...form, event_time: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-end">Fim</Label>
              <Input
                id="ev-end"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-loc">Local</Label>
            <Input
              id="ev-loc"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Ex: Sala 3, Google Meet, etc."
            />
          </div>

          {/* Type & Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.event_type}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    event_type: v as EventType,
                    color:
                      !form.color && v
                        ? EVENT_TYPE_COLORS[v as EventType] || ""
                        : form.color,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(EVENT_TYPE_LABELS) as EventType[]
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: EVENT_TYPE_COLORS[t] }}
                        />
                        {EVENT_TYPE_LABELS[t]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select
                value={form.priority}
                onValueChange={(v) =>
                  setForm({ ...form, priority: v as Priority })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Color picker */}
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setForm({ ...form, color: c.value })}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    form.color === c.value
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
              {form.color && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, color: "" })}
                  className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Remover cor"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">Descricao</Label>
            <Textarea
              id="ev-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Detalhes do evento..."
              rows={3}
            />
          </div>

          {/* Reminder */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                checked={form.reminder}
                onCheckedChange={(v) => setForm({ ...form, reminder: v })}
              />
              <Label>Lembrete</Label>
            </div>
            {form.reminder && (
              <div className="flex items-center gap-2 pl-1">
                <Select
                  value={String(form.reminder_minutes_before)}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      reminder_minutes_before: parseInt(v, 10),
                    })
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 min</SelectItem>
                    <SelectItem value="10">10 min</SelectItem>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                    <SelectItem value="1440">1 dia</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">antes</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? "Salvando..." : editingEvent ? "Atualizar" : "Criar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  // ---------------------------------------------------------------------------
  // Render: Event Detail Sheet
  // ---------------------------------------------------------------------------

  const renderDetailSheet = () => {
    if (!detailEvent) return null;
    const color = getEventColor(detailEvent);
    const isDone = detailEvent.status === "done";
    const isCancelled = detailEvent.status === "cancelled";
    const eventDate = new Date(detailEvent.event_date + "T12:00:00");

    return (
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="bg-card border-border w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-left flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span
                className={`${isDone ? "line-through text-muted-foreground" : ""} ${isCancelled ? "text-muted-foreground" : ""}`}
              >
                {detailEvent.title}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Status badges */}
            <div className="flex gap-2 flex-wrap">
              {detailEvent.status === "done" && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                  <Check className="h-3 w-3 mr-1" />
                  Concluido
                </Badge>
              )}
              {detailEvent.status === "cancelled" && (
                <Badge variant="destructive">Cancelado</Badge>
              )}
              {detailEvent.status === "pending" && (
                <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
                  Pendente
                </Badge>
              )}
              {detailEvent.source === "whatsapp" && (
                <Badge
                  variant="outline"
                  className="border-green-600 text-green-500"
                >
                  <MessageCircle className="h-3 w-3 mr-1" />
                  WhatsApp
                </Badge>
              )}
              {(detailEvent.source as string) === "google_calendar" && (
                <Badge
                  variant="outline"
                  className="border-blue-500 text-blue-400"
                >
                  Google Calendar
                </Badge>
              )}
              {detailEvent.event_type && (
                <Badge variant="outline">
                  {EVENT_TYPE_LABELS[detailEvent.event_type]}
                </Badge>
              )}
              {detailEvent.priority && (
                <Badge
                  variant="outline"
                  className={
                    detailEvent.priority === "alta"
                      ? "border-red-500/50 text-red-400"
                      : detailEvent.priority === "media"
                        ? "border-yellow-500/50 text-yellow-400"
                        : "border-border"
                  }
                >
                  {detailEvent.priority === "alta" && (
                    <AlertCircle className="h-3 w-3 mr-1" />
                  )}
                  {PRIORITY_LABELS[detailEvent.priority]}
                </Badge>
              )}
            </div>

            {/* Date & Time */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span>
                  {format(eventDate, "EEEE, d 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </span>
              </div>
              {detailEvent.event_time && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {formatTimeShort(detailEvent.event_time)}
                    {detailEvent.end_time &&
                      ` - ${formatTimeShort(detailEvent.end_time)}`}
                  </span>
                </div>
              )}
              {detailEvent.location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{detailEvent.location}</span>
                </div>
              )}
              {detailEvent.meeting_url && (
                <div className="flex items-center gap-2 text-sm">
                  <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={detailEvent.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline truncate"
                  >
                    {detailEvent.meeting_url.includes("meet.google.com")
                      ? "Abrir Google Meet"
                      : detailEvent.meeting_url.includes("zoom.us")
                        ? "Abrir Zoom"
                        : detailEvent.meeting_url.includes("teams")
                          ? "Abrir Teams"
                          : "Abrir reunião"}
                  </a>
                </div>
              )}
              {detailEvent.reminder && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Bell className="h-4 w-4" />
                  <span>
                    Lembrete {detailEvent.reminder_minutes_before || 30} min
                    antes
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            {detailEvent.description && (
              <div className="border-t border-border pt-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {detailEvent.description}
                </p>
              </div>
            )}

            {/* Actions */}
            {(detailEvent.source as string) === "google_calendar" ? (
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted-foreground text-center">
                  Evento do Google Calendar — edite diretamente no Google Calendar
                </p>
              </div>
            ) : (
              <div className="border-t border-border pt-4 space-y-2">
                {detailEvent.status !== "cancelled" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => toggleStatus(detailEvent)}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      {isDone ? "Reabrir" : "Concluir"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => openEditDialog(detailEvent)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Editar
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  {detailEvent.status === "pending" && (
                    <Button
                      variant="outline"
                      className="flex-1 text-yellow-500 hover:text-yellow-400"
                      onClick={() => cancelEvent(detailEvent)}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancelar
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(detailEvent.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Excluir
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  };

  // ---------------------------------------------------------------------------
  // Main Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold flex items-center gap-2">Agenda<LiveBadge isLive={isLive} className="ml-2" /></h1>
          {googleConnected ? (
            <Badge className="bg-success/20 text-success border-success/30 text-[10px] gap-1">
              <span>Google Calendar</span>
              {googleEmail && <span className="opacity-70">({googleEmail})</span>}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] gap-1">
              Agenda nativa
            </Badge>
          )}
        </div>
        <Button onClick={() => openCreateDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          Novo evento
        </Button>
      </div>

      {/* Navigation & View switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Nav controls */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Próximo período" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold capitalize ml-1">
            {headerLabel}
          </h2>
        </div>

        {/* View switcher */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(
            [
              { v: "month" as ViewMode, l: "Mes" },
              { v: "week" as ViewMode, l: "Semana" },
              { v: "day" as ViewMode, l: "Dia" },
            ] as const
          ).map((item) => (
            <button
              key={item.v}
              onClick={() => setView(item.v)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === item.v
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-muted-foreground"
              }`}
            >
              {item.l}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar Views */}
      {view === "month" && renderMonthView()}
      {view === "week" && renderWeekView()}
      {view === "day" && renderDayView()}

      {/* Global empty state */}
      {allEvents.length === 0 && view === "month" && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Sua agenda esta vazia.</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Crie eventos pelo painel ou receba pelo WhatsApp!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {renderEventDialog()}
      {renderDetailSheet()}
    </div>
  );
}
