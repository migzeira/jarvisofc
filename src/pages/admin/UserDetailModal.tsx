import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { format, differenceInDays, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, MessageSquare, ArrowLeft, Bot, User } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const INTENT_LABELS: Record<string, string> = {
  finance_record: "Registrar gasto/receita",
  finance_report: "Relatório financeiro",
  budget_set: "Definir orçamento",
  budget_query: "Consultar orçamento",
  recurring_create: "Transação recorrente",
  habit_create: "Criar hábito",
  habit_checkin: "Check-in de hábito",
  agenda_create: "Criar evento",
  agenda_query: "Consultar agenda",
  agenda_edit: "Editar evento",
  agenda_delete: "Cancelar evento",
  agenda_lookup: "Buscar evento",
  notes_save: "Salvar anotação",
  reminder_set: "Criar lembrete",
  reminder_list: "Listar lembretes",
  reminder_cancel: "Cancelar lembrete",
  reminder_edit: "Editar lembrete",
  reminder_snooze: "Adiar lembrete",
  event_followup: "Follow-up de evento",
  statement_import: "Importar extrato",
  greeting: "Saudação",
  ai_chat: "Conversa livre",
};

const INTENT_COLORS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4",
  "#10b981", "#84cc16", "#f59e0b", "#ef4444",
  "#ec4899", "#a855f7",
];

function intentLabel(intent: string) {
  return INTENT_LABELS[intent] ?? intent;
}

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
  onProfileUpdate?: () => void;
}

export default function UserDetailModal({ userId, userName, open, onClose, onProfileUpdate }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activatingDays, setActivatingDays] = useState("");
  // Rate limit frontend: evita múltiplos cliques simultâneos em ações admin.
  // Valor = ID da ação em curso (ex: "mensal", "anual", "trial", "permanent", "suspend",
  // "pause_agent", "pause_payment", "reactivate"). Botões com outro ID rodando ficam disabled.
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<{
    totalMessages: number;
    avgResponseMs: number | null;
    successRate: number | null;
    distinctIntents: number;
    dailyVolume: { day: string; count: number }[];
    topIntents: { intent: string; count: number }[];
  } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Chat view state
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    if (open && userId) loadAll();
  }, [open, userId]);

  // Reset chat selection when modal closes
  useEffect(() => {
    if (!open) { setSelectedConv(null); setConvMessages([]); }
  }, [open]);

  const loadAll = async () => {
    setLoading(true);
    const [pRes, cRes, tRes, aRes, iRes, evRes, remRes, nRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("conversations").select("*").eq("user_id", userId).order("last_message_at", { ascending: false }).limit(50),
      supabase.from("transactions").select("*").eq("user_id", userId).order("transaction_date", { ascending: false }).limit(50),
      supabase.from("agent_configs").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("integrations").select("*").eq("user_id", userId),
      supabase.from("events").select("*").eq("user_id", userId).order("event_date", { ascending: false }).limit(50),
      supabase.from("reminders").select("*").eq("user_id", userId).order("send_at", { ascending: false }).limit(50),
      supabase.from("notes").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    setProfile(pRes.data);
    setConversations(cRes.data || []);
    setTransactions(tRes.data || []);
    setAgentConfig(aRes.data);
    setIntegrations(iRes.data || []);
    setEvents(evRes.data || []);
    setReminders(remRes.data || []);
    setNotes(nRes.data || []);
    setLoading(false);
  };

  const loadConvMessages = useCallback(async (conv: any) => {
    setSelectedConv(conv);
    setLoadingMsgs(true);
    // Limit de 200 mensagens mais recentes. Desc + reverse no front pra
    // exibir cronológico. Sem limit, conversa ativa trava o modal.
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setConvMessages((data ?? []).reverse());
    setLoadingMsgs(false);
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    const since30 = new Date(); since30.setDate(since30.getDate() - 30);
    const since14 = new Date(); since14.setDate(since14.getDate() - 14);

    // Limits defensivos: analytics do user (últimos 30 dias). Cliente muito ativo
    // pode ter 10k+ mensagens em 30 dias — sem limit, cada abertura de UserDetailModal
    // no admin consumia MB de payload. 5000 msgs é suficiente pra top intents + volume.
    const [{ data: convs }, { data: metrics }] = await Promise.all([
      supabase.from("conversations").select("id").eq("user_id", userId).limit(500),
      (supabase as any).from("bot_metrics").select("intent, processing_time_ms, success, error_type, created_at")
        .eq("user_id", userId).gte("created_at", since30.toISOString()).order("created_at", { ascending: false }).limit(5000),
    ]);

    const convIds = convs?.map((c: { id: string }) => c.id) ?? [];
    const [{ data: msgs30 }, { data: msgs14 }] = await Promise.all([
      convIds.length > 0
        ? supabase.from("messages").select("intent, created_at, role").in("conversation_id", convIds).eq("role", "user").gte("created_at", since30.toISOString()).limit(5000)
        : Promise.resolve({ data: [] }),
      convIds.length > 0
        ? supabase.from("messages").select("created_at").in("conversation_id", convIds).eq("role", "user").gte("created_at", since14.toISOString()).limit(5000)
        : Promise.resolve({ data: [] }),
    ]);

    const metricsList = (metrics as any[]) ?? [];
    const totalMessages = msgs30?.length ?? 0;
    const successCount = metricsList.filter((m) => m.success).length;
    const totalMetrics = metricsList.length;
    const avgResponseMs = totalMetrics > 0
      ? metricsList.filter((m) => m.processing_time_ms != null).reduce((s, m, _, arr) => s + m.processing_time_ms / arr.length, 0)
      : null;
    const successRate = totalMetrics > 0 ? (successCount / totalMetrics) * 100 : null;
    const distinctIntents = new Set((msgs30 ?? []).map((m: any) => m.intent).filter(Boolean)).size;

    const dayMap: Record<string, number> = {};
    (msgs14 ?? []).forEach((m: any) => { const k = m.created_at.slice(0, 10); dayMap[k] = (dayMap[k] ?? 0) + 1; });
    const dailyVolume = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      const key = d.toLocaleDateString("sv-SE");
      return { day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), count: dayMap[key] ?? 0 };
    });

    const intentMap: Record<string, number> = {};
    (msgs30 ?? []).forEach((m: any) => { if (m.intent) intentMap[m.intent] = (intentMap[m.intent] ?? 0) + 1; });
    const topIntents = Object.entries(intentMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([intent, count]) => ({ intent: intentLabel(intent), count }));

    setAnalytics({ totalMessages, avgResponseMs, successRate, distinctIntents, dailyVolume, topIntents });
    setAnalyticsLoading(false);
  }, [userId]);

  const refreshConvMessages = async () => {
    if (!selectedConv) return;
    setLoadingMsgs(true);
    // Limit de 200 mensagens mais recentes. Conversa ativa pode ter milhares —
    // sem limit, o browser travava no DOM. Ordena desc e inverte no front
    // pra exibir cronológico.
    const [{ data: msgs }, { data: updatedConv }] = await Promise.all([
      supabase.from("messages").select("*").eq("conversation_id", selectedConv.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("conversations").select("*").eq("id", selectedConv.id).maybeSingle(),
    ]);
    setConvMessages((msgs ?? []).reverse());
    if (updatedConv) setSelectedConv(updatedConv);
    setLoadingMsgs(false);
  };

  const fmt = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }); } catch { return "—"; }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy", { locale: ptBR }); } catch { return "—"; }
  };

  // Garante que o agente fique ativo DEPOIS de liberar plano/trial/permanente.
  //
  // Por que upsert e não update:
  //   - Usuários legados (criados antes do trigger handle_new_user atual) podem
  //     não ter row em agent_configs. .update() não falha nesse caso — apenas
  //     não afeta linhas. Resultado: admin "ativava" plano mas o Jarvis continuava
  //     silencioso porque não existia config pra flag is_active=true.
  //   - .upsert({ user_id, is_active: true }, { onConflict: 'user_id' }) cria a
  //     row se faltar e atualiza se já existir. user_id tem UNIQUE na tabela, então
  //     o onConflict é seguro e idempotente.
  //
  // Também atualiza o estado local agentConfig pra UI refletir na hora, sem
  // precisar reabrir o modal.
  const ensureAgentActive = async () => {
    const { error: agentErr } = await (supabase.from("agent_configs").upsert({
      user_id: userId,
      is_active: true,
    } as any, { onConflict: "user_id" }) as any);
    if (agentErr) {
      console.error("ensureAgentActive error:", agentErr);
      toast.error("Plano ativado, mas falhei ao ativar o agente. Abra o modal de novo e clique em Retomar agente.");
      return false;
    }
    setAgentConfig((c: any) => c ? { ...c, is_active: true } : { user_id: userId, is_active: true });
    // Re-fetch depois do upsert pra pegar a row completa (id, agent_name, timestamps),
    // garantindo que qualquer render posterior use o estado real do DB — se isso falhar,
    // mantemos o setAgentConfig otimista acima pra UI nao regredir.
    try {
      const { data: fresh } = await (supabase.from("agent_configs").select("*").eq("user_id", userId).maybeSingle() as any);
      if (fresh) setAgentConfig(fresh);
    } catch { /* ignore — estado otimista ja cobriu */ }
    return true;
  };

  const handleActivateWithPeriod = async () => {
    const days = parseInt(activatingDays);
    if (!days || days < 1) { toast.error("Informe um número de dias válido"); return; }
    if (actionInProgress) return;
    setActionInProgress("trial");
    try {
      const accessUntil = addDays(new Date(), days).toISOString();
      const { error } = await (supabase.from("profiles").update({
        account_status: "active",
        access_until: accessUntil,
        access_source: "admin_trial",
        subscription_cancelled_at: null,
      } as any).eq("id", userId) as any);
      if (error) { toast.error("Erro ao ativar"); return; }
      await ensureAgentActive();
      toast.success(`Período teste de ${days} dia${days > 1 ? "s" : ""} liberado e agente ativado!`);
      setProfile((p: any) => ({ ...p, account_status: "active", access_until: accessUntil, access_source: "admin_trial", subscription_cancelled_at: null }));
      setActivatingDays("");
      onProfileUpdate?.();
    } finally {
      setActionInProgress(null);
    }
  };

  // Ativação direta de plano Mensal ou Anual — seta plan + access_until + source
  const handleActivatePlan = async (plan: "maya_mensal" | "maya_anual", days: number) => {
    if (actionInProgress) return;
    const actionId = plan === "maya_anual" ? "anual" : "mensal";
    setActionInProgress(actionId);
    try {
      const accessUntil = addDays(new Date(), days).toISOString();
      const { error } = await (supabase.from("profiles").update({
        account_status: "active",
        plan,
        access_until: accessUntil,
        access_source: "admin_plan",
        subscription_cancelled_at: null,
      } as any).eq("id", userId) as any);
      if (error) { toast.error("Erro ao ativar plano"); return; }
      await ensureAgentActive();
      const label = plan === "maya_anual" ? "Anual" : "Mensal";
      toast.success(`Plano ${label} liberado por ${days} dias e agente ativado!`);
      setProfile((p: any) => ({ ...p, plan, account_status: "active", access_until: accessUntil, access_source: "admin_plan", subscription_cancelled_at: null }));
      onProfileUpdate?.();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleActivatePermanent = async () => {
    if (actionInProgress) return;
    if (!window.confirm("Ativar conta permanentemente (sem data de expiração)?")) return;
    setActionInProgress("permanent");
    try {
      const { error } = await (supabase.from("profiles").update({
        account_status: "active",
        access_until: null,
        access_source: "admin_plan",
        subscription_cancelled_at: null,
      } as any).eq("id", userId) as any);
      if (error) { toast.error("Erro ao ativar"); return; }
      await ensureAgentActive();
      toast.success("Conta ativada permanentemente e agente ativado!");
      setProfile((p: any) => ({ ...p, account_status: "active", access_until: null, access_source: "admin_plan", subscription_cancelled_at: null }));
      onProfileUpdate?.();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSuspend = async () => {
    if (actionInProgress) return;
    // Confirmação obrigatória em ação destrutiva — cliente para de receber respostas do Jarvis
    if (!window.confirm(`Suspender a conta de ${userName}? O Jarvis vai parar de responder no WhatsApp dele.`)) return;
    setActionInProgress("suspend");
    try {
      const { error } = await (supabase.from("profiles").update({
        account_status: "suspended",
        access_until: null,
        access_source: null,
        subscription_cancelled_at: null,
      } as any).eq("id", userId) as any);
      await supabase.from("agent_configs").update({ is_active: false } as any).eq("user_id", userId);
      if (error) toast.error("Erro ao suspender");
      else {
        toast.success("Conta suspensa");
        setProfile((p: any) => ({ ...p, account_status: "suspended", access_until: null, access_source: null, subscription_cancelled_at: null }));
        onProfileUpdate?.();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  // Pausa por falta de pagamento: manda a conta pra estado "pending".
  // Diferença pra Suspender: nao bloqueia o acesso pro suporte, so zera o plano
  // — cliente ve banner amarelo + CTAs Kirvano no dashboard e pode se auto-reativar
  // renovando. Zera access_until/source pra nao dar falso "ativo" e pausa agente.
  const handlePausePayment = async () => {
    if (actionInProgress) return;
    if (!window.confirm(`Pausar a conta de ${userName} por falta de pagamento? O Jarvis para de responder e o cliente vera o CTA de renovacao.`)) return;
    setActionInProgress("pause_payment");
    try {
      const { error } = await (supabase.from("profiles").update({
        account_status: "pending",
        access_until: null,
        access_source: null,
        subscription_cancelled_at: new Date().toISOString(),
      } as any).eq("id", userId) as any);
      if (error) { toast.error("Erro ao pausar conta"); return; }
      // Pausa agente via upsert (user legado pode nao ter row em agent_configs)
      await (supabase.from("agent_configs").upsert({
        user_id: userId,
        is_active: false,
      } as any, { onConflict: "user_id" }) as any);
      toast.success("Conta pausada por falta de pagamento. Cliente vera o CTA de renovacao.");
      setProfile((p: any) => ({ ...p, account_status: "pending", access_until: null, access_source: null, subscription_cancelled_at: new Date().toISOString() }));
      setAgentConfig((c: any) => c ? { ...c, is_active: false } : { user_id: userId, is_active: false });
      onProfileUpdate?.();
    } finally {
      setActionInProgress(null);
    }
  };

  // Reativa conta suspensa. Se ainda tiver access_until valido (ou for permanente
  // vinda de admin_plan sem expiracao), volta pra "active" + agente on.
  // Caso contrario, volta pra "pending" (banner amarelo + CTAs Kirvano) sem agente,
  // pra admin decidir separadamente se quer liberar um novo plano/dias.
  const handleReactivate = async () => {
    if (actionInProgress) return;
    setActionInProgress("reactivate");
    try {
      const now = new Date();
      const hasFutureAccess = profile?.access_until && new Date(profile.access_until) > now;
      const hasPermanent = profile?.access_source === "admin_plan" && !profile?.access_until;
      const shouldActivate = hasFutureAccess || hasPermanent;

      const { error } = await (supabase.from("profiles").update({
        account_status: shouldActivate ? "active" : "pending",
      } as any).eq("id", userId) as any);
      if (error) { toast.error("Erro ao reativar"); return; }

      if (shouldActivate) {
        await ensureAgentActive();
        toast.success("Conta reativada e agente ligado.");
      } else {
        toast.success("Conta reativada, mas sem plano ativo. Cliente vera o CTA de renovacao.");
      }
      setProfile((p: any) => ({ ...p, account_status: shouldActivate ? "active" : "pending" }));
      onProfileUpdate?.();
    } finally {
      setActionInProgress(null);
    }
  };

  // Pausa apenas o agente (silencioso) — não mexe em account_status/plan
  const handlePauseAgent = async () => {
    if (actionInProgress) return;
    setActionInProgress("pause_agent");
    try {
      const { error } = await (supabase.from("agent_configs").update({ is_active: false } as any).eq("user_id", userId) as any);
      if (error) toast.error("Erro ao pausar agente");
      else {
        toast.success("Agente pausado (silencioso)");
        setAgentConfig((c: any) => ({ ...c, is_active: false }));
        onProfileUpdate?.();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const handleResumeAgent = async () => {
    if (actionInProgress) return;
    setActionInProgress("resume_agent");
    try {
      // upsert em vez de update: se o user legado não tem agent_configs,
      // cria a row com is_active=true em vez de falhar silenciosamente
      const { error } = await (supabase.from("agent_configs").upsert({
        user_id: userId,
        is_active: true,
      } as any, { onConflict: "user_id" }) as any);
      if (error) toast.error("Erro ao retomar agente");
      else {
        toast.success("Agente retomado");
        setAgentConfig((c: any) => c ? { ...c, is_active: true } : { user_id: userId, is_active: true });
        onProfileUpdate?.();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const daysSince = profile?.created_at ? differenceInDays(new Date(), new Date(profile.created_at)) : 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {userName}
            {profile && (
              <>
                <Badge variant="secondary">{profile.plan}</Badge>
                <Badge className={profile.account_status === "active" ? "bg-green-500/20 text-green-300" : profile.account_status === "suspended" ? "bg-red-500/20 text-red-300" : "bg-yellow-500/20 text-yellow-300"}>
                  {profile.account_status}
                </Badge>
                <span className="text-sm text-muted-foreground font-normal">{profile.phone_number || ""}</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{conversations.length}</p>
                <p className="text-xs text-muted-foreground">Conversas</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{transactions.length}</p>
                <p className="text-xs text-muted-foreground">Transações</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{events.length}</p>
                <p className="text-xs text-muted-foreground">Eventos</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{daysSince}</p>
                <p className="text-xs text-muted-foreground">Dias cadastrado</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{profile?.plan || "—"}</p>
                <p className="text-xs text-muted-foreground">Plano</p>
              </div>
            </div>

            {/* Admin actions */}
            <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ações administrativas</p>

              {/* Ativar plano Mensal / Anual — atalhos rápidos */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Ativar plano:</span>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs bg-violet-600 hover:bg-violet-500"
                  disabled={!!actionInProgress}
                  onClick={() => handleActivatePlan("maya_mensal", 30)}
                >
                  {actionInProgress === "mensal" ? "Ativando..." : "Mensal (+30d)"}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs bg-violet-700 hover:bg-violet-600"
                  disabled={!!actionInProgress}
                  onClick={() => handleActivatePlan("maya_anual", 365)}
                >
                  {actionInProgress === "anual" ? "Ativando..." : "Anual (+365d)"}
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
                <div className="space-y-1">
                  <Label className="text-xs">Período teste / bônus (N dias)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={activatingDays}
                      onChange={e => setActivatingDays(e.target.value)}
                      placeholder="Ex: 7"
                      className="w-24 h-8 text-sm"
                      disabled={!!actionInProgress}
                    />
                    <Button size="sm" className="h-8" disabled={!!actionInProgress} onClick={handleActivateWithPeriod}>
                      {actionInProgress === "trial" ? "Liberando..." : "Liberar"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[3, 7, 14, 30].map(d => (
                    <Button key={d} size="sm" variant="outline" className="h-8 text-xs"
                      disabled={!!actionInProgress}
                      onClick={() => { setActivatingDays(String(d)); }}>
                      {d}d
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-border">
                <span className="text-xs text-muted-foreground">Status atual:</span>
                <Badge className={
                  profile?.account_status === "active"
                    ? "bg-green-500/20 text-green-300 border-green-500/30 text-xs"
                    : profile?.account_status === "suspended"
                    ? "bg-red-500/20 text-red-300 border-red-500/30 text-xs"
                    : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-xs"
                }>
                  {profile?.account_status === "active" ? "Ativa" : profile?.account_status === "suspended" ? "Suspensa" : "Pendente"}
                </Badge>
                {agentConfig && (
                  <Badge className={
                    agentConfig.is_active
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs"
                      : "bg-gray-500/20 text-gray-300 border-gray-500/30 text-xs"
                  }>
                    Agente: {agentConfig.is_active ? "Ativo" : "Pausado"}
                  </Badge>
                )}
                {profile?.access_until && (
                  <span className="text-xs text-muted-foreground">
                    Expira: {format(new Date(profile.access_until), "dd/MM/yyyy", { locale: ptBR })}
                  </span>
                )}
                {profile?.access_source && (
                  <span className="text-xs text-muted-foreground">
                    Origem: {profile.access_source === "kirvano" ? "Kirvano" : profile.access_source === "admin_plan" ? "Admin (plano)" : profile.access_source === "admin_trial" ? "Admin (teste)" : profile.access_source}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                {profile?.account_status !== "active" && profile?.account_status !== "suspended" && (
                  <Button size="sm" variant="default" className="h-8 text-xs" disabled={!!actionInProgress} onClick={handleActivatePermanent}>
                    {actionInProgress === "permanent" ? "Ativando..." : "Ativar permanente"}
                  </Button>
                )}
                {profile?.account_status === "suspended" && (
                  <Button size="sm" variant="default" className="h-8 text-xs bg-green-600 hover:bg-green-500" disabled={!!actionInProgress} onClick={handleReactivate}>
                    {actionInProgress === "reactivate" ? "Reativando..." : "Reativar conta"}
                  </Button>
                )}
                {agentConfig && agentConfig.is_active && profile?.account_status === "active" && (
                  <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={!!actionInProgress} onClick={handlePauseAgent}>
                    {actionInProgress === "pause_agent" ? "Pausando..." : "Pausar agente"}
                  </Button>
                )}
                {agentConfig && !agentConfig.is_active && profile?.account_status === "active" && (
                  <Button size="sm" variant="default" className="h-8 text-xs bg-blue-600 hover:bg-blue-500" disabled={!!actionInProgress} onClick={handleResumeAgent}>
                    {actionInProgress === "resume_agent" ? "Retomando..." : "Retomar agente"}
                  </Button>
                )}
                {profile?.account_status === "active" && (
                  <Button size="sm" variant="outline" className="h-8 text-xs border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10" disabled={!!actionInProgress} onClick={handlePausePayment}>
                    {actionInProgress === "pause_payment" ? "Pausando..." : "Pausar por falta de pagamento"}
                  </Button>
                )}
                {profile?.account_status !== "suspended" && (
                  <Button size="sm" variant="destructive" className="h-8 text-xs ml-auto" disabled={!!actionInProgress} onClick={handleSuspend}>
                    {actionInProgress === "suspend" ? "Suspendendo..." : "Suspender conta"}
                  </Button>
                )}
              </div>
            </div>

            <Tabs defaultValue="conversations">
              <TabsList className="mb-3 flex-wrap h-auto gap-1">
                <TabsTrigger value="conversations">
                  Conversas ({conversations.length})
                </TabsTrigger>
                <TabsTrigger value="transactions">Transações ({transactions.length})</TabsTrigger>
                <TabsTrigger value="events">Agenda ({events.length})</TabsTrigger>
                <TabsTrigger value="reminders">Lembretes ({reminders.length})</TabsTrigger>
                <TabsTrigger value="notes">Notas ({notes.length})</TabsTrigger>
                <TabsTrigger value="agent">Agente</TabsTrigger>
                <TabsTrigger value="integrations">Integrações</TabsTrigger>
                <TabsTrigger value="analytics" onClick={() => { if (!analytics) loadAnalytics(); }}>Analytics</TabsTrigger>
              </TabsList>

              {/* ── CONVERSAS: full chat view ── */}
              <TabsContent value="conversations">
                {!selectedConv ? (
                  /* List of conversations */
                  conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                      <MessageSquare className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Nenhuma conversa ainda</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conversations.map(c => (
                        <button
                          key={c.id}
                          onClick={() => loadConvMessages(c)}
                          className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                <User className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">
                                  {c.contact_name || c.phone_number || "Desconhecido"}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">{c.phone_number}</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <Badge variant="secondary" className="text-xs mb-1">{c.message_count ?? 0} msgs</Badge>
                              <p className="text-xs text-muted-foreground">{fmt(c.last_message_at)}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  /* Chat view for selected conversation */
                  <div className="flex flex-col gap-3">
                    {/* Chat header */}
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSelectedConv(null); setConvMessages([]); }}
                        className="h-8 px-2 text-muted-foreground"
                      >
                        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                      </Button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {selectedConv.contact_name || selectedConv.phone_number || "Desconhecido"}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{selectedConv.phone_number}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs">{convMessages.length} msgs</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={refreshConvMessages}
                          disabled={loadingMsgs}
                          className="h-8 w-8 p-0"
                          title="Atualizar mensagens"
                        >
                          <RefreshCw className={`h-4 w-4 ${loadingMsgs ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </div>

                    {/* Messages */}
                    <ScrollArea className="h-[380px] pr-2">
                      {loadingMsgs ? (
                        <div className="space-y-3 p-2">
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-3/4" />)}
                        </div>
                      ) : convMessages.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                          Nenhuma mensagem nesta conversa
                        </div>
                      ) : (
                        <div className="space-y-3 p-2">
                          {convMessages.map(m => {
                            const isAssistant = m.role === "assistant";
                            return (
                              <div
                                key={m.id}
                                className={`flex gap-2 ${isAssistant ? "flex-row" : "flex-row-reverse"}`}
                              >
                                {/* Avatar */}
                                <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${isAssistant ? "bg-primary/20" : "bg-muted"}`}>
                                  {isAssistant
                                    ? <Bot className="h-3.5 w-3.5 text-primary" />
                                    : <User className="h-3.5 w-3.5 text-muted-foreground" />
                                  }
                                </div>
                                {/* Bubble */}
                                <div className={`max-w-[75%] space-y-0.5 ${isAssistant ? "" : "items-end flex flex-col"}`}>
                                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                                    isAssistant
                                      ? "bg-primary/15 text-foreground rounded-tl-sm"
                                      : "bg-muted text-foreground rounded-tr-sm"
                                  }`}>
                                    {m.content}
                                  </div>
                                  <div className={`flex items-center gap-2 px-1 ${isAssistant ? "" : "flex-row-reverse"}`}>
                                    <span className="text-[10px] text-muted-foreground/60">
                                      {fmt(m.created_at)}
                                    </span>
                                    {m.intent && (
                                      <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 font-normal opacity-60">
                                        {m.intent}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transactions">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead>Categoria</TableHead><TableHead>Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {transactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">{fmtDate(t.transaction_date)}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell><Badge className={t.type === "income" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>{t.type === "income" ? "Receita" : "Gasto"}</Badge></TableCell>
                        <TableCell>{t.category}</TableCell>
                        <TableCell className="font-medium">R$ {Number(t.amount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {transactions.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhuma transação</p>}
              </TabsContent>

              <TabsContent value="events">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Hora</TableHead><TableHead>Título</TableHead><TableHead>Status</TableHead><TableHead>Fonte</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {events.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{fmtDate(e.event_date)}</TableCell>
                        <TableCell className="text-sm">{e.event_time || "—"}</TableCell>
                        <TableCell>{e.title}</TableCell>
                        <TableCell><Badge variant="secondary">{e.status}</Badge></TableCell>
                        <TableCell className="text-sm">{e.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {events.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhum evento</p>}
              </TabsContent>

              <TabsContent value="reminders">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Enviar em</TableHead><TableHead>Título</TableHead><TableHead>Mensagem</TableHead><TableHead>Status</TableHead><TableHead>Recorrência</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {reminders.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm whitespace-nowrap">{fmt(r.send_at)}</TableCell>
                        <TableCell>{r.title || "—"}</TableCell>
                        <TableCell className="text-sm max-w-xs truncate">{r.message}</TableCell>
                        <TableCell><Badge className={r.status === "sent" ? "bg-green-500/20 text-green-300" : "bg-yellow-500/20 text-yellow-300"}>{r.status}</Badge></TableCell>
                        <TableCell className="text-sm">{r.recurrence}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {reminders.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhum lembrete</p>}
              </TabsContent>

              <TabsContent value="notes">
                <div className="space-y-3">
                  {notes.map(n => (
                    <div key={n.id} className="p-3 rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{n.title || "Sem título"}</span>
                        <span className="text-xs text-muted-foreground">{fmt(n.created_at)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{n.content}</p>
                    </div>
                  ))}
                  {notes.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhuma nota</p>}
                </div>
              </TabsContent>

              <TabsContent value="agent">
                {agentConfig ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Nome do agente:</strong> {agentConfig.agent_name}</div>
                    <div><strong>Apelido do usuário:</strong> {agentConfig.user_nickname || "—"}</div>
                    <div><strong>Tom:</strong> {agentConfig.tone}</div>
                    <div><strong>Idioma:</strong> {agentConfig.language}</div>
                    <div><strong>Ativo:</strong> {agentConfig.is_active ? "Sim" : "Não"}</div>
                    <div><strong>Financeiro:</strong> {agentConfig.module_finance ? "✅" : "❌"}</div>
                    <div><strong>Agenda:</strong> {agentConfig.module_agenda ? "✅" : "❌"}</div>
                    <div><strong>Notas:</strong> {agentConfig.module_notes ? "✅" : "❌"}</div>
                    <div><strong>Chat livre:</strong> {agentConfig.module_chat ? "✅" : "❌"}</div>
                    {agentConfig.custom_instructions && (
                      <div className="col-span-2"><strong>Instruções:</strong> <p className="mt-1 text-muted-foreground">{agentConfig.custom_instructions}</p></div>
                    )}
                  </div>
                ) : <p className="text-muted-foreground">Nenhuma configuração</p>}
              </TabsContent>

              <TabsContent value="integrations">
                <div className="space-y-3">
                  {integrations.map(i => (
                    <div key={i.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                      <div>
                        <span className="font-medium">{i.provider}</span>
                        {i.metadata?.email && <span className="text-sm text-muted-foreground ml-2">{(i.metadata as any).email}</span>}
                      </div>
                      <Badge className={i.is_connected ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                        {i.is_connected ? "Conectado" : "Desconectado"}
                      </Badge>
                    </div>
                  ))}
                  {integrations.length === 0 && <p className="text-muted-foreground">Nenhuma integração</p>}
                </div>
              </TabsContent>

              <TabsContent value="analytics">
                {analyticsLoading || !analytics ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}
                    </div>
                    <Skeleton className="h-48 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Últimos 30 dias</p>
                      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={loadAnalytics} disabled={analyticsLoading}>
                        <RefreshCw className="h-3 w-3" /> Atualizar
                      </Button>
                    </div>

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Mensagens", value: analytics.totalMessages.toLocaleString("pt-BR") },
                        { label: "Resp. média", value: analytics.avgResponseMs == null ? "—" : analytics.avgResponseMs >= 1000 ? `${(analytics.avgResponseMs/1000).toFixed(1)}s` : `${Math.round(analytics.avgResponseMs)}ms` },
                        { label: "Taxa sucesso", value: analytics.successRate == null ? "—" : `${analytics.successRate.toFixed(1)}%` },
                        { label: "Intents", value: analytics.distinctIntents.toLocaleString("pt-BR") },
                      ].map(kpi => (
                        <Card key={kpi.label} className="bg-muted/30">
                          <CardHeader className="pb-1 pt-3 px-3">
                            <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
                          </CardHeader>
                          <CardContent className="pb-3 px-3">
                            <p className="text-xl font-bold">{kpi.value}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card className="bg-muted/30">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-sm">Volume de mensagens (14 dias)</CardTitle>
                        </CardHeader>
                        <CardContent className="px-2 pb-3">
                          {analytics.dailyVolume.every(d => d.count === 0) ? (
                            <p className="text-muted-foreground text-xs py-8 text-center">Sem dados suficientes</p>
                          ) : (
                            <ResponsiveContainer width="100%" height={180}>
                              <BarChart data={analytics.dailyVolume} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Bar dataKey="count" name="Mensagens" radius={[3,3,0,0]}>
                                  {analytics.dailyVolume.map((_, i) => <Cell key={i} fill="#6366f1" />)}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="bg-muted/30">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-sm">Intents mais usados</CardTitle>
                        </CardHeader>
                        <CardContent className="px-2 pb-3">
                          {analytics.topIntents.length === 0 ? (
                            <p className="text-muted-foreground text-xs py-8 text-center">Sem dados suficientes</p>
                          ) : (
                            <ResponsiveContainer width="100%" height={Math.max(180, analytics.topIntents.length * 28)}>
                              <BarChart data={analytics.topIntents} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                                <YAxis type="category" dataKey="intent" width={150} tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Bar dataKey="count" name="Ocorrências" radius={[0,3,3,0]}>
                                  {analytics.topIntents.map((_, i) => <Cell key={i} fill={INTENT_COLORS[i % INTENT_COLORS.length]} />)}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
