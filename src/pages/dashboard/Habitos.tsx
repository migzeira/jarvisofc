import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useRealtimeBadge } from "@/hooks/useRealtimeBadge";
import { LiveBadge } from "@/components/LiveBadge";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Flame, Trophy, CheckCircle2, Trash2, Settings2,
  Zap, Pencil, X,
} from "lucide-react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type ConfigType = "single_time" | "interval" | "multiple_times" | "meal_times" | "weekly" | "weekly_days";
type PresetKey =
  | "bible_verse" | "motivation" | "water" | "medication" | "sunscreen"
  | "meals" | "breathing" | "sleep" | "call_parents" | "emotional"
  | "gratitude" | "pet_walk" | "plants" | "reading";

interface PresetDef {
  key: PresetKey;
  name: string;
  desc: string;
  icon: string;
  color: string;
  configType: ConfigType;
  defaultTime?: string;
  defaultTimes?: string[];
  defaultInterval?: number;
  defaultStart?: string;
  defaultEnd?: string;
  defaultDay?: number;
  defaultDays?: number[];
  recurrence: "daily" | "weekly" | "hourly";
}

interface HabitConfig {
  time?: string;
  times?: string[];
  interval?: number;
  startTime?: string;
  endTime?: string;
  day?: number;
  days?: number[];
}

interface Habit {
  id: string;
  name: string;
  description: string | null;
  frequency: string;
  times_per_day: number;
  reminder_times: string[] | string;
  target_days: number[] | string;
  icon: string;
  color: string;
  is_active: boolean;
  current_streak: number;
  best_streak: number;
  preset_key: string | null;
  habit_config: HabitConfig | null;
  created_at: string;
}

interface HabitLog {
  id: string;
  habit_id: string;
  logged_date: string;
  logged_at: string;
  note: string | null;
}

// ─────────────────────────────────────────────
// 14 Preset Habits
// ─────────────────────────────────────────────

const PRESET_HABITS: PresetDef[] = [
  {
    key: "bible_verse",
    name: "Versículo do dia",
    desc: "Mensagem bíblica inspiradora todo dia",
    icon: "✝️",
    color: "#f59e0b",
    configType: "single_time",
    defaultTime: "07:00",
    recurrence: "daily",
  },
  {
    key: "motivation",
    name: "Frase motivacional",
    desc: "Uma frase para começar o dia com energia",
    icon: "💪",
    color: "#8b5cf6",
    configType: "single_time",
    defaultTime: "07:30",
    recurrence: "daily",
  },
  {
    key: "water",
    name: "Beber água",
    desc: "Lembretes para se hidratar durante o dia",
    icon: "💧",
    color: "#3b82f6",
    configType: "interval",
    defaultInterval: 2,
    defaultStart: "08:00",
    defaultEnd: "22:00",
    recurrence: "daily",
  },
  {
    key: "medication",
    name: "Remédio / Vitamina",
    desc: "Hora de tomar seus medicamentos",
    icon: "💊",
    color: "#ef4444",
    configType: "multiple_times",
    defaultTimes: ["08:00"],
    recurrence: "daily",
  },
  {
    key: "sunscreen",
    name: "Protetor solar",
    desc: "Não esqueça o protetor toda manhã",
    icon: "🧴",
    color: "#f97316",
    configType: "single_time",
    defaultTime: "08:30",
    recurrence: "daily",
  },
  {
    key: "meals",
    name: "Hora de comer",
    desc: "Lembretes para as refeições do dia",
    icon: "🍽️",
    color: "#22c55e",
    configType: "meal_times",
    defaultTimes: ["07:30", "12:00", "19:00"],
    recurrence: "daily",
  },
  {
    key: "breathing",
    name: "Respiração / Alongamento",
    desc: "Pausas para respirar e se alongar",
    icon: "🧘",
    color: "#14b8a6",
    configType: "interval",
    defaultInterval: 3,
    defaultStart: "09:00",
    defaultEnd: "18:00",
    recurrence: "daily",
  },
  {
    key: "sleep",
    name: "Hora de dormir",
    desc: "Lembrete para descansar na hora certa",
    icon: "😴",
    color: "#6366f1",
    configType: "single_time",
    defaultTime: "22:00",
    recurrence: "daily",
  },
  {
    key: "call_parents",
    name: "Ligar pra mãe / pai",
    desc: "Não esqueça de dar uma ligadinha",
    icon: "📞",
    color: "#ec4899",
    configType: "weekly",
    defaultDay: 0,
    defaultTime: "18:00",
    recurrence: "weekly",
  },
  {
    key: "emotional",
    name: "Check-in emocional",
    desc: "Como você está se sentindo hoje?",
    icon: "😊",
    color: "#a78bfa",
    configType: "single_time",
    defaultTime: "20:00",
    recurrence: "daily",
  },
  {
    key: "gratitude",
    name: "Gratidão",
    desc: "Momento para refletir e agradecer",
    icon: "🙏",
    color: "#f59e0b",
    configType: "single_time",
    defaultTime: "21:00",
    recurrence: "daily",
  },
  {
    key: "pet_walk",
    name: "Passeio com pet",
    desc: "Seu bichinho está esperando!",
    icon: "🐕",
    color: "#84cc16",
    configType: "multiple_times",
    defaultTimes: ["07:00", "18:00"],
    recurrence: "daily",
  },
  {
    key: "plants",
    name: "Regar as plantas",
    desc: "Suas plantinhas precisam de você",
    icon: "🌿",
    color: "#10b981",
    configType: "weekly_days",
    defaultDays: [1, 3, 5],
    defaultTime: "08:00",
    recurrence: "weekly",
  },
  {
    key: "reading",
    name: "Leitura",
    desc: "20 minutinhos de leitura por dia",
    icon: "📖",
    color: "#6366f1",
    configType: "single_time",
    defaultTime: "21:30",
    recurrence: "daily",
  },
];

const DAY_NAMES_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEK_DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ICON_OPTIONS = ["🎯", "💧", "🏃", "📚", "🧘", "💪", "🥗", "💊", "🎵", "✍️", "🧠", "😴", "📝", "🏆", "🌟", "🎨"];
const COLOR_OPTIONS = ["#6366f1", "#ec4899", "#22c55e", "#f97316", "#3b82f6", "#14b8a6", "#eab308", "#ef4444", "#8b5cf6", "#84cc16"];

// ─────────────────────────────────────────────
// Helpers: time conversion (Brazil UTC-3)
// ─────────────────────────────────────────────

/** Converts Brazil local time "HH:MM" to next UTC ISO occurrence (daily) */
function nextDailyUTC(localTimeHHMM: string): string {
  const [lh, lm] = localTimeHHMM.split(":").map(Number);
  const now = new Date();

  // Current Brazil date (UTC-3)
  const brNow = new Date(now.getTime() - 3 * 3_600_000);
  const [brYear, brMonth, brDay] = brNow.toISOString().slice(0, 10).split("-").map(Number);

  // Brazil to UTC: add 3 hours
  let utcH = lh + 3;
  let dayAdd = 0;
  if (utcH >= 24) { utcH -= 24; dayAdd = 1; }

  const candidate = new Date(Date.UTC(brYear, brMonth - 1, brDay + dayAdd, utcH, lm, 0));

  // If already past, schedule for tomorrow
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.toISOString();
}

/** Next UTC occurrence of a specific weekday + local time (weekly) */
function nextWeeklyUTC(localTimeHHMM: string, targetDayOfWeek: number): string {
  const [lh, lm] = localTimeHHMM.split(":").map(Number);
  const now = new Date();

  // Current Brazil date
  const brNow = new Date(now.getTime() - 3 * 3_600_000);
  const [brYear, brMonth, brDay] = brNow.toISOString().slice(0, 10).split("-").map(Number);
  const brDayOfWeek = brNow.getUTCDay();

  let utcH = lh + 3;
  let utcDayAdd = 0;
  if (utcH >= 24) { utcH -= 24; utcDayAdd = 1; }

  // Days until target weekday in Brazil
  let daysUntil = (targetDayOfWeek - brDayOfWeek + 7) % 7;

  // If today is the target day, check if time has passed
  if (daysUntil === 0) {
    const todayCandidate = new Date(Date.UTC(brYear, brMonth - 1, brDay + utcDayAdd, utcH, lm, 0));
    if (todayCandidate.getTime() > now.getTime()) {
      return todayCandidate.toISOString();
    }
    daysUntil = 7; // Already passed today, use next week
  }

  const candidate = new Date(Date.UTC(brYear, brMonth - 1, brDay + daysUntil + utcDayAdd, utcH, lm, 0));
  return candidate.toISOString();
}

/** Generate time slots from interval config.
 *  Returns [] (and never crashes) if startTime >= endTime or interval <= 0. */
function generateIntervalTimes(interval: number, startTime: string, endTime: string): string[] {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em = 0] = endTime.split(":").map(Number);
  if (!interval || interval <= 0) return [];

  const startMinutes = sh * 60 + sm;
  const endMinutes   = eh * 60 + em;
  if (startMinutes >= endMinutes) return []; // Bug #5: validate start < end

  const times: string[] = [];
  let current = startMinutes;
  while (current <= endMinutes) {
    const h = Math.floor(current / 60);
    const m = current % 60;
    if (h >= 24) break; // Bug #4: >= 24 prevents "24:00"
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    current += interval * 60;
  }
  return times;
}

/** Message to send for each preset habit */
function getHabitMessage(key: PresetKey, time?: string): string {
  switch (key) {
    case "bible_verse":   return "{{habit:bible_verse}}";
    case "motivation":    return "{{habit:motivation}}";
    case "water":         return "💧 Hora de beber água! Mantenha-se hidratado(a). 🥤";
    case "medication":    return "💊 Hora de tomar seu remédio / vitamina! Não pule! ✅";
    case "sunscreen":     return "🧴 Lembra do protetor solar hoje! ☀️";
    case "meals":         return getMealMessage(time ?? "12:00");
    case "breathing":     return "🧘 Pausa de 5 minutos para respirar fundo e se alongar. Você merece! ✨";
    case "sleep":         return "😴 Hora de descansar! Uma boa noite de sono é essencial. Bom descanso! 🌙";
    case "call_parents":  return "📞 Já ligou pra mãe ou pro pai essa semana? Eles adoram ouvir sua voz! ❤️";
    case "emotional":     return "😊 Como você está se sentindo hoje? Me conta com uma palavra!";
    case "gratitude":     return "🙏 O que você tem a agradecer hoje? Pense em 3 coisas boas que aconteceram.";
    case "pet_walk":      return "🐕 Hora do passeio! Seu pet está te esperando. Bora lá! 🐾";
    case "plants":        return "🌿 Suas plantinhas precisam de água hoje! Não as esqueça. 💚";
    case "reading":       return "📖 Que tal 20 minutinhos de leitura agora? Abra aquele livro que você adora!";
    default:              return "⏰ Hora do seu hábito diário!";
  }
}

function getMealMessage(time: string): string {
  const [h] = time.split(":").map(Number);
  if (h < 10) return "☕ Bom dia! Hora do café da manhã. Não pule essa refeição!";
  if (h < 15) return "🍽️ Hora do almoço! Faça uma pausa e se alimente bem.";
  if (h < 18) return "🥗 Lanche da tarde! Hora de repor as energias.";
  return "🌙 Hora do jantar! Cuide-se e coma bem esta noite.";
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function Habitos() {
  const { user } = useAuth();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [userPhone, setUserPhone] = useState<string>("");

  // Config modal for preset habits
  const [configModal, setConfigModal] = useState<{
    open: boolean;
    preset: PresetDef | null;
    editingHabit: Habit | null;
  }>({ open: false, preset: null, editingHabit: null });

  const [configState, setConfigState] = useState<HabitConfig>({});
  const [configSaving, setConfigSaving] = useState(false);

  // Custom habit dialog
  const [customOpen, setCustomOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<Habit | null>(null);
  const [customForm, setCustomForm] = useState({
    name: "", description: "", reminder_time: "08:00",
    icon: "🎯", color: "#6366f1",
    target_days: [0, 1, 2, 3, 4, 5, 6] as number[],
    is_recurring: false, interval: 2, startTime: "08:00", endTime: "22:00",
  });

  // ── Load data ──────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 0 }), "yyyy-MM-dd");

    const [hRes, lRes, pRes] = await Promise.all([
      (supabase.from("habits" as any).select("*").eq("user_id", user.id).order("created_at") as any),
      (supabase.from("habit_logs" as any).select("*").eq("user_id", user.id).gte("logged_date", weekStart) as any),
      // Bug #3: only select phone_number (confirmed column), avoid unknown column error
      (supabase.from("profiles").select("phone_number").eq("id", user.id).maybeSingle() as any),
    ]);

    setHabits(hRes.data ?? []);
    setLogs(lRes.data ?? []);
    if (pRes.data && !pRes.error) {
      setUserPhone((pRes.data as any).phone_number ?? "");
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const { triggerLive, isLive } = useRealtimeBadge();
  useRealtimeSync(["habits", "habit_logs"], user?.id, () => { loadData(); triggerLive(); });

  // ── Derived state ──────────────────────────────
  // Bug #8: recompute today on every render so it stays correct past midnight
  const today = format(new Date(), "yyyy-MM-dd");
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Map preset_key → active habit record
  const activePresetMap = new Map<string, Habit>();
  for (const h of habits) {
    if (h.preset_key && h.is_active) activePresetMap.set(h.preset_key, h);
  }
  // All activated habit records (preset + custom)
  const activeHabits = habits.filter(h => h.is_active);
  const customHabits = habits.filter(h => !h.preset_key);
  // Bug #2: only count today's logs for *currently active* habits to prevent > 100%
  const activeHabitIds = new Set(activeHabits.map(h => h.id));

  // ── Activate preset: open config modal ────────────────────────
  const handlePresetToggle = async (preset: PresetDef, shouldActivate: boolean) => {
    if (!shouldActivate) {
      // Deactivate
      const habit = activePresetMap.get(preset.key);
      if (!habit) return;
      await deactivateHabit(habit.id);
      return;
    }

    // Check if deactivated habit already exists (re-activate)
    const existingDeactivated = habits.find(h => h.preset_key === preset.key && !h.is_active);
    if (existingDeactivated) {
      // Re-open config for them to verify settings, then re-activate
      const cfg = existingDeactivated.habit_config as HabitConfig ?? buildDefaultConfig(preset);
      openConfigModal(preset, existingDeactivated, cfg);
      return;
    }

    // First activation - open config modal with defaults
    openConfigModal(preset, null, buildDefaultConfig(preset));
  };

  function buildDefaultConfig(preset: PresetDef): HabitConfig {
    switch (preset.configType) {
      case "single_time":
        return { time: preset.defaultTime ?? "08:00" };
      case "interval":
        return { interval: preset.defaultInterval ?? 2, startTime: preset.defaultStart ?? "08:00", endTime: preset.defaultEnd ?? "22:00" };
      case "multiple_times":
      case "meal_times":
        return { times: [...(preset.defaultTimes ?? ["08:00"])] };
      case "weekly":
        return { day: preset.defaultDay ?? 0, time: preset.defaultTime ?? "18:00" };
      case "weekly_days":
        return { days: [...(preset.defaultDays ?? [1, 3, 5])], time: preset.defaultTime ?? "08:00" };
      default:
        return {};
    }
  }

  function openConfigModal(preset: PresetDef, editingHabit: Habit | null, cfg: HabitConfig) {
    setConfigState({ ...cfg });
    setConfigModal({ open: true, preset, editingHabit });
  }

  const deactivateHabit = async (habitId: string) => {
    // Deactivate the habit
    await (supabase.from("habits" as any).update({ is_active: false } as any).eq("id", habitId) as any);
    // Delete pending habit reminders (no "cancelled" status exists — just delete them)
    await (supabase.from("reminders" as any) as any)
      .delete()
      .eq("habit_id", habitId)
      .eq("status", "pending");
    toast.success("Hábito desativado.");
    loadData();
  };

  // ── Save preset config ─────────────────────────
  const handleSavePresetConfig = async () => {
    if (!configModal.preset || !user) return;

    const preset = configModal.preset;
    const cfg = configState;

    // Bug #5: validate interval config before saving
    if (preset.configType === "interval") {
      const times = generateIntervalTimes(
        cfg.interval ?? 2, cfg.startTime ?? "08:00", cfg.endTime ?? "22:00"
      );
      if (times.length === 0) {
        toast.error("O horário de início deve ser antes do horário de fim.");
        return;
      }
    }
    // Validate multiple_times / meal_times has at least one valid time
    if (preset.configType === "multiple_times" || preset.configType === "meal_times") {
      if (!cfg.times || cfg.times.length === 0) {
        toast.error("Adicione pelo menos um horário.");
        return;
      }
    }
    // Validate weekly_days has at least one day selected
    if (preset.configType === "weekly_days") {
      if (!cfg.days || cfg.days.length === 0) {
        toast.error("Selecione pelo menos um dia da semana.");
        return;
      }
    }

    setConfigSaving(true);

    try {
      let habitId: string;

      if (configModal.editingHabit) {
        // Update existing habit
        habitId = configModal.editingHabit.id;
        await (supabase.from("habits" as any).update({
          is_active: true,
          habit_config: cfg,
          updated_at: new Date().toISOString(),
        } as any).eq("id", habitId) as any);

        // Delete existing pending reminders before recreating
        await (supabase.from("reminders" as any) as any)
          .delete()
          .eq("habit_id", habitId)
          .eq("status", "pending");
      } else {
        // Create new habit record
        // Bug #6: ON CONFLICT (user_id, preset_key) → reactivate the existing deactivated one
        const { data: newHabit, error: habitErr } = await (supabase.from("habits" as any).insert({
          user_id: user.id,
          name: preset.name,
          description: preset.desc,
          frequency: preset.recurrence,
          times_per_day: 1,
          reminder_times: JSON.stringify([cfg.time ?? cfg.times?.[0] ?? "08:00"]),
          target_days: JSON.stringify(cfg.days ?? [0, 1, 2, 3, 4, 5, 6]),
          icon: preset.icon,
          color: preset.color,
          is_active: true,
          preset_key: preset.key,
          habit_config: cfg,
        } as any).select("id").single() as any);

        if (habitErr) {
          // Unique constraint violation (23505) → habit already exists but deactivated
          // This path should be handled by handlePresetToggle's existingDeactivated check,
          // but as a safety net we surface a friendly error
          if (habitErr.code === "23505") {
            throw new Error("Este hábito já existe. Por favor, recarregue a página.");
          }
          throw new Error(habitErr.message ?? "Erro ao criar hábito");
        }
        if (!newHabit) throw new Error("Erro ao criar hábito");
        habitId = (newHabit as any).id;
      }

      // Create reminders
      if (userPhone) {
        const remindersToCreate = buildReminders(preset, cfg, user.id, userPhone, habitId);
        if (remindersToCreate.length > 0) {
          await (supabase.from("reminders" as any).insert(remindersToCreate as any) as any);
        }
      }

      toast.success(`${preset.icon} ${preset.name} ativado!`);
      setConfigModal({ open: false, preset: null, editingHabit: null });
      loadData();
    } catch (err) {
      toast.error("Erro ao salvar hábito. Tente novamente.");
      console.error(err);
    } finally {
      setConfigSaving(false);
    }
  };

  function buildReminders(
    preset: PresetDef,
    cfg: HabitConfig,
    userId: string,
    phone: string,
    habitId: string
  ) {
    const base = {
      user_id: userId,
      whatsapp_number: phone,
      title: preset.name,
      source: "habit",
      status: "pending",
      habit_id: habitId,
    };

    if (preset.configType === "single_time") {
      return [{
        ...base,
        message: getHabitMessage(preset.key, cfg.time),
        send_at: nextDailyUTC(cfg.time ?? "08:00"),
        recurrence: "daily",
      }];
    }

    if (preset.configType === "interval") {
      const times = generateIntervalTimes(
        cfg.interval ?? 2,
        cfg.startTime ?? "08:00",
        cfg.endTime ?? "22:00"
      );
      return times.map(t => ({
        ...base,
        message: getHabitMessage(preset.key, t),
        send_at: nextDailyUTC(t),
        recurrence: "daily",
      }));
    }

    if (preset.configType === "multiple_times" || preset.configType === "meal_times") {
      return (cfg.times ?? ["08:00"]).map(t => ({
        ...base,
        message: getHabitMessage(preset.key, t),
        send_at: nextDailyUTC(t),
        recurrence: "daily",
      }));
    }

    if (preset.configType === "weekly") {
      return [{
        ...base,
        message: getHabitMessage(preset.key),
        send_at: nextWeeklyUTC(cfg.time ?? "18:00", cfg.day ?? 0),
        recurrence: "weekly",
        recurrence_value: cfg.day ?? 0,
      }];
    }

    if (preset.configType === "weekly_days") {
      return (cfg.days ?? [1, 3, 5]).map(d => ({
        ...base,
        message: getHabitMessage(preset.key),
        send_at: nextWeeklyUTC(cfg.time ?? "08:00", d),
        recurrence: "weekly",
        recurrence_value: d,
      }));
    }

    return [];
  }

  // ── Custom habit ──────────────────────────────
  const handleSaveCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customForm.name.trim()) { toast.error("Nome obrigatório"); return; }

    // Se recorrente, gera múltiplos horários via intervalo
    const isRecurring = customForm.is_recurring;
    const reminderTimes = isRecurring
      ? generateIntervalTimes(customForm.interval, customForm.startTime, customForm.endTime)
      : [customForm.reminder_time];

    if (isRecurring && reminderTimes.length === 0) {
      toast.error("Horário de início deve ser menor que o de fim.");
      return;
    }

    const payload = {
      name: customForm.name.trim(),
      description: customForm.description.trim() || null,
      frequency: isRecurring ? "hourly" : "daily",
      times_per_day: reminderTimes.length,
      reminder_times: JSON.stringify(reminderTimes),
      target_days: JSON.stringify(customForm.target_days),
      icon: customForm.icon,
      color: customForm.color,
      habit_config: isRecurring
        ? { interval: customForm.interval, startTime: customForm.startTime, endTime: customForm.endTime }
        : { time: customForm.reminder_time },
      updated_at: new Date().toISOString(),
    };

    // Helper: cria reminders (1 por horário) para o hábito
    const buildHabitReminders = (habitId: string) =>
      reminderTimes.map(t => ({
        user_id: user!.id,
        habit_id: habitId,
        whatsapp_number: userPhone,
        title: customForm.name.trim(),
        message: `⏰ Hora do seu hábito: *${customForm.name.trim()}*${isRecurring ? ` (${t})` : ""}`,
        send_at: nextDailyUTC(t),
        recurrence: "daily",
        source: "habit",
        status: "pending",
      }));

    if (editingCustom) {
      const { error } = await (supabase.from("habits" as any).update(payload as any).eq("id", editingCustom.id) as any);
      if (error) { toast.error("Erro ao atualizar"); return; }
      // Recreate reminders (delete old pending ones, insert new)
      if (userPhone) {
        await (supabase.from("reminders" as any) as any)
          .delete()
          .eq("habit_id", editingCustom.id)
          .eq("status", "pending");
        const reminders = buildHabitReminders(editingCustom.id);
        if (reminders.length > 0) {
          await (supabase.from("reminders" as any).insert(reminders as any) as any);
        }
      }
      toast.success("Hábito atualizado!");
    } else {
      const { data: newHabit, error } = await (supabase.from("habits" as any)
        .insert({ ...payload, user_id: user!.id } as any).select("id").single() as any);
      if (error) { toast.error("Erro ao criar: " + error.message); return; }
      if (userPhone && newHabit) {
        const reminders = buildHabitReminders(newHabit.id);
        if (reminders.length > 0) {
          await (supabase.from("reminders" as any).insert(reminders as any) as any);
        }
      }
      toast.success("Hábito criado! 🎯");
    }

    setCustomOpen(false);
    setEditingCustom(null);
    loadData();
  };

  const deleteHabit = async (id: string) => {
    if (!confirm("Remover este hábito?")) return;
    try {
      await (supabase.from("reminders" as any) as any)
        .delete()
        .eq("habit_id", id)
        .eq("status", "pending");
      await (supabase.from("habits" as any).delete().eq("id", id) as any);
      toast.success("Hábito removido.");
      loadData();
    } catch {
      toast.error("Erro ao remover hábito.");
    }
  };

  const openEditCustom = (h: Habit) => {
    setEditingCustom(h);
    const times = Array.isArray(h.reminder_times) ? h.reminder_times : JSON.parse(h.reminder_times as string);
    const days = Array.isArray(h.target_days) ? h.target_days : JSON.parse(h.target_days as string);
    const cfg = (typeof h.habit_config === "object" && h.habit_config) ? h.habit_config as Record<string, any> : {};
    const isRecurring = h.frequency === "hourly" || !!cfg.interval;
    setCustomForm({
      name: h.name, description: h.description ?? "",
      reminder_time: times[0] ?? "08:00",
      icon: h.icon, color: h.color, target_days: days,
      is_recurring: isRecurring,
      interval: cfg.interval ?? 2,
      startTime: cfg.startTime ?? "08:00",
      endTime: cfg.endTime ?? "22:00",
    });
    setCustomOpen(true);
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Hábitos
          <LiveBadge isLive={isLive} className="ml-2" />
        </h1>
        <Button onClick={() => {
          setEditingCustom(null);
          setCustomForm({ name: "", description: "", reminder_time: "08:00", icon: "🎯", color: "#6366f1", target_days: [0,1,2,3,4,5,6], is_recurring: false, interval: 2, startTime: "08:00", endTime: "22:00" });
          setCustomOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> Criar hábito
        </Button>
      </div>

      {/* ── Preset Habits Grid ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Hábitos Sugeridos
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {PRESET_HABITS.map(preset => {
            const activeHabit = activePresetMap.get(preset.key);
            const isActive = !!activeHabit;
            const todayDone = activeHabit
              ? logs.some(l => l.habit_id === activeHabit.id && l.logged_date === today)
              : false;

            return (
              <div
                key={preset.key}
                className={`relative rounded-xl border p-3 transition-all duration-200 ${
                  isActive
                    ? "border-transparent shadow-md"
                    : "border-border bg-card opacity-70 hover:opacity-90"
                }`}
                style={isActive ? { background: `${preset.color}18`, borderColor: `${preset.color}40` } : {}}
              >
                {/* Top row: icon + toggle */}
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl leading-none">{preset.icon}</span>
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <button
                        onClick={() => {
                          const cfg = (activeHabit.habit_config as HabitConfig) ?? buildDefaultConfig(preset);
                          openConfigModal(preset, activeHabit, cfg);
                        }}
                        className="p-1 rounded-md hover:bg-black/10 transition-colors"
                        title="Configurar"
                      >
                        <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                    <Switch
                      checked={isActive}
                      onCheckedChange={v => handlePresetToggle(preset, v)}
                      className="scale-90"
                    />
                  </div>
                </div>

                {/* Name */}
                <p className="text-xs font-semibold leading-tight mb-0.5">{preset.name}</p>
                {!isActive && (
                  <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{preset.desc}</p>
                )}

                {/* Active: streak + today status (check-in happens via WhatsApp) */}
                {isActive && activeHabit && (
                  <div className="mt-2 space-y-1">
                    {activeHabit.current_streak > 0 && (
                      <div className="flex items-center gap-1">
                        <Flame className="h-3 w-3 text-orange-500" />
                        <span className="text-[11px] font-medium">{activeHabit.current_streak} dias</span>
                      </div>
                    )}
                    {todayDone ? (
                      <div className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="h-3 w-3" />
                        <span className="text-[11px] font-medium">Feito hoje ✅</span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Aguardando lembrete 🔔</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Custom Habits (mesmo layout dos presets) ── */}
      {customHabits.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Meus Hábitos Personalizados
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {customHabits.map(h => {
              const todayDone = logs.some(l => l.habit_id === h.id && l.logged_date === today);

              return (
                <div
                  key={h.id}
                  className={`relative rounded-xl border p-3 transition-all duration-200 ${
                    h.is_active
                      ? "border-transparent shadow-md"
                      : "border-border bg-card opacity-70 hover:opacity-90"
                  }`}
                  style={h.is_active ? { background: `${h.color}18`, borderColor: `${h.color}40` } : {}}
                >
                  {/* Top row: icon + actions */}
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl leading-none">{h.icon}</span>
                    <div className="flex items-center gap-0.5">
                      {h.is_active && (
                        <>
                          <button
                            onClick={() => openEditCustom(h)}
                            className="p-1 rounded-md hover:bg-black/10 transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => deleteHabit(h.id)}
                            className="p-1 rounded-md hover:bg-black/10 transition-colors"
                            title="Remover"
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </>
                      )}
                      <Switch
                        checked={h.is_active}
                        onCheckedChange={async v => {
                          await (supabase.from("habits" as any).update({ is_active: v } as any).eq("id", h.id) as any);
                          // Cancel pending reminders when pausing; recreate when reactivating
                          await (supabase.from("reminders" as any) as any)
                            .delete()
                            .eq("habit_id", h.id)
                            .eq("status", "pending");
                          if (v && userPhone) {
                            const times: string[] = Array.isArray(h.reminder_times)
                              ? h.reminder_times as string[]
                              : h.reminder_times ? JSON.parse(h.reminder_times as string) : [];
                            const newReminders = times.map(t => ({
                              user_id: user!.id,
                              habit_id: h.id,
                              whatsapp_number: userPhone,
                              title: h.name,
                              message: `⏰ Hora do seu hábito: *${h.name}*`,
                              send_at: nextDailyUTC(t),
                              recurrence: "daily",
                              source: "habit",
                              status: "pending",
                            }));
                            if (newReminders.length > 0) {
                              await (supabase.from("reminders" as any).insert(newReminders as any) as any);
                            }
                          }
                          loadData();
                        }}
                        className="scale-90"
                      />
                    </div>
                  </div>

                  {/* Name + description */}
                  <p className="text-xs font-semibold leading-tight mb-0.5">{h.name}</p>
                  {!h.is_active && h.description && (
                    <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{h.description}</p>
                  )}

                  {/* Active: streak + today status */}
                  {h.is_active && (
                    <div className="mt-2 space-y-1">
                      {h.current_streak > 0 && (
                        <div className="flex items-center gap-1">
                          <Flame className="h-3 w-3 text-orange-500" />
                          <span className="text-[11px] font-medium">{h.current_streak} dias</span>
                        </div>
                      )}
                      {todayDone ? (
                        <div className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 className="h-3 w-3" />
                          <span className="text-[11px] font-medium">Feito hoje</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">Aguardando lembrete 🔔</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {activeHabits.length === 0 && customHabits.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Nenhum hábito ativo ainda</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Ative hábitos acima para receber lembretes no WhatsApp!
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Preset Config Modal ── */}
      <Dialog
        open={configModal.open}
        onOpenChange={v => { if (!v) setConfigModal({ open: false, preset: null, editingHabit: null }); }}
      >
        <DialogContent className="bg-card border-border max-w-md">
          {configModal.preset && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="text-2xl">{configModal.preset.icon}</span>
                  {configModal.editingHabit ? "Configurar" : "Ativar"} {configModal.preset.name}
                </DialogTitle>
              </DialogHeader>

              <PresetConfigForm
                preset={configModal.preset}
                config={configState}
                onChange={setConfigState}
              />

              {!userPhone && (
                <p className="text-xs text-amber-500 bg-amber-500/10 rounded-lg p-3">
                  ⚠️ Número de WhatsApp não configurado no perfil. Os lembretes serão criados mas não serão enviados até você configurar seu número.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfigModal({ open: false, preset: null, editingHabit: null })}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSavePresetConfig}
                  disabled={configSaving}
                  style={{ backgroundColor: configModal.preset.color }}
                >
                  {configSaving ? "Salvando..." : configModal.editingHabit ? "Salvar alterações" : "Ativar hábito"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Custom Habit Dialog ── */}
      <Dialog open={customOpen} onOpenChange={v => { setCustomOpen(v); if (!v) setEditingCustom(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingCustom ? "Editar" : "Criar"} hábito personalizado</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveCustom} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={customForm.name}
                onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Meditar 10 minutos"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                value={customForm.description}
                onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Ex: Foco na respiração"
              />
            </div>
            {/* Horário: único OU recorrente */}
            {!customForm.is_recurring && (
              <div className="space-y-2">
                <Label>Horário do lembrete</Label>
                <Input
                  type="time"
                  value={customForm.reminder_time}
                  onChange={e => setCustomForm(f => ({ ...f, reminder_time: e.target.value }))}
                />
              </div>
            )}

            {/* Toggle recorrência */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
              <div>
                <p className="text-sm font-medium">Repetir a cada X horas</p>
                <p className="text-xs text-muted-foreground">Lembrete recorrente ao longo do dia</p>
              </div>
              <Switch
                checked={customForm.is_recurring}
                onCheckedChange={v => setCustomForm(f => ({ ...f, is_recurring: v }))}
              />
            </div>

            {/* Campos de intervalo (visíveis quando recorrente) */}
            {customForm.is_recurring && (
              <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="space-y-2">
                  <Label>Repetir a cada</Label>
                  <Select
                    value={String(customForm.interval)}
                    onValueChange={v => setCustomForm(f => ({ ...f, interval: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 6, 8, 12].map(h => (
                        <SelectItem key={h} value={String(h)}>{h}h em {h}h</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Início</Label>
                    <Input
                      type="time"
                      value={customForm.startTime}
                      onChange={e => setCustomForm(f => ({ ...f, startTime: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fim</Label>
                    <Input
                      type="time"
                      value={customForm.endTime}
                      onChange={e => setCustomForm(f => ({ ...f, endTime: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const times = generateIntervalTimes(customForm.interval, customForm.startTime, customForm.endTime);
                    return times.length > 0
                      ? `${times.length} lembretes: ${times.join(", ")}`
                      : "Horário de início deve ser menor que o fim";
                  })()}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Ícone</Label>
              <div className="flex flex-wrap gap-1.5">
                {ICON_OPTIONS.map(icon => (
                  <button key={icon} type="button"
                    className={`w-9 h-9 rounded-md text-xl flex items-center justify-center transition-colors ${customForm.icon === icon ? "bg-primary/20 ring-2 ring-primary" : "bg-muted hover:bg-muted/80"}`}
                    onClick={() => setCustomForm(f => ({ ...f, icon }))}
                  >{icon}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dias da semana</Label>
              <div className="flex gap-1.5">
                {DAY_NAMES_SHORT.map((d, idx) => (
                  <button key={idx} type="button"
                    className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
                      customForm.target_days.includes(idx)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    onClick={() => setCustomForm(f => ({
                      ...f,
                      target_days: f.target_days.includes(idx)
                        ? f.target_days.filter(d => d !== idx)
                        : [...f.target_days, idx].sort(),
                    }))}
                  >{d}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTIONS.map(c => (
                  <button key={c} type="button"
                    className={`w-7 h-7 rounded-full transition-transform ${customForm.color === c ? "ring-2 ring-primary scale-110" : "hover:scale-105"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setCustomForm(f => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
            <Button type="submit" className="w-full">
              {editingCustom ? "Salvar alterações" : "Criar hábito"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────
// Preset Config Form (sub-component)
// ─────────────────────────────────────────────

function PresetConfigForm({
  preset,
  config,
  onChange,
}: {
  preset: PresetDef;
  config: HabitConfig;
  onChange: (c: HabitConfig) => void;
}) {
  const set = (patch: Partial<HabitConfig>) => onChange({ ...config, ...patch });

  if (preset.configType === "single_time") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Horário do lembrete</Label>
          <Input type="time" value={config.time ?? "08:00"} onChange={e => set({ time: e.target.value })} />
          <p className="text-xs text-muted-foreground">Você receberá um lembrete no WhatsApp todos os dias neste horário.</p>
        </div>
      </div>
    );
  }

  if (preset.configType === "interval") {
    const times = generateIntervalTimes(config.interval ?? 2, config.startTime ?? "08:00", config.endTime ?? "22:00");
    const invalidRange = (config.startTime ?? "08:00") >= (config.endTime ?? "22:00");
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Intervalo (a cada quantas horas)</Label>
          <Select value={String(config.interval ?? 2)} onValueChange={v => set({ interval: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 6].map(n => (
                <SelectItem key={n} value={String(n)}>A cada {n}h</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Início</Label>
            <Input type="time" value={config.startTime ?? "08:00"} onChange={e => set({ startTime: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Fim</Label>
            <Input type="time" value={config.endTime ?? "22:00"} onChange={e => set({ endTime: e.target.value })} />
          </div>
        </div>
        {invalidRange ? (
          <p className="text-xs text-destructive">⚠️ O horário de início deve ser anterior ao horário de fim.</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Você receberá <strong>{times.length}</strong> lembrete{times.length !== 1 ? "s" : ""} por dia: {times.slice(0, 6).join(", ")}{times.length > 6 ? ` e mais ${times.length - 6}...` : ""}.
          </p>
        )}
      </div>
    );
  }

  if (preset.configType === "multiple_times") {
    const times = config.times ?? ["08:00"];
    return (
      <div className="space-y-3">
        <Label>Horários de lembrete</Label>
        {times.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="time"
              value={t}
              onChange={e => {
                const newTimes = [...times];
                newTimes[i] = e.target.value;
                set({ times: newTimes });
              }}
              className="flex-1"
            />
            {times.length > 1 && (
              <button
                type="button"
                onClick={() => set({ times: times.filter((_, j) => j !== i) })}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {times.length < 5 && (
          <Button type="button" variant="outline" size="sm" onClick={() => set({ times: [...times, "12:00"] })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar horário
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{times.length} lembrete{times.length !== 1 ? "s" : ""} por dia.</p>
      </div>
    );
  }

  if (preset.configType === "meal_times") {
    const labels = ["Café da manhã", "Almoço", "Jantar"];
    const times = config.times ?? ["07:30", "12:00", "19:00"];
    return (
      <div className="space-y-3">
        <Label>Horários das refeições</Label>
        {labels.map((label, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-28 shrink-0">{label}</span>
            <Input
              type="time"
              value={times[i] ?? "12:00"}
              onChange={e => {
                const newTimes = [...times];
                while (newTimes.length <= i) newTimes.push("12:00");
                newTimes[i] = e.target.value;
                set({ times: newTimes });
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (preset.configType === "weekly") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Dia da semana</Label>
          <Select value={String(config.day ?? 0)} onValueChange={v => set({ day: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEK_DAY_NAMES.map((d, i) => (
                <SelectItem key={i} value={String(i)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Horário</Label>
          <Input type="time" value={config.time ?? "18:00"} onChange={e => set({ time: e.target.value })} />
        </div>
        <p className="text-xs text-muted-foreground">
          Lembrete toda {WEEK_DAY_NAMES[config.day ?? 0]} às {config.time ?? "18:00"}.
        </p>
      </div>
    );
  }

  if (preset.configType === "weekly_days") {
    const selectedDays = config.days ?? [1, 3, 5];
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Dias da semana</Label>
          <div className="flex gap-1.5">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
              <button
                key={i}
                type="button"
                className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
                  selectedDays.includes(i)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                onClick={() => set({
                  days: selectedDays.includes(i)
                    ? selectedDays.filter(d => d !== i)
                    : [...selectedDays, i].sort(),
                })}
              >{d}</button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Horário</Label>
          <Input type="time" value={config.time ?? "08:00"} onChange={e => set({ time: e.target.value })} />
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedDays.length} dia{selectedDays.length !== 1 ? "s" : ""} por semana.
        </p>
      </div>
    );
  }

  return null;
}

// generateIntervalTimes is defined at module level above
