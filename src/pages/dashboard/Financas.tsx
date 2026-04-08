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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, TrendingDown, TrendingUp, Wallet, RefreshCw, Trash2, Download, DollarSign, Target, ArrowUpRight, ArrowDownRight, CalendarDays } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay,
  startOfWeek, endOfWeek, differenceInDays,
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
    case "ano": {
      const y = now.getFullYear();
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59) };
    }
  }
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
  const [budgets, setBudgets] = useState<any[]>([]);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [editingBudget, setEditingBudget] = useState<any>(null);
  const [budgetForm, setBudgetForm] = useState({
    category: "alimentacao", amount_limit: "", alert_at_percent: "80",
  });
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [form, setForm] = useState({
    description: "", amount: "", type: "expense",
    category: "outros", transaction_date: format(new Date(), "yyyy-MM-dd"),
  });

  useEffect(() => { if (user) loadData(); }, [user]);

  const loadData = async () => {
    const [txRes, catRes, recRes, budRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", user!.id).order("transaction_date", { ascending: false }).limit(500),
      supabase.from("categories").select("*").eq("user_id", user!.id).order("name"),
      (supabase.from("recurring_transactions" as any).select("*").eq("user_id", user!.id).order("next_date") as any),
      (supabase.from("budgets" as any).select("*").eq("user_id", user!.id).order("category") as any),
    ]);
    setTransactions(txRes.data ?? []);
    setCategories(catRes.data ?? []);
    setRecurring(recRes.data ?? []);
    setBudgets(budRes.data ?? []);
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
    await (supabase.from("recurring_transactions" as any).update({ active } as any).eq("id", id) as any);
    loadData();
  };

  const deleteRecurring = async (id: string) => {
    await (supabase.from("recurring_transactions" as any).delete().eq("id", id) as any);
    toast.success("Removida!");
    loadData();
  };

  // ── Budget CRUD ──────────────────────────────────────────────────
  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(budgetForm.amount_limit);
    if (!limit || limit <= 0) { toast.error("Valor inválido"); return; }
    const alertPct = Math.min(Math.max(parseInt(budgetForm.alert_at_percent) || 80, 50), 100);

    if (editingBudget) {
      const { error } = await (supabase.from("budgets" as any).update({
        amount_limit: limit, alert_at_percent: alertPct,
      } as any).eq("id", editingBudget.id) as any);
      if (error) toast.error("Erro ao atualizar");
      else { toast.success("Orçamento atualizado!"); setBudgetDialog(false); setEditingBudget(null); loadData(); }
    } else {
      const { error } = await (supabase.from("budgets" as any).insert({
        user_id: user!.id,
        category: budgetForm.category,
        amount_limit: limit,
        alert_at_percent: alertPct,
        period: "monthly",
      } as any) as any);
      if (error) {
        if (error.code === "23505") toast.error("Já existe orçamento para essa categoria");
        else toast.error("Erro ao criar: " + error.message);
      } else {
        toast.success("Orçamento criado!");
        setBudgetDialog(false);
        loadData();
      }
    }
    setBudgetForm({ category: "alimentacao", amount_limit: "", alert_at_percent: "80" });
  };

  const deleteBudget = async (id: string) => {
    await (supabase.from("budgets" as any).delete().eq("id", id) as any);
    toast.success("Orçamento removido!");
    loadData();
  };

  const openEditBudget = (budget: any) => {
    setEditingBudget(budget);
    setBudgetForm({
      category: budget.category,
      amount_limit: String(budget.amount_limit),
      alert_at_percent: String(budget.alert_at_percent),
    });
    setBudgetDialog(true);
  };

  // Gastos do mes atual por categoria (para barras de orcamento)
  const currentMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthlyExpensesByCategory: Record<string, number> = {};
  transactions.filter(t => t.type === "expense" && t.transaction_date >= currentMonthStart)
    .forEach(t => { monthlyExpensesByCategory[t.category] = (monthlyExpensesByCategory[t.category] ?? 0) + Number(t.amount); });

  const handleDeleteTransaction = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Transação excluída!"); loadData(); }
  };

  const { start: periodStart, end: periodEnd } = getPeriodRange(period);

  const periodTx = transactions.filter(t => {
    const d = new Date(t.transaction_date + "T12:00:00");
    return d >= periodStart && d <= periodEnd;
  });

  const totalExpenses = periodTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = periodTx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const balance = totalIncome - totalExpenses;
  const txCount = periodTx.length;

  // Previous period comparison
  const periodDays = Math.max(differenceInDays(periodEnd, periodStart), 1);
  const prevStart = new Date(periodStart.getTime() - periodDays * 86400000);
  const prevEnd = new Date(periodStart.getTime() - 1);
  const prevTx = transactions.filter(t => {
    const d = new Date(t.transaction_date + "T12:00:00");
    return d >= prevStart && d <= prevEnd;
  });
  const prevExpenses = prevTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const prevIncome = prevTx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expenseChange = prevExpenses > 0 ? ((totalExpenses - prevExpenses) / prevExpenses * 100) : 0;
  const incomeChange = prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome * 100) : 0;

  // Daily average
  const daysInPeriod = Math.max(differenceInDays(new Date() < periodEnd ? new Date() : periodEnd, periodStart), 1);
  const dailyAvgExpense = totalExpenses / daysInPeriod;

  // Top category
  const expensesByCategory = periodTx.filter(t => t.type === "expense").reduce((acc: Record<string, number>, t) => {
    acc[t.category] = (acc[t.category] || 0) + Number(t.amount);
    return acc;
  }, {});
  const topCategory = Object.entries(expensesByCategory).sort((a, b) => (b[1] as number) - (a[1] as number))[0];

  // Pie chart data
  const pieData = Object.entries(expensesByCategory)
    .map(([name, value]) => ({ name, value: value as number }))
    .sort((a, b) => b.value - a.value);

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

  // Weekly bar chart (last 4 weeks)
  const weeklyData = Array.from({ length: 4 }, (_, i) => {
    const weekStart = startOfWeek(now, { locale: ptBR });
    const wsTime = weekStart.getTime() - (3 - i) * 7 * 86400000;
    const ws = new Date(wsTime);
    const we = new Date(wsTime + 6 * 86400000 + 86399999);
    const txs = transactions.filter(t => {
      const d = new Date(t.transaction_date + "T12:00:00");
      return d >= ws && d <= we;
    });
    return {
      week: `Sem ${i + 1}`,
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" /> Finanças
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Controle completo dos seus gastos e receitas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(transactions, `financas-${format(new Date(), "yyyy-MM-dd")}.csv`)}>
            <Download className="mr-1 h-4 w-4" /> Exportar
          </Button>
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
          <TabsTrigger value="orcamentos">
            <Target className="h-3.5 w-3.5 mr-1" />Orçamentos
            {budgets.length > 0 && (
              <span className="ml-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {budgets.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
        </TabsList>

        {/* VISÃO GERAL */}
        <TabsContent value="visao-geral" className="space-y-6">
          {/* Summary cards - 4 columns */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Gastos</p>
                  <TrendingDown className="h-5 w-5 text-destructive/50" />
                </div>
                <p className="text-2xl font-bold text-destructive">R$ {totalExpenses.toFixed(2)}</p>
                {expenseChange !== 0 && (
                  <div className={`flex items-center gap-1 mt-1 text-xs ${expenseChange > 0 ? "text-destructive" : "text-green-400"}`}>
                    {expenseChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(expenseChange).toFixed(0)}% vs período anterior
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Receitas</p>
                  <TrendingUp className="h-5 w-5 text-green-400/50" />
                </div>
                <p className="text-2xl font-bold text-green-400">R$ {totalIncome.toFixed(2)}</p>
                {incomeChange !== 0 && (
                  <div className={`flex items-center gap-1 mt-1 text-xs ${incomeChange > 0 ? "text-green-400" : "text-destructive"}`}>
                    {incomeChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(incomeChange).toFixed(0)}% vs período anterior
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo</p>
                  <Wallet className={`h-5 w-5 ${balance >= 0 ? "text-green-400/50" : "text-destructive/50"}`} />
                </div>
                <p className={`text-2xl font-bold ${balance >= 0 ? "text-green-400" : "text-destructive"}`}>R$ {balance.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1">{txCount} transações no período</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Média/dia</p>
                  <CalendarDays className="h-5 w-5 text-primary/50" />
                </div>
                <p className="text-2xl font-bold">R$ {dailyAvgExpense.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1">de gasto por dia</p>
              </CardContent>
            </Card>
          </div>

          {/* Top categories ranking */}
          {pieData.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Maiores gastos por categoria</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pieData.slice(0, 5).map((cat, idx) => {
                    const pct = totalExpenses > 0 ? (cat.value / totalExpenses) * 100 : 0;
                    return (
                      <div key={cat.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                            <span className="font-medium">{cat.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                            <span className="font-semibold w-28 text-right">R$ {cat.value.toFixed(2)}</span>
                          </div>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Pie chart */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Distribuição de gastos</CardTitle></CardHeader>
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

            {/* Line chart - 6 months */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Evolução mensal (6 meses)</CardTitle></CardHeader>
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

          {/* Weekly bar chart */}
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">Comparativo semanal</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 10% 18%)" />
                  <XAxis dataKey="week" stroke="hsl(240 5% 65%)" fontSize={11} />
                  <YAxis stroke="hsl(240 5% 65%)" fontSize={11} />
                  <Tooltip
                    formatter={(v: number) => `R$ ${v.toFixed(2)}`}
                    contentStyle={{ backgroundColor: "hsl(240 12% 7%)", border: "1px solid hsl(240 10% 18%)", borderRadius: "8px", color: "#fff" }}
                  />
                  <Legend />
                  <Bar dataKey="gastos" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="receitas" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
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
                const txArr = txs as any[];
                const dayExpenses = txArr.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
                const dayIncome = txArr.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
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
                      {txArr.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:bg-accent/5 transition-colors group">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${t.type === "expense" ? "bg-red-500/10" : "bg-green-500/10"}`}>
                            {t.type === "expense"
                              ? <TrendingDown className="h-4 w-4 text-destructive" />
                              : <TrendingUp className="h-4 w-4 text-green-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{t.description}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                              {t.source === "whatsapp" && <span className="text-[10px] text-green-500/70">via WhatsApp</span>}
                            </div>
                          </div>
                          <p className={`text-sm font-semibold shrink-0 ${t.type === "expense" ? "text-destructive" : "text-green-400"}`}>
                            {t.type === "expense" ? "-" : "+"}R$ {Number(t.amount).toFixed(2)}
                          </p>
                          <button
                            onClick={() => handleDeleteTransaction(t.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

        {/* ORÇAMENTOS */}
        <TabsContent value="orcamentos" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Metas por categoria</h3>
              <p className="text-sm text-muted-foreground">Defina limites mensais e acompanhe seus gastos</p>
            </div>
            <Dialog open={budgetDialog} onOpenChange={(v) => { setBudgetDialog(v); if (!v) setEditingBudget(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { setEditingBudget(null); setBudgetForm({ category: "alimentacao", amount_limit: "", alert_at_percent: "80" }); }}>
                  <Plus className="h-4 w-4 mr-1" /> Nova meta
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingBudget ? "Editar" : "Nova"} meta de gastos</DialogTitle></DialogHeader>
                <form onSubmit={handleSaveBudget} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select value={budgetForm.category} onValueChange={v => setBudgetForm(f => ({ ...f, category: v }))} disabled={!!editingBudget}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["alimentacao", "transporte", "moradia", "saude", "lazer", "educacao", "trabalho", "outros"].map(c => (
                          <SelectItem key={c} value={c} disabled={!editingBudget && budgets.some(b => b.category === c)}>
                            {c.charAt(0).toUpperCase() + c.slice(1)} {budgets.some(b => b.category === c) && !editingBudget ? "(já definido)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Limite mensal (R$)</Label>
                    <Input type="number" step="0.01" min="1" value={budgetForm.amount_limit}
                      onChange={e => setBudgetForm(f => ({ ...f, amount_limit: e.target.value }))}
                      placeholder="Ex: 2000" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Alertar quando atingir (%)</Label>
                    <Input type="number" min="50" max="100" value={budgetForm.alert_at_percent}
                      onChange={e => setBudgetForm(f => ({ ...f, alert_at_percent: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">A Maya avisa no WhatsApp quando atingir esse percentual</p>
                  </div>
                  <Button type="submit" className="w-full">{editingBudget ? "Atualizar" : "Criar"} meta</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {budgets.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <Target className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma meta definida.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Crie metas para controlar seus gastos por categoria!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {budgets.map((b) => {
                const catEmojis: Record<string, string> = {
                  alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
                  lazer: "🎮", educacao: "📚", trabalho: "💼", outros: "📦",
                };
                const spent = monthlyExpensesByCategory[b.category] ?? 0;
                const limit = Number(b.amount_limit);
                const pct = limit > 0 ? (spent / limit) * 100 : 0;
                const remaining = limit - spent;
                const emoji = catEmojis[b.category] ?? "📌";

                let barColor = "bg-green-500";
                let statusText = "Dentro do orçamento";
                let statusClass = "text-green-400";
                if (pct >= 100) {
                  barColor = "bg-red-500";
                  statusText = `Estourou em R$ ${Math.abs(remaining).toFixed(2)}`;
                  statusClass = "text-red-400";
                } else if (pct >= Number(b.alert_at_percent)) {
                  barColor = "bg-red-400";
                  statusText = `Atenção! ${pct.toFixed(0)}% usado`;
                  statusClass = "text-red-400";
                } else if (pct >= 60) {
                  barColor = "bg-yellow-500";
                  statusText = `Resta R$ ${remaining.toFixed(2)}`;
                  statusClass = "text-yellow-400";
                } else {
                  statusText = `Resta R$ ${remaining.toFixed(2)}`;
                }

                return (
                  <Card key={b.id} className="bg-card border-border">
                    <CardContent className="pt-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{emoji}</span>
                          <span className="font-semibold capitalize">{b.category}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditBudget(b)}>
                            <DollarSign className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteBudget(b.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>R$ {spent.toFixed(2)}</span>
                          <span className="text-muted-foreground">de R$ {limit.toFixed(2)}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor} ${pct >= 100 ? "animate-pulse" : ""}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`text-xs font-medium ${statusClass}`}>{statusText}</span>
                          <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Alerta no WhatsApp em {b.alert_at_percent}%</p>
                      </div>
                    </CardContent>
                  </Card>
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
              const pct = totalExpenses > 0 ? (total / totalExpenses) * 100 : 0;
              return (
                <Card key={c.id} className="bg-card border-border">
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <div>
                          <p className="font-medium text-sm">{c.name}</p>
                          {c.is_default && <span className="text-xs text-muted-foreground">Padrão</span>}
                        </div>
                      </div>
                      <p className="text-sm font-semibold">R$ {total.toFixed(2)}</p>
                    </div>
                    <Progress value={pct} className="h-1" />
                    <p className="text-xs text-muted-foreground mt-1">{pct.toFixed(0)}% dos gastos</p>
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
