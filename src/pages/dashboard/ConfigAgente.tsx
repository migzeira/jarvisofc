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
import { Plus, Trash2, Save, Clock } from "lucide-react";

export default function ConfigAgente({ hideTitle = false }: { hideTitle?: boolean } = {}) {
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
        briefing_hour: raw.briefing_hour ?? 8,
        proactive_insights_enabled: raw.proactive_insights_enabled !== false,
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
      // Trim custom_instructions: se o user digita só espaço, salva null (não espaço)
      custom_instructions: config.custom_instructions?.trim() || null,
      // Modules are boolean after normalization; persist explicit true/false (not null)
      module_finance: config.module_finance === true,
      module_agenda: config.module_agenda === true,
      module_notes: config.module_notes === true,
      module_chat: config.module_chat === true,
      daily_briefing_enabled: config.daily_briefing_enabled === true,
      briefing_hour: config.briefing_hour ?? 8,
      proactive_insights_enabled: config.proactive_insights_enabled === true,
    }).eq("user_id", user!.id);
    if (error) toast.error("Erro ao salvar");
    else toast.success("Configurações salvas!");
  };

  const addQuickReply = async () => {
    if (!newTrigger.trim() || !newReply.trim()) return;
    const { error } = await supabase.from("quick_replies").insert({ user_id: user!.id, trigger_text: newTrigger, reply_text: newReply });
    if (error) toast.error("Erro ao adicionar");
    else { toast.success("Resposta rápida adicionada!"); setNewTrigger(""); setNewReply(""); loadData(); }
  };

  const deleteQuickReply = async (id: string) => {
    const { error } = await supabase.from("quick_replies").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover"); return; }
    toast.success("Removida");
    loadData();
  };

  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}</div>;
  if (!config) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      {!hideTitle && <h1 className="text-2xl font-bold">Configurações do Agente</h1>}

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Identidade</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do agente</Label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                <span className="font-semibold text-foreground">Jarvis</span>
                <span className="text-xs">— nome padrão do assistente</span>
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
              <p className="text-xs text-muted-foreground">Define como o Jarvis se comunica com você no WhatsApp.</p>
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
            { key: "module_finance", label: "💰 Financeiro", desc: "Registrar gastos e receitas pelo WhatsApp — se desativado, o Jarvis recusa qualquer pedido financeiro" },
            { key: "module_agenda", label: "📅 Agenda", desc: "Criar, consultar e editar compromissos — se desativado, o Jarvis recusa pedidos de agenda e followups de eventos" },
            { key: "module_notes", label: "📝 Anotações e Lembretes", desc: "Salvar notas e criar lembretes WhatsApp — se desativado, o Jarvis recusa anotações e lembretes" },
            { key: "module_chat", label: "💬 Conversa livre", desc: "Respostas de IA para perguntas gerais — se desativado, o Jarvis só responde com os módulos ativos" },
          ].map(m => (
            <div key={m.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
              <Switch checked={!!config[m.key]} onCheckedChange={v => setConfig({...config, [m.key]: v})} />
            </div>
          ))}

          {/* Resumo diário com seletor de horário condicional */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">🌅 Resumo diário</p>
                <p className="text-xs text-muted-foreground">Mensagem automática com compromissos e lembretes do dia — desative para não receber</p>
              </div>
              <Switch checked={!!config.daily_briefing_enabled} onCheckedChange={v => setConfig({...config, daily_briefing_enabled: v})} />
            </div>
            {config.daily_briefing_enabled && (
              <div className="flex items-center gap-2 pl-0 pt-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Horário:</span>
                <Select value={String(config.briefing_hour)} onValueChange={v => setConfig({...config, briefing_hour: Number(v)})}>
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 6, 7, 8, 9, 10].map(h => (
                      <SelectItem key={h} value={String(h)} className="text-xs">
                        {h}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">no seu fuso horário</span>
              </div>
            )}
          </div>

          {/* Insights proativos */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">🔍 Insights proativos</p>
              <p className="text-xs text-muted-foreground">Toda segunda o Jarvis analisa seus dados e envia padrões detectados — gastos crescentes, dias com mais cancelamentos, hábitos em risco</p>
            </div>
            <Switch checked={!!config.proactive_insights_enabled} onCheckedChange={v => setConfig({...config, proactive_insights_enabled: v})} />
          </div>
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
                        <button aria-label="Remover resposta rápida" onClick={() => deleteQuickReply(qr.id)} className="text-muted-foreground hover:text-destructive">
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
            <Button variant="outline" aria-label="Adicionar resposta rápida" onClick={addQuickReply}><Plus className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full sm:w-auto"><Save className="mr-2 h-4 w-4" /> Salvar configurações</Button>
    </div>
  );
}
