import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Users, MessageSquare, Settings, Shield, Search, Eye, MessageCircle,
  Clock, CheckCircle, XCircle, RefreshCw, Download, CreditCard, AlertTriangle,
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Webhook, ChevronDown, ChevronUp, Link2, Link2Off,
  Activity, BarChart3, UserCheck, UserX, Send,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ptBR } from "date-fns/locale";
import { Navigate } from "react-router-dom";
import UserDetailModal from "./UserDetailModal";

const SUPABASE_URL = "https://fnilyapvhhygfzcdxqjm.supabase.co";
const PAGE_SIZE = 25;

type DateRange = "today" | "7d" | "30d" | "all";

function getDateFilter(range: DateRange): string | null {
  if (range === "all") return null;
  const days = range === "today" ? 0 : range === "7d" ? 7 : 30;
  return subDays(new Date(), days).toISOString();
}

function exportCSV(data: any[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(","), ...data.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function AdminPanel() {
  const { user, session, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState({
    totalUsers: 0, pendingUsers: 0, whatsappConnected: 0,
    totalRevenue: 0, approvedPayments: 0, errorCount: 0,
  });
  const [profiles, setProfiles] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [kirvanoEvents, setKirvanoEvents] = useState<any[]>([]);

  // Pagination
  const [usersPage, setUsersPage] = useState(0);
  const [convsPage, setConvsPage] = useState(0);
  const [payPage, setPayPage] = useState(0);
  const [errPage, setErrPage] = useState(0);
  const [kirvanoPage, setKirvanoPage] = useState(0);

  // Counts for pagination
  const [userCount, setUserCount] = useState(0);
  const [convCount, setConvCount] = useState(0);
  const [payCount, setPayCount] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [kirvanoCount, setKirvanoCount] = useState(0);

  // Kirvano UI state
  const [kirvanoExpandedId, setKirvanoExpandedId] = useState<string | null>(null);
  const [kirvanoLiveRefresh, setKirvanoLiveRefresh] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState<any>(null);

  // Filters
  const [userSearch, setUserSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [errContextFilter, setErrContextFilter] = useState("all");

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");

  const [settings, setSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Broadcast
  const [broadcastUsers, setBroadcastUsers] = useState<any[]>([]);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastSelected, setBroadcastSelected] = useState<Set<string>>(new Set());
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResults, setBroadcastResults] = useState<{ sent: number; failed: number; skipped: number } | null>(null);

  // Sparkline data
  const [dailyUsers, setDailyUsers] = useState<number[]>([]);

  // Reload on filter/page changes
  useEffect(() => { if (!loading && isAdmin) loadConversations(); }, [convsPage, dateRange]);
  useEffect(() => { if (!loading && isAdmin) loadPayments(); }, [payPage]);
  useEffect(() => { if (!loading && isAdmin) loadErrorLogs(); }, [errPage, errContextFilter]);
  useEffect(() => { if (!loading && isAdmin) loadProfiles(); }, [usersPage]);
  useEffect(() => { if (!loading && isAdmin) loadKirvanoEvents(); }, [kirvanoPage]);

  // Live refresh para Kirvano — atualiza a cada 3s enquanto a aba estiver ativa
  useEffect(() => {
    if (!kirvanoLiveRefresh) return;
    const interval = setInterval(() => loadKirvanoEvents(), 3000);
    return () => clearInterval(interval);
  }, [kirvanoLiveRefresh, kirvanoPage]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const loadData = async () => {
    setLoading(true);
    await Promise.all([
      loadProfiles(), loadConversations(), loadSettings(), loadPayments(), loadErrorLogs(),
      loadKirvanoEvents(), loadAnalytics(),
    ]);
    setLastRefresh(new Date());
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success("Dados atualizados!");
  };

  const loadProfiles = async () => {
    const { data, count, error } = await supabase
      .from("profiles")
      .select("id, display_name, phone_number, whatsapp_lid, created_at, account_status", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(usersPage * PAGE_SIZE, (usersPage + 1) * PAGE_SIZE - 1) as any;
    if (error) {
      console.error("[admin] loadProfiles error:", error);
      toast.error("Erro ao carregar usuários");
      return;
    }
    if (data) {
      setProfiles(data);
      setUserCount(count || 0);

      // Stats from full count - need separate queries for pending
      const { count: totalCount } = await supabase.from("profiles").select("id", { count: "exact", head: true }) as any;
      const { count: pendCount } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("account_status", "pending") as any;
      const { count: waCount } = await supabase.from("profiles").select("id", { count: "exact", head: true }).not("phone_number", "is", null) as any;

      setStats(s => ({
        ...s,
        totalUsers: totalCount || 0,
        pendingUsers: pendCount || 0,
        whatsappConnected: waCount || 0,
      }));

      // Sparkline: users per day last 7 days
      const days: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = subDays(new Date(), i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const { count: dc } = await supabase.from("profiles").select("id", { count: "exact", head: true })
          .gte("created_at", dayStart.toISOString()).lte("created_at", dayEnd.toISOString()) as any;
        days.push(dc || 0);
      }
      setDailyUsers(days);
    }
  };

  const loadConversations = async () => {
    let q = supabase.from("conversations")
      .select("id, user_id, contact_name, whatsapp_lid, phone_number, last_message_at, started_at, message_count", { count: "exact" })
      .order("last_message_at", { ascending: false });
    const df = getDateFilter(dateRange);
    if (df) q = q.gte("started_at", df);
    const { data, count } = await q.range(convsPage * PAGE_SIZE, (convsPage + 1) * PAGE_SIZE - 1) as any;
    if (data) { setConversations(data); setConvCount(count || 0); }
  };

  const loadPayments = async () => {
    const { data, count } = await supabase.from("kirvano_payments")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(payPage * PAGE_SIZE, (payPage + 1) * PAGE_SIZE - 1) as any;
    if (data) {
      setPayments(data);
      setPayCount(count || 0);
      const approved = data.filter((p: any) => p.status === "approved");
      const revenue = approved.reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
      setStats(s => ({ ...s, totalRevenue: revenue, approvedPayments: approved.length }));
    }
  };

  const loadErrorLogs = async () => {
    let q = supabase.from("error_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (errContextFilter !== "all") q = q.eq("context", errContextFilter);
    const { data, count } = await q.range(errPage * PAGE_SIZE, (errPage + 1) * PAGE_SIZE - 1) as any;
    if (data) {
      setErrorLogs(data);
      setErrCount(count || 0);
      setStats(s => ({ ...s, errorCount: count || 0 }));
    }
  };

  const loadKirvanoEvents = async () => {
    const { data, count, error } = await (supabase
      .from("kirvano_events" as any)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(kirvanoPage * PAGE_SIZE, (kirvanoPage + 1) * PAGE_SIZE - 1) as any);
    if (error) {
      console.error("[admin] loadKirvanoEvents error:", error);
      // Não mostra toast aqui porque roda em live refresh — ia spamar
      return;
    }
    if (data) { setKirvanoEvents(data); setKirvanoCount(count || 0); }
  };

  const loadAnalytics = async () => {
    const { data, error } = await (supabase.rpc("get_admin_analytics" as any) as any);
    if (error) {
      console.error("[admin] loadAnalytics error:", error);
      toast.error("Erro ao carregar métricas");
      return;
    }
    if (data) setAnalytics(data);
  };

  const loadSettings = async () => {
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-settings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, { value: string; configured: boolean }> = {};
        data.forEach((s: any) => { map[s.key] = { value: s.value, configured: s.configured }; });
        setSettings(map);
      }
    } catch {}
  };

  // Removido: approveUser/rejectUser — ativação agora é via UserDetailModal (Ativar Mensal/Anual/período).
  // O botão "Gerenciar" na aba "Sem plano" abre o modal com todas as opções de ativação.

  const saveSettings = async () => {
    if (!session) return;
    setSavingSettings(true);
    const body: Record<string, string> = {};
    Object.entries(settingsForm).forEach(([k, v]) => { if (v) body[k] = v; });
    if (Object.keys(body).length === 0) { toast.error("Preencha pelo menos um campo"); setSavingSettings(false); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) { toast.success("Configurações salvas!"); setSettingsForm({}); loadSettings(); }
      else toast.error("Erro ao salvar");
    } catch { toast.error("Erro de rede"); }
    setSavingSettings(false);
  };



  // ── Broadcast helpers ────────────────────────────────────────────────────
  const loadBroadcastUsers = async () => {
    setBroadcastLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, phone_number, account_status")
      .eq("account_status", "active")
      .not("phone_number", "is", null)
      .order("display_name", { ascending: true });
    setBroadcastUsers(data ?? []);
    setBroadcastLoading(false);
  };

  const toggleBroadcastUser = (id: string) => {
    setBroadcastSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (broadcastSelected.size === broadcastUsers.length) {
      setBroadcastSelected(new Set());
    } else {
      setBroadcastSelected(new Set(broadcastUsers.map(u => u.id)));
    }
  };

  const handleBroadcast = async () => {
    if (!session || broadcastSelected.size === 0 || !broadcastMsg.trim()) return;
    setBroadcasting(true);
    setBroadcastResults(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-broadcast`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_ids: Array.from(broadcastSelected), message: broadcastMsg.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setBroadcastResults({ sent: data.sent, failed: data.failed, skipped: data.skipped });
        setBroadcastMsg("");
        setBroadcastSelected(new Set());
        toast.success(`✅ ${data.sent} mensagem(ns) enviada(s)!`);
      } else {
        toast.error(data.error ?? "Erro ao enviar");
      }
    } catch {
      toast.error("Erro de rede");
    }
    setBroadcasting(false);
  };

  const filteredProfiles = profiles.filter(p => {
    const matchSearch = !userSearch || (p.display_name || "").toLowerCase().includes(userSearch.toLowerCase());
    return matchSearch;
  });

  const pendingProfiles = profiles.filter(p => p.account_status === "pending");

  const getUserName = (userId: string) => {
    const p = profiles.find(pr => pr.id === userId);
    return p?.display_name || "—";
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }); } catch { return "—"; }
  };

  const statusBadge = (status: string | null) => {
    if (status === "active") return <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs">Ativa</Badge>;
    if (status === "suspended") return <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">Suspensa</Badge>;
    return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-xs">Pendente</Badge>;
  };

  const payStatusBadge = (status: string) => {
    if (status === "approved") return <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs">Aprovado</Badge>;
    if (status === "refunded") return <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs">Reembolsado</Badge>;
    return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-xs">Pendente</Badge>;
  };

  const timeSince = (d: Date) => {
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}min atrás`;
    return `${Math.floor(mins / 60)}h atrás`;
  };

  const PaginationControls = ({ page, setPage, total }: { page: number; setPage: (p: number) => void; total: number }) => {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Próximo <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const DateFilter = () => (
    <Select value={dateRange} onValueChange={v => { setDateRange(v as DateRange); setConvsPage(0); }}>
      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="today">Hoje</SelectItem>
        <SelectItem value="7d">7 dias</SelectItem>
        <SelectItem value="30d">30 dias</SelectItem>
        <SelectItem value="all">Tudo</SelectItem>
      </SelectContent>
    </Select>
  );

  // Sparkline component
  const Sparkline = ({ data }: { data: number[] }) => {
    const max = Math.max(...data, 1);
    return (
      <div className="flex items-end gap-0.5 h-8">
        {data.map((v, i) => (
          <div
            key={i}
            className="w-2 bg-primary/60 rounded-t transition-all"
            style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
            title={`${v}`}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const SETTINGS_FIELDS = [
    { key: "whatsapp_number", label: "Número WhatsApp da IA", type: "text", hint: "Ex: 5511999999999 — número que os usuários devem chamar" },
    { key: "google_client_id", label: "Google Client ID", type: "text" },
    { key: "google_client_secret", label: "Google Client Secret", type: "password" },
    { key: "notion_client_id", label: "Notion Client ID", type: "text" },
    { key: "notion_client_secret", label: "Notion Client Secret", type: "password" },
    { key: "dashboard_url", label: "URL do Dashboard", type: "text" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => window.location.href = "/dashboard"} className="mr-1">
            <ChevronLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
          <Shield className="h-6 w-6 text-purple-400" />
          <h1 className="text-xl font-bold">Admin Master — Hey Jarvis</h1>
          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">{stats.totalUsers} usuários</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">Atualizado {timeSince(lastRefresh)}</span>
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 p-6">
        <Card><CardContent className="pt-4 text-center">
          <Users className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold">{stats.totalUsers}</p>
          <p className="text-xs text-muted-foreground">Usuários</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Clock className="h-5 w-5 mx-auto text-yellow-400 mb-1" />
          <p className="text-2xl font-bold text-yellow-400">{stats.pendingUsers}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <MessageCircle className="h-5 w-5 mx-auto text-green-400 mb-1" />
          <p className="text-2xl font-bold">{stats.whatsappConnected}</p>
          <p className="text-xs text-muted-foreground">WhatsApp</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <CreditCard className="h-5 w-5 mx-auto text-emerald-400 mb-1" />
          <p className="text-2xl font-bold text-emerald-400">R${stats.totalRevenue.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground">Receita</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <AlertTriangle className="h-5 w-5 mx-auto text-red-400 mb-1" />
          <p className="text-2xl font-bold text-red-400">{stats.errorCount}</p>
          <p className="text-xs text-muted-foreground">Erros</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <TrendingUp className="h-5 w-5 mx-auto text-primary mb-1" />
          <Sparkline data={dailyUsers} />
          <p className="text-xs text-muted-foreground mt-1">Novos 7d</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="px-6 pb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <TabsList>
              <TabsTrigger value="pending" className="relative">
                <Clock className="h-4 w-4 mr-1" />Sem plano
                {stats.pendingUsers > 0 && (
                  <span className="ml-1.5 bg-yellow-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5">{stats.pendingUsers}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" />Usuários</TabsTrigger>
              <TabsTrigger value="conversations"><MessageSquare className="h-4 w-4 mr-1" />Conversas</TabsTrigger>
              <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1" />Pagamentos</TabsTrigger>
              <TabsTrigger value="metricas" onClick={() => loadAnalytics()}>
                <BarChart3 className="h-4 w-4 mr-1" />Métricas
              </TabsTrigger>
              <TabsTrigger value="kirvano" onClick={() => { loadKirvanoEvents(); setKirvanoLiveRefresh(true); }} className="relative">
                <Webhook className="h-4 w-4 mr-1" />Kirvano
                {kirvanoEvents.some((e: any) => !e.matched_user_id) && (
                  <span className="ml-1.5 bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">!</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="errors" onClick={() => setKirvanoLiveRefresh(false)}><AlertTriangle className="h-4 w-4 mr-1" />Erros</TabsTrigger>
              <TabsTrigger value="settings" onClick={() => setKirvanoLiveRefresh(false)}><Settings className="h-4 w-4 mr-1" />Config</TabsTrigger>
              <TabsTrigger value="broadcast" onClick={() => { setKirvanoLiveRefresh(false); loadBroadcastUsers(); }}><Send className="h-4 w-4 mr-1" />Mensagem</TabsTrigger>
            </TabsList>
          </div>

          {/* SEM PLANO (antigo Pendentes) */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-400" /> Contas sem plano ativo
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Usuários que criaram conta mas ainda não têm plano. Clique em Gerenciar para ativar (Mensal, Anual ou período de teste).
                </p>
              </CardHeader>
              <CardContent>
                {pendingProfiles.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhuma conta sem plano no momento.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Nome</TableHead><TableHead>Telefone</TableHead><TableHead>Plano</TableHead><TableHead>Cadastro</TableHead><TableHead>Ações</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {pendingProfiles.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.display_name || "—"}</TableCell>
                          <TableCell className="text-sm font-mono">{p.phone_number || <span className="text-muted-foreground italic">Não informado</span>}</TableCell>
                          <TableCell><Badge variant="secondary">{p.plan}</Badge></TableCell>
                          <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => { setSelectedUserId(p.id); setSelectedUserName(p.display_name || "Usuário"); }}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Gerenciar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* USERS */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por nome..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => exportCSV(filteredProfiles, "usuarios.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Nome</TableHead><TableHead>Telefone</TableHead>
                    <TableHead>Status</TableHead><TableHead>WhatsApp</TableHead><TableHead>Cadastro</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredProfiles.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.display_name || "—"}</TableCell>
                        <TableCell className="text-sm">{p.phone_number || "—"}</TableCell>
                        <TableCell>{statusBadge(p.account_status)}</TableCell>
                        <TableCell>
                          <Badge className={p.whatsapp_lid || p.phone_number ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                            {p.whatsapp_lid || p.phone_number ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => { setSelectedUserId(p.id); setSelectedUserName(p.display_name || "Usuário"); }}>
                            <Eye className="h-4 w-4 mr-1" /> Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredProfiles.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum usuário encontrado</p>}
                <PaginationControls page={usersPage} setPage={setUsersPage} total={userCount} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* CONVERSATIONS */}
          <TabsContent value="conversations">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <DateFilter />
                  <Button size="sm" variant="outline" onClick={() => exportCSV(conversations, "conversas.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Usuário</TableHead><TableHead>Contato</TableHead><TableHead>Telefone</TableHead>
                    <TableHead>Mensagens</TableHead><TableHead>Último</TableHead><TableHead>Início</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {conversations.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>{getUserName(c.user_id)}</TableCell>
                        <TableCell>{c.contact_name || "—"}</TableCell>
                        <TableCell className="text-sm">{c.phone_number}</TableCell>
                        <TableCell>{c.message_count}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.last_message_at)}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.started_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {conversations.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma conversa</p>}
                <PaginationControls page={convsPage} setPage={setConvsPage} total={convCount} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* PAYMENTS */}
          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-emerald-400" /> Pagamentos Kirvano
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => exportCSV(payments, "pagamentos.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Email</TableHead><TableHead>Nome</TableHead>
                    <TableHead>Plano</TableHead><TableHead>Status</TableHead><TableHead>Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {payments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                        <TableCell className="text-sm">{p.email}</TableCell>
                        <TableCell>{p.name || "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{p.plan}</Badge></TableCell>
                        <TableCell>{payStatusBadge(p.status)}</TableCell>
                        <TableCell className="font-medium">R$ {Number(p.amount || 0).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {payments.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pagamento</p>}
                <PaginationControls page={payPage} setPage={setPayPage} total={payCount} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ERROR LOGS */}
          <TabsContent value="errors">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Select value={errContextFilter} onValueChange={v => { setErrContextFilter(v); setErrPage(0); }}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Contexto" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="whatsapp-webhook">WhatsApp Webhook</SelectItem>
                      <SelectItem value="process-recurring">Process Recurring</SelectItem>
                      <SelectItem value="send-reminder">Send Reminder</SelectItem>
                      <SelectItem value="send-report">Send Report</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => exportCSV(errorLogs, "erros.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Contexto</TableHead><TableHead>Mensagem</TableHead><TableHead>Telefone</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {errorLogs.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(e.created_at)}</TableCell>
                        <TableCell><Badge variant="destructive" className="text-xs">{e.context}</Badge></TableCell>
                        <TableCell className="text-sm max-w-md">
                          <p className="truncate">{e.message}</p>
                          {e.stack && <details className="mt-1"><summary className="text-xs text-muted-foreground cursor-pointer">Stack trace</summary><pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">{e.stack}</pre></details>}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{e.phone_number || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {errorLogs.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum erro registrado</p>}
                <PaginationControls page={errPage} setPage={setErrPage} total={errCount} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* MÉTRICAS */}
          <TabsContent value="metricas">
            <div className="space-y-6">

              {/* ── MRR / Assinantes ── */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-5 text-center">
                    <UserCheck className="h-6 w-6 mx-auto text-green-400 mb-2" />
                    <p className="text-3xl font-bold text-green-400">{analytics?.active_subscribers ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">Assinantes ativos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 text-center">
                    <Activity className="h-6 w-6 mx-auto text-blue-400 mb-2" />
                    <p className="text-3xl font-bold">{analytics?.active_today ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">Ativos hoje</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 text-center">
                    <Activity className="h-6 w-6 mx-auto text-violet-400 mb-2" />
                    <p className="text-3xl font-bold">{analytics?.active_week ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">Ativos 7 dias</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 text-center">
                    <Activity className="h-6 w-6 mx-auto text-primary mb-2" />
                    <p className="text-3xl font-bold">{analytics?.active_month ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">Ativos este mês</p>
                  </CardContent>
                </Card>
              </div>

              {/* ── Gráfico mensal ── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Ativações vs Cancelamentos — últimos 6 meses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(!analytics?.monthly_events || analytics.monthly_events.length === 0) ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                      Sem dados suficientes ainda
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.monthly_events} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="period" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Bar dataKey="ativacoes" name="Ativações" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                        <Bar dataKey="cancelamentos" name="Cancelamentos" fill="#f59e0b" radius={[4,4,0,0]} />
                        <Bar dataKey="estornos" name="Estornos/Reembolsos" fill="#ef4444" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-2 gap-6">
                {/* ── Funil de onboarding ── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-400" />
                      Funil de onboarding
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(() => {
                      const reg = analytics?.funnel_registered ?? 0;
                      const phone = analytics?.funnel_with_phone ?? 0;
                      const msgs = analytics?.funnel_with_messages ?? 0;
                      const steps = [
                        { label: "Registrou conta", value: reg, pct: 100, color: "bg-primary" },
                        { label: "Conectou WhatsApp", value: phone, pct: reg > 0 ? Math.round((phone/reg)*100) : 0, color: "bg-blue-500" },
                        { label: "Usou o assistente", value: msgs, pct: reg > 0 ? Math.round((msgs/reg)*100) : 0, color: "bg-emerald-500" },
                      ];
                      return steps.map((s, i) => (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="font-semibold tabular-nums">{s.value} <span className="text-muted-foreground font-normal text-xs">({s.pct}%)</span></span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${s.pct}%` }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </CardContent>
                </Card>

                {/* ── Churn do mês ── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserX className="h-5 w-5 text-orange-400" />
                      Churn — este mês
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="space-y-1 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <p className="text-2xl font-bold text-green-400">{analytics?.new_this_month ?? 0}</p>
                        <p className="text-xs text-muted-foreground">Novas ativações</p>
                      </div>
                      <div className="space-y-1 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <p className="text-2xl font-bold text-yellow-400">{analytics?.cancelled_this_month ?? 0}</p>
                        <p className="text-xs text-muted-foreground">Cancelamentos</p>
                      </div>
                      <div className="space-y-1 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-2xl font-bold text-red-400">{analytics?.revoked_this_month ?? 0}</p>
                        <p className="text-xs text-muted-foreground">Estornos</p>
                      </div>
                    </div>
                    {(() => {
                      const total = (analytics?.new_this_month ?? 0) + (analytics?.active_subscribers ?? 0);
                      const lost = (analytics?.cancelled_this_month ?? 0) + (analytics?.revoked_this_month ?? 0);
                      const churnRate = total > 0 ? ((lost / total) * 100).toFixed(1) : "0.0";
                      const churnNum = parseFloat(churnRate);
                      return (
                        <div className="p-3 rounded-lg bg-muted/30 border border-border text-center">
                          <p className="text-xs text-muted-foreground mb-1">Taxa de churn estimada</p>
                          <p className={`text-2xl font-bold ${churnNum < 5 ? "text-green-400" : churnNum < 15 ? "text-yellow-400" : "text-red-400"}`}>
                            {churnRate}%
                          </p>
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground text-center">Baseado nos eventos Kirvano deste mês</p>
                  </CardContent>
                </Card>
              </div>

            </div>
          </TabsContent>

          {/* KIRVANO EVENTS */}
          <TabsContent value="kirvano">
            <div className="space-y-4">
              {/* Painel de controle + URL */}
              <Card className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">URL do Webhook Kirvano</p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-3 py-1.5 rounded-md font-mono text-green-400 select-all break-all">
                          https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/kirvano-webhook
                        </code>
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => {
                          navigator.clipboard.writeText("https://fnilyapvhhygfzcdxqjm.supabase.co/functions/v1/kirvano-webhook");
                          toast.success("URL copiada!");
                        }}>Copiar</Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Cole essa URL nas configurações de webhook da Kirvano. Ative os eventos de compra, assinatura e reembolso.</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className={`w-2 h-2 rounded-full ${kirvanoLiveRefresh ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
                      <span className="text-xs text-muted-foreground">{kirvanoLiveRefresh ? "Ao vivo" : "Parado"}</span>
                      <Button size="sm" variant={kirvanoLiveRefresh ? "default" : "outline"}
                        onClick={() => setKirvanoLiveRefresh(v => !v)}>
                        {kirvanoLiveRefresh ? "⏹ Parar" : "▶ Live"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={loadKirvanoEvents}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Último evento recebido — destaque para debug */}
              {kirvanoEvents.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-emerald-400" />
                      Último evento recebido
                      <span className="text-xs text-muted-foreground font-normal">
                        — {formatDate(kirvanoEvents[0].created_at)}
                      </span>
                      {kirvanoEvents[0].matched_user_id ? (
                        <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs"><Link2 className="h-3 w-3 mr-1" />Usuário encontrado</Badge>
                      ) : (
                        <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs"><Link2Off className="h-3 w-3 mr-1" />Sem match</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid sm:grid-cols-3 gap-3 mb-3">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Evento</p>
                        <p className="text-sm font-mono">{kirvanoEvents[0].event_type || "—"}</p>
                        <Badge variant="outline" className="text-xs">{kirvanoEvents[0].status || "unknown"}</Badge>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Email / Telefone</p>
                        <p className="text-sm">{kirvanoEvents[0].customer_email || "—"}</p>
                        <p className="text-xs font-mono text-muted-foreground">{kirvanoEvents[0].customer_phone || "—"}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Produto</p>
                        <p className="text-sm">{kirvanoEvents[0].product_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">Sub: {kirvanoEvents[0].subscription_id || "—"}</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium">Raw Payload (JSON completo)</p>
                      <pre className="text-xs bg-muted/50 border border-border rounded-md p-3 overflow-auto max-h-64 text-green-300 font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(kirvanoEvents[0].raw_payload, null, 2)}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tabela de todos os eventos */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Webhook className="h-5 w-5 text-purple-400" />
                      Histórico de Eventos Kirvano
                      <Badge variant="secondary">{kirvanoCount}</Badge>
                    </CardTitle>
                    <Button size="sm" variant="outline" onClick={() => exportCSV(kirvanoEvents, "kirvano-eventos.csv")}>
                      <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {kirvanoEvents.length === 0 ? (
                    <div className="text-center py-12 space-y-2">
                      <Webhook className="h-10 w-10 mx-auto text-muted-foreground/40" />
                      <p className="text-muted-foreground text-sm">Nenhum evento recebido ainda.</p>
                      <p className="text-xs text-muted-foreground">Configure a URL acima na Kirvano e dispare um evento de teste.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">Data</TableHead>
                          <TableHead>Evento</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead>Match</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kirvanoEvents.map((ev: any) => (
                          <>
                            <TableRow key={ev.id} className={!ev.matched_user_id ? "bg-orange-500/5" : ""}>
                              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(ev.created_at)}</TableCell>
                              <TableCell>
                                <div className="space-y-0.5">
                                  <p className="text-xs font-mono">{ev.event_type || "—"}</p>
                                  <Badge variant="outline" className="text-[10px] h-4">{ev.status || "unknown"}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{ev.customer_email || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{ev.customer_phone || "—"}</TableCell>
                              <TableCell className="text-sm max-w-[140px] truncate">{ev.product_name || "—"}</TableCell>
                              <TableCell>
                                {ev.matched_user_id ? (
                                  <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs"><Link2 className="h-3 w-3 mr-1" />Match</Badge>
                                ) : (
                                  <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs"><Link2Off className="h-3 w-3 mr-1" />Sem match</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                                  onClick={() => setKirvanoExpandedId(kirvanoExpandedId === ev.id ? null : ev.id)}>
                                  {kirvanoExpandedId === ev.id
                                    ? <ChevronUp className="h-4 w-4" />
                                    : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {kirvanoExpandedId === ev.id && (
                              <TableRow key={`${ev.id}-detail`}>
                                <TableCell colSpan={7} className="bg-muted/20 p-0">
                                  <div className="p-4 space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">Raw Payload completo:</p>
                                    <pre className="text-xs bg-background border border-border rounded-md p-3 overflow-auto max-h-72 text-green-300 font-mono whitespace-pre-wrap break-all">
                                      {JSON.stringify(ev.raw_payload, null, 2)}
                                    </pre>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <PaginationControls page={kirvanoPage} setPage={setKirvanoPage} total={kirvanoCount} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Configurações do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {SETTINGS_FIELDS.map(f => {
                  const s = settings[f.key];
                  return (
                    <div key={f.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label>{f.label}</Label>
                        <Badge className={s?.configured ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                          {s?.configured ? "Configurado" : "Não configurado"}
                        </Badge>
                      </div>
                      <Input
                        type={f.type}
                        placeholder={s?.configured ? `${s.value} — deixe vazio para manter` : `Insira ${f.label}`}
                        value={settingsForm[f.key] || ""}
                        onChange={e => setSettingsForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                  );
                })}
                <Button onClick={saveSettings} disabled={savingSettings} className="bg-purple-600 hover:bg-purple-700">
                  {savingSettings ? "Salvando..." : "Salvar Configurações"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* BROADCAST — Enviar mensagem para clientes */}
          <TabsContent value="broadcast">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Lista de clientes */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Destinatários
                    {broadcastSelected.size > 0 && (
                      <Badge className="ml-auto bg-purple-600">{broadcastSelected.size} selecionado(s)</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {broadcastLoading ? (
                    <div className="space-y-2">
                      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                    </div>
                  ) : broadcastUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhum cliente ativo com telefone cadastrado.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                        <input
                          type="checkbox"
                          id="select-all"
                          className="h-4 w-4 cursor-pointer"
                          checked={broadcastSelected.size === broadcastUsers.length && broadcastUsers.length > 0}
                          onChange={toggleSelectAll}
                        />
                        <label htmlFor="select-all" className="text-sm font-medium cursor-pointer select-none">
                          Selecionar todos ({broadcastUsers.length})
                        </label>
                      </div>
                      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                        {broadcastUsers.map(u => (
                          <div
                            key={u.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                              broadcastSelected.has(u.id) ? "bg-purple-50 dark:bg-purple-950/30" : "hover:bg-muted/50"
                            }`}
                            onClick={() => toggleBroadcastUser(u.id)}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer pointer-events-none"
                              checked={broadcastSelected.has(u.id)}
                              readOnly
                            />
                            <span className="text-sm flex-1 truncate">{u.display_name || "–"}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {(u.phone_number ?? "").replace(/\D/g, "").slice(-4) ? `···${(u.phone_number ?? "").replace(/\D/g, "").slice(-4)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Composer */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    Mensagem
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Suporta *negrito*, _itálico_ e quebras de linha (estilo WhatsApp)
                    </Label>
                    <textarea
                      className="w-full min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                      placeholder={"Olá! 👋\n\nAqui é o Jarvis com um recado importante..."}
                      value={broadcastMsg}
                      onChange={e => setBroadcastMsg(e.target.value)}
                      maxLength={4000}
                    />
                    <p className="text-xs text-muted-foreground text-right mt-1">{broadcastMsg.length}/4000</p>
                  </div>

                  {broadcastResults && (
                    <div className="rounded-lg border p-3 bg-muted/40 text-sm space-y-1">
                      <p className="font-medium">Resultado do último envio:</p>
                      <p className="text-green-600">✅ Enviadas: {broadcastResults.sent}</p>
                      {broadcastResults.failed > 0 && <p className="text-red-500">❌ Falhas: {broadcastResults.failed}</p>}
                      {broadcastResults.skipped > 0 && <p className="text-yellow-600">⚠️ Sem telefone: {broadcastResults.skipped}</p>}
                    </div>
                  )}

                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700"
                    disabled={broadcasting || broadcastSelected.size === 0 || !broadcastMsg.trim()}
                    onClick={handleBroadcast}
                  >
                    {broadcasting ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enviando...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" />Enviar para {broadcastSelected.size || "..."} cliente(s)</>
                    )}
                  </Button>
                  {broadcastSelected.size === 0 && (
                    <p className="text-xs text-muted-foreground text-center">Selecione ao menos um destinatário</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          userName={selectedUserName}
          open={!!selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onProfileUpdate={loadProfiles}
        />
      )}
    </div>
  );
}
