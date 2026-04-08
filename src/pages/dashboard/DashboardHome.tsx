import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import {
  Wallet, CalendarDays, StickyNote, Settings, BarChart3, Link2,
  TrendingDown, BookOpen, Bell, BellRing, Plus, ChevronRight,
  MessageSquare, Clock, Zap, Smartphone, AlertTriangle, XCircle, ExternalLink,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { format, subDays, startOfMonth, endOfMonth, endOfWeek, isToday, isTomorrow, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { OnboardingModal } from "@/components/OnboardingModal";

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
    icon: Settings,
    label: "Configurar Agente",
    desc: "Personalizar a Maya",
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
  const [stats, setStats] = useState({ expenses: 0, events: 0, notes: 0, reminders: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [pendingReminders, setPendingReminders] = useState<any[]>([]);
  const [recentNotes, setRecentNotes] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    const now = new Date();
    const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
    const weekEnd = format(endOfWeek(now, { locale: ptBR }), "yyyy-MM-dd");
    const nowIso = now.toISOString();

    const [
      profileRes, agentRes, expensesRes, eventsRes, notesCountRes,
      chartRes, upcomingRes, remindersRes, recentNotesRes,
      recentTransRes, recentEventsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user!.id).single(),
      supabase.from("agent_configs").select("*").eq("user_id", user!.id).single(),
      supabase.from("transactions").select("amount").eq("user_id", user!.id).eq("type", "expense").gte("transaction_date", monthStart).lte("transaction_date", monthEnd),
      supabase.from("events").select("id").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).lte("event_date", weekEnd),
      supabase.from("notes").select("id").eq("user_id", user!.id),
      supabase.from("transactions").select("amount, transaction_date").eq("user_id", user!.id).eq("type", "expense").gte("transaction_date", format(subDays(now, 6), "yyyy-MM-dd")).order("transaction_date"),
      supabase.from("events").select("*").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).order("event_date").order("event_time").limit(3),
      // Pending reminders (next 3)
      supabase.from("reminders").select("id, title, send_at, message").eq("user_id", user!.id).eq("status", "pending").gte("send_at", nowIso).order("send_at").limit(3),
      // Recent notes (last 3)
      supabase.from("notes").select("id, title, content, created_at, category").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(3),
      // For activity feed
      supabase.from("transactions").select("id, description, amount, type, created_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("events").select("id, title, event_date, created_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(4),
    ]);

    setProfile(profileRes.data);
    setAgentConfig(agentRes.data);

    const reminderCount = remindersRes.data?.length ?? 0;
    setStats({
      expenses: expensesRes.data?.reduce((s, t) => s + Number(t.amount), 0) ?? 0,
      events: eventsRes.data?.length ?? 0,
      notes: notesCountRes.data?.length ?? 0,
      reminders: reminderCount,
    });

    setUpcomingEvents(upcomingRes.data ?? []);
    setPendingReminders(remindersRes.data ?? []);
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

    // Chart: last 7 days
    const dailyTotals: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      dailyTotals[format(subDays(now, i), "yyyy-MM-dd")] = 0;
    }
    chartRes.data?.forEach((t: any) => {
      if (dailyTotals[t.transaction_date] !== undefined) {
        dailyTotals[t.transaction_date] += Number(t.amount);
      }
    });
    setChartData(
      Object.entries(dailyTotals).map(([date, total]) => ({
        date: format(new Date(date + "T12:00:00"), "EEE", { locale: ptBR }),
        total,
      }))
    );

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
  const isSuspended = accountStatus === "suspended";
  const isCancelling = accountStatus === "active" && accessUntil && accessUntil > new Date();
  const isExpired = accountStatus === "active" && accessUntil && accessUntil <= new Date();
  const daysLeft = accessUntil ? Math.max(0, Math.ceil((accessUntil.getTime() - Date.now()) / 86400000)) : null;

  return (
    <div className="space-y-6">

      {/* ── Subscription status banner ── */}
      {isSuspended && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">
          <XCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Acesso suspenso</p>
            <p className="text-xs text-red-400 mt-0.5">Sua conta foi suspensa por estorno ou reembolso. Renove para reativar o assistente.</p>
          </div>
          <a href="https://minhamaya.com" target="_blank" rel="noopener noreferrer">
            <button className="shrink-0 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
        </div>
      )}

      {isCancelling && daysLeft !== null && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Assinatura cancelada</p>
            <p className="text-xs text-yellow-400 mt-0.5">
              Seu acesso expira {daysLeft === 0 ? "hoje" : `em ${daysLeft} dia${daysLeft > 1 ? "s" : ""}`} —{" "}
              {accessUntil!.toLocaleDateString("pt-BR")}. Após essa data o assistente será desativado.
            </p>
          </div>
          <a href="https://minhamaya.com" target="_blank" rel="noopener noreferrer">
            <button className="shrink-0 text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
        </div>
      )}

      {isExpired && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">
          <XCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Assinatura expirada</p>
            <p className="text-xs text-red-400 mt-0.5">Seu período de acesso chegou ao fim. Renove para voltar a usar a Maya.</p>
          </div>
          <a href="https://minhamaya.com" target="_blank" rel="noopener noreferrer">
            <button className="shrink-0 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Renovar
            </button>
          </a>
        </div>
      )}

      {/* ── Onboarding banner (novos usuários) ── */}
      {showOnboarding && (
        <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-500/20">
          <CardContent className="pt-5 pb-5">
            <h3 className="text-base font-bold mb-3 flex items-center gap-2">
              🚀 Configure sua Maya em 3 passos
            </h3>
            <div className="space-y-3">
              {[
                {
                  num: 1,
                  done: phoneSet,
                  title: "Cadastre seu WhatsApp",
                  hint: phoneSet ? null : (
                    <>Vá em{" "}
                      <Link to="/dashboard/perfil" className="text-violet-400 underline">Meu Perfil</Link>
                      {" "}e salve seu número com DDD</>
                  ),
                },
                {
                  num: 2,
                  done: profile?.messages_used > 0,
                  title: 'Mande "oi" no WhatsApp da Maya',
                  hint: (profile?.messages_used === 0 && phoneSet)
                    ? "Envie uma mensagem para o número da Maya e ela vai te responder" : null,
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

      {/* ── Mobile header portal: "Como usar a Maya" button ── */}
      {typeof document !== "undefined" && document.getElementById("dashboard-header-actions") &&
        createPortal(
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOnboardingOpen(true)}
            className="sm:hidden gap-1.5 border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 text-xs h-8"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Como usar a Maya
          </Button>,
          document.getElementById("dashboard-header-actions")!
        )
      }

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
                  {profile.phone_number.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4")}
                </span>
              </div>
            ) : (
              <Link to="/dashboard/perfil" className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors">
                <Smartphone className="h-3 w-3 shrink-0" />
                <span className="text-xs">Vincular WhatsApp</span>
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

        {/* Desktop: Como usar a Maya button */}
        <div className="hidden sm:flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOnboardingOpen(true)}
            className="gap-2 border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
          >
            <BookOpen className="h-4 w-4" />
            Como usar a Maya
          </Button>
        </div>
      </div>

      {/* ── Stats (4 cards) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-emerald-400" /> Gastos — últimos 7 dias
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
                <p className="text-muted-foreground text-sm">Nenhum gasto registrado nos últimos 7 dias.</p>
                <p className="text-xs text-muted-foreground">Diga para a Maya: <span className="font-mono text-violet-400">"Gastei 50 reais no mercado"</span></p>
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
                <p className="text-xs text-muted-foreground">Diga à Maya: <span className="font-mono text-violet-400">"Reunião sexta às 10h"</span></p>
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
                <p className="text-xs text-muted-foreground">Comece conversando com a Maya no WhatsApp!</p>
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

      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </div>
  );
}
