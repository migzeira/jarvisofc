import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, TrendingDown, TrendingUp, Wallet, RefreshCw, Trash2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay,
  startOfWeek, endOfWeek, subYears, startOfYear, endOfYear, startOfQuarter, subQuarters, endOfQuarter,
} from "date-fns";
import { ptBR } from "date-fns/locale";

type Period = "hoje" | "semana" | "mes" | "3meses" | "ano";

const PIE_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6",
  "#3b82f6", "#84cc16", "#eab308", "#ef4444", "#06b6d4",
];

const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje",
  semana: "Semana",
  mes: "Mês",
  "3meses": "3 Meses",
  ano: "Ano",
};

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "hoje": return { start: startOfDay(now), end: endOfDay(now) };
    case "semana": return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
    case "mes": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "3meses": return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) };
    case "ano": return { start: startOfYear(now), end: endOfYear(now) };
  }
}

export default function Financas() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [period, setPeriod] = useState<Period>("mes");
  const [recurring, setRecurring] = useState<any[]>([]);
  const [recurringDialog, setRecurringDialog] = useState(false);
  const [recurringForm, setRecurringForm] = useState({
    description: "", amount: "", type: "expense", category: "outros",
    frequency: "monthly", next_date: format(new Date(), "yyyy-MM-dd"),
  });
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [form, setForm] = useState({
    description: "", amount: "", type: "expense",
    category: "outros", transaction_date: format(new Date(), "yyyy-MM-dd"),
  });

  useEffect(() => { if (user) loadData(); }, [user]);

  const loadData = async () => {
    const [txRes, catRes, recRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", user!.id).order("transaction_date", { ascending: false }).limit(500),
      supabase.from("categories").select("*").eq("user_id", user!.id).order("name"),
      (supabase.from("recurring_transactions" as any).select("*").eq("user_id", user!.id).order("next_date") as any),
    ]);
    setTransactions(txRes.data ?? []);
    setCategories(catRes.data ?? []);
    setRecurring(recRes.data ?? []);
    setLoading(false);
  };

  const handleAddRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await (supabase.from("recurring_transactions" as any).insert({
      user_id: user!.id,
      description: recurringForm.description,
      amount: parseFloat(recurringForm.amount),
      type: recurringForm.type,
      category: recurringForm.category,
      frequency: recurringForm.frequency,
      next_date: recurringForm.next_date,
    }) as any);
    if (error) toast.error("Erro ao criar recorrente: " + error.message);
    else {
      toast.success("Transação recorrente criada!");
      setRecurringDialog(false);
      setRecurringForm({ description: "", amount: "", type: "expense", category: "outros", frequency: "monthly", next_date: format(new Date(), "yyyy-MM-dd") });
      loadData();
    }
  };

  const toggleRecurring = async (id: string, active: boolean) => {
    await supabase.from("recurring_transactions").update({ active }).eq("id", id);
    loadData();
  };

  const deleteRecurring = async (id: string) => {
    await supabase.from("recurring_transactions").delete().eq("id", id);
    toast.success("Removida!");
    loadData();
  };

  const { start: periodStart, end: periodEnd } = getPeriodRange(period);

  const periodTx = transactions.filter(t => {
    const d = new Date(t.transaction_date + "T12:00:00");
    return d >= periodStart && d <= periodEnd;
  });

  const totalExpenses = periodTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = periodTx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const balance = totalIncome - totalExpenses;

  // Pie chart data (expenses by category)
  const pieData = Object.entries(
    periodTx.filter(t => t.type === "expense").reduce((acc: Record<string, number>, t) => {
      acc[t.category] = (acc[t.category] || 0) + Number(t.amount);
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Monthly trend (last 6 months)
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const m = subMonths(now, 5 - i);
    const ms = startOfMonth(m);
    const me = endOfMonth(m);
    const txs = transactions.filter(t => {
      const d = new Date(t.transaction_date + "T12:00:00");
      return d >= ms && d <= me;
    });
    return {
      month: format(m, "MMM", { locale: ptBR }),
      gastos: txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0),
      receitas: txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0),
    };
  });

  // Filtered + grouped by date for transactions tab
  const filteredTx = transactions.filter(t => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    return true;
  });

  const groupedByDate = filteredTx.reduce((acc: Record<string, any[]>, t) => {
    const key = t.transaction_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("transactions").insert({
      user_id: user!.id,
      description: form.description,
      amount: parseFloat(form.amount),
      type: form.type,
      category: form.category,
      transaction_date: form.transaction_date,
      source: "manual",
    });
    if (error) toast.error("Erro ao adicionar");
    else {
      toast.success("Transação adicionada!");
      setDialogOpen(false);
      setForm({ description: "", amount: "", type: "expense", category: "outros", transaction_date: format(new Date(), "yyyy-MM-dd") });
      loadData();
    }
  };

  const handleAddCategory = async () => {
    if (!newCat.trim()) return;
    const { error } = await supabase.from("categories").insert({ user_id: user!.id, name: newCat.trim(), is_default: false });
    if (error) toast.error("Erro ao criar categoria");
    else {
      toast.success("Categoria criada!");
      setNewCat("");
      setCatDialogOpen(false);
      loadData();
    }
  };

  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanças</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Nova transação</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valor (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Gasto</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input type="date" value={form.transaction_date} onChange={e => setForm({...form, transaction_date: e.target.value})} />
                </div>
              </div>
              <Button type="submit" className="w-full">Salvar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Period filter */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "outline"}
            onClick={() => setPeriod(p)}
            className={period === p ? "" : "text-muted-foreground"}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="visao-geral">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="transacoes">Transações</TabsTrigger>
          <TabsTrigger value="recorrentes">
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Recorrentes
            {recurring.filter(r => r.active).length > 0 && (
              <span className="ml-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {recurring.filter(r => r.active).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
        </TabsList>

        {/* VISÃO GERAL */}
        <TabsContent value="visao-geral" className="space-y-6">
          {/* Summary cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="pt-5 flex items-center gap-3">
                <TrendingDown className="h-8 w-8 text-destructive shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Gastos</p>
                  <p className="text-2xl font-bold text-destructive">R$ {totalExpenses.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-400 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Receitas</p>
                  <p className="text-2xl font-bold text-green-400">R$ {totalIncome.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 flex items-center gap-3">
                <Wallet className={`h-8 w-8 shrink-0 ${balance >= 0 ? "text-green-400" : "text-destructive"}`} />
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Saldo</p>
                  <p className={`text-2xl font-bold ${balance >= 0 ? "text-green-400" : "text-destructive"}`}>R$ {balance.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Pie chart */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Gastos por categoria</CardTitle></CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => `R$ ${v.toFixed(2)}`}
                        contentStyle={{ backgroundColor: "hsl(240 12% 7%)", border: "1px solid hsl(240 10% 18%)", borderRadius: "8px", color: "#fff" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-10">Nenhum gasto neste período.</p>
                )}
              </CardContent>
            </Card>

            {/* Line chart */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Últimos 6 meses</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 10% 18%)" />
                    <XAxis dataKey="month" stroke="hsl(240 5% 65%)" fontSize={11} />
                    <YAxis stroke="hsl(240 5% 65%)" fontSize={11} />
                    <Tooltip
                      formatter={(v: number) => `R$ ${v.toFixed(2)}`}
                      contentStyle={{ backgroundColor: "hsl(240 12% 7%)", border: "1px solid hsl(240 10% 18%)", borderRadius: "8px", color: "#fff" }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="gastos" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="receitas" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TRANSAÇÕES */}
        <TabsContent value="transacoes" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="expense">Gastos</SelectItem>
                <SelectItem value="income">Receitas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredTx.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <Wallet className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma transação encontrada.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Comece conversando com seu agente no WhatsApp!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByDate).map(([date, txs]) => {
                const dayExpenses = txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
                const dayIncome = txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
                return (
                  <div key={date}>
                    <div className="flex items-center justify-between py-1 mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {format(new Date(date + "T12:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                      </p>
                      <div className="flex gap-3 text-xs">
                        {dayExpenses > 0 && <span className="text-destructive">-R$ {dayExpenses.toFixed(2)}</span>}
                        {dayIncome > 0 && <span className="text-green-400">+R$ {dayIncome.toFixed(2)}</span>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {txs.map(t => (
                        <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:bg-accent/5 transition-colors">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${t.type === "expense" ? "bg-red-500/10" : "bg-green-500/10"}`}>
                            {t.type === "expense"
                              ? <TrendingDown className="h-4 w-4 text-destructive" />
                              : <TrendingUp className="h-4 w-4 text-green-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{t.description}</p>
                            <Badge variant="secondary" className="text-xs mt-0.5">{t.category}</Badge>
                          </div>
                          <p className={`text-sm font-semibold shrink-0 ${t.type === "expense" ? "text-destructive" : "text-green-400"}`}>
                            {t.type === "expense" ? "-" : "+"}R$ {Number(t.amount).toFixed(2)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* RECORRENTES */}
        <TabsContent value="recorrentes" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Transações processadas automaticamente todo dia às 06:00.</p>
            <Dialog open={recurringDialog} onOpenChange={setRecurringDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nova recorrente</Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Transação recorrente</DialogTitle></DialogHeader>
                <form onSubmit={handleAddRecurring} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Input value={recurringForm.description} onChange={e => setRecurringForm({...recurringForm, description: e.target.value})} placeholder="Ex: Mensalidade academia" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Valor (R$)</Label>
                      <Input type="number" step="0.01" min="0" value={recurringForm.amount} onChange={e => setRecurringForm({...recurringForm, amount: e.target.value})} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={recurringForm.type} onValueChange={v => setRecurringForm({...recurringForm, type: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="expense">Gasto</SelectItem>
                          <SelectItem value="income">Receita</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Frequência</Label>
                      <Select value={recurringForm.frequency} onValueChange={v => setRecurringForm({...recurringForm, frequency: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Diária</SelectItem>
                          <SelectItem value="weekly">Semanal</SelectItem>
                          <SelectItem value="monthly">Mensal</SelectItem>
                          <SelectItem value="yearly">Anual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Próxima data</Label>
                      <Input type="date" value={recurringForm.next_date} onChange={e => setRecurringForm({...recurringForm, next_date: e.target.value})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select value={recurringForm.category} onValueChange={v => setRecurringForm({...recurringForm, category: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full">Criar</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {recurring.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <RefreshCw className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma transação recorrente.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Crie recorrentes para salário, aluguel, assinaturas, etc.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {recurring.map(r => {
                const freqLabel: Record<string, string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };
                return (
                  <div key={r.id} className={`flex items-center gap-3 p-4 rounded-lg border transition-opacity ${r.active ? "bg-card border-border" : "bg-muted/30 border-border/50 opacity-60"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${r.type === "expense" ? "bg-red-500/10" : "bg-green-500/10"}`}>
                      {r.type === "expense" ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-green-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.description}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">{r.category}</Badge>
                        <Badge variant="outline" className="text-xs"><RefreshCw className="h-2.5 w-2.5 mr-1" />{freqLabel[r.frequency]}</Badge>
                        <span className="text-xs text-muted-foreground">próxima: {format(new Date(r.next_date + "T12:00:00"), "dd/MM/yyyy")}</span>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold shrink-0 ${r.type === "expense" ? "text-destructive" : "text-green-400"}`}>
                      R$ {Number(r.amount).toFixed(2)}
                    </p>
                    <Switch checked={r.active} onCheckedChange={v => toggleRecurring(r.id, v)} />
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteRecurring(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* CATEGORIAS */}
        <TabsContent value="categorias" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
              <DialogTrigger asChild><Button variant="outline"><Plus className="mr-2 h-4 w-4" /> Nova categoria</Button></DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Ex: Investimentos" />
                  </div>
                  <Button onClick={handleAddCategory} className="w-full">Criar</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((c, idx) => {
              const total = transactions.filter(t => t.category === c.name && t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
              return (
                <Card key={c.id} className="bg-card border-border">
                  <CardContent className="pt-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        {c.is_default && <span className="text-xs text-muted-foreground">Padrão</span>}
                      </div>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">R$ {total.toFixed(2)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
