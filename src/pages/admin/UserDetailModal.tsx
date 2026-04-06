import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
}

export default function UserDetailModal({ userId, userName, open, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);

  useEffect(() => {
    if (open && userId) loadAll();
  }, [open, userId]);

  const loadAll = async () => {
    setLoading(true);
    const [pRes, cRes, tRes, aRes, iRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("conversations").select("*").eq("user_id", userId).order("last_message_at", { ascending: false }).limit(50),
      supabase.from("transactions").select("*").eq("user_id", userId).order("transaction_date", { ascending: false }).limit(50),
      supabase.from("agent_configs").select("*").eq("user_id", userId).single(),
      supabase.from("integrations").select("*").eq("user_id", userId),
    ]);
    setProfile(pRes.data);
    setConversations(cRes.data || []);
    setTransactions(tRes.data || []);
    setAgentConfig(aRes.data);
    setIntegrations(iRes.data || []);

    // Load messages from user's conversations
    if (cRes.data && cRes.data.length > 0) {
      const convIds = cRes.data.map((c: any) => c.id);
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(100);
      setMessages(msgs || []);
    }
    setLoading(false);
  };

  const fmt = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }); } catch { return "—"; }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {userName}
            {profile && (
              <>
                <Badge variant="secondary">{profile.plan}</Badge>
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
          <Tabs defaultValue="conversations">
            <TabsList className="mb-3">
              <TabsTrigger value="conversations">Conversas ({conversations.length})</TabsTrigger>
              <TabsTrigger value="messages">Mensagens ({messages.length})</TabsTrigger>
              <TabsTrigger value="transactions">Transações ({transactions.length})</TabsTrigger>
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
                      <TableCell className="text-sm">{fmt(t.transaction_date)}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell><Badge className={t.type === "income" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>{t.type === "income" ? "Receita" : "Gasto"}</Badge></TableCell>
                      <TableCell>{t.category}</TableCell>
                      <TableCell className="font-medium">R$ {Number(t.amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                      {i.metadata?.email && <span className="text-sm text-muted-foreground ml-2">{i.metadata.email}</span>}
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
        )}
      </DialogContent>
    </Dialog>
  );
}
