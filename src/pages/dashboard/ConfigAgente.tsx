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
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, MessageSquare } from "lucide-react";

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
    setConfig(configRes.data);
    setQuickReplies(qrRes.data ?? []);
    setLoading(false);
  };

  const handleSave = async () => {
    const { error } = await supabase.from("agent_configs").update({
      agent_name: config.agent_name,
      tone: config.tone,
      language: config.language,
      system_prompt: config.system_prompt,
      module_finance: config.module_finance,
      module_agenda: config.module_agenda,
      module_notes: config.module_notes,
      module_chat: config.module_chat,
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
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Nome do agente</Label>
              <Input value={config.agent_name} onChange={e => setConfig({...config, agent_name: e.target.value})} />
            </div>
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
                  <SelectItem value="pt-BR">Português</SelectItem>
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
              <Switch checked={config[m.key]} onCheckedChange={v => setConfig({...config, [m.key]: v})} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base">Instruções personalizadas</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={config.system_prompt || ""} onChange={e => setConfig({...config, system_prompt: e.target.value})} rows={4} placeholder="Ex: sempre responda em português formal, me chame de 'chefe', etc." />
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

      <Button onClick={handleSave} className="w-full sm:w-auto"><Save className="mr-2 h-4 w-4" /> Salvar configurações</Button>
    </div>
  );
}
