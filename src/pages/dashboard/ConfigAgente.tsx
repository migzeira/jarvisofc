import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Trash2, Save, MessageSquare, RotateCcw, ShieldCheck, AlertTriangle } from "lucide-react";

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
  const { user, session } = useAuth();
  const [config, setConfig] = useState<any>(null);
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTrigger, setNewTrigger] = useState("");
  const [newReply, setNewReply] = useState("");

  // Integration credentials
  const [credSettings, setCredSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [credLoading, setCredLoading] = useState(true);
  const [credSaving, setCredSaving] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [notionClientId, setNotionClientId] = useState("");
  const [notionClientSecret, setNotionClientSecret] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("");

  useEffect(() => { if (user) loadData(); }, [user]);
  useEffect(() => { if (session?.access_token) loadCredentials(); }, [session]);

  const loadCredentials = async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, { value: string; configured: boolean }> = {};
        data.forEach((s: any) => { map[s.key] = { value: s.value || "", configured: !!s.configured }; });
        setCredSettings(map);
      }
    } catch { /* silently fail */ }
    setCredLoading(false);
  };

  const saveCredentials = async () => {
    setCredSaving(true);
    try {
      const body: Record<string, string> = {};
      if (googleClientId) body.google_client_id = googleClientId;
      if (googleClientSecret) body.google_client_secret = googleClientSecret;
      if (notionClientId) body.notion_client_id = notionClientId;
      if (notionClientSecret) body.notion_client_secret = notionClientSecret;
      if (dashboardUrl) body.dashboard_url = dashboardUrl;

      if (Object.keys(body).length === 0) {
        toast.error("Preencha pelo menos um campo");
        setCredSaving(false);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro");
      toast.success("Credenciais salvas com sucesso!");
      setGoogleClientId("");
      setGoogleClientSecret("");
      setNotionClientId("");
      setNotionClientSecret("");
      setDashboardUrl("");
      loadCredentials();
    } catch {
      toast.error("Erro ao salvar credenciais");
    }
    setCredSaving(false);
  };

  const isConfigured = (key: string) => credSettings[key]?.configured ?? false;
  const maskedValue = (key: string) => credSettings[key]?.value || "";

  const loadData = async () => {
    const [configRes, qrRes] = await Promise.all([
      supabase.from("agent_configs").select("*").eq("user_id", user!.id).single(),
      supabase.from("quick_replies").select("*").eq("user_id", user!.id).order("created_at"),
    ]);
    setConfig(configRes.data);
    setQuickReplies(qrRes.data ?? []);
    setLoading(false);
  };

  const handleSave = async () => {
    const { error } = await supabase.from("agent_configs").update({
      agent_name: config.agent_name,
      user_nickname: config.user_nickname,
      tone: config.tone,
      language: config.language,
      system_prompt: config.system_prompt,
      custom_instructions: config.custom_instructions,
      module_finance: config.module_finance,
      module_agenda: config.module_agenda,
      module_notes: config.module_notes,
      module_chat: config.module_chat,
      template_expense: config.template_expense,
      template_income: config.template_income,
      template_expense_multi: config.template_expense_multi,
      template_note: config.template_note,
      greeting_message: config.greeting_message,
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

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  const googleConfigured = isConfigured("google_client_id") && isConfigured("google_client_secret");
  const notionConfigured = isConfigured("notion_client_id") && isConfigured("notion_client_secret");

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Configurações do Agente</h1>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Identidade</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do agente</Label>
              <Input value={config.agent_name} onChange={e => setConfig({...config, agent_name: e.target.value})} />
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
                  <SelectItem value="profissional">Profissional</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                  <SelectItem value="amigavel">Amigável</SelectItem>
                  <SelectItem value="tecnico">Técnico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Select value={config.language} onValueChange={v => setConfig({...config, language: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português brasileiro</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
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
            { key: "module_finance", label: "💰 Financeiro", desc: "Registrar gastos/receitas por mensagem" },
            { key: "module_agenda", label: "📅 Agenda", desc: "Criar/consultar compromissos" },
            { key: "module_notes", label: "📝 Anotações", desc: "Salvar notas e lembretes" },
            { key: "module_chat", label: "💬 Conversa livre", desc: "Perguntas gerais respondidas por IA" },
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

      {/* ── Credenciais de Integração ── */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Credenciais de Integração
        </h2>
        <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-muted/30 border border-border">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Estas credenciais são necessárias para que as integrações OAuth funcionem. Configure antes de conectar.
          </p>
        </div>

        {credLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        ) : (
          <Accordion type="multiple" defaultValue={["google", "notion", "general"]} className="space-y-3">
            {/* Google OAuth */}
            <AccordionItem value="google" className="border border-border rounded-lg bg-card px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="text-lg">🔑</span>
                  <span className="font-medium text-sm">Google OAuth</span>
                  <Badge variant={googleConfigured ? "default" : "secondary"} className={googleConfigured ? "bg-success/20 text-success border-success/30 text-[10px]" : "text-[10px]"}>
                    {googleConfigured ? "Configurado" : "Não configurado"}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 rounded-md p-3">
                  <p className="font-medium text-foreground mb-1">Como obter:</p>
                  <p>1. Acesse <span className="font-mono text-[11px]">console.cloud.google.com</span> → Credenciais → Criar credencial OAuth 2.0</p>
                  <p>2. Tipo: Aplicativo Web</p>
                  <p>3. URI de redirecionamento autorizado:</p>
                  <code className="block bg-muted/40 rounded px-2 py-1 text-[11px] mt-1 break-all">{callbackUrl}</code>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Google Client ID</Label>
                  <Input
                    value={googleClientId}
                    onChange={e => setGoogleClientId(e.target.value)}
                    placeholder={isConfigured("google_client_id") ? `${maskedValue("google_client_id")} — deixe em branco para manter` : "Obtenha em console.cloud.google.com"}
                    className="text-sm font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Google Client Secret</Label>
                  <Input
                    type="password"
                    value={googleClientSecret}
                    onChange={e => setGoogleClientSecret(e.target.value)}
                    placeholder={isConfigured("google_client_secret") ? `${maskedValue("google_client_secret")} — deixe em branco para manter` : "Segredo do cliente OAuth"}
                    className="text-sm font-mono"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Notion OAuth */}
            <AccordionItem value="notion" className="border border-border rounded-lg bg-card px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="text-lg">📝</span>
                  <span className="font-medium text-sm">Notion OAuth</span>
                  <Badge variant={notionConfigured ? "default" : "secondary"} className={notionConfigured ? "bg-success/20 text-success border-success/30 text-[10px]" : "text-[10px]"}>
                    {notionConfigured ? "Configurado" : "Não configurado"}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 rounded-md p-3">
                  <p className="font-medium text-foreground mb-1">Como obter:</p>
                  <p>1. Acesse <span className="font-mono text-[11px]">notion.so/my-integrations</span> → Nova integração</p>
                  <p>2. Tipo: Público</p>
                  <p>3. URI de redirecionamento:</p>
                  <code className="block bg-muted/40 rounded px-2 py-1 text-[11px] mt-1 break-all">{callbackUrl}</code>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Notion Client ID</Label>
                  <Input
                    value={notionClientId}
                    onChange={e => setNotionClientId(e.target.value)}
                    placeholder={isConfigured("notion_client_id") ? `${maskedValue("notion_client_id")} — deixe em branco para manter` : "Obtenha em notion.so/my-integrations"}
                    className="text-sm font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Notion Client Secret</Label>
                  <Input
                    type="password"
                    value={notionClientSecret}
                    onChange={e => setNotionClientSecret(e.target.value)}
                    placeholder={isConfigured("notion_client_secret") ? `${maskedValue("notion_client_secret")} — deixe em branco para manter` : "Segredo da integração"}
                    className="text-sm font-mono"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Geral */}
            <AccordionItem value="general" className="border border-border rounded-lg bg-card px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="text-lg">⚙️</span>
                  <span className="font-medium text-sm">Geral</span>
                  <Badge variant={isConfigured("dashboard_url") ? "default" : "secondary"} className={isConfigured("dashboard_url") ? "bg-success/20 text-success border-success/30 text-[10px]" : "text-[10px]"}>
                    {isConfigured("dashboard_url") ? "Configurado" : "Não configurado"}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div className="space-y-2">
                  <Label className="text-xs">URL do Dashboard</Label>
                  <p className="text-[11px] text-muted-foreground">URL para redirecionar após conectar/desconectar uma integração</p>
                  <Input
                    value={dashboardUrl}
                    onChange={e => setDashboardUrl(e.target.value)}
                    placeholder={isConfigured("dashboard_url") ? `${maskedValue("dashboard_url")} — deixe em branco para manter` : "https://seusite.com/dashboard/integracoes"}
                    className="text-sm font-mono"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <Button onClick={saveCredentials} disabled={credSaving} className="w-full sm:w-auto mt-4">
          <ShieldCheck className="mr-2 h-4 w-4" /> {credSaving ? "Salvando..." : "Salvar Credenciais"}
        </Button>
      </div>
    </div>
  );
}
