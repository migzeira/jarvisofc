import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Intent labels ────────────────────────────────────────────────────────────
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

function label(intent: string) {
  return INTENT_LABELS[intent] ?? intent;
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface KPIs {
  totalMessages: number;
  avgResponseMs: number | null;
  successRate: number | null;
  distinctIntents: number;
}

interface DailyPoint { day: string; count: number }
interface IntentPoint { intent: string; count: number }
interface ResponsePoint { intent: string; avg_ms: number }
interface ErrorEntry {
  intent: string;
  error_type: string | null;
  created_at: string;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, loading }: { title: string; value: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIs>({ totalMessages: 0, avgResponseMs: null, successRate: null, distinctIntents: 0 });
  const [dailyVolume, setDailyVolume] = useState<DailyPoint[]>([]);
  const [topIntents, setTopIntents] = useState<IntentPoint[]>([]);
  const [responseByIntent, setResponseByIntent] = useState<ResponsePoint[]>([]);
  const [recentErrors, setRecentErrors] = useState<ErrorEntry[]>([]);

  useEffect(() => {
    if (!user) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadData() {
    setLoading(true);

    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    const since30Str = since30.toISOString();

    const since14 = new Date();
    since14.setDate(since14.getDate() - 14);
    const since14Str = since14.toISOString();

    // Fetch all data in parallel
    const [{ data: convs }, { data: metrics }] = await Promise.all([
      supabase.from("conversations").select("id").eq("user_id", user!.id),
      (supabase as any)
        .from("bot_metrics")
        .select("intent, processing_time_ms, success, error_type, created_at")
        .eq("user_id", user!.id)
        .gte("created_at", since30Str)
        .order("created_at", { ascending: false }),
    ]);

    const convIds = convs?.map((c: { id: string }) => c.id) ?? [];

    // Fetch messages only when we have conversation IDs
    const { data: msgs30 } = convIds.length > 0
      ? await supabase
          .from("messages")
          .select("intent, created_at, role")
          .in("conversation_id", convIds)
          .eq("role", "user")
          .gte("created_at", since30Str)
      : { data: [] };

    const { data: msgs14 } = convIds.length > 0
      ? await supabase
          .from("messages")
          .select("created_at")
          .in("conversation_id", convIds)
          .eq("role", "user")
          .gte("created_at", since14Str)
      : { data: [] };

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const totalMessages = msgs30?.length ?? 0;

    const metricsList = (metrics as any[]) ?? [];
    const successCount = metricsList.filter((m) => m.success).length;
    const totalMetrics = metricsList.length;

    const avgResponseMs = totalMetrics > 0
      ? metricsList
          .filter((m) => m.processing_time_ms != null)
          .reduce((sum, m, _, arr) => sum + m.processing_time_ms / arr.length, 0)
      : null;

    const successRate = totalMetrics > 0 ? (successCount / totalMetrics) * 100 : null;

    const distinctIntents = new Set(
      (msgs30 ?? []).map((m: { intent: string | null }) => m.intent).filter(Boolean)
    ).size;

    setKpis({ totalMessages, avgResponseMs, successRate, distinctIntents });

    // ── Daily volume (last 14 days) ───────────────────────────────────────────
    const dayMap: Record<string, number> = {};
    (msgs14 ?? []).forEach((m: { created_at: string }) => {
      const key = m.created_at.slice(0, 10);
      dayMap[key] = (dayMap[key] ?? 0) + 1;
    });

    const volumeData: DailyPoint[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const key = d.toLocaleDateString("sv-SE");
      return {
        day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        count: dayMap[key] ?? 0,
      };
    });
    setDailyVolume(volumeData);

    // ── Top intents ───────────────────────────────────────────────────────────
    const intentMap: Record<string, number> = {};
    (msgs30 ?? []).forEach((m: { intent: string | null }) => {
      if (m.intent) intentMap[m.intent] = (intentMap[m.intent] ?? 0) + 1;
    });
    const intentsData: IntentPoint[] = Object.entries(intentMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([intent, count]) => ({ intent: label(intent), count }));
    setTopIntents(intentsData);

    // ── Avg response time by intent ───────────────────────────────────────────
    const responseMap: Record<string, number[]> = {};
    metricsList.forEach((m) => {
      if (m.processing_time_ms != null) {
        if (!responseMap[m.intent]) responseMap[m.intent] = [];
        responseMap[m.intent].push(m.processing_time_ms);
      }
    });
    const responseData: ResponsePoint[] = Object.entries(responseMap)
      .map(([intent, times]) => ({
        intent: label(intent),
        avg_ms: Math.round(times.reduce((s, v) => s + v, 0) / times.length),
      }))
      .sort((a, b) => b.avg_ms - a.avg_ms)
      .slice(0, 10);
    setResponseByIntent(responseData);

    // ── Recent errors ─────────────────────────────────────────────────────────
    const errors: ErrorEntry[] = metricsList
      .filter((m) => !m.success)
      .slice(0, 10)
      .map((m) => ({ intent: label(m.intent), error_type: m.error_type, created_at: m.created_at }));
    setRecentErrors(errors);

    setLoading(false);
  }

  // ── Formatters ───────────────────────────────────────────────────────────────
  function formatMs(ms: number | null): string {
    if (ms == null) return "—";
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }

  function formatRate(rate: number | null): string {
    if (rate == null) return "—";
    return `${rate.toFixed(1)}%`;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Performance do bot — últimos 30 dias</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total de mensagens" value={kpis.totalMessages.toLocaleString("pt-BR")} loading={loading} />
        <KpiCard title="Tempo médio de resposta" value={formatMs(kpis.avgResponseMs)} loading={loading} />
        <KpiCard title="Taxa de sucesso" value={formatRate(kpis.successRate)} loading={loading} />
        <KpiCard title="Intents classificados" value={kpis.distinctIntents.toLocaleString("pt-BR")} loading={loading} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume de mensagens */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume de mensagens</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : dailyVolume.every((d) => d.count === 0) ? (
              <p className="text-muted-foreground text-sm py-16 text-center">Sem dados suficientes</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyVolume} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Mensagens" radius={[3, 3, 0, 0]}>
                    {dailyVolume.map((_, i) => (
                      <Cell key={i} fill="#6366f1" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Intents mais usados */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Intents mais usados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : topIntents.length === 0 ? (
              <p className="text-muted-foreground text-sm py-16 text-center">Sem dados suficientes</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, topIntents.length * 32)}>
                <BarChart data={topIntents} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="intent" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Ocorrências" radius={[0, 3, 3, 0]}>
                    {topIntents.map((_, i) => (
                      <Cell key={i} fill={INTENT_COLORS[i % INTENT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Response time by intent */}
      {(loading || responseByIntent.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tempo de resposta médio por intent</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={responseByIntent} margin={{ top: 4, right: 8, left: -8, bottom: 40 }}>
                  <XAxis dataKey="intent" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip formatter={(v: number) => [formatMs(v), "Tempo médio"]} />
                  <Bar dataKey="avg_ms" name="Tempo médio" radius={[3, 3, 0, 0]}>
                    {responseByIntent.map((_, i) => (
                      <Cell key={i} fill={INTENT_COLORS[i % INTENT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Erros recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : recentErrors.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum erro registrado nos últimos 30 dias.</p>
          ) : (
            <ul className="space-y-2">
              {recentErrors.map((e, i) => (
                <li key={i} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="font-medium">{e.intent}</span>
                    {e.error_type && (
                      <span className="ml-2 text-xs text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                        {e.error_type}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
