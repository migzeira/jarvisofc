import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { MessageSquare, Wallet, CalendarDays, StickyNote, Settings, BarChart3, Link2, TrendingDown, BookOpen } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { OnboardingModal } from "@/components/OnboardingModal";

export default function DashboardHome() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [stats, setStats] = useState({ expenses: 0, events: 0, notes: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
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

    const [profileRes, agentRes, expensesRes, eventsRes, notesRes, chartRes, upcomingRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user!.id).single(),
      supabase.from("agent_configs").select("*").eq("user_id", user!.id).single(),
      supabase.from("transactions").select("amount").eq("user_id", user!.id).eq("type", "expense").gte("transaction_date", monthStart).lte("transaction_date", monthEnd),
      supabase.from("events").select("id").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).lte("event_date", weekEnd),
      supabase.from("notes").select("id").eq("user_id", user!.id),
      supabase.from("transactions").select("amount, transaction_date").eq("user_id", user!.id).eq("type", "expense").gte("transaction_date", format(subDays(now, 6), "yyyy-MM-dd")).order("transaction_date"),
      supabase.from("events").select("*").eq("user_id", user!.id).gte("event_date", format(now, "yyyy-MM-dd")).order("event_date").order("event_time").limit(3),
    ]);

    setProfile(profileRes.data);
    setAgentConfig(agentRes.data);
    setStats({
      expenses: expensesRes.data?.reduce((s, t) => s + Number(t.amount), 0) ?? 0,
      events: eventsRes.data?.length ?? 0,
      notes: notesRes.data?.length ?? 0,
    });
    setUpcomingEvents(upcomingRes.data ?? []);

    // Build chart data for last 7 days
    const dailyTotals: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      dailyTotals[format(subDays(now, i), "yyyy-MM-dd")] = 0;
    }
    chartRes.data?.forEach((t: any) => {
      if (dailyTotals[t.transaction_date] !== undefined) {
        dailyTotals[t.transaction_date] += Number(t.amount);
      }
    });
    setChartData(Object.entries(dailyTotals).map(([date, total]) => ({
      date: format(new Date(date + "T12:00:00"), "dd/MM", { locale: ptBR }),
      total,
    })));

    setLoading(false);
  };

  const toggleAgent = async () => {
    if (!agentConfig) return;
    const { error } = await supabase.from("agent_configs").update({ is_active: !agentConfig.is_active }).eq("user_id", user!.id);
    if (error) toast.error("Erro ao atualizar status");
    else {
      setAgentConfig({ ...agentConfig, is_active: !agentConfig.is_active });
      toast.success(agentConfig.is_active ? "Agente desativado" : "Agente ativado");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const whatsappLinked = !!profile?.whatsapp_lid || !!profile?.phone_number;
  const phoneSet = !!profile?.phone_number;

  return (
    <div className="space-y-6">
      {/* Onboarding: guia passo a passo pra quem acabou de criar conta */}
      {(!phoneSet || !whatsappLinked || profile?.messages_used === 0) && (
        <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-500/20">
          <CardContent className="pt-5 pb-5">
            <h3 className="text-base font-bold mb-3 flex items-center gap-2">
              🚀 Configure sua Maya em 3 passos
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${phoneSet ? "bg-green-500 text-white" : "bg-violet-500 text-white"}`}>
                  {phoneSet ? "✓" : "1"}
                </div>
                <div>
                  <p className={`text-sm font-medium ${phoneSet ? "text-green-400 line-through" : "text-white"}`}>
                    Cadastre seu WhatsApp
                  </p>
                  {!phoneSet && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vá em{" "}
                      <Link to="/dashboard/perfil" className="text-violet-400 underline">Meu Perfil</Link>
                      {" "}e salve seu número com DDD
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${profile?.messages_used > 0 ? "bg-green-500 text-white" : phoneSet ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {profile?.messages_used > 0 ? "✓" : "2"}
                </div>
                <div>
                  <p className={`text-sm font-medium ${profile?.messages_used > 0 ? "text-green-400 line-through" : ""}`}>
                    Mande "oi" no WhatsApp do bot
                  </p>
                  {profile?.messages_used === 0 && phoneSet && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Envie uma mensagem para o número do bot e a Maya vai te responder automaticamente
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${profile?.messages_used >= 3 ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {profile?.messages_used >= 3 ? "✓" : "3"}
                </div>
                <p className={`text-sm font-medium ${profile?.messages_used >= 3 ? "text-green-400 line-through" : ""}`}>
                  Registre seu primeiro gasto ou compromisso
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Olá, {profile?.display_name || "usuário"}! 👋</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOnboardingOpen(true)}
            className="gap-2 border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
          >
            <BookOpen className="h-4 w-4" />
            Como usar a Maya
          </Button>
          <Card className="bg-card border-border inline-flex items-center gap-3 px-4 py-3">
            <div className={`w-2 h-2 rounded-full ${agentConfig?.is_active ? "bg-green-500" : "bg-muted-foreground"}`} />
            <span className="text-sm">Agente {agentConfig?.is_active ? "ativo" : "inativo"}</span>
            <Switch checked={agentConfig?.is_active ?? false} onCheckedChange={toggleAgent} />
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Mensagens</p>
                <p className="text-2xl font-bold mt-1">{profile?.messages_used ?? 0}<span className="text-sm text-muted-foreground font-normal">/{profile?.messages_limit ?? 500}</span></p>
              </div>
              <MessageSquare className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Gastos este mês</p>
                <p className="text-2xl font-bold mt-1">R$ {stats.expenses.toFixed(2)}</p>
              </div>
              <Wallet className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Compromissos</p>
                <p className="text-2xl font-bold mt-1">{stats.events}</p>
              </div>
              <CalendarDays className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Anotações</p>
                <p className="text-2xl font-bold mt-1">{stats.notes}</p>
              </div>
              <StickyNote className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4 text-primary" /> Gastos — últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 10% 18%)" />
                  <XAxis dataKey="date" stroke="hsl(240 5% 65%)" fontSize={12} />
                  <YAxis stroke="hsl(240 5% 65%)" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(240 12% 7%)", border: "1px solid hsl(240 10% 18%)", borderRadius: "8px", color: "#fff" }} />
                  <Line type="monotone" dataKey="total" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ fill: "hsl(217 91% 60%)" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-10">Nenhum gasto registrado nos últimos 7 dias.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Próximos compromissos</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length > 0 ? (
              <div className="space-y-3">
                {upcomingEvents.map(e => (
                  <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg bg-accent/30">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                      {format(new Date(e.event_date + "T12:00:00"), "dd", { locale: ptBR })}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.event_time?.slice(0, 5) || "Dia todo"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">Nenhum compromisso próximo.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild><Link to="/dashboard/agente"><Settings className="mr-2 h-4 w-4" /> Configurar agente</Link></Button>
        <Button variant="outline" asChild><Link to="/dashboard/financas"><BarChart3 className="mr-2 h-4 w-4" /> Ver finanças</Link></Button>
        <Button variant="outline" asChild><Link to="/dashboard/integracoes"><Link2 className="mr-2 h-4 w-4" /> Conectar integração</Link></Button>
      </div>

      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </div>
  );
}
