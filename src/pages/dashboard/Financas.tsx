import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useRealtimeBadge } from "@/hooks/useRealtimeBadge";
import { LiveBadge } from "@/components/LiveBadge";
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
import { FinancialInsightCard } from "@/components/FinancialInsightCard";
import { CategoryCreateModal, CATEGORY_COLORS, type CategoryRow } from "@/components/CategoryCreateModal";
import { TransactionEditModal, type Transaction as TxEditType } from "@/components/TransactionEditModal";
import { toast } from "sonner";
import {
  Plus, TrendingDown, TrendingUp, Wallet, RefreshCw, Trash2, Download,
  Target, ArrowUpRight, ArrowDownRight, Pencil, Check, X,
  Search, Settings2, AlertTriangle, Zap, ChevronRight, CalendarDays,
} from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay,
  startOfWeek, endOfWeek, differenceInDays, getDaysInMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";

// ─────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────

type Period = "hoje" | "semana" | "mes" | "3meses" | "ano" | "tudo";

const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje", semana: "Semana", mes: "Mês",
  "3meses": "3 Meses", ano: "Ano", tudo: "Tudo",
};

// Per-category visual config — emoji + brand color
const CAT: Record<string, { emoji: string; color: string; label: string }> = {
  alimentacao:   { emoji: "🍔", color: "#f97316", label: "Alimentação" },
  transporte:    { emoji: "🚗", color: "#3b82f6", label: "Transporte" },
  moradia:       { emoji: "🏠", color: "#8b5cf6", label: "Moradia" },
  saude:         { emoji: "💊", color: "#10b981", label: "Saúde" },
  lazer:         { emoji: "🎬", color: "#ec4899", label: "Lazer" },
  educacao:      { emoji: "📚", color: "#eab308", label: "Educação" },
  trabalho:      { emoji: "💼", color: "#6366f1", label: "Trabalho" },
  assinaturas:   { emoji: "📱", color: "#06b6d4", label: "Assinaturas" },
  investimentos: { emoji: "📈", color: "#059669", label: "Investimentos" },
  outros:        { emoji: "📦", color: "#6b7280", label: "Outros" },
};

function getCat(name: string) {
  return CAT[name?.toLowerCase()] ?? { emoji: "💳", color: "#6b7280", label: name };
}

// Lista de nomes default — usada pra distinguir categorias custom
const DEFAULT_CATEGORY_NAMES = Object.keys(CAT);

// Mapeia paleta nominal (CategoryCreateModal) → hex (recharts/SVG)
const CATEGORY_COLOR_HEX: Record<string, string> = {
  violet: "#8b5cf6",
  blue:   "#3b82f6",
  green:  "#10b981",
  yellow: "#eab308",
  orange: "#f97316",
  red:    "#ef4444",
  pink:   "#ec4899",
  amber:  "#b45309",
  slate:  "#64748b",
  cyan:   "#06b6d4",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "hoje":    return { start: startOfDay(now), end: endOfDay(now) };
    case "semana":  return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
    case "mes":     return { start: startOfMonth(now), end: endOfMonth(now) };
    case "3meses":  return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) };
    case "ano": {
      const y = now.getFullYear();
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59) };
    }
    case "tudo":    return { start: new Date(0), end: new Date(8640000000000000) };
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

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(240 12% 7%)",
  border: "1px solid hsl(240 10% 18%)",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
};

// ─────────────────────────────────────────────
// SavingsRing — mini SVG donut for savings rate
// ─────────────────────────────────────────────

function SavingsRing({ pct }: { pct: number }) {
  const r = 20; const circ = 2 * Math.PI * r;
  const abs = Math.min(Math.abs(pct), 100);
  const fill = (abs / 100) * circ;
  const color = pct >= 20 ? "#10b981" : pct >= 0 ? "#eab308" : "#ef4444";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
      <circle cx="26" cy="26" r={r} fill="none" stroke="hsl(240 10% 20%)" strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        strokeDashoffset={circ / 4}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function Financas() {
  const { user } = useAuth();

  // ── Data state ──
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories]     = useState<any[]>([]);
  const [recurring, setRecurring]       = useState<any[]>([]);
  const [budgets, setBudgets]           = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);

  // ── UI state ──
  const [period, setPeriod]           = useState<Period>("mes");
  const [activeTab, setActiveTab]     = useState("visao-geral");
  const [filterType, setFilterType]   = useState("all");
  const [filterCat, setFilterCat]     = useState("all");
  const [searchTx, setSearchTx]       = useState("");

  // ── Dialogs ──
  const [dialogOpen, setDialogOpen]           = useState(false);
  const [catDialogOpen, setCatDialogOpen]     = useState(false);
  const [recurringDialog, setRecurringDialog] = useState(false);
  const [budgetDialog, setBudgetDialog]       = useState(false);
  const [newCat, setNewCat]                   = useState("");

  // ── Inline edit ──
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  // ── Modais novos: criar/editar categoria + editar transação ──
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState<CategoryRow | null>(null);
  const [txEditModalOpen, setTxEditModalOpen] = useState(false);
  const [txToEdit, setTxToEdit] = useState<TxEditType | null>(null);

  /**
   * Lookup dinâmico de categoria: primeiro tenta achar na lista do banco
   * (categorias custom têm icon + color próprios), depois cai no CAT estático.
   */
  const getCatDynamic = (name: string) => {
    const key = (name ?? "").toLowerCase().trim();
    const fromDB = categories.find((c: any) => String(c.name ?? "").toLowerCase().trim() === key);
    if (fromDB) {
      const colorObj = CATEGORY_COLORS.find((c) => c.key === fromDB.color);
      // Se categoria do banco tem cor mas é default, usa cor do CAT estático
      const fallback = CAT[key];
      return {
        emoji: fromDB.icon || fallback?.emoji || "🏷️",
        // Mapeia paleta nominal → hex pra usar em SVG/recharts
        color: colorObj ? CATEGORY_COLOR_HEX[colorObj.key] : (fallback?.color ?? "#6b7280"),
        label: fromDB.name,
      };
    }
    return getCat(name);
  };

  /** Categorias custom (não-default) — usadas pra mostrar botão de editar e validar permissão */
  const customCategoryNames = new Set(
    categories
      .filter((c: any) => !c.is_default)
      .map((c: any) => String(c.name ?? "").toLowerCase().trim())
  );

  /** Lista de categorias pra dropdowns do TransactionEditModal */
  const categoryOptionsForEdit = [
    ...DEFAULT_CATEGORY_NAMES.map((name) => ({
      name,
      label: CAT[name]?.label ?? name,
      icon: CAT[name]?.emoji,
    })),
    ...categories
      .filter((c: any) => !c.is_default)
      .map((c: any) => ({
        name: String(c.name ?? "").toLowerCase().trim(),
        label: c.name,
        icon: c.icon || "🏷️",
      })),
  ];

  const handleEditCategory = (categoryName: string) => {
    const cat = categories.find((c: any) => String(c.name ?? "").toLowerCase().trim() === categoryName.toLowerCase().trim());
    if (!cat || cat.is_default) return;
    setCategoryToEdit(cat as CategoryRow);
    setCategoryModalOpen(true);
  };

  const handleNewCategory = () => {
    setCategoryToEdit(null);
    setCategoryModalOpen(true);
  };

  const handleEditTransaction = (t: any) => {
    setTxToEdit({
      id: t.id,
      description: t.description,
      amount: Number(t.amount),
      type: t.type,
      category: t.category,
      transaction_date: t.transaction_date,
      source: t.source,
      installment_group: t.installment_group,
    });
    setTxEditModalOpen(true);
  };
  const [editForm, setEditForm]       = useState<Record<string, any>>({});

  // ── Forms ──
  const [form, setForm] = useState({
    description: "", amount: "", type: "expense",
    category: "outros", transaction_date: format(new Date(), "yyyy-MM-dd"),
  });
  const [editingRecurring, setEditingRecurring] = useState<any>(null);
  const [recurringForm, setRecurringForm]       = useState({
    description: "", amount: "", type: "expense", category: "outros",
    frequency: "monthly", next_date: format(new Date(), "yyyy-MM-dd"),
  });
  const [editingBudget, setEditingBudget] = useState<any>(null);
  const [budgetForm, setBudgetForm]       = useState({
    category: "alimentacao", amount_limit: "", alert_at_percent: "80",
  });

  // ── Realtime ──
  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(["transactions", "budgets"], user?.id, () => { loadData(); triggerLive(); });

  useEffect(() => { if (user) loadData(); }, [user]);

  // ─────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────

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

  // ─────────────────────────────────────────────
  // CRUD handlers — transactions
  // ─────────────────────────────────────────────

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
    if (error) { toast.error("Erro ao adicionar"); return; }
    toast.success("Transação adicionada!");
    setDialogOpen(false);
    setForm({ description: "", amount: "", type: "expense", category: "outros", transaction_date: format(new Date(), "yyyy-MM-dd") });
    loadData();
  };

  const handleDeleteTransaction = (id: string) => {
    // Optimistic remove
    const snapshot = transactions;
    setTransactions(prev => prev.filter(t => t.id !== id));

    let undone = false;
    const timeoutId = window.setTimeout(async () => {
      if (!undone) {
        const { error } = await supabase.from("transactions").delete().eq("id", id);
        if (error) { toast.error("Erro ao excluir"); setTransactions(snapshot); }
      }
    }, 5000);

    toast("Transação removida", {
      action: {
        label: "Desfazer",
        onClick: () => {
          undone = true;
          clearTimeout(timeoutId);
          setTransactions(snapshot);
        },
      },
      duration: 5000,
    });
  };

  const startEditTx = (t: any) => {
    setEditingTxId(t.id);
    setEditForm({
      description: t.description,
      amount: String(t.amount),
      type: t.type,
      category: t.category,
      transaction_date: t.transaction_date,
    });
  };

  const saveEditTx = async (id: string) => {
    const { error } = await supabase.from("transactions").update({
      description: editForm.description,
      amount: parseFloat(editForm.amount),
      type: editForm.type,
      category: editForm.category,
      transaction_date: editForm.transaction_date,
    }).eq("id", id);
    if (error) { toast.error("Erro ao editar"); return; }
    toast.success("Transação atualizada!");
    setEditingTxId(null);
    loadData();
  };

  // ─────────────────────────────────────────────
  // CRUD handlers — categories
  // ─────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (!newCat.trim()) return;
    const { error } = await supabase.from("categories").insert({ user_id: user!.id, name: newCat.trim(), is_default: false });
    if (error) { toast.error("Erro ao criar categoria"); return; }
    toast.success("Categoria criada!");
    setNewCat(""); setCatDialogOpen(false); loadData();
  };

  // ─────────────────────────────────────────────
  // CRUD handlers — recurring
  // ─────────────────────────────────────────────

  const handleAddRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      description: recurringForm.description,
      amount: parseFloat(recurringForm.amount),
      type: recurringForm.type,
      category: recurringForm.category,
      frequency: recurringForm.frequency,
      next_date: recurringForm.next_date,
    };
    if (editingRecurring) {
      const { error } = await (supabase.from("recurring_transactions" as any).update(payload as any).eq("id", editingRecurring.id) as any);
      if (error) { toast.error("Erro: " + error.message); return; }
      toast.success("Recorrente atualizada!");
    } else {
      const { error } = await (supabase.from("recurring_transactions" as any).insert({ ...payload, user_id: user!.id } as any) as any);
      if (error) { toast.error("Erro: " + error.message); return; }
      toast.success("Recorrente criada!");
    }
    setRecurringDialog(false); setEditingRecurring(null);
    setRecurringForm({ description: "", amount: "", type: "expense", category: "outros", frequency: "monthly", next_date: format(new Date(), "yyyy-MM-dd") });
    loadData();
  };

  const openEditRecurring = (r: any) => {
    setEditingRecurring(r);
    setRecurringForm({ description: r.description, amount: String(r.amount), type: r.type, category: r.category, frequency: r.frequency, next_date: r.next_date });
    setRecurringDialog(true);
  };

  const toggleRecurring = async (id: string, active: boolean) => {
    await (supabase.from("recurring_transactions" as any).update({ active } as any).eq("id", id) as any);
    loadData();
  };

  const deleteRecurring = async (id: string) => {
    await (supabase.from("recurring_transactions" as any).delete().eq("id", id) as any);
    toast.success("Removida!"); loadData();
  };

  // ─────────────────────────────────────────────
  // CRUD handlers — budgets
  // ─────────────────────────────────────────────

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(budgetForm.amount_limit);
    if (!limit || limit <= 0) { toast.error("Valor inválido"); return; }
    const alertPct = Math.min(Math.max(parseInt(budgetForm.alert_at_percent) || 80, 50), 100);
    if (editingBudget) {
      const { error } = await (supabase.from("budgets" as any).update({ amount_limit: limit, alert_at_percent: alertPct } as any).eq("id", editingBudget.id) as any);
      if (error) { toast.error("Erro ao atualizar"); return; }
      toast.success("Orçamento atualizado!"); setBudgetDialog(false); setEditingBudget(null); loadData();
    } else {
      const { error } = await (supabase.from("budgets" as any).insert({ user_id: user!.id, category: budgetForm.category, amount_limit: limit, alert_at_percent: alertPct, period: "monthly" } as any) as any);
      if (error) {
        if (error.code === "23505") toast.error("Já existe orçamento para essa categoria");
        else toast.error("Erro: " + error.message);
        return;
      }
      toast.success("Orçamento criado!"); setBudgetDialog(false); loadData();
    }
    setBudgetForm({ category: "alimentacao", amount_limit: "", alert_at_percent: "80" });
  };

  const deleteBudget = async (id: string) => {
    await (supabase.from("budgets" as any).delete().eq("id", id) as any);
    toast.success("Orçamento removido!"); loadData();
  };

  const openEditBudget = (b: any) => {
    setEditingBudget(b);
    setBudgetForm({ category: b.category, amount_limit: String(b.amount_limit), alert_at_percent: String(b.alert_at_percent) });
    setBudgetDialog(true);
  };

  // ─────────────────────────────────────────────
  // Derived computations
  // ─────────────────────────────────────────────

  const { start: periodStart, end: periodEnd } = getPeriodRange(period);

  // Period-filtered base (Overview metrics)
  const periodTx = transactions.filter(t => {
    const d = new Date(t.transaction_date + "T12:00:00");
    return d >= periodStart && d <= periodEnd;
  });

  // Further filtered for Transactions list
  const filteredTx = periodTx.filter(t => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (searchTx && !t.description.toLowerCase().includes(searchTx.toLowerCase())) return false;
    return true;
  });

  const totalExpenses = periodTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome   = periodTx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const balance       = totalIncome - totalExpenses;
  const txCount       = periodTx.length;
  const savingsRate   = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

  // Previous period comparison
  const periodDays = Math.max(differenceInDays(periodEnd, periodStart), 1);
  const prevStart  = new Date(periodStart.getTime() - periodDays * 86400000);
  const prevEnd    = new Date(periodStart.getTime() - 1);
  const prevTx     = transactions.filter(t => { const d = new Date(t.transaction_date + "T12:00:00"); return d >= prevStart && d <= prevEnd; });
  const prevExpenses = prevTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const prevIncome   = prevTx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expenseChange = prevExpenses > 0 ? ((totalExpenses - prevExpenses) / prevExpenses * 100) : 0;
  const incomeChange  = prevIncome   > 0 ? ((totalIncome  - prevIncome)   / prevIncome   * 100) : 0;

  // Category breakdown
  const expensesByCategory = periodTx
    .filter(t => t.type === "expense")
    .reduce((acc: Record<string, number>, t) => {
      acc[t.category] = (acc[t.category] || 0) + Number(t.amount);
      return acc;
    }, {});

  const pieData = Object.entries(expensesByCategory)
    .map(([name, value]) => ({ name, value: value as number }))
    .sort((a, b) => b.value - a.value);

  const topCategory = pieData[0] ?? null;

  // Monthly chart (6 months) — bars + balance line
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const m  = subMonths(now, 5 - i);
    const ms = startOfMonth(m);
    const me = endOfMonth(m);
    const txs = transactions.filter(t => { const d = new Date(t.transaction_date + "T12:00:00"); return d >= ms && d <= me; });
    const gastos   = txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const receitas = txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
    return { month: format(m, "MMM", { locale: ptBR }), gastos, receitas, saldo: receitas - gastos };
  });

  // Budget alerts
  const currentMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthlyExpensesByCategory: Record<string, number> = {};
  transactions
    .filter(t => t.type === "expense" && t.transaction_date >= currentMonthStart)
    .forEach(t => { monthlyExpensesByCategory[t.category] = (monthlyExpensesByCategory[t.category] ?? 0) + Number(t.amount); });

  const budgetAlerts = budgets.filter(b => {
    const spent = monthlyExpensesByCategory[b.category] ?? 0;
    return (spent / Number(b.amount_limit)) * 100 >= Number(b.alert_at_percent);
  });

  // End-of-month projection (only meaningful in "mes" period)
  const dayOfMonth        = now.getDate();
  const daysInCurrentMonth = getDaysInMonth(now);
  const projectedExpense  = (period === "mes" && dayOfMonth > 2 && totalExpenses > 0)
    ? (totalExpenses / dayOfMonth) * daysInCurrentMonth
    : null;

  // Top merchant (most repeated description with 2+ occurrences)
  const merchantMap: Record<string, { count: number; total: number }> = {};
  periodTx.filter(t => t.type === "expense").forEach(t => {
    const key = t.description.trim().toLowerCase();
    if (!merchantMap[key]) merchantMap[key] = { count: 0, total: 0 };
    merchantMap[key].count++;
    merchantMap[key].total += Number(t.amount);
  });
  const topMerchant = Object.entries(merchantMap)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.count - a.count)
    .find(m => m.count >= 2) ?? null;

  // Recurring totals
  const recurringExpenses = recurring.filter(r => r.type === "expense" && r.active);
  const recurringIncome   = recurring.filter(r => r.type === "income" && r.active);
  const totalRecurringExp = recurringExpenses.reduce((s, r) => s + Number(r.amount), 0);
  const totalRecurringInc = recurringIncome.reduce((s, r) => s + Number(r.amount), 0);

  // Grouped by date for transactions list
  const groupedByDate = filteredTx.reduce((acc: Record<string, any[]>, t) => {
    if (!acc[t.transaction_date]) acc[t.transaction_date] = [];
    acc[t.transaction_date].push(t);
    return acc;
  }, {});

  // Recent 5 for overview widget
  const recentFive = transactions.slice(0, 5);

  const freqLabel: Record<string, string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };

  // ─────────────────────────────────────────────
  // Loading skeleton
  // ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <div className="flex gap-2">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-8 w-16" />)}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            Finanças
            <LiveBadge isLive={isLive} className="ml-1" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Controle total dos seus gastos e receitas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(transactions, `financas-${format(new Date(), "yyyy-MM-dd")}.csv`)}>
            <Download className="mr-1.5 h-4 w-4" /> Exportar
          </Button>
          {/* Add transaction dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>Nova transação</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Valor (R$)</Label>
                    <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
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
                    <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{getCat(c.name).emoji} {c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Data</Label>
                    <Input type="date" value={form.transaction_date} onChange={e => setForm({ ...form, transaction_date: e.target.value })} />
                  </div>
                </div>
                <Button type="submit" className="w-full">Salvar transação</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Global period filter ── */}
      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <Button
            key={p} size="sm"
            variant={period === p ? "default" : "outline"}
            onClick={() => setPeriod(p)}
            className={`h-8 text-xs px-3 ${period !== p ? "text-muted-foreground" : ""}`}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* ── Budget alerts banner ── */}
      {budgetAlerts.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-semibold">Orçamentos em alerta: </span>
            {budgetAlerts.map((b, i) => {
              const spent = monthlyExpensesByCategory[b.category] ?? 0;
              const pct = Math.round((spent / Number(b.amount_limit)) * 100);
              return (
                <span key={b.id}>
                  {i > 0 && " · "}
                  <span className="font-mono">{getCat(b.category).emoji} {b.category} ({pct}%)</span>
                </span>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-amber-300 hover:text-amber-200 shrink-0"
            onClick={() => setActiveTab("orcamentos")}>
            Ver orçamentos <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="transacoes">
            Transações
            {filteredTx.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{filteredTx.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="recorrentes">
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Recorrentes
            {recurring.filter(r => r.active).length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {recurring.filter(r => r.active).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="orcamentos">
            <Target className="h-3.5 w-3.5 mr-1" />Orçamentos
            {budgetAlerts.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-amber-500/30 text-amber-300 px-1.5 py-0.5 rounded-full">{budgetAlerts.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════
            VISÃO GERAL
        ═══════════════════════════════════════ */}
        <TabsContent value="visao-geral" className="space-y-5 mt-5">

          {/* Resumo Inteligente do Jarvis (gerado por IA, cache 4h) */}
          <FinancialInsightCard />

          {/* Hero: 4 KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Saldo */}
            <Card className={`border-2 col-span-2 lg:col-span-1 ${balance >= 0 ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Saldo do período</p>
                <p className={`text-3xl font-bold tabular-nums ${balance >= 0 ? "text-green-400" : "text-destructive"}`}>
                  R$ {brl(Math.abs(balance))}
                </p>
                <p className={`text-xs mt-1 ${balance >= 0 ? "text-green-400/60" : "text-destructive/60"}`}>
                  {balance >= 0 ? "✓ Saldo positivo" : "✗ Saldo negativo"} · {txCount} transações
                </p>
              </CardContent>
            </Card>

            {/* Receitas */}
            <Card className="border-border bg-card">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Receitas</p>
                  <TrendingUp className="h-4 w-4 text-green-400/50" />
                </div>
                <p className="text-2xl font-bold text-green-400 tabular-nums">R$ {brl(totalIncome)}</p>
                {incomeChange !== 0 && (
                  <div className={`flex items-center gap-1 mt-1 text-xs ${incomeChange > 0 ? "text-green-400" : "text-destructive"}`}>
                    {incomeChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(incomeChange).toFixed(0)}% vs anterior
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Gastos */}
            <Card className="border-border bg-card">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Gastos</p>
                  <TrendingDown className="h-4 w-4 text-destructive/50" />
                </div>
                <p className="text-2xl font-bold text-destructive tabular-nums">R$ {brl(totalExpenses)}</p>
                {expenseChange !== 0 && (
                  <div className={`flex items-center gap-1 mt-1 text-xs ${expenseChange > 0 ? "text-destructive" : "text-green-400"}`}>
                    {expenseChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(expenseChange).toFixed(0)}% vs anterior
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Taxa de economia */}
            <Card className="border-border bg-card">
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Taxa de economia</p>
                <div className="flex items-center gap-3">
                  <SavingsRing pct={savingsRate} />
                  <div>
                    <p className={`text-2xl font-bold tabular-nums ${savingsRate >= 20 ? "text-green-400" : savingsRate >= 0 ? "text-amber-400" : "text-destructive"}`}>
                      {savingsRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {savingsRate >= 20 ? "Ótimo ritmo!" : savingsRate >= 0 ? "Pode melhorar" : "Déficit"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Insights strip — 3 auto-generated cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Insight 1: End-of-month projection */}
            <div className={`p-4 rounded-xl border ${projectedExpense !== null ? "border-primary/20 bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Projeção</p>
              </div>
              {projectedExpense !== null ? (
                <>
                  <p className="text-lg font-bold tabular-nums">R$ {brl(projectedExpense)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    estimativa de gasto até dia {daysInCurrentMonth}
                    {projectedExpense > totalExpenses * 1.2 && (
                      <span className="text-amber-400 ml-1">— acima do usual</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Dados disponíveis após o dia 3 do mês.</p>
              )}
            </div>

            {/* Insight 2: Top spending category */}
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg flex items-center justify-center text-base"
                  style={{ backgroundColor: topCategory ? getCat(topCategory.name).color + "20" : "hsl(240 10% 18%)" }}>
                  {topCategory ? getCat(topCategory.name).emoji : "📊"}
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Maior gasto</p>
              </div>
              {topCategory ? (
                <>
                  <p className="text-lg font-bold capitalize">{topCategory.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    R$ {brl(topCategory.value)} · {totalExpenses > 0 ? Math.round((topCategory.value / totalExpenses) * 100) : 0}% do total
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum gasto no período.</p>
              )}
            </div>

            {/* Insight 3: Top merchant */}
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
                  <Target className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recorrente</p>
              </div>
              {topMerchant ? (
                <>
                  <p className="text-lg font-bold capitalize truncate">{topMerchant.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {topMerchant.count}× · R$ {brl(topMerchant.total)} total
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum item repetido no período.</p>
              )}
            </div>
          </div>

          {/* Charts row */}
          <div className="grid lg:grid-cols-5 gap-5">
            {/* Monthly evolution — ComposedChart */}
            <Card className="bg-card border-border lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Evolução 6 meses</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={monthlyData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 10% 18%)" />
                    <XAxis dataKey="month" stroke="hsl(240 5% 65%)" fontSize={11} />
                    <YAxis stroke="hsl(240 5% 65%)" fontSize={11} tickFormatter={v => `R$${v}`} width={55} />
                    <Tooltip
                      formatter={(v: number, name: string) => [`R$ ${brl(v)}`, name === "gastos" ? "Gastos" : name === "receitas" ? "Receitas" : "Saldo"]}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Legend formatter={v => v === "gastos" ? "Gastos" : v === "receitas" ? "Receitas" : "Saldo"} />
                    <Bar dataKey="receitas" fill="#10b981" radius={[3, 3, 0, 0]} opacity={0.85} maxBarSize={22} />
                    <Bar dataKey="gastos"   fill="#ef4444" radius={[3, 3, 0, 0]} opacity={0.85} maxBarSize={22} />
                    <Line type="monotone" dataKey="saldo" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1", r: 3 }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Donut chart — category distribution */}
            <Card className="bg-card border-border lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Por categoria</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                          dataKey="value" paddingAngle={2} strokeWidth={0}>
                          {pieData.map((entry, idx) => (
                            <Cell key={idx} fill={getCat(entry.name).color} opacity={0.9} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number, _: string, props: any) => [
                            `R$ ${brl(v)} (${totalExpenses > 0 ? Math.round((v / totalExpenses) * 100) : 0}%)`,
                            props.payload.name,
                          ]}
                          contentStyle={TOOLTIP_STYLE}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <p className="text-base font-bold tabular-nums leading-tight">R$ {(totalExpenses / 1000 >= 1 ? (totalExpenses / 1000).toFixed(1) + "k" : brl(totalExpenses))}</p>
                        <p className="text-[10px] text-muted-foreground">gasto total</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                    <Target className="h-8 w-8 opacity-20 mb-2" />
                    <p className="text-sm">Nenhum gasto no período</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top 5 categories ranking */}
          {pieData.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" /> Ranking de categorias
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNewCategory}
                    className="h-7 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Nova categoria
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pieData.slice(0, 5).map(cat => {
                    const pct = totalExpenses > 0 ? (cat.value / totalExpenses) * 100 : 0;
                    const conf = getCatDynamic(cat.name);
                    const isCustom = customCategoryNames.has(cat.name.toLowerCase().trim());
                    return (
                      <div key={cat.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base">{conf.emoji}</span>
                            <span className="font-medium capitalize truncate">{cat.name}</span>
                            {isCustom && (
                              <button
                                onClick={() => handleEditCategory(cat.name)}
                                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-accent/40"
                                title="Editar categoria"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                            <span className="font-semibold tabular-nums w-28 text-right">R$ {brl(cat.value)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: conf.color }} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Lista categorias custom QUE NÃO TÊM gastos (não aparecem no ranking) */}
                  {categories.filter((c: any) => !c.is_default && !pieData.some(p => p.name.toLowerCase() === String(c.name ?? "").toLowerCase())).length > 0 && (
                    <div className="pt-3 mt-3 border-t border-border/40">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        Suas categorias (sem gastos no período)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {categories
                          .filter((c: any) => !c.is_default && !pieData.some(p => p.name.toLowerCase() === String(c.name ?? "").toLowerCase()))
                          .map((c: any) => {
                            const conf = getCatDynamic(c.name);
                            return (
                              <button
                                key={c.id}
                                onClick={() => handleEditCategory(c.name)}
                                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md hover:bg-accent/40 transition-colors border border-border/40"
                                title="Clique pra editar"
                              >
                                <span style={{ color: conf.color }}>●</span>
                                <span>{conf.emoji}</span>
                                <span className="capitalize">{c.name}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent transactions widget */}
          {recentFive.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Transações recentes</CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary/80"
                    onClick={() => setActiveTab("transacoes")}>
                    Ver todas <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {recentFive.map(t => {
                  const conf = getCatDynamic(t.category);
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleEditTransaction(t)}
                      className="w-full flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-accent/10 transition-colors text-left"
                      title="Clique pra editar"
                    >
                      <div className="w-1 h-7 rounded-full shrink-0" style={{ backgroundColor: conf.color }} />
                      <span className="text-base shrink-0">{conf.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{t.description}</p>
                          {t.installment_number && t.installment_total && (
                            <Badge className="text-[9px] bg-violet-500/20 text-violet-300 border-violet-500/30 shrink-0 px-1.5 py-0">
                              {t.installment_number}/{t.installment_total}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {format(new Date(t.transaction_date + "T12:00:00"), "dd/MM", { locale: ptBR })} · {t.category}
                          {t.source === "whatsapp" && <span className="text-green-500/70 ml-1">● WhatsApp</span>}
                        </p>
                      </div>
                      <p className={`text-sm font-bold tabular-nums shrink-0 ${t.type === "expense" ? "text-destructive" : "text-green-400"}`}>
                        {t.type === "expense" ? "−" : "+"}R$ {brl(Number(t.amount))}
                      </p>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════
            TRANSAÇÕES
        ═══════════════════════════════════════ */}
        <TabsContent value="transacoes" className="space-y-4 mt-5">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchTx}
                onChange={e => setSearchTx(e.target.value)}
                placeholder="Buscar por descrição..."
                className="pl-8 h-9 text-sm"
              />
              {searchTx && (
                <button onClick={() => setSearchTx("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-32 h-9 text-sm"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="expense">Gastos</SelectItem>
                <SelectItem value="income">Receitas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="w-40 h-9 text-sm"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.name}>{getCat(c.name).emoji} {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Category management */}
            <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground hover:text-foreground">
                  <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Categorias
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Gerenciar categorias</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                    {categories.map(c => {
                      const total = transactions.filter(t => t.category === c.name && t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
                      const conf = getCat(c.name);
                      return (
                        <div key={c.id} className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/30">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{conf.emoji}</span>
                            <div>
                              <p className="text-sm font-medium capitalize">{c.name}</p>
                              <p className="text-[10px] text-muted-foreground">R$ {brl(total)}</p>
                            </div>
                          </div>
                          {!c.is_default && (
                            <button onClick={async () => {
                              await supabase.from("categories").delete().eq("id", c.id);
                              toast.success("Categoria removida"); loadData();
                            }} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Nova categoria..." className="h-9 text-sm" />
                    <Button size="sm" className="h-9" onClick={handleAddCategory}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Count */}
          <p className="text-xs text-muted-foreground">
            {filteredTx.length} de {periodTx.length} transações no período
            {(searchTx || filterType !== "all" || filterCat !== "all") && (
              <button onClick={() => { setSearchTx(""); setFilterType("all"); setFilterCat("all"); }}
                className="ml-2 text-primary hover:underline">Limpar filtros</button>
            )}
          </p>

          {/* Transaction list */}
          {filteredTx.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <Wallet className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma transação encontrada.</p>
                {searchTx && <p className="text-sm text-muted-foreground/60 mt-1">Tente outro termo de busca.</p>}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByDate)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, txs]) => {
                  const txArr = txs as any[];
                  const dayExp = txArr.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
                  const dayInc = txArr.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
                  return (
                    <div key={date}>
                      {/* Date header */}
                      <div className="flex items-center justify-between py-1 mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {format(new Date(date + "T12:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                        </p>
                        <div className="flex gap-3 text-xs">
                          {dayExp > 0 && <span className="text-destructive tabular-nums">−R$ {brl(dayExp)}</span>}
                          {dayInc > 0 && <span className="text-green-400 tabular-nums">+R$ {brl(dayInc)}</span>}
                        </div>
                      </div>

                      {/* Rows */}
                      <div className="space-y-1.5">
                        {txArr.map(t => {
                          const conf = getCat(t.category);
                          const isEditing = editingTxId === t.id;
                          return (
                            <div key={t.id} className={`rounded-xl border overflow-hidden transition-colors group ${isEditing ? "border-primary/40" : "border-border hover:border-border/60"}`}>
                              {/* Main row */}
                              <div className="flex items-center gap-3 px-3 py-2.5 bg-card hover:bg-accent/5 transition-colors">
                                {/* Color accent bar */}
                                <div className="w-1 h-9 rounded-full shrink-0" style={{ backgroundColor: conf.color }} />
                                {/* Emoji icon */}
                                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base"
                                  style={{ backgroundColor: conf.color + "20" }}>
                                  {conf.emoji}
                                </div>
                                {/* Description + category */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-medium truncate">{t.description}</p>
                                    {t.installment_number && t.installment_total && (
                                      <Badge className="text-[9px] bg-violet-500/20 text-violet-300 border-violet-500/30 shrink-0 px-1.5 py-0">
                                        {t.installment_number}/{t.installment_total}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[11px] text-muted-foreground capitalize">{t.category}</span>
                                    {t.source === "whatsapp" && (
                                      <span className="text-[10px] text-green-500/70 font-medium">● WhatsApp</span>
                                    )}
                                  </div>
                                </div>
                                {/* Amount */}
                                <p className={`text-sm font-bold tabular-nums shrink-0 ${t.type === "expense" ? "text-destructive" : "text-green-400"}`}>
                                  {t.type === "expense" ? "−" : "+"}R$ {brl(Number(t.amount))}
                                </p>
                                {/* Action buttons — appear on hover */}
                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  <button
                                    onClick={() => isEditing ? setEditingTxId(null) : startEditTx(t)}
                                    className={`p-1.5 rounded-md transition-colors ${isEditing ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                                    title="Editar"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTransaction(t.id)}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Excluir"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Inline edit form */}
                              {isEditing && (
                                <div className="px-3 pb-3 pt-2 border-t border-border bg-accent/10 space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="col-span-2 space-y-1">
                                      <Label className="text-xs">Descrição</Label>
                                      <Input value={editForm.description}
                                        onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                                        className="h-8 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Valor (R$)</Label>
                                      <Input type="number" step="0.01" value={editForm.amount}
                                        onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                                        className="h-8 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Data</Label>
                                      <Input type="date" value={editForm.transaction_date}
                                        onChange={e => setEditForm({ ...editForm, transaction_date: e.target.value })}
                                        className="h-8 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Tipo</Label>
                                      <Select value={editForm.type} onValueChange={v => setEditForm({ ...editForm, type: v })}>
                                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="expense">Gasto</SelectItem>
                                          <SelectItem value="income">Receita</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Categoria</Label>
                                      <Select value={editForm.category} onValueChange={v => setEditForm({ ...editForm, category: v })}>
                                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          {categories.map(c => (
                                            <SelectItem key={c.id} value={c.name}>{getCat(c.name).emoji} {c.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                  <div className="flex gap-2 justify-end">
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingTxId(null)}>
                                      <X className="h-3 w-3 mr-1" /> Cancelar
                                    </Button>
                                    <Button size="sm" className="h-7 text-xs" onClick={() => saveEditTx(t.id)}>
                                      <Check className="h-3 w-3 mr-1" /> Salvar
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════
            RECORRENTES
        ═══════════════════════════════════════ */}
        <TabsContent value="recorrentes" className="space-y-5 mt-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5">
              <p className="text-xs text-muted-foreground mb-1">Gastos fixos / mês</p>
              <p className="text-2xl font-bold text-destructive tabular-nums">R$ {brl(totalRecurringExp)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{recurringExpenses.length} {recurringExpenses.length === 1 ? "item ativo" : "itens ativos"}</p>
            </div>
            <div className="p-4 rounded-xl border border-green-500/20 bg-green-500/5">
              <p className="text-xs text-muted-foreground mb-1">Receitas fixas / mês</p>
              <p className="text-2xl font-bold text-green-400 tabular-nums">R$ {brl(totalRecurringInc)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{recurringIncome.length} {recurringIncome.length === 1 ? "item ativo" : "itens ativos"}</p>
            </div>
          </div>

          {/* Add button */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Processadas automaticamente às 06:00.</p>
            <Dialog open={recurringDialog} onOpenChange={v => { setRecurringDialog(v); if (!v) setEditingRecurring(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => {
                  setEditingRecurring(null);
                  setRecurringForm({ description: "", amount: "", type: "expense", category: "outros", frequency: "monthly", next_date: format(new Date(), "yyyy-MM-dd") });
                }}>
                  <Plus className="mr-2 h-4 w-4" /> Nova recorrente
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>{editingRecurring ? "Editar" : "Nova"} transação recorrente</DialogTitle></DialogHeader>
                <form onSubmit={handleAddRecurring} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Input value={recurringForm.description} onChange={e => setRecurringForm({ ...recurringForm, description: e.target.value })} placeholder="Ex: Mensalidade academia" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Valor (R$)</Label>
                      <Input type="number" step="0.01" min="0" value={recurringForm.amount} onChange={e => setRecurringForm({ ...recurringForm, amount: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={recurringForm.type} onValueChange={v => setRecurringForm({ ...recurringForm, type: v })}>
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
                      <Select value={recurringForm.frequency} onValueChange={v => setRecurringForm({ ...recurringForm, frequency: v })}>
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
                      <Input type="date" value={recurringForm.next_date} onChange={e => setRecurringForm({ ...recurringForm, next_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select value={recurringForm.category} onValueChange={v => setRecurringForm({ ...recurringForm, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{getCat(c.name).emoji} {c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full">{editingRecurring ? "Atualizar" : "Criar"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {recurring.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <RefreshCw className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma transação recorrente.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Crie recorrentes para salário, aluguel, assinaturas, etc.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5">
              {/* Gastos fixos */}
              {recurringExpenses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-destructive" /> Gastos fixos
                  </p>
                  {recurringExpenses.map(r => (
                    <RecurringRow key={r.id} r={r} freqLabel={freqLabel} onEdit={openEditRecurring} onDelete={deleteRecurring} onToggle={toggleRecurring} />
                  ))}
                  {/* Inactive expense recurring */}
                  {recurring.filter(r => r.type === "expense" && !r.active).map(r => (
                    <RecurringRow key={r.id} r={r} freqLabel={freqLabel} onEdit={openEditRecurring} onDelete={deleteRecurring} onToggle={toggleRecurring} />
                  ))}
                </div>
              )}
              {/* Receitas fixas */}
              {recurringIncome.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-green-400" /> Receitas fixas
                  </p>
                  {recurringIncome.map(r => (
                    <RecurringRow key={r.id} r={r} freqLabel={freqLabel} onEdit={openEditRecurring} onDelete={deleteRecurring} onToggle={toggleRecurring} />
                  ))}
                  {recurring.filter(r => r.type === "income" && !r.active).map(r => (
                    <RecurringRow key={r.id} r={r} freqLabel={freqLabel} onEdit={openEditRecurring} onDelete={deleteRecurring} onToggle={toggleRecurring} />
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════
            ORÇAMENTOS
        ═══════════════════════════════════════ */}
        <TabsContent value="orcamentos" className="space-y-4 mt-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Metas mensais por categoria</h3>
              <p className="text-sm text-muted-foreground">O Jarvis avisa no WhatsApp quando você estiver perto do limite.</p>
            </div>
            <Dialog open={budgetDialog} onOpenChange={v => { setBudgetDialog(v); if (!v) setEditingBudget(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { setEditingBudget(null); setBudgetForm({ category: "alimentacao", amount_limit: "", alert_at_percent: "80" }); }}>
                  <Plus className="h-4 w-4 mr-1" /> Nova meta
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingBudget ? "Editar" : "Nova"} meta de gasto</DialogTitle></DialogHeader>
                <form onSubmit={handleSaveBudget} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select value={budgetForm.category} onValueChange={v => setBudgetForm(f => ({ ...f, category: v }))} disabled={!!editingBudget}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["alimentacao", "transporte", "moradia", "saude", "lazer", "educacao", "trabalho", "assinaturas", "investimentos", "outros"].map(c => (
                          <SelectItem key={c} value={c} disabled={!editingBudget && budgets.some(b => b.category === c)}>
                            {getCat(c).emoji} {getCat(c).label} {budgets.some(b => b.category === c) && !editingBudget ? "(já definido)" : ""}
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
                    <p className="text-xs text-muted-foreground">O Jarvis avisa no WhatsApp ao atingir esse percentual.</p>
                  </div>
                  <Button type="submit" className="w-full">{editingBudget ? "Atualizar" : "Criar"} meta</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {budgets.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <Target className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma meta definida.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Crie metas para controlar seus gastos por categoria.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {budgets.map(b => {
                const conf    = getCat(b.category);
                const spent   = monthlyExpensesByCategory[b.category] ?? 0;
                const limit   = Number(b.amount_limit);
                const pct     = limit > 0 ? (spent / limit) * 100 : 0;
                const remaining = limit - spent;
                const over    = pct >= 100;
                const alert   = pct >= Number(b.alert_at_percent);

                const barColor  = over ? "#ef4444" : alert ? "#f97316" : pct >= 60 ? "#eab308" : "#10b981";
                const statusTxt = over
                  ? `Estourou R$ ${brl(Math.abs(remaining))}`
                  : `Resta R$ ${brl(remaining)}`;
                const statusCls = over ? "text-destructive" : alert ? "text-amber-400" : pct >= 60 ? "text-yellow-400" : "text-green-400";

                return (
                  <Card key={b.id} className={`border-2 transition-colors ${over ? "border-destructive/30" : alert ? "border-amber-500/30" : "border-border"}`}>
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{conf.emoji}</span>
                          <span className="font-semibold capitalize">{b.category}</span>
                          {over && <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[10px]">Estourou</Badge>}
                          {!over && alert && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">Alerta</Badge>}
                        </div>
                        <div className="flex gap-1">
                          <button className="p-1 rounded text-muted-foreground hover:text-foreground" onClick={() => openEditBudget(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button className="p-1 rounded text-muted-foreground hover:text-destructive" onClick={() => deleteBudget(b.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium tabular-nums">R$ {brl(spent)}</span>
                          <span className="text-muted-foreground tabular-nums">de R$ {brl(limit)}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${over ? "animate-pulse" : ""}`}
                            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`text-xs font-medium ${statusCls}`}>{statusTxt}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60">
                          <CalendarDays className="h-2.5 w-2.5 inline mr-1" />Alerta via WhatsApp em {b.alert_at_percent}%
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Modal: criar/editar categoria custom ── */}
      <CategoryCreateModal
        open={categoryModalOpen}
        onOpenChange={(o) => {
          setCategoryModalOpen(o);
          if (!o) setCategoryToEdit(null);
        }}
        categoryToEdit={categoryToEdit}
        onSaved={() => {
          // Recarrega categorias do banco depois de criar/editar/excluir
          loadData();
        }}
      />

      {/* ── Modal: editar transação (a partir das transações recentes) ── */}
      <TransactionEditModal
        open={txEditModalOpen}
        onOpenChange={(o) => {
          setTxEditModalOpen(o);
          if (!o) setTxToEdit(null);
        }}
        transaction={txToEdit}
        categoryOptions={categoryOptionsForEdit}
        onSaved={() => {
          loadData();
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// RecurringRow sub-component
// ─────────────────────────────────────────────

function RecurringRow({ r, freqLabel, onEdit, onDelete, onToggle }: {
  r: any;
  freqLabel: Record<string, string>;
  onEdit: (r: any) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const conf = getCat(r.category);
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${r.active ? "bg-card border-border" : "bg-muted/20 border-border/40 opacity-60"}`}>
      <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: r.type === "expense" ? "#ef4444" : "#10b981" }} />
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base"
        style={{ backgroundColor: conf.color + "20" }}>
        {conf.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{r.description}</p>
        <div className="flex gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground capitalize">{r.category}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">
            <RefreshCw className="h-2.5 w-2.5 mr-1" />{freqLabel[r.frequency]}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            próxima: {format(new Date(r.next_date + "T12:00:00"), "dd/MM/yyyy")}
          </span>
        </div>
      </div>
      <p className={`text-sm font-bold tabular-nums shrink-0 ${r.type === "expense" ? "text-destructive" : "text-green-400"}`}>
        R$ {brl(Number(r.amount))}
      </p>
      <Switch checked={r.active} onCheckedChange={v => onToggle(r.id, v)} />
      <button onClick={() => onEdit(r)} className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onDelete(r.id)} className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
