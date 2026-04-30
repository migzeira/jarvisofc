import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import {
  Wallet, CalendarDays, StickyNote, Settings, BarChart3, Link2,
  TrendingDown, TrendingUp, Bell, BellRing, Plus, ChevronRight,
  MessageSquare, Clock, Zap, Smartphone, AlertTriangle, XCircle, ExternalLink,
  X, Lock, CheckCircle,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { PlanCTAButtons } from "@/components/PlanCTAButtons";
import { toast } from "sonner";
import { format, subDays, startOfMonth, endOfMonth, endOfWeek, isToday, isTomorrow, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─────────────────────────────────────────────
// Quick actions
// ─────────────────────────────────────────────
const QUICK_ACTIONS = [
  {
    icon: Wallet,
    label: "Finanças",
    desc: "Ver gastos e receitas",
    to: "/dashboard/financas",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  {
    icon: CalendarDays,
    label: "Agenda",
    desc: "Compromissos e eventos",
    to: "/dashboard/agenda",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  {
    icon: StickyNote,
    label: "Anotações",
    desc: "Ideias e informações",
    to: "/dashboard/anotacoes",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: Zap,
    label: "Habitos",
    desc: "Rastrear sua rotina",
    to: "/dashboard/habitos",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
  },
  {
    icon: Settings,
    label: "Configurar Agente",
    desc: "Personalizar o Jarvis",
    to: "/dashboard/agente",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatReminderTime(sendAt: string) {
  const d = new Date(sendAt);
  if (isToday(d)) return `Hoje às ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `Amanhã às ${format(d, "HH:mm")}`;
  return format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
}

function activityIcon(type: string) {
  if (type === "transaction") return <Wallet className="h-3.5 w-3.5" />;
  if (type === "event") return <CalendarDays className="h-3.5 w-3.5" />;
  if (type === "note") return <StickyNote className="h-3.5 w-3.5" />;
  if (type === "reminder") return <Bell className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

function activityColor(type: string) {
  if (type === "transaction") return "bg-emerald-500/15 text-emerald-400";
  if (type === "event") return "bg-blue-500/15 text-blue-400";
  if (type === "note") return "bg-amber-500/15 text-amber-400";
  if (type === "reminder") return "bg-violet-500/15 text-violet-400";
  return "bg-accent text-muted-foreground";
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function DashboardHome() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [stats, setStats] = useState({ expenses: 0, incomes: 0, events: 0, notes: 0, reminders: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartPeriod, setChartPeriod] = useState<7 | 15 | 30>(7);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [pendingReminders, setPendingReminders] = useState<any[]>([]);
  const [recentNotes, setRecentNotes] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);


  // Banner dismiss state (session-only — reset no reload)
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set());
  const dismissBanner = (key: string) => setDismissedBanners(prev => new Set([...prev, key]));

  // Onboarding widget dismissal (persist em localStorage)
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(
    () => typeof window !== "undefined" && !!localStorage.getItem("jarvis_onboarding_dismissed_v1")
  );
  const dismissOnboarding = () => {
    localStorage.setItem("jarvis_onboarding_dismissed_v1", "1");
    setOnboardingDismissed(true);
  };

  // Dismiss persistente do banner "Liberado pelo admin" — tem que ser declarado AQUI
  // (antes de qualquer early return) senão viola Rules of Hooks e quebra o dashboard.
  // A chave é derivada do access_until pra que um novo período reapresente o banner.
  const [adminBannerDismissed, setAdminBannerDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  // Gráfico de gastos — refetch quando o período muda (7/15/30 dias)
  useEffect(() => {
    if (!user) return;
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chartPeriod]);

  const loadChart = async () => {
    const now = new Date();
    const { data } = await supabase
      .from("transactions")
      .select("amount, transaction_date")
      .eq("user_id", user!.id)
      .eq("type", "expense")
      .gte("transaction_date", format(subDays(now, chartPeriod - 1), "yyyy-MM-dd"))
      .order("transaction_date");

    const dailyTotals: Record<string, number> = {};
    for (let i = chartPeriod - 1; i >= 0; i--) {
      dailyTotals[format(subDays(now, i), "yyyy-MM-dd")] = 0;
    }
    data?.forEach((t: any) => {
      if (dailyTotals[t.transaction_date] !== undefined) {
        dailyTotals[t.transaction_date] += Number(t.amount);
      }
    });

    const dateFormat = chartPeriod <= 7 ? "EEE" : "dd/MM";
    setChartData(
      Object.entries(dailyTotals).map(([date, total]) => ({
        date: format(new Date(date + "T12:00:00"), dateFormat, { locale: ptBR }),
        total,
      }))
    );
  };

  // Sincroniza adminBannerDismissed com localStorage sempre que o access_until muda.
  // access_until vem do profile carregado em loadData — por isso depende de [profile].
  useEffect(() => {
    if (typeof window === "undefined") return;
    const au = profile?.access_until;
    if (!au) { setAdminBannerDismissed(false); return; }
    const key = `jarvis_admin_banner_dismissed_v1:${new Date(au).toISOString()}`;
    setAdminBannerDismissed(!!localStorage.getItem(key));
  }, [profile?.access_until]);

  const loadData = async () => {
    const now = new Date();
    const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
    const weekEnd = format(endOfWeek(now, { locale: ptBR }), "yyyy-MM-dd");
    const nowIso = now.toISOString();

    const [
      profileRes, agentRes, expensesRes, incomesRes, eventsRes, notesCountRes,
      upcomingRes, remindersRes, recentNotesRes,
      recentTransRes, recentEventsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user!.id).single(),
      supabase.from("agent_configs").select("*").eq("user_id", user!.id).single(),
      supabase.from("transactions").select("amount").eq("user_id", user!.id).eq("type", "expense").gte("transaction_date", monthStart).lte("transaction_date", monthEnd),
      supabase.from("transactions").select("amount").eq("user_id", user!.id).eq("type", "income").gte("transaction_date", monthStart).lte("transaction_date", monthEnd),
      supabase.from("events").select("id").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).lte("event_date", weekEnd),
      // Usa count head pra pegar só o total de notas (sem carregar os IDs).
      // Economiza payload quando user tem centenas de notas.
      supabase.from("notes").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
      // Próximos eventos — busca 10 e filtra eventos do dia cuja hora já passou
      supabase.from("events").select("*").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).order("event_date").order("event_time").limit(10),
      // Pending reminders — exclui habits (que têm card próprio) e followups de evento (duplicam "Próximos")
      supabase.from("reminders").select("id, title, send_at, message, source, event_id, habit_id").eq("user_id", user!.id).eq("status", "pending").gte("send_at", nowIso).neq("source", "habit").is("habit_id", null).order("send_at").limit(10),
      // Recent notes (last 3)
      supabase.from("notes").select("id, title, content, created_at, source").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(3),
      // For activity feed
      supabase.from("transactions").select("id, description, amount, type, created_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("events").select("id, title, event_date, created_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(4),
    ]);

    setProfile(profileRes.data);
    setAgentConfig(agentRes.data);

    const reminderCount = remindersRes.data?.length ?? 0;
    setStats({
      expenses: expensesRes.data?.reduce((s, t) => s + Number(t.amount), 0) ?? 0,
      incomes: incomesRes.data?.reduce((s, t) => s + Number(t.amount), 0) ?? 0,
      events: eventsRes.data?.length ?? 0,
      // notesCountRes usa { count: 'exact', head: true } → lê do campo .count
      notes: (notesCountRes as any).count ?? 0,
      reminders: reminderCount,
    });

    // Próximos — filtra eventos de hoje cuja hora já passou.
    // All-day events (event_time null) ficam visíveis o dia todo.
    const todayStr = format(now, "yyyy-MM-dd");
    const filteredUpcoming = (upcomingRes.data ?? []).filter((e: any) => {
      if (e.event_date > todayStr) return true;
      if (e.event_date < todayStr) return false;
      if (!e.event_time) return true;
      const [h, m] = String(e.event_time).split(":").map(Number);
      const evDt = new Date(now);
      evDt.setHours(h || 0, m || 0, 0, 0);
      return evDt.getTime() > now.getTime();
    }).slice(0, 3);

    // Lembretes card — mostra só lembretes "puros" do usuário.
    // Exclui habits (têm card próprio), event_followup e reminders ligados a evento
    // (já aparecem em "Próximos" — duplicaria).
    const filteredReminders = (remindersRes.data ?? []).filter((r: any) => {
      if (r.source === "habit") return false;
      if (r.habit_id) return false;
      if (r.source === "event" || r.source === "event_followup") return false;
      if (r.event_id) return false;
      return true;
    }).slice(0, 3);

    setUpcomingEvents(filteredUpcoming);
    setPendingReminders(filteredReminders);
    setRecentNotes(recentNotesRes.data ?? []);

    // Build activity feed — merge transactions + events, sort by created_at, take 5
    const activities = [
      ...(recentTransRes.data ?? []).map((t: any) => ({
        type: "transaction",
        label: t.description || (t.type === "expense" ? "Gasto registrado" : "Receita registrada"),
        sub: `R$ ${Number(t.amount).toFixed(2)}`,
        time: t.created_at,
      })),
      ...(recentEventsRes.data ?? []).map((e: any) => ({
        type: "event",
        label: e.title,
        sub: format(new Date(e.event_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR }),
        time: e.created_at,
      })),
      ...(recentNotesRes.data ?? []).map((n: any) => ({
        type: "note",
        label: n.title || "Anotação",
        sub: n.content?.slice(0, 40) || "",
        time: n.created_at,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);

    setRecentActivity(activities);

    // Chart é carregado pelo useEffect separado de chartPeriod (loadChart).

    setLoading(false);
  };

  const toggleAgent = async () => {
    if (!agentConfig) return;
    const { error } = await supabase
      .from("agent_configs")
      .update({ is_active: !agentConfig.is_active })
      .eq("user_id", user!.id);
    if (error) toast.error("Erro ao atualizar status");
    else {
      setAgentConfig({ ...agentConfig, is_active: !agentConfig.is_active });
      toast.success(agentConfig.is_active ? "Agente desativado" : "Agente ativado");
    }
  };

  // ─── Loading skeleton ───────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-56 lg:col-span-2 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      </div>
    );
  }

  const phoneSet = !!profile?.phone_number;
  const whatsappLinked = !!profile?.whatsapp_lid || phoneSet;
  const showOnboarding = !phoneSet || !whatsappLinked || profile?.messages_used === 0;

  // ── Subscription status helpers ───────────────
  const accountStatus = profile?.account_status;
  const accessUntil = profile?.access_until ? new Date(profile.access_until) : null;
  const accessSource = profile?.access_source as string | null;
  const isSuspended = accountStatus === "suspended";
  const isPending = accountStatus === "pending";
  // "Assinatura cancelada" SÓ aparece se Kirvano enviou webhook de cancelamento
  const subscriptionCancelledAt = profile?.subscription_cancelled_at ? new Date(profile.subscription_cancelled_at) : null;
  const isCancelling = accountStatus === "active" && !!subscriptionCancelledAt && accessUntil && accessUntil > new Date();
  // "Liberado pelo admin" — quando admin ativou com período (sem cancelamento Kirvano)
  const isAdminGranted = accountStatus === "active"
    && !subscriptionCancelledAt
    && (accessSource === "admin_trial" || accessSource === "admin_plan")
    && accessUntil && accessUntil > new Date();
  const isExpired = accountStatus === "active" && accessUntil && accessUntil <= new Date();
  const daysLeft = accessUntil ? Math.max(0, Math.ceil((accessUntil.getTime() - Date.now()) / 86400000)) : null;

  // Dismiss persistente do banner "Liberado pelo admin" — chave inclui access_until
  // para que um novo período/renovação reapresente o banner.
  // NOTA: o useState/useEffect deste banner está declarado no TOPO do componente
  // (antes do early return do loading) pra não violar Rules of Hooks.
  const adminBannerKey = accessUntil ? `jarvis_admin_banner_dismissed_v1:${accessUntil.toISOString()}` : null;
  const dismissAdminBanner = () => {
    if (adminBannerKey) {
      localStorage.setItem(adminBannerKey, "1");
      setAdminBannerDismissed(true);
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Subscription status banners (com X pra fechar até reload) ── */}
      {isSuspended && !dismissedBanners.has("suspended") && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">
          <XCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Acesso suspenso</p>
            <p className="text-xs text-red-400 mt-0.5">Sua conta foi suspensa por estorno ou reembolso. Renove para reativar o assistente.</p>
          </div>
          <a href="https://heyjarvis.com.br" target="_blank" rel="noopener noreferrer" className="shrink-0 mr-2">
            <button className="text-xs font-medium bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
          <button
            onClick={() => dismissBanner("suspended")}
            aria-label="Fechar aviso"
            className="shrink-0 p-1 rounded-md hover:bg-red-500/20 text-red-300/70 hover:text-red-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isPending && !dismissedBanners.has("pending") && (
        <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3 relative">
          <button
            onClick={() => dismissBanner("pending")}
            aria-label="Fechar aviso"
            className="absolute top-2 right-2 p-1 rounded-md hover:bg-violet-500/20 text-violet-300/70 hover:text-violet-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0 pr-6 sm:pr-0">
            <Lock className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Assine um plano para começar</p>
              <p className="text-xs text-violet-300/80 mt-0.5">Sua conta está sem plano ativo. Assine para cadastrar seu WhatsApp e usar o Jarvis.</p>
            </div>
          </div>
          <PlanCTAButtons className="sm:shrink-0 sm:mr-6" />
        </div>
      )}

      {/* ── Admin liberou acesso (período teste ou plano) ── */}
      {isAdminGranted && daysLeft !== null && !adminBannerDismissed && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {accessSource === "admin_trial" ? "Período teste liberado pelo admin" : "Plano liberado pelo admin"}
            </p>
            <p className="text-xs text-emerald-300/80 mt-0.5">
              Seu acesso expira {daysLeft === 0 ? "hoje" : `em ${daysLeft} dia${daysLeft > 1 ? "s" : ""}`} —{" "}
              {accessUntil!.toLocaleDateString("pt-BR")}. Aproveite!
            </p>
          </div>
          <button
            onClick={dismissAdminBanner}
            aria-label="Fechar aviso"
            className="shrink-0 p-1 rounded-md hover:bg-emerald-500/20 text-emerald-300/70 hover:text-emerald-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Assinatura cancelada (Kirvano webhook) — só aparece se subscription_cancelled_at estiver setado ── */}
      {isCancelling && daysLeft !== null && !dismissedBanners.has("cancelling") && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Assinatura cancelada</p>
            <p className="text-xs text-yellow-400 mt-0.5">
              Seu acesso expira {daysLeft === 0 ? "hoje" : `em ${daysLeft} dia${daysLeft > 1 ? "s" : ""}`} —{" "}
              {accessUntil!.toLocaleDateString("pt-BR")}. Após essa data o assistente será desativado.
            </p>
          </div>
          <a href="https://heyjarvis.com.br" target="_blank" rel="noopener noreferrer" className="shrink-0 mr-2">
            <button className="text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
          <button
            onClick={() => dismissBanner("cancelling")}
            aria-label="Fechar aviso"
            className="shrink-0 p-1 rounded-md hover:bg-yellow-500/20 text-yellow-300/70 hover:text-yellow-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isExpired && !dismissedBanners.has("expired") && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">
          <XCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Assinatura expirada</p>
            <p className="text-xs text-red-400 mt-0.5">Seu período de acesso chegou ao fim. Renove para voltar a usar o Jarvis.</p>
          </div>
          <a href="https://heyjarvis.com.br" target="_blank" rel="noopener noreferrer" className="shrink-0 mr-2">
            <button className="text-xs font-medium bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
          <button
            onClick={() => dismissBanner("expired")}
            aria-label="Fechar aviso"
            className="shrink-0 p-1 rounded-md hover:bg-red-500/20 text-red-300/70 hover:text-red-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Alerta: agente inativo mas número cadastrado (primeira vez) ── */}
      {/* Mostra quando: tem phone ativo + conta ativa + agente desligado + nunca usou (messages_used=0) */}
      {/* NÃO mostra se: desativou manualmente depois de já ter usado (messages_used > 0) */}
      {phoneSet && accountStatus === "active" && agentConfig?.is_active === false && (profile?.messages_used ?? 0) === 0 && !dismissedBanners.has("agent_inactive") && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Agente desativado</p>
            <p className="text-xs text-amber-300/80 mt-0.5">
              O agente está desligado. Ative o toggle abaixo pra que o Jarvis volte a responder no seu WhatsApp.
            </p>
          </div>
          <button
            onClick={() => dismissBanner("agent_inactive")}
            aria-label="Fechar aviso"
            className="shrink-0 p-1 rounded-md hover:bg-amber-500/20 text-amber-300/70 hover:text-amber-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Onboarding banner (novos usuários) ── */}
      {showOnboarding && !onboardingDismissed && (
        <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-500/20 relative">
          <button
            onClick={dismissOnboarding}
            aria-label="Fechar tutorial"
            className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-violet-500/20 text-violet-300/70 hover:text-violet-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <CardContent className="pt-5 pb-5">
            <h3 className="text-base font-bold mb-3 flex items-center gap-2 pr-8">
              🚀 Configure seu Jarvis em 3 passos
            </h3>
            <div className="space-y-3">
              {[
                {
                  num: 1,
                  done: phoneSet,
                  title: "Cadastre seu WhatsApp",
                  hint: phoneSet ? null : (
                    <>Vá em{" "}
                      <Link to="/dashboard/configuracoes" className="text-violet-400 underline">Configurações</Link>
                      {" "}e salve seu número com DDD</>
                  ),
                },
                {
                  num: 2,
                  done: profile?.messages_used > 0,
                  title: "Converse com o Jarvis no WhatsApp",
                  hint: (profile?.messages_used === 0 && phoneSet)
                    ? "Abra o WhatsApp e mande uma mensagem pro Jarvis — ele já está pronto pra responder!" : null,
                },
                {
                  num: 3,
                  done: profile?.messages_used >= 3,
                  title: "Registre seu primeiro gasto ou compromisso",
                  hint: null,
                },
              ].map(item => (
                <div key={item.num} className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.done ? "bg-green-500 text-white" : "bg-violet-500 text-white"}`}>
                    {item.done ? "✓" : item.num}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${item.done ? "text-green-400 line-through" : "text-foreground"}`}>
                      {item.title}
                    </p>
                    {item.hint && <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Olá, {profile?.display_name || "usuário"}!</h1>
          <div className="flex items-center gap-3 mt-1">
            {/* Phone number */}
            {profile?.phone_number ? (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <Smartphone className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground font-mono">
                  {(() => {
                    // Strip any non-digit characters (e.g. leading "+") before formatting
                    const d = profile.phone_number.replace(/\D/g, "");
                    if (d.startsWith("55") && d.length === 13)
                      return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
                    if (d.startsWith("55") && d.length === 12)
                      return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
                    return `+${d}`;
                  })()}
                </span>
              </div>
            ) : (
              <Link to="/dashboard/perfil" className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors group">
                <Smartphone className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium group-hover:underline">Clique aqui para ativar o Jarvis</span>
              </Link>
            )}

            <span className="text-muted-foreground/40 text-xs">•</span>

            {/* Agent status */}
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${agentConfig?.is_active ? "bg-green-500" : "bg-muted-foreground"}`} />
              <span className="text-xs text-muted-foreground">Agente {agentConfig?.is_active ? "ativo" : "inativo"}</span>
              <Switch checked={agentConfig?.is_active ?? true} onCheckedChange={toggleAgent} className="scale-75 origin-left" />
            </div>
          </div>
        </div>

      </div>

      {/* ── Stats (5 cards: gastos, receitas, compromissos, anotações, lembretes) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Gastos no mês</p>
                <p className="text-2xl font-bold mt-1">R$ {stats.expenses.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Receitas no mês</p>
                <p className="text-2xl font-bold mt-1">R$ {stats.incomes.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Compromissos</p>
                <p className="text-2xl font-bold mt-1">{stats.events}
                  <span className="text-xs text-muted-foreground font-normal ml-1">esta semana</span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Anotações</p>
                <p className="text-2xl font-bold mt-1">{stats.notes}
                  <span className="text-xs text-muted-foreground font-normal ml-1">salvas</span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <StickyNote className="h-5 w-5 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Lembretes</p>
                <p className="text-2xl font-bold mt-1">{stats.reminders}
                  <span className="text-xs text-muted-foreground font-normal ml-1">pendentes</span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <BellRing className="h-5 w-5 text-violet-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Chart + Próximos compromissos ── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-emerald-400" /> Gastos — últimos {chartPeriod} dias
              </span>
              <div className="flex gap-1 text-xs font-medium">
                {([7, 15, 30] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setChartPeriod(p)}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      chartPeriod === p
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {p}d
                  </button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.some(d => d.total > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 10% 18%)" />
                  <XAxis dataKey="date" stroke="hsl(240 5% 65%)" fontSize={12} />
                  <YAxis stroke="hsl(240 5% 65%)" fontSize={12} tickFormatter={v => `R$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(240 12% 7%)", border: "1px solid hsl(240 10% 18%)", borderRadius: "8px", color: "#fff" }}
                    formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Gastos"]}
                  />
                  <Line type="monotone" dataKey="total" stroke="#34d399" strokeWidth={2} dot={{ fill: "#34d399", r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Nenhum gasto registrado nos últimos {chartPeriod} dias.</p>
                <p className="text-xs text-muted-foreground">Diga para o Jarvis: <span className="font-mono text-violet-400">"Gastei 50 reais no mercado"</span></p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-400" /> Próximos</span>
              <Link to="/dashboard/agenda" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Ver todos <ChevronRight className="h-3 w-3" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length > 0 ? (
              <div className="space-y-2">
                {upcomingEvents.map(e => (
                  <div key={e.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex flex-col items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-400 leading-none">
                        {format(new Date(e.event_date + "T12:00:00"), "dd", { locale: ptBR })}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase">
                        {format(new Date(e.event_date + "T12:00:00"), "MMM", { locale: ptBR })}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.event_time?.slice(0, 5) || "Dia todo"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <CalendarDays className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Agenda livre por aqui.</p>
                <p className="text-xs text-muted-foreground">Diga ao Jarvis: <span className="font-mono text-violet-400">"Reunião sexta às 10h"</span></p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Lembretes + Últimas anotações + Atividade recente ── */}
      <div className="grid md:grid-cols-3 gap-6">

        {/* Lembretes pendentes */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Bell className="h-4 w-4 text-violet-400" /> Lembretes</span>
              <Link to="/dashboard/lembretes" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Ver todos <ChevronRight className="h-3 w-3" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingReminders.length > 0 ? (
              <div className="space-y-2">
                {pendingReminders.map(r => (
                  <div key={r.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-accent/30">
                    <div className="h-7 w-7 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-violet-400 mt-0.5">{formatReminderTime(r.send_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <Bell className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Sem lembretes ativos.</p>
                <p className="text-xs text-muted-foreground">Diga: <span className="font-mono text-violet-400">"Me lembra às 15h"</span></p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Últimas anotações */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-amber-400" /> Anotações</span>
              <Link to="/dashboard/anotacoes" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Ver todas <ChevronRight className="h-3 w-3" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentNotes.length > 0 ? (
              <div className="space-y-2">
                {recentNotes.map(n => (
                  <div key={n.id} className="p-2.5 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors">
                    <p className="text-sm font-medium truncate">{n.title || "Sem título"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.content}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <StickyNote className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Nenhuma anotação ainda.</p>
                <p className="text-xs text-muted-foreground">Diga: <span className="font-mono text-violet-400">"Anota: ideia aqui"</span></p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Atividade recente */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Atividade recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="space-y-2">
                {recentActivity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${activityColor(a.type)}`}>
                      {activityIcon(a.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{a.label}</p>
                      {a.sub && <p className="text-xs text-muted-foreground truncate">{a.sub}</p>}
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0 pt-0.5">
                      {formatDistanceToNow(new Date(a.time), { addSuffix: false, locale: ptBR })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <MessageSquare className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Nenhuma atividade ainda.</p>
                <p className="text-xs text-muted-foreground">Comece conversando com o Jarvis no WhatsApp!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Quick actions ── */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Acesso rápido</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map(action => (
            <Link key={action.to} to={action.to}>
              <Card className={`bg-card border-border hover:border-current/30 transition-all hover:-translate-y-0.5 cursor-pointer h-full ${action.border}`}>
                <CardContent className="pt-4 pb-4">
                  <div className={`h-9 w-9 rounded-lg ${action.bg} flex items-center justify-center mb-3`}>
                    <action.icon className={`h-5 w-5 ${action.color}`} />
                  </div>
                  <p className="text-sm font-semibold">{action.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
