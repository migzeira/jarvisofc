import React, { useEffect, useState, useCallback } from "react";
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
  Activity, BarChart3, UserCheck, UserX, Send, Copy, UserSearch, Bug, Mail,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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

// Busca todas as páginas de uma query Supabase para export. A UI pagina em 25,
// mas o export precisa do dataset completo (filtros incluídos). builderFactory
// DEVE retornar uma query NOVA a cada chamada (sem .range() aplicado), porque
// .range() muta o builder. Limite defensivo de 50k linhas — muito além do
// realista pro estágio atual; acima disso migrar pra edge function.
const EXPORT_PAGE_SIZE = 1000;
const EXPORT_MAX_ROWS = 50000;
async function fetchAllRows(builderFactory: () => any): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (from < EXPORT_MAX_ROWS) {
    const q = builderFactory();
    const { data, error } = await q.range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < EXPORT_PAGE_SIZE) break;
    from += EXPORT_PAGE_SIZE;
  }
  return all;
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
    // Split de receita: mrr = valor mensal recorrente (Anual normalizado /12),
    // oneTime = planos vitalicios / produtos unicos. totalRevenue continua
    // sendo a soma bruta de todos os approved — preservado pra nao quebrar
    // lugares que ja leem esse campo.
    mrr: 0, oneTimeRevenue: 0,
  });
  const [profiles, setProfiles] = useState<any[]>([]);
  // Lista dedicada pra aba "Sem plano". Antes a gente filtrava `profiles` (que
  // é paginado em 25), então pendentes em páginas diferentes ficavam invisíveis.
  // Agora uma query dedicada busca TODOS os pending (limit defensivo de 500).
  const [pendingProfilesList, setPendingProfilesList] = useState<any[]>([]);
  // Cache de nomes de usuários indexado por id — alimentado sob demanda pelo
  // loadConversations. Necessário porque `profiles` é paginado: sem esse mapa,
  // a aba Conversas mostrava "—" pra donos de conversa que estivessem em
  // outra página de profiles. Merge incremental pra preservar entradas antigas.
  const [userNamesMap, setUserNamesMap] = useState<Record<string, string>>({});
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

  // Bug reports
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [bugReportsLoading, setBugReportsLoading] = useState(false);
  const [bugStatusFilter, setBugStatusFilter] = useState<"new" | "in_progress" | "resolved" | "wontfix" | "all">("new");
  const [newBugCount, setNewBugCount] = useState(0);
  const [expandedBugId, setExpandedBugId] = useState<string | null>(null);
  const [bugAdminNotes, setBugAdminNotes] = useState<Record<string, string>>({});
  const [bugSavingId, setBugSavingId] = useState<string | null>(null);

  // Analytics
  const [analytics, setAnalytics] = useState<any>(null);

  // Filters
  const [userSearch, setUserSearch] = useState("");
  // Debounced search — usado na query server-side pra não disparar request
  // a cada tecla. Atualizado 300ms depois do usuário parar de digitar.
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  // Busca na aba Conversas (nome do contato ou telefone) — server-side via ilike
  const [convsSearch, setConvsSearch] = useState("");
  const [debouncedConvsSearch, setDebouncedConvsSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [errContextFilter, setErrContextFilter] = useState("all");

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");

  const [settings, setSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  // Qual setting está salvando individualmente (undefined = nenhum)
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Broadcast
  const [broadcastUsers, setBroadcastUsers] = useState<any[]>([]);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastSelected, setBroadcastSelected] = useState<Set<string>>(new Set());
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResults, setBroadcastResults] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [broadcastSearch, setBroadcastSearch] = useState("");
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [broadcastHistory, setBroadcastHistory] = useState<any[]>([]);
  const [scheduledList, setScheduledList] = useState<any[]>([]);

  // Sparkline data
  const [dailyUsers, setDailyUsers] = useState<number[]>([]);

  // Reload on filter/page changes
  useEffect(() => { if (!loading && isAdmin) loadConversations(); }, [convsPage, dateRange, debouncedConvsSearch]);
  useEffect(() => { if (!loading && isAdmin) loadPayments(); }, [payPage]);
  useEffect(() => { if (!loading && isAdmin) loadErrorLogs(); }, [errPage, errContextFilter]);
  useEffect(() => { if (!loading && isAdmin) loadProfiles(); }, [usersPage, debouncedUserSearch]);
  useEffect(() => { if (!loading && isAdmin) loadKirvanoEvents(); }, [kirvanoPage]);

  // Debounce do input de busca — 300ms depois que o usuário para de digitar,
  // propaga pra debouncedUserSearch (que dispara o loadProfiles via useEffect acima)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUserSearch(userSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  // Quando a busca muda, volta pra página 1 — evita ficar em página 3 com 0 resultados
  useEffect(() => {
    if (usersPage !== 0) setUsersPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedUserSearch]);

  // Debounce da busca da aba Conversas
  useEffect(() => {
    const t = setTimeout(() => setDebouncedConvsSearch(convsSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [convsSearch]);

  // Reseta página quando a busca de Conversas muda
  useEffect(() => {
    if (convsPage !== 0) setConvsPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedConvsSearch]);

  // Live refresh para Kirvano — atualiza a cada 3s SÓ quando:
  //   1) a aba Kirvano está ativa (activeTab === "kirvano"), E
  //   2) a página do navegador está visível (document.visibilityState === "visible"), E
  //   3) o toggle kirvanoLiveRefresh está ligado.
  // Antes: alguns TabsTrigger (pending/users/conversations/payments/metricas) não
  // desligavam o live, então o interval continuava queimando query em background.
  // Agora ele é auto-gated por activeTab — não importa como o admin mude de aba.
  useEffect(() => {
    if (activeTab !== "kirvano") return;
    if (!kirvanoLiveRefresh) return;
    const tick = () => {
      if (document.visibilityState === "visible") loadKirvanoEvents();
    };
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [kirvanoLiveRefresh, kirvanoPage, activeTab]);

  // Auto-desliga o live refresh quando o usuário sai da aba Kirvano —
  // torna redundantes (mas inofensivos) os setKirvanoLiveRefresh(false)
  // espalhados nos onClick dos TabsTrigger.
  useEffect(() => {
    if (activeTab !== "kirvano" && kirvanoLiveRefresh) {
      setKirvanoLiveRefresh(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const loadData = async () => {
    setLoading(true);
    await Promise.all([
      loadProfiles(), loadPendingProfiles(), loadConversations(), loadSettings(), loadPayments(), loadRevenueStats(), loadErrorLogs(),
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
    // Sanitiza caracteres que têm significado especial em filtros PostgREST
    // (vírgula separa filtros em .or(), % é wildcard do ILIKE). Busca por nome
    // OU telefone — ambos via ilike case-insensitive.
    const search = debouncedUserSearch.replace(/[%,]/g, "");

    let q = supabase
      .from("profiles")
      .select("id, display_name, email, phone_number, whatsapp_lid, created_at, account_status", { count: "exact" });

    if (search) {
      q = q.or(`display_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, count, error } = await q
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

      // IMPORTANTE: stats globais (cards do topo) e sparkline só são
      // atualizados quando NÃO há filtro de busca — senão os cards passariam
      // a refletir apenas o resultado da busca em vez do total do sistema.
      if (!search) {
        // Antes: 3 count queries + 1 sparkline query rodando em SÉRIE via
        // await sequencial. Agora: Promise.all paraleliza as 4 — são 100%
        // independentes (nenhuma depende do resultado da outra), então o
        // speedup é ~4x em condição normal de rede. Limit 5000 defensivo
        // no sparkline preservado. Semântica e resultados idênticos.
        const windowStart = subDays(new Date(), 6);
        windowStart.setHours(0, 0, 0, 0);

        const [totalRes, pendRes, waRes, sparkRes] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }) as any,
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("account_status", "pending") as any,
          supabase.from("profiles").select("id", { count: "exact", head: true }).not("phone_number", "is", null) as any,
          supabase.from("profiles").select("created_at").gte("created_at", windowStart.toISOString()).limit(5000) as any,
        ]);

        setStats(s => ({
          ...s,
          totalUsers: totalRes.count || 0,
          pendingUsers: pendRes.count || 0,
          whatsappConnected: waRes.count || 0,
        }));

        // Sparkline — se a query falhou, mantém dailyUsers como estava
        // (fail-safe visual). Chave YYYY-MM-DD em timezone LOCAL — mesmo
        // critério de "hoje" do admin que existia no loop original.
        if (sparkRes.error) {
          console.error("[admin] sparkline query error:", sparkRes.error);
        } else {
          const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const counts: Record<string, number> = {};
          (sparkRes.data ?? []).forEach((p: any) => {
            const k = dayKey(new Date(p.created_at));
            counts[k] = (counts[k] || 0) + 1;
          });
          const days: number[] = [];
          for (let i = 6; i >= 0; i--) {
            const d = subDays(new Date(), i);
            days.push(counts[dayKey(d)] || 0);
          }
          setDailyUsers(days);
        }
      }
    }
  };

  // Carrega TODOS os usuários com account_status='pending' em uma única query
  // — fonte exclusiva da aba "Sem plano". Não mexe em `profiles` (aba Usuários)
  // nem em `stats` (cards do topo). Limit de 500 é defensivo: fila de pendentes
  // na prática nunca cresce tanto porque o admin ativa rapidamente.
  const loadPendingProfiles = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, phone_number, plan, created_at, account_status")
      .eq("account_status", "pending")
      .order("created_at", { ascending: false })
      .limit(500) as any;
    if (error) {
      console.error("[admin] loadPendingProfiles error:", error);
      return;
    }
    setPendingProfilesList(data ?? []);
  };

  const loadConversations = async () => {
    let q = supabase.from("conversations")
      .select("id, user_id, contact_name, whatsapp_lid, phone_number, last_message_at, started_at, message_count", { count: "exact" })
      .order("last_message_at", { ascending: false });
    const df = getDateFilter(dateRange);
    if (df) q = q.gte("started_at", df);
    // Busca server-side via ilike em contact_name e phone_number.
    // Sanitiza `%` e `,` — caracteres especiais do PostgREST .or() — pra evitar
    // que o usuário quebre o filtro digitando vírgulas ou %.
    if (debouncedConvsSearch) {
      const safe = debouncedConvsSearch.replace(/[%,]/g, "");
      if (safe) {
        q = q.or(`contact_name.ilike.%${safe}%,phone_number.ilike.%${safe}%`);
      }
    }
    const { data, count, error } = await q.range(convsPage * PAGE_SIZE, (convsPage + 1) * PAGE_SIZE - 1) as any;
    if (error) {
      console.error("[admin] loadConversations error:", error);
      toast.error("Erro ao carregar conversas");
      return;
    }
    if (data) {
      setConversations(data);
      setConvCount(count || 0);

      // Popula userNamesMap com os donos dessas conversas. Antes getUserName
      // procurava em `profiles` (paginado em 25), então donos em outras páginas
      // apareciam como "—". Agora buscamos em batch só os ids que faltam no mapa.
      const userIds = Array.from(new Set(
        (data as any[]).map(c => c.user_id).filter((id: any) => id && !userNamesMap[id])
      ));
      if (userIds.length > 0) {
        const { data: profs, error: profsError } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds) as any;
        // Falha na resolução de nomes não derruba a tabela — só loga.
        // getUserName já tem fallback (mostra "—" ou id truncado).
        if (profsError) {
          console.warn("[admin] loadConversations profiles lookup warn:", profsError);
        } else if (profs && profs.length > 0) {
          setUserNamesMap(prev => {
            const next = { ...prev };
            (profs as any[]).forEach(p => { next[p.id] = p.display_name || "—"; });
            return next;
          });
        }
      }
    }
  };

  const loadPayments = async () => {
    const { data, count, error } = await supabase.from("kirvano_payments")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(payPage * PAGE_SIZE, (payPage + 1) * PAGE_SIZE - 1) as any;
    if (error) {
      console.error("[admin] loadPayments error:", error);
      toast.error("Erro ao carregar pagamentos");
      return;
    }
    if (data) {
      setPayments(data);
      setPayCount(count || 0);
    }
    // NOTA: antes a receita era calculada aqui em cima de `data` (só 25 linhas
    // da página atual), então o card "Receita" ficava errado — pior: mudava
    // ao navegar entre páginas. Cálculo correto agora vive em `loadRevenueStats`.
  };

  // Soma TODOS os pagamentos approved em uma query dedicada — independente
  // da paginação da tabela. Limit 10000 é defensivo (muito além do realista
  // pro estágio atual); quando passar disso, migrar pra RPC com SUM() no Postgres.
  const loadRevenueStats = async () => {
    const { data, error } = await supabase
      .from("kirvano_payments")
      .select("amount, plan")
      .eq("status", "approved")
      .limit(10000) as any;
    if (error) {
      console.error("[admin] loadRevenueStats error:", error);
      return;
    }
    // Classifica cada pagamento como recorrente (MRR) ou one-time baseado no
    // campo `plan`. Heuristica conservadora: so conta como MRR quando o plano
    // bate com padroes conhecidos; resto cai em one-time (mais seguro do que
    // o contrario — nao infla MRR de forma enganosa).
    // Regras:
    //   - "mensal"/"mes"/"monthly"  → amount inteiro vira MRR
    //   - "anual"/"yearly"/"ano"    → amount/12 vira MRR
    //   - "trimestral"              → amount/3 vira MRR
    //   - "semestral"               → amount/6 vira MRR
    //   - tudo mais (permanente, vitalicio, produtos, null, "")  → one-time
    let revenue = 0;
    let mrr = 0;
    let oneTime = 0;
    (data ?? []).forEach((p: any) => {
      const amount = Number(p.amount) || 0;
      revenue += amount;
      const plan = String(p.plan || "").toLowerCase();
      if (/mensal|monthly|\bmes\b/.test(plan)) {
        mrr += amount;
      } else if (/anual|yearly|\bano\b/.test(plan)) {
        mrr += amount / 12;
      } else if (/trimestral|quarterly/.test(plan)) {
        mrr += amount / 3;
      } else if (/semestral/.test(plan)) {
        mrr += amount / 6;
      } else {
        oneTime += amount;
      }
    });
    const approvedCount = (data ?? []).length;
    setStats(s => ({
      ...s,
      totalRevenue: revenue,
      approvedPayments: approvedCount,
      mrr,
      oneTimeRevenue: oneTime,
    }));
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

  // ── Bug Reports ────────────────────────────────────────────
  const loadBugReports = useCallback(async () => {
    setBugReportsLoading(true);
    try {
      let query = (supabase.from("bug_reports" as any).select("*") as any)
        .order("created_at", { ascending: false })
        .limit(200);
      if (bugStatusFilter !== "all") {
        query = query.eq("status", bugStatusFilter);
      }
      const { data, error } = await query;
      if (error) {
        console.error("[admin] loadBugReports error:", error);
        toast.error("Erro ao carregar bugs.");
        setBugReports([]);
      } else {
        setBugReports((data as any[]) ?? []);
      }
    } finally {
      setBugReportsLoading(false);
    }
  }, [bugStatusFilter]);

  // Conta bugs com status="new" (pra badge no header da tab)
  const refreshNewBugCount = useCallback(async () => {
    const { count, error } = await (supabase
      .from("bug_reports" as any)
      .select("id", { count: "exact", head: true })
      .eq("status", "new") as any);
    if (!error) setNewBugCount(count ?? 0);
  }, []);

  const updateBugStatus = async (bugId: string, status: string) => {
    setBugSavingId(bugId);
    try {
      const updates: Record<string, unknown> = { status };
      if (bugAdminNotes[bugId] !== undefined) {
        updates.admin_notes = bugAdminNotes[bugId];
      }
      // .select() força retorno das rows afetadas → permite detectar update
      // silencioso (0 rows = RLS bloqueou, profile.is_admin provavelmente false)
      const { data, error } = await (supabase
        .from("bug_reports" as any)
        .update(updates as any)
        .eq("id", bugId)
        .select() as any);
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        toast.error("Sem permissão pra atualizar. Confirme que seu profile tem is_admin=true.");
        return;
      }
      toast.success(`Bug marcado como ${status}.`);
      await Promise.all([loadBugReports(), refreshNewBugCount()]);
    } catch (e) {
      console.error("[admin] updateBugStatus error:", e);
      toast.error("Erro ao atualizar status do bug.");
    } finally {
      setBugSavingId(null);
    }
  };

  const saveBugNotes = async (bugId: string) => {
    setBugSavingId(bugId);
    try {
      const { data, error } = await (supabase
        .from("bug_reports" as any)
        .update({ admin_notes: bugAdminNotes[bugId] ?? "" } as any)
        .eq("id", bugId)
        .select() as any);
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        toast.error("Sem permissão pra salvar notas. Confirme que seu profile tem is_admin=true.");
        return;
      }
      toast.success("Notas salvas.");
      await loadBugReports();
    } catch (e) {
      console.error("[admin] saveBugNotes error:", e);
      toast.error("Erro ao salvar notas.");
    } finally {
      setBugSavingId(null);
    }
  };

  const deleteBug = async (bugId: string, title: string) => {
    if (!confirm(`Excluir o reporte "${title}"? Essa ação não pode ser desfeita.`)) return;
    setBugSavingId(bugId);
    try {
      const { data, error } = await (supabase
        .from("bug_reports" as any)
        .delete()
        .eq("id", bugId)
        .select() as any);
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        toast.error("Sem permissão pra excluir. Confirme que seu profile tem is_admin=true.");
        return;
      }
      toast.success("Reporte excluído.");
      setExpandedBugId(null);
      await Promise.all([loadBugReports(), refreshNewBugCount()]);
    } catch (e) {
      console.error("[admin] deleteBug error:", e);
      toast.error("Erro ao excluir reporte.");
    } finally {
      setBugSavingId(null);
    }
  };

  // Bug reports: recarrega quando filtro muda OU quando entra na tab.
  // Posicionado AQUI (após declaração de loadBugReports) pra evitar TDZ.
  useEffect(() => {
    if (!loading && isAdmin && activeTab === "bugs") loadBugReports();
  }, [activeTab, bugStatusFilter, loading, isAdmin, loadBugReports]);

  // Badge contador de bugs novos: load inicial + refresh a cada 60s
  useEffect(() => {
    if (loading || !isAdmin) return;
    refreshNewBugCount();
    const t = setInterval(refreshNewBugCount, 60_000);
    return () => clearInterval(t);
  }, [loading, isAdmin, refreshNewBugCount]);

  // Export "tudo" com paginação por trás — fetcha todas as páginas do Supabase
  // respeitando os filtros ativos (data/busca/contexto), agrega, e passa pro
  // exportCSV. Substitui os exports antigos que só exportavam a página atual
  // (25 linhas). Loading toast + row count no sucesso.
  const handleExportAll = async (label: string, builderFactory: () => any, filename: string) => {
    const toastId = toast.loading(`Exportando ${label}...`);
    try {
      const rows = await fetchAllRows(builderFactory);
      if (!rows.length) {
        toast.error(`Nenhum dado de ${label} pra exportar`, { id: toastId });
        return;
      }
      exportCSV(rows, filename);
      toast.success(`${label}: ${rows.length.toLocaleString("pt-BR")} linhas exportadas`, { id: toastId });
    } catch (e) {
      console.error(`[admin] export ${label} error:`, e);
      toast.error(`Erro ao exportar ${label}`, { id: toastId });
    }
  };

  // Builders de query que replicam as condições de cada loadX SEM .range() —
  // .order() é aplicado pra output consistente. fetchAllRows aplica .range()
  // por página internamente.
  const buildUsersExportQuery = () => {
    const search = debouncedUserSearch.replace(/[%,]/g, "");
    let q = supabase
      .from("profiles")
      .select("id, display_name, email, phone_number, whatsapp_lid, created_at, account_status");
    if (search) q = q.or(`display_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%`);
    return q.order("created_at", { ascending: false });
  };

  const buildConversationsExportQuery = () => {
    let q = supabase
      .from("conversations")
      .select("id, user_id, contact_name, whatsapp_lid, phone_number, last_message_at, started_at, message_count");
    const df = getDateFilter(dateRange);
    if (df) q = q.gte("started_at", df);
    if (debouncedConvsSearch) {
      const safe = debouncedConvsSearch.replace(/[%,]/g, "");
      if (safe) q = q.or(`contact_name.ilike.%${safe}%,phone_number.ilike.%${safe}%`);
    }
    return q.order("last_message_at", { ascending: false });
  };

  const buildPaymentsExportQuery = () =>
    supabase.from("kirvano_payments").select("*").order("created_at", { ascending: false });

  const buildErrorLogsExportQuery = () => {
    let q = supabase.from("error_logs").select("*").order("created_at", { ascending: false });
    if (errContextFilter !== "all") q = q.eq("context", errContextFilter);
    return q;
  };

  const buildKirvanoExportQuery = () =>
    (supabase.from("kirvano_events" as any) as any).select("*").order("created_at", { ascending: false });

  // Ações para eventos Kirvano sem match — helpers defensivos, sem mutar backend.
  const copyToClipboard = async (text: string, label: string) => {
    if (!text) { toast.error(`${label} vazio`); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  // Manda o admin pra aba Usuários com o termo já preenchido — usa email (ou
  // telefone como fallback) pra tentar localizar o profile manualmente.
  const searchUserFromKirvano = (ev: any) => {
    const term = (ev.customer_email || ev.customer_phone || "").trim();
    if (!term) { toast.error("Evento sem email/telefone pra buscar"); return; }
    setUserSearch(term);
    setActiveTab("users");
    setKirvanoLiveRefresh(false);
    toast.info(`Buscando "${term}" na aba Usuários`);
  };

  // Re-processa o webhook Kirvano pro evento atual (sem duplicar pagamento —
  // o edge function já tem guards de idempotência). Útil quando o usuário
  // criou conta DEPOIS do evento chegar, então agora o match deve funcionar.
  const retryKirvanoMatch = async (ev: any) => {
    if (!ev.raw_payload) { toast.error("Sem raw_payload pra re-processar"); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/kirvano-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(ev.raw_payload),
      });
      if (res.ok) {
        toast.success("Evento re-processado — verificando match...");
        setTimeout(() => loadKirvanoEvents(), 800);
      } else {
        const txt = await res.text().catch(() => "");
        toast.error(`Falha ao re-processar (${res.status})`);
        console.error("[retryKirvanoMatch]", res.status, txt);
      }
    } catch (err) {
      toast.error("Erro de rede ao re-processar");
      console.error("[retryKirvanoMatch]", err);
    }
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
    Object.entries(settingsForm).forEach(([k, v]) => { if (v) body[k] = v.trim(); });
    if (Object.keys(body).length === 0) { toast.error("Preencha pelo menos um campo"); setSavingSettings(false); return; }
    // Revalida antes de enviar — defesa em profundidade caso o botão disabled
    // escape (ex: submit via Enter). Não envia nada se algum campo preenchido
    // estiver inválido.
    for (const [k, v] of Object.entries(body)) {
      const err = validateSetting(k, v);
      if (err) {
        toast.error(`${k}: ${err}`);
        setSavingSettings(false);
        return;
      }
    }
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

  /** Salva UM único campo do Settings, independente dos outros.
   *  Valida só aquele campo — permite salvar o link de renovação mesmo
   *  se Google Client ID estiver com valor inválido autocompletado pelo
   *  navegador, por exemplo. */
  const saveSingleSetting = async (key: string) => {
    if (!session) return;
    const raw = (settingsForm[key] || "").trim();
    if (!raw) { toast.error("Preencha o campo antes de salvar"); return; }
    const err = validateSetting(key, raw);
    if (err) { toast.error(err); return; }
    setSavingKey(key);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: raw }),
      });
      if (res.ok) {
        toast.success("Salvo!");
        setSettingsForm(prev => ({ ...prev, [key]: "" })); // limpa só esse campo
        loadSettings();
      } else toast.error("Erro ao salvar");
    } catch { toast.error("Erro de rede"); }
    setSavingKey(null);
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

  const toggleSelectAll = (list?: any[]) => {
    const target = list && list.length > 0 ? list : broadcastUsers;
    const targetIds = target.map(u => u.id);
    const allSelected = targetIds.every(id => broadcastSelected.has(id));
    setBroadcastSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        targetIds.forEach(id => next.delete(id));
      } else {
        targetIds.forEach(id => next.add(id));
      }
      return next;
    });
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
        body: JSON.stringify({
          user_ids: Array.from(broadcastSelected),
          message: broadcastMsg.trim(),
          ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        }),
      });
      const rawText = await res.text();
      let data: any = {};
      try { data = JSON.parse(rawText); } catch { /* nao é JSON */ }
      console.log("[broadcast] status:", res.status, "body:", rawText);
      if (res.ok) {
        if (data.scheduled) {
          toast.success(`📅 Broadcast agendado para ${new Date(data.send_at).toLocaleString("pt-BR")}`);
          setScheduleAt("");
          loadBroadcastHistory();
        } else {
          setBroadcastResults({ sent: data.sent, failed: data.failed, skipped: data.skipped });
          toast.success(`✅ ${data.sent} mensagem(ns) enviada(s)!`);
          loadBroadcastHistory();
        }
        setBroadcastMsg("");
        setBroadcastSelected(new Set());
      } else {
        toast.error(`[${res.status}] ${data.error ?? rawText.slice(0, 200) ?? "Erro ao enviar"}`);
      }
    } catch (err) {
      console.error("[broadcast] erro:", err);
      toast.error("Erro de rede: " + (err instanceof Error ? err.message : String(err)));
    }
    setBroadcasting(false);
  };

  const loadBroadcastHistory = async () => {
    const [logsRes, schedRes] = await Promise.all([
      (supabase.from("broadcast_logs" as any) as any)
        .select("id, message, total, sent, failed, skipped, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      (supabase.from("scheduled_broadcasts" as any) as any)
        .select("id, message, user_ids, send_at, status")
        .in("status", ["pending", "processing"])
        .order("send_at", { ascending: true })
        .limit(20),
    ]);
    setBroadcastHistory(logsRes.data ?? []);
    setScheduledList(schedRes.data ?? []);
  };

  const cancelScheduled = async (id: string) => {
    if (!confirm("Cancelar este agendamento?")) return;
    const { error } = await (supabase.from("scheduled_broadcasts" as any) as any)
      .update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error("Erro ao cancelar");
    else { toast.success("Agendamento cancelado"); loadBroadcastHistory(); }
  };

  // Antes esse filtro rodava client-side sobre `profiles`, mas como `profiles`
  // é paginado em 25, a busca nunca encontrava usuários de outras páginas.
  // Agora o filtro é aplicado server-side no loadProfiles (ilike em nome e
  // telefone), então `filteredProfiles` vira passthrough pra não quebrar as
  // referências existentes (tabela, export CSV, mensagem de vazio).
  const filteredProfiles = profiles;

  // NOTA: antes usava `profiles.filter(p => account_status === "pending")`, mas
  // `profiles` é paginado em 25, então pendentes de páginas > 1 sumiam.
  // Agora a aba "Sem plano" lê diretamente de `pendingProfilesList` (query dedicada).

  const getUserName = (userId: string) => {
    // Ordem de lookup: 1) cache userNamesMap (populado por loadConversations
    // em batch pra donos de todas as conversas visíveis), 2) profiles da aba
    // Usuários (fallback p/ quando o user aparece nas duas abas), 3) "—".
    if (userNamesMap[userId]) return userNamesMap[userId];
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

  // Validadores por campo — retornam mensagem de erro ou null. Só são aplicados
  // quando o valor NÃO é vazio: campos em branco continuam significando "manter
  // valor atual", mantendo o comportamento anterior do saveSettings.
  const validateSetting = (key: string, value: string): string | null => {
    const v = value.trim();
    if (!v) return null;
    switch (key) {
      case "whatsapp_number": {
        const digits = v.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) return "Deve ter entre 10 e 15 dígitos (ex: 5511999999999)";
        if (!/^[\d+\s()-]+$/.test(v)) return "Use apenas dígitos (com ou sem + no início)";
        return null;
      }
      case "google_client_id": {
        if (!/\.apps\.googleusercontent\.com$/.test(v)) return "Deve terminar com .apps.googleusercontent.com";
        return null;
      }
      case "google_client_secret": {
        if (v.length < 20) return "Secret muito curto (mínimo 20 caracteres)";
        return null;
      }
      case "notion_client_id": {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
          return "Formato UUID esperado (ex: 12345678-1234-1234-1234-123456789012)";
        }
        return null;
      }
      case "notion_client_secret": {
        if (v.length < 20) return "Secret muito curto (mínimo 20 caracteres)";
        return null;
      }
      case "dashboard_url": {
        try {
          const u = new URL(v);
          if (!/^https?:$/.test(u.protocol)) return "Use http:// ou https://";
          return null;
        } catch {
          return "URL inválida (ex: https://app.heyjarvis.com.br)";
        }
      }
      case "renewal_link":
      case "renewal_link_monthly":
      case "renewal_link_annual": {
        try {
          const u = new URL(v);
          if (!/^https?:$/.test(u.protocol)) return "Use http:// ou https://";
          return null;
        } catch {
          return "URL inválida (ex: https://pay.kirvano.com/abc123)";
        }
      }
      case "renewal_reminders_enabled": {
        if (!/^(true|false)$/i.test(v)) return "Use 'true' ou 'false'";
        return null;
      }
      case "overdue_grace_days": {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 90) return "Número entre 1 e 90";
        return null;
      }
      case "openai_api_key": {
        // Aceita "sk-..." (formato user) ou "sk-proj-..." (formato project key).
        // Também aceita o valor mascarado (••••) — significa "manter valor atual".
        if (v.includes("•")) return null;
        if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(v)) return "Deve começar com 'sk-' (ex: sk-proj-abc123...)";
        return null;
      }
      case "ai_chat_provider": {
        const lower = v.toLowerCase();
        if (lower !== "claude" && lower !== "openai") return "Use 'claude' ou 'openai'";
        return null;
      }
      default:
        return null;
    }
  };

  const SETTINGS_FIELDS = [
    { key: "whatsapp_number", label: "Número WhatsApp da IA", type: "text", hint: "Ex: 5511999999999 — número que os usuários devem chamar" },
    { key: "google_client_id", label: "Google Client ID", type: "text" },
    { key: "google_client_secret", label: "Google Client Secret", type: "password" },
    { key: "notion_client_id", label: "Notion Client ID", type: "text" },
    { key: "notion_client_secret", label: "Notion Client Secret", type: "password" },
    { key: "dashboard_url", label: "URL do Dashboard", type: "text" },
    { key: "renewal_link_monthly", label: "Link de Renovação — Plano Mensal", type: "text", hint: "Checkout Kirvano enviado nos lembretes de clientes do plano mensal" },
    { key: "renewal_link_annual", label: "Link de Renovação — Plano Anual", type: "text", hint: "Checkout Kirvano enviado nos lembretes de clientes do plano anual" },
    { key: "renewal_reminders_enabled", label: "Lembretes de Renovação Ativos", type: "text", hint: "'true' envia lembretes automáticos; 'false' desativa" },
    { key: "overdue_grace_days", label: "Dias de Tolerância (OVERDUE)", type: "text", hint: "Grace period quando Kirvano sinaliza atraso. Default: 7" },
    // Inteligência Artificial — roteamento Claude/OpenAI
    { key: "openai_api_key", label: "OpenAI API Key", type: "password", hint: "Cola a key (sk-proj-... ou sk-...). Usado quando Provider de Chat = 'openai'. Fallback automático pra Claude se OpenAI falhar." },
    { key: "ai_chat_provider", label: "Provider de Chat", type: "text", hint: "'claude' (default, mais robusto) ou 'openai' (mais barato — usa GPT-4o-mini em chat geral, modo sombra e fallback de lembrete). Extrações estruturadas continuam sempre no Claude." },
  ];

  // Calcula erros por campo e se o form é submetível.
  const settingsErrors = Object.fromEntries(
    SETTINGS_FIELDS.map(f => [f.key, validateSetting(f.key, settingsForm[f.key] || "")])
  ) as Record<string, string | null>;
  const hasSettingsErrors = Object.values(settingsErrors).some(e => e !== null);

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
          <p className="text-xs text-muted-foreground">Receita total</p>
          <div
            className="mt-1.5 pt-1.5 border-t border-border/60 space-y-0.5"
            title="MRR normaliza planos anuais (÷12), trimestrais (÷3) e semestrais (÷6). One-time soma planos vitalícios e produtos únicos."
          >
            <p className="text-[11px] text-emerald-300/90">
              <span className="text-muted-foreground">MRR</span> R${stats.mrr.toFixed(0)}
            </p>
            <p className="text-[11px] text-emerald-300/70">
              <span className="text-muted-foreground">One-time</span> R${stats.oneTimeRevenue.toFixed(0)}
            </p>
          </div>
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
              <TabsTrigger value="bugs" onClick={() => setKirvanoLiveRefresh(false)} className="relative">
                <Bug className="h-4 w-4 mr-1" />Bugs
                {newBugCount > 0 && (
                  <span className="ml-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{newBugCount}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="settings" onClick={() => setKirvanoLiveRefresh(false)}><Settings className="h-4 w-4 mr-1" />Config</TabsTrigger>
              <TabsTrigger value="broadcast" onClick={() => { setKirvanoLiveRefresh(false); loadBroadcastUsers(); loadBroadcastHistory(); }}><Send className="h-4 w-4 mr-1" />Mensagem</TabsTrigger>
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
                {pendingProfilesList.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhuma conta sem plano no momento.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Nome</TableHead><TableHead>Telefone</TableHead><TableHead>Plano</TableHead><TableHead>Cadastro</TableHead><TableHead>Ações</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {pendingProfilesList.map(p => (
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
                    <Input placeholder="Buscar por nome ou telefone..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleExportAll("usuários", buildUsersExportQuery, "usuarios.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Nome</TableHead><TableHead>Email</TableHead><TableHead>Telefone</TableHead>
                    <TableHead>Status</TableHead><TableHead>WhatsApp</TableHead><TableHead>Cadastro</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredProfiles.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.display_name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate" title={p.email || ""}>{p.email || "—"}</TableCell>
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
                <div className="flex items-center gap-3 flex-wrap">
                  <DateFilter />
                  <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="Buscar por nome ou telefone..."
                      value={convsSearch}
                      onChange={e => setConvsSearch(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleExportAll("conversas", buildConversationsExportQuery, "conversas.csv")}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Usuário</TableHead><TableHead>Contato</TableHead><TableHead>Telefone</TableHead>
                    <TableHead>Mensagens</TableHead><TableHead>Último</TableHead><TableHead>Início</TableHead>
                    <TableHead className="w-20 text-right">Ações</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {conversations.map(c => {
                      const ownerName = getUserName(c.user_id);
                      return (
                      <TableRow key={c.id}>
                        <TableCell>{ownerName}</TableCell>
                        <TableCell>{c.contact_name || "—"}</TableCell>
                        <TableCell className="text-sm">{c.phone_number}</TableCell>
                        <TableCell>{c.message_count}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.last_message_at)}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.started_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            disabled={!c.user_id}
                            title={c.user_id ? "Ver detalhes do usuário dono da conversa" : "Conversa sem usuário vinculado"}
                            onClick={() => {
                              if (!c.user_id) return;
                              setSelectedUserId(c.user_id);
                              setSelectedUserName(ownerName && ownerName !== "—" ? ownerName : "Usuário");
                            }}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            <span className="text-xs">Detalhes</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                      );
                    })}
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
                  <Button size="sm" variant="outline" onClick={() => handleExportAll("pagamentos", buildPaymentsExportQuery, "pagamentos.csv")}>
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
                  <Button size="sm" variant="outline" onClick={() => handleExportAll("erros", buildErrorLogsExportQuery, "erros.csv")}>
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
                    <Button size="sm" variant="outline" onClick={() => handleExportAll("eventos Kirvano", buildKirvanoExportQuery, "kirvano-eventos.csv")}>
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
                          <React.Fragment key={ev.id}>
                            <TableRow className={!ev.matched_user_id ? "bg-orange-500/5" : ""}>
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
                              <TableRow>
                                <TableCell colSpan={7} className="bg-muted/20 p-0">
                                  <div className="p-4 space-y-3">
                                    {!ev.matched_user_id && (
                                      <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-orange-500/30 bg-orange-500/5">
                                        <span className="text-xs font-medium text-orange-300 mr-1">Ações:</span>
                                        <Button size="sm" variant="outline" className="h-7 text-xs"
                                          onClick={() => copyToClipboard(ev.customer_email, "Email")}
                                          disabled={!ev.customer_email}>
                                          <Copy className="h-3 w-3 mr-1" /> Copiar email
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs"
                                          onClick={() => copyToClipboard(ev.customer_phone, "Telefone")}
                                          disabled={!ev.customer_phone}>
                                          <Copy className="h-3 w-3 mr-1" /> Copiar telefone
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs"
                                          onClick={() => searchUserFromKirvano(ev)}
                                          disabled={!ev.customer_email && !ev.customer_phone}>
                                          <UserSearch className="h-3 w-3 mr-1" /> Buscar em Usuários
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs"
                                          onClick={() => retryKirvanoMatch(ev)}
                                          disabled={!ev.raw_payload}>
                                          <RefreshCw className="h-3 w-3 mr-1" /> Tentar match novamente
                                        </Button>
                                      </div>
                                    )}
                                    <p className="text-xs font-medium text-muted-foreground">Raw Payload completo:</p>
                                    <pre className="text-xs bg-background border border-border rounded-md p-3 overflow-auto max-h-72 text-green-300 font-mono whitespace-pre-wrap break-all">
                                      {JSON.stringify(ev.raw_payload, null, 2)}
                                    </pre>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <PaginationControls page={kirvanoPage} setPage={setKirvanoPage} total={kirvanoCount} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* BUGS REPORTS */}
          <TabsContent value="bugs">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bug className="h-5 w-5 text-rose-400" /> Bugs e sugestões reportados pelos usuários
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={bugStatusFilter} onValueChange={(v) => setBugStatusFilter(v as any)}>
                      <SelectTrigger className="w-[180px] h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">🔴 Novos</SelectItem>
                        <SelectItem value="in_progress">🟡 Em andamento</SelectItem>
                        <SelectItem value="resolved">✅ Resolvidos</SelectItem>
                        <SelectItem value="wontfix">⚪ Wontfix</SelectItem>
                        <SelectItem value="all">📋 Todos</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => loadBugReports()} disabled={bugReportsLoading}>
                      <RefreshCw className={`h-4 w-4 ${bugReportsLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Reportes enviados via menu "Ajuda & Conta → Reportar bug" no dashboard. Mude o status pra acompanhar o tratamento.
                </p>
              </CardHeader>
              <CardContent>
                {bugReportsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : bugReports.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    {bugStatusFilter === "new"
                      ? "Nenhum bug novo no momento. 🎉"
                      : "Nenhum reporte encontrado neste filtro."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {bugReports.map((b: any) => {
                      const isExpanded = expandedBugId === b.id;
                      const statusBadge: Record<string, { label: string; className: string }> = {
                        new:         { label: "🔴 Novo",         className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
                        in_progress: { label: "🟡 Em andamento", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
                        resolved:    { label: "✅ Resolvido",    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
                        wontfix:     { label: "⚪ Wontfix",       className: "bg-muted text-muted-foreground" },
                      };
                      const sb = statusBadge[b.status as string] ?? { label: b.status, className: "" };
                      const notesValue = bugAdminNotes[b.id] ?? b.admin_notes ?? "";
                      const isSaving = bugSavingId === b.id;
                      return (
                        <Card key={b.id} className="bg-card border-border">
                          <CardContent className="pt-4 pb-3 space-y-2">
                            {/* Header: title + status */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm leading-tight">{b.title}</p>
                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                                  <Users className="h-3 w-3" />
                                  <span>{b.user_name || "—"}</span>
                                  {b.user_email && (
                                    <>
                                      <span>·</span>
                                      <Mail className="h-3 w-3" />
                                      <span className="font-mono">{b.user_email}</span>
                                    </>
                                  )}
                                  <span>·</span>
                                  <Clock className="h-3 w-3" />
                                  <span>{formatDate(b.created_at)}</span>
                                </div>
                              </div>
                              <Badge className={sb.className}>{sb.label}</Badge>
                            </div>

                            {/* Description: clamp se não expandido */}
                            <p
                              className={`text-sm whitespace-pre-wrap leading-relaxed ${isExpanded ? "" : "line-clamp-3"}`}
                            >
                              {b.description}
                            </p>

                            {/* Toggle expand */}
                            {b.description && b.description.length > 200 && (
                              <button
                                onClick={() => setExpandedBugId(isExpanded ? null : b.id)}
                                className="text-xs text-violet-400 hover:text-violet-300"
                              >
                                {isExpanded ? "Mostrar menos" : "Ler tudo"}
                              </button>
                            )}

                            {/* Expanded: admin notes + status buttons */}
                            {isExpanded && (
                              <div className="pt-3 mt-2 border-t border-border/40 space-y-2">
                                <div>
                                  <Label className="text-[11px] text-muted-foreground">Notas internas (só admin vê)</Label>
                                  <Textarea
                                    value={notesValue}
                                    onChange={(e) => setBugAdminNotes((prev) => ({ ...prev, [b.id]: e.target.value }))}
                                    placeholder="Ex: já corrigido no commit X, aguardando deploy"
                                    rows={2}
                                    className="text-xs mt-1"
                                    disabled={isSaving}
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2"
                                    disabled={isSaving || (notesValue ?? "") === (b.admin_notes ?? "")}
                                    onClick={() => saveBugNotes(b.id)}
                                  >
                                    Salvar notas
                                  </Button>
                                </div>
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {b.status !== "in_progress" && (
                                    <Button size="sm" variant="outline" disabled={isSaving} onClick={() => updateBugStatus(b.id, "in_progress")}>
                                      🟡 Em andamento
                                    </Button>
                                  )}
                                  {b.status !== "resolved" && (
                                    <Button size="sm" variant="outline" disabled={isSaving} onClick={() => updateBugStatus(b.id, "resolved")} className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10">
                                      ✅ Resolver
                                    </Button>
                                  )}
                                  {b.status !== "wontfix" && (
                                    <Button size="sm" variant="outline" disabled={isSaving} onClick={() => updateBugStatus(b.id, "wontfix")} className="text-muted-foreground">
                                      ⚪ Wontfix
                                    </Button>
                                  )}
                                  {b.status !== "new" && (
                                    <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => updateBugStatus(b.id, "new")}>
                                      ↩️ Reabrir
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={isSaving}
                                    onClick={() => deleteBug(b.id, b.title)}
                                    className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 ml-auto"
                                  >
                                    <XCircle className="h-3.5 w-3.5 mr-1" />
                                    Excluir
                                  </Button>
                                </div>
                                {b.resolved_at && (
                                  <p className="text-[10px] text-muted-foreground">
                                    Encerrado em {formatDate(b.resolved_at)}
                                  </p>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings">
            {(() => {
              // Agrupa campos por categoria — cada grupo é 1 card, cada campo
              // tem seu próprio botão "Salvar" (independente).
              const GROUPS: { title: string; keys: string[] }[] = [
                { title: "Integrações Principais", keys: ["whatsapp_number", "dashboard_url"] },
                { title: "Google OAuth (Calendar + Sheets)", keys: ["google_client_id", "google_client_secret"] },
                { title: "Notion OAuth", keys: ["notion_client_id", "notion_client_secret"] },
                { title: "Renovação & Cobrança", keys: ["renewal_link_monthly", "renewal_link_annual", "renewal_reminders_enabled", "overdue_grace_days"] },
                { title: "Inteligência Artificial", keys: ["ai_chat_provider", "openai_api_key"] },
              ];
              const renderField = (key: string) => {
                const f = SETTINGS_FIELDS.find(x => x.key === key);
                if (!f) return null;
                const s = settings[f.key];
                const err = settingsErrors[f.key];
                const current = settingsForm[f.key] || "";
                const isSaving = savingKey === f.key;
                const canSave = current.trim().length > 0 && !err && !isSaving;
                return (
                  <div key={f.key} className="space-y-1.5 pt-3 first:pt-0 border-t first:border-t-0 border-border/50">
                    <div className="flex items-center gap-2">
                      <Label>{f.label}</Label>
                      <Badge className={s?.configured ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                        {s?.configured ? "Configurado" : "Não configurado"}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type={f.type}
                        placeholder={s?.configured ? `${s.value} — deixe vazio para manter` : `Insira ${f.label}`}
                        value={current}
                        onChange={e => setSettingsForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className={err ? "border-red-500 focus-visible:ring-red-500 flex-1" : "flex-1"}
                        aria-invalid={!!err}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        name={`setting_${f.key}`}
                      />
                      <Button
                        onClick={() => saveSingleSetting(f.key)}
                        disabled={!canSave}
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 shrink-0"
                      >
                        {isSaving ? "Salvando..." : "Salvar"}
                      </Button>
                    </div>
                    {err && <p className="text-xs text-red-400">{err}</p>}
                    {f.hint && !err && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                  </div>
                );
              };
              return (
                <div className="space-y-4">
                  {GROUPS.map(g => (
                    <Card key={g.title}>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Settings className="h-4 w-4" /> {g.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {g.keys.map(renderField)}
                      </CardContent>
                    </Card>
                  ))}
                  {/* Fallback — permite salvar vários campos de uma vez se o admin quiser */}
                  {Object.values(settingsForm).some(v => (v || "").trim().length > 0) && (
                    <Card>
                      <CardContent className="pt-4 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Ou salve todos os campos preenchidos de uma vez.
                        </p>
                        <Button
                          onClick={saveSettings}
                          disabled={savingSettings || hasSettingsErrors}
                          variant="outline"
                          size="sm"
                        >
                          {savingSettings ? "Salvando..." : hasSettingsErrors ? "Corrija os erros" : "Salvar Todos"}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })()}
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
                  ) : (() => {
                    const q = broadcastSearch.trim().toLowerCase();
                    const filteredBroadcastUsers = q
                      ? broadcastUsers.filter(u => {
                          const name = (u.display_name || "").toLowerCase();
                          const phone = (u.phone_number || "").replace(/\D/g, "");
                          return name.includes(q) || phone.includes(q.replace(/\D/g, ""));
                        })
                      : broadcastUsers;
                    const filteredIds = filteredBroadcastUsers.map(u => u.id);
                    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => broadcastSelected.has(id));
                    return (
                    <>
                      <div className="relative mb-3">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          type="text"
                          placeholder="Buscar por nome ou telefone..."
                          value={broadcastSearch}
                          onChange={e => setBroadcastSearch(e.target.value)}
                          className="pl-8 h-9"
                        />
                      </div>
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                        <input
                          type="checkbox"
                          id="select-all"
                          className="h-4 w-4 cursor-pointer"
                          checked={allFilteredSelected}
                          onChange={() => toggleSelectAll(filteredBroadcastUsers)}
                        />
                        <label htmlFor="select-all" className="text-sm font-medium cursor-pointer select-none">
                          {q
                            ? `Selecionar ${filteredBroadcastUsers.length} filtrado(s) de ${broadcastUsers.length}`
                            : `Selecionar todos (${broadcastUsers.length})`}
                        </label>
                      </div>
                      {filteredBroadcastUsers.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Nenhum cliente corresponde à busca.</p>
                      ) : (
                      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                        {filteredBroadcastUsers.map(u => (
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
                      )}
                    </>
                    );
                  })()}
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
                      placeholder={"Olá {{nome}}! 👋\n\nAqui é o Jarvis com um recado..."}
                      value={broadcastMsg}
                      onChange={e => setBroadcastMsg(e.target.value)}
                      maxLength={4000}
                    />
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex flex-wrap gap-1">
                        {["{{nome}}", "{{full_name}}"].map(v => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setBroadcastMsg(m => m + v)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{broadcastMsg.length}/4000</p>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Agendar envio (opcional — deixe vazio pra enviar agora)
                    </Label>
                    <input
                      type="datetime-local"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={scheduleAt}
                      min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                      onChange={e => setScheduleAt(e.target.value)}
                    />
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
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />{scheduleAt ? "Agendando..." : "Enviando..."}</>
                    ) : scheduleAt ? (
                      <><Send className="h-4 w-4 mr-2" />Agendar para {broadcastSelected.size || "..."} cliente(s)</>
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

            {/* Agendamentos pendentes */}
            {scheduledList.length > 0 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    📅 Broadcasts agendados ({scheduledList.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {scheduledList.map(s => (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground">
                            {new Date(s.send_at).toLocaleString("pt-BR")} • {Array.isArray(s.user_ids) ? s.user_ids.length : 0} destinatário(s)
                          </div>
                          <div className="truncate">{s.message}</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => cancelScheduled(s.id)}>Cancelar</Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Histórico recente */}
            {broadcastHistory.length > 0 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    📜 Histórico recente
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {broadcastHistory.map(h => (
                      <div key={h.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span>{new Date(h.created_at).toLocaleString("pt-BR")}</span>
                          <span className="text-green-600">✅ {h.sent}</span>
                          {h.failed > 0 && <span className="text-red-500">❌ {h.failed}</span>}
                          {h.skipped > 0 && <span className="text-yellow-600">⚠️ {h.skipped}</span>}
                          <span className="ml-auto">total: {h.total}</span>
                        </div>
                        <div className="line-clamp-2 text-muted-foreground">{h.message}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          userName={selectedUserName}
          open={!!selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onProfileUpdate={() => { loadProfiles(); loadPendingProfiles(); }}
        />
      )}
    </div>
  );
}
