import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
  onProfileUpdate?: () => void;
}

export default function UserDetailModal({ userId, userName, open, onClose, onProfileUpdate }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [changingPlan, setChangingPlan] = useState(false);

  useEffect(() => {
    if (open && userId) loadAll();
  }, [open, userId]);

  const loadAll = async () => {
    setLoading(true);
    const [pRes, cRes, tRes, aRes, iRes, evRes, remRes, nRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("conversations").select("*").eq("user_id", userId).order("last_message_at", { ascending: false }).limit(50),
      supabase.from("transactions").select("*").eq("user_id", userId).order("transaction_date", { ascending: false }).limit(50),
      supabase.from("agent_configs").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("integrations").select("*").eq("user_id", userId),
      supabase.from("events").select("*").eq("user_id", userId).order("event_date", { ascending: false }).limit(50),
      supabase.from("reminders").select("*").eq("user_id", userId).order("send_at", { ascending: false }).limit(50),
      supabase.from("notes").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    setProfile(pRes.data);
    setConversations(cRes.data || []);
    setTransactions(tRes.data || []);
    setAgentConfig(aRes.data);
    setIntegrations(iRes.data || []);
    setEvents(evRes.data || []);
    setReminders(remRes.data || []);
    setNotes(nRes.data || []);

    if (cRes.data && cRes.data.length > 0) {
      const convIds = cRes.data.map((c: any) => c.id);
      const { data: msgs } = await supabase.from("messages").select("*").in("conversation_id", convIds).order("created_at", { ascending: false }).limit(100);
      setMessages(msgs || []);
    }
    setLoading(false);
  };

  const fmt = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }); } catch { return "—"; }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy", { locale: ptBR }); } catch { return "—"; }
  };

  const handleChangePlan = async (plan: string) => {
    setChangingPlan(true);
    const { error } = await (supabase.from("profiles").update({ plan } as any).eq("id", userId) as any);
    if (error) toast.error("Erro ao alterar plano");
    else { toast.success(`Plano alterado para ${plan}`); setProfile((p: any) => ({ ...p, plan })); onProfileUpdate?.(); }
    setChangingPlan(false);
  };

  const handleToggleStatus = async () => {
    const newStatus = profile?.account_status === "suspended" ? "active" : "suspended";
    const { error } = await (supabase.from("profiles").update({ account_status: newStatus } as any).eq("id", userId) as any);
    if (error) toast.error("Erro ao alterar status");
    else { toast.success(newStatus === "suspended" ? "Conta suspensa" : "Conta reativada"); setProfile((p: any) => ({ ...p, account_status: newStatus })); onProfileUpdate?.(); }
  };

  const daysSince = profile?.created_at ? differenceInDays(new Date(), new Date(profile.created_at)) : 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {userName}
            {profile && (
              <>
                <Badge variant="secondary">{profile.plan}</Badge>
                <Badge className={profile.account_status === "active" ? "bg-green-500/20 text-green-300" : profile.account_status === "suspended" ? "bg-red-500/20 text-red-300" : "bg-yellow-500/20 text-yellow-300"}>
                  {profile.account_status}
                </Badge>
                <span className="text-sm text-muted-foreground font-normal">{profile.phone_number || ""}</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{messages.length}</p>
                <p className="text-xs text-muted-foreground">Mensagens</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{transactions.length}</p>
                <p className="text-xs text-muted-foreground">Transações</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{events.length}</p>
                <p className="text-xs text-muted-foreground">Eventos</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{daysSince}</p>
                <p className="text-xs text-muted-foreground">Dias cadastrado</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{profile?.messages_used || 0}/{profile?.messages_limit || 0}</p>
                <p className="text-xs text-muted-foreground">Msgs usadas</p>
              </div>
            </div>

            {/* Admin actions */}
            <div className="flex flex-wrap gap-3 mb-4 p-3 rounded-lg border border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Plano:</span>
                <Select value={profile?.plan || "starter"} onValueChange={handleChangePlan} disabled={changingPlan}>
                  <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant={profile?.account_status === "suspended" ? "default" : "destructive"} onClick={handleToggleStatus}>
                {profile?.account_status === "suspended" ? "Reativar conta" : "Suspender conta"}
              </Button>
            </div>

            <Tabs defaultValue="conversations">
              <TabsList className="mb-3 flex-wrap h-auto gap-1">
                <TabsTrigger value="conversations">Conversas ({conversations.length})</TabsTrigger>
                <TabsTrigger value="messages">Msgs ({messages.length})</TabsTrigger>
                <TabsTrigger value="transactions">Transações ({transactions.length})</TabsTrigger>
                <TabsTrigger value="events">Agenda ({events.length})</TabsTrigger>
                <TabsTrigger value="reminders">Lembretes ({reminders.length})</TabsTrigger>
                <TabsTrigger value="notes">Notas ({notes.length})</TabsTrigger>
                <TabsTrigger value="agent">Agente</TabsTrigger>
                <TabsTrigger value="integrations">Integrações</TabsTrigger>
              </TabsList>

              <TabsContent value="conversations">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Contato</TableHead><TableHead>Telefone</TableHead><TableHead>Msgs</TableHead><TableHead>Último</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {conversations.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>{c.contact_name || "—"}</TableCell>
                        <TableCell className="text-sm">{c.phone_number}</TableCell>
                        <TableCell>{c.message_count}</TableCell>
                        <TableCell className="text-sm">{fmt(c.last_message_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="messages">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Role</TableHead><TableHead>Intent</TableHead><TableHead>Mensagem</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {messages.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm whitespace-nowrap">{fmt(m.created_at)}</TableCell>
                        <TableCell><Badge variant={m.role === "assistant" ? "default" : "secondary"}>{m.role}</Badge></TableCell>
                        <TableCell className="text-sm">{m.intent || "—"}</TableCell>
                        <TableCell className="text-sm max-w-sm truncate">{m.content?.substring(0, 100)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="transactions">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead>Categoria</TableHead><TableHead>Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {transactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">{fmtDate(t.transaction_date)}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell><Badge className={t.type === "income" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>{t.type === "income" ? "Receita" : "Gasto"}</Badge></TableCell>
                        <TableCell>{t.category}</TableCell>
                        <TableCell className="font-medium">R$ {Number(t.amount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="events">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Hora</TableHead><TableHead>Título</TableHead><TableHead>Status</TableHead><TableHead>Fonte</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {events.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{fmtDate(e.event_date)}</TableCell>
                        <TableCell className="text-sm">{e.event_time || "—"}</TableCell>
                        <TableCell>{e.title}</TableCell>
                        <TableCell><Badge variant="secondary">{e.status}</Badge></TableCell>
                        <TableCell className="text-sm">{e.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {events.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhum evento</p>}
              </TabsContent>

              <TabsContent value="reminders">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Enviar em</TableHead><TableHead>Título</TableHead><TableHead>Mensagem</TableHead><TableHead>Status</TableHead><TableHead>Recorrência</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {reminders.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm whitespace-nowrap">{fmt(r.send_at)}</TableCell>
                        <TableCell>{r.title || "—"}</TableCell>
                        <TableCell className="text-sm max-w-xs truncate">{r.message}</TableCell>
                        <TableCell><Badge className={r.status === "sent" ? "bg-green-500/20 text-green-300" : "bg-yellow-500/20 text-yellow-300"}>{r.status}</Badge></TableCell>
                        <TableCell className="text-sm">{r.recurrence}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {reminders.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhum lembrete</p>}
              </TabsContent>

              <TabsContent value="notes">
                <div className="space-y-3">
                  {notes.map(n => (
                    <div key={n.id} className="p-3 rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{n.title || "Sem título"}</span>
                        <span className="text-xs text-muted-foreground">{fmt(n.created_at)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{n.content}</p>
                    </div>
                  ))}
                  {notes.length === 0 && <p className="text-muted-foreground text-center py-4">Nenhuma nota</p>}
                </div>
              </TabsContent>

              <TabsContent value="agent">
                {agentConfig ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Nome do agente:</strong> {agentConfig.agent_name}</div>
                    <div><strong>Apelido do usuário:</strong> {agentConfig.user_nickname || "—"}</div>
                    <div><strong>Tom:</strong> {agentConfig.tone}</div>
                    <div><strong>Idioma:</strong> {agentConfig.language}</div>
                    <div><strong>Ativo:</strong> {agentConfig.is_active ? "Sim" : "Não"}</div>
                    <div><strong>Financeiro:</strong> {agentConfig.module_finance ? "✅" : "❌"}</div>
                    <div><strong>Agenda:</strong> {agentConfig.module_agenda ? "✅" : "❌"}</div>
                    <div><strong>Notas:</strong> {agentConfig.module_notes ? "✅" : "❌"}</div>
                    <div><strong>Chat livre:</strong> {agentConfig.module_chat ? "✅" : "❌"}</div>
                    {agentConfig.custom_instructions && (
                      <div className="col-span-2"><strong>Instruções:</strong> <p className="mt-1 text-muted-foreground">{agentConfig.custom_instructions}</p></div>
                    )}
                  </div>
                ) : <p className="text-muted-foreground">Nenhuma configuração</p>}
              </TabsContent>

              <TabsContent value="integrations">
                <div className="space-y-3">
                  {integrations.map(i => (
                    <div key={i.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                      <div>
                        <span className="font-medium">{i.provider}</span>
                        {i.metadata?.email && <span className="text-sm text-muted-foreground ml-2">{(i.metadata as any).email}</span>}
                      </div>
                      <Badge className={i.is_connected ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                        {i.is_connected ? "Conectado" : "Desconectado"}
                      </Badge>
                    </div>
                  ))}
                  {integrations.length === 0 && <p className="text-muted-foreground">Nenhuma integração</p>}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
