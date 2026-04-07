import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, MessageSquare, RotateCcw } from "lucide-react";

const TEMPLATE_FIELDS = [
  {
    key: "template_expense",
    label: "Gasto registrado",
    defaultVal: '🔴 *Gasto registrado!*\n📝 {{description}}\n💰 R$ {{amount}}',
    variables: ["{{description}}", "{{amount}}", "{{category}}", "{{user_name}}"],
  },
  {
    key: "template_income",
    label: "Receita registrada",
    defaultVal: '🟢 *Receita registrada!*\n📝 {{description}}\n💰 R$ {{amount}}',
    variables: ["{{description}}", "{{amount}}", "{{category}}", "{{user_name}}"],
  },
  {
    key: "template_expense_multi",
    label: "Múltiplos gastos",
    defaultVal: '✅ *{{count}} gastos registrados!*\n\n{{lines}}\n\n💸 *Total: R$ {{total}}*',
    variables: ["{{count}}", "{{lines}}", "{{total}}", "{{user_name}}"],
  },
  {
    key: "template_note",
    label: "Nota anotada",
    defaultVal: '📝 *Anotado, {{user_name}}!*\n"{{content}}"',
    variables: ["{{content}}", "{{user_name}}"],
  },
  {
    key: "greeting_message",
    label: "Saudação inicial",
    defaultVal: 'Olá, {{user_name}}! Sou a {{agent_name}}, sua assistente pessoal. Como posso ajudar?',
    variables: ["{{agent_name}}", "{{user_name}}"],
  },
];

export default function ConfigAgente() {
  const { user } = useAuth();
  const [config, setConfig] = useState<any>(null);
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTrigger, setNewTrigger] = useState("");
  const [newReply, setNewReply] = useState("");

  useEffect(() => { if (user) loadData(); }, [user]);
  const loadData = async () => {
    const [configRes, qrRes] = await Promise.all([
      supabase.from("agent_configs").select("*").eq("user_id", user!.id).single(),
      supabase.from("quick_replies").select("*").eq("user_id", user!.id).order("created_at"),
    ]);
    const raw = configRes.data;
    if (raw) {
      // Normalize NULL values to safe defaults.
      // Modules: NULL means "never explicitly set" → treat as ON (matches webhook logic: !== false).
      // tone/language: NULL → use app defaults so Select components never show blank.
      setConfig({
        ...raw,
        tone: raw.tone ?? "profissional",
        language: raw.language ?? "pt-BR",
        module_finance: raw.module_finance !== false,
        module_agenda: raw.module_agenda !== false,
        module_notes: raw.module_notes !== false,
        module_chat: raw.module_chat !== false,
        daily_briefing_enabled: raw.daily_briefing_enabled !== false,
      });
    }
    setQuickReplies(qrRes.data ?? []);
    setLoading(false);
  };

  const handleSave = async () => {
    const { error } = await supabase.from("agent_configs").update({
      // Trim nickname; persist null when empty so the webhook falls back gracefully
      user_nickname: config.user_nickname?.trim() || null,
      // Always save resolved values (never undefined / never blank string for selects)
      tone: config.tone || "profissional",
      language: config.language || "pt-BR",
      // Never overwrite system_prompt — it has no UI field here
      custom_instructions: config.custom_instructions ?? null,
      // Modules are boolean after normalization; persist explicit true/false (not null)
      module_finance: config.module_finance === true,
      module_agenda: config.module_agenda === true,
      module_notes: config.module_notes === true,
      module_chat: config.module_chat === true,
      daily_briefing_enabled: config.daily_briefing_enabled === true,
      // Message templates — persist null when cleared so webhook uses built-in defaults
      template_expense: config.template_expense?.trim() || null,
      template_income: config.template_income?.trim() || null,
      template_expense_multi: config.template_expense_multi?.trim() || null,
      template_note: config.template_note?.trim() || null,
      greeting_message: config.greeting_message?.trim() || null,
    }).eq("user_id", user!.id);
    if (error) toast.error("Erro ao salvar");
    else toast.success("Configurações salvas!");
  };

  const insertVariable = (fieldKey: string, variable: string) => {
    const el = document.getElementById(`template-${fieldKey}`) as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = config[fieldKey] || "";
    const newVal = current.substring(0, start) + variable + current.substring(end);
    setConfig({ ...config, [fieldKey]: newVal });
    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + variable.length;
    }, 0);
  };

  const resetToDefault = (fieldKey: string) => {
    const field = TEMPLATE_FIELDS.find(f => f.key === fieldKey);
    if (field) setConfig({ ...config, [fieldKey]: field.defaultVal });
  };

  const addQuickReply = async () => {
    if (!newTrigger.trim() || !newReply.trim()) return;
    const { error } = await supabase.from("quick_replies").insert({ user_id: user!.id, trigger_text: newTrigger, reply_text: newReply });
    if (error) toast.error("Erro ao adicionar");
    else { toast.success("Resposta rápida adicionada!"); setNewTrigger(""); setNewReply(""); loadData(); }
  };

  const deleteQuickReply = async (id: string) => {
    await supabase.from("quick_replies").delete().eq("id", id);
    toast.success("Removida");
    loadData();
  };

  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}</div>;
  if (!config) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Configurações do Agente</h1>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Identidade</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do agente</Label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                <span className="font-semibold text-foreground">Maya</span>
                <span className="text-xs">— nome padrão da assistente</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Como você quer ser chamado?</Label>
              <Input value={config.user_nickname || ""} onChange={e => setConfig({...config, user_nickname: e.target.value})} placeholder="Ex: João, Chefe, Boss..." />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tom de voz</Label>
              <Select value={config.tone} onValueChange={v => setConfig({...config, tone: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="profissional">🏢 Profissional — formal, objetivo, sem gírias</SelectItem>
                  <SelectItem value="casual">😊 Casual — descontraído, linguagem do dia a dia</SelectItem>
                  <SelectItem value="amigavel">🤗 Amigável — caloroso, entusiasmado, uso frequente de emojis</SelectItem>
                  <SelectItem value="tecnico">🔧 Técnico — preciso, focado em dados e números</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Define como a Maya se comunica com você no WhatsApp.</p>
            </div>
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Select value={config.language} onValueChange={v => setConfig({...config, language: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português brasileiro</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Módulos ativos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: "module_finance", label: "💰 Financeiro", desc: "Registrar gastos e receitas pelo WhatsApp — se desativado, a Maya recusa qualquer pedido financeiro" },
            { key: "module_agenda", label: "📅 Agenda", desc: "Criar, consultar e editar compromissos — se desativado, a Maya recusa pedidos de agenda e followups de eventos" },
            { key: "module_notes", label: "📝 Anotações e Lembretes", desc: "Salvar notas e criar lembretes WhatsApp — se desativado, a Maya recusa anotações e lembretes" },
            { key: "module_chat", label: "💬 Conversa livre", desc: "Respostas de IA para perguntas gerais — se desativado, a Maya só responde com os módulos ativos" },
            { key: "daily_briefing_enabled", label: "🌅 Resumo diário", desc: "Mensagem automática às 8h com compromissos e lembretes do dia — desative para não receber" },
          ].map(m => (
            <div key={m.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
              <Switch checked={!!config[m.key]} onCheckedChange={v => setConfig({...config, [m.key]: v})} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Instruções personalizadas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Textarea value={config.custom_instructions || ""} onChange={e => setConfig({...config, custom_instructions: e.target.value})} rows={4} placeholder="Ex: sempre responda em português formal, me chame de 'chefe', etc." />
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Respostas rápidas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {quickReplies.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>Comando</TableHead>
                    <TableHead>Resposta</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quickReplies.map(qr => (
                    <TableRow key={qr.id} className="border-border">
                      <TableCell className="font-mono text-sm">{qr.trigger_text}</TableCell>
                      <TableCell className="text-sm">{qr.reply_text}</TableCell>
                      <TableCell>
                        <button onClick={() => deleteQuickReply(qr.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Comando</Label>
              <Input value={newTrigger} onChange={e => setNewTrigger(e.target.value)} placeholder="pix" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Resposta</Label>
              <Input value={newReply} onChange={e => setNewReply(e.target.value)} placeholder="Minha chave PIX é..." />
            </div>
            <Button variant="outline" onClick={addQuickReply}><Plus className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Mensagens do Assistente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {TEMPLATE_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{field.label}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => resetToDefault(field.key)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Padrão
                </Button>
              </div>
              <Textarea
                id={`template-${field.key}`}
                value={config[field.key] ?? field.defaultVal}
                onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                rows={3}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {field.variables.map((v) => (
                  <Badge
                    key={v}
                    variant="secondary"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs"
                    onClick={() => insertVariable(field.key, v)}
                  >
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full sm:w-auto"><Save className="mr-2 h-4 w-4" /> Salvar configurações</Button>
    </div>
  );
}
