import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, MessageSquare, Wallet, Settings, Shield, Search, Eye, MessageCircle, Clock, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Navigate } from "react-router-dom";
import UserDetailModal from "./UserDetailModal";

const SUPABASE_URL = "https://fnilyapvhhygfzcdxqjm.supabase.co";

export default function AdminPanel() {
  const { user, session, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("pending");
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({ totalUsers: 0, pendingUsers: 0, whatsappConnected: 0, totalMessages: 0, totalTransactions: 0 });
  const [profiles, setProfiles] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  const [userSearch, setUserSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [messageSearch, setMessageSearch] = useState("");
  const [intentFilter, setIntentFilter] = useState("all");

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");

  const [settings, setSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const loadData = async () => {
    setLoading(true);
    await Promise.all([loadProfiles(), loadConversations(), loadMessages(), loadTransactions(), loadSettings()]);
    setLoading(false);
  };

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, phone_number, whatsapp_lid, created_at, plan, messages_used, messages_limit")
      .order("created_at", { ascending: false }) as any;
    if (data) {
      setProfiles(data);
      setStats(s => ({
        ...s,
        totalUsers: data.length,
        pendingUsers: data.filter(u => u.account_status === "pending").length,
        whatsappConnected: data.filter(u => u.whatsapp_lid || u.phone_number).length,
      }));
    }
  };

  const loadConversations = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, user_id, contact_name, whatsapp_lid, phone_number, last_message_at, started_at, message_count")
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (data) setConversations(data);
  };

  const loadMessages = async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at, intent, conversation_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data) {
      setMessages(data);
      setStats(s => ({ ...s, totalMessages: data.length }));
    }
  };

  const loadTransactions = async () => {
    const { data } = await supabase
      .from("transactions")
      .select("id, description, amount, type, category, transaction_date, user_id")
      .order("transaction_date", { ascending: false })
      .limit(200);
    if (data) {
      setTransactions(data);
      setStats(s => ({ ...s, totalTransactions: data.length }));
    }
  };

  const loadSettings = async () => {
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-settings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, { value: string; configured: boolean }> = {};
        data.forEach((s: any) => { map[s.key] = { value: s.value, configured: s.configured }; });
        setSettings(map);
      }
    } catch {}
  };

  const approveUser = async (userId: string) => {
    setApprovingId(userId);
    const { error } = await (supabase
      .from("profiles")
      .update({ plan: "starter" } as any)
      .eq("id", userId) as any);
    if (error) toast.error("Erro ao aprovar");
    else {
      toast.success("Conta aprovada!");
      await loadProfiles();
    }
    setApprovingId(null);
  };

  const rejectUser = async (userId: string) => {
    setApprovingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ account_status: "suspended" })
      .eq("id", userId);
    if (error) toast.error("Erro ao rejeitar");
    else {
      toast.success("Conta rejeitada.");
      await loadProfiles();
    }
    setApprovingId(null);
  };

  const saveSettings = async () => {
    if (!session) return;
    setSavingSettings(true);
    const body: Record<string, string> = {};
    Object.entries(settingsForm).forEach(([k, v]) => { if (v) body[k] = v; });
    if (Object.keys(body).length === 0) {
      toast.error("Preencha pelo menos um campo");
      setSavingSettings(false);
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Configurações salvas!");
        setSettingsForm({});
        loadSettings();
      } else toast.error("Erro ao salvar");
    } catch { toast.error("Erro de rede"); }
    setSavingSettings(false);
  };

  const filteredProfiles = profiles.filter(p => {
    const matchSearch = !userSearch || (p.display_name || "").toLowerCase().includes(userSearch.toLowerCase());
    const matchPlan = planFilter === "all" || p.plan === planFilter;
    return matchSearch && matchPlan;
  });

  const pendingProfiles = profiles.filter(p => p.account_status === "pending");

  const filteredMessages = messages.filter(m => {
    const matchSearch = !messageSearch || m.content?.toLowerCase().includes(messageSearch.toLowerCase());
    const matchIntent = intentFilter === "all" || m.intent === intentFilter;
    return matchSearch && matchIntent;
  });

  const uniqueIntents = [...new Set(messages.map(m => m.intent).filter(Boolean))];

  const getUserName = (userId: string) => {
    const p = profiles.find(pr => pr.id === userId);
    return p?.display_name || "—";
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }); } catch { return "—"; }
  };

  const statusBadge = (status: string | null) => {
    if (status === "active") return <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs">Ativa</Badge>;
    if (status === "suspended") return <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">Suspensa</Badge>;
    return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-xs">Pendente</Badge>;
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const SETTINGS_FIELDS = [
    { key: "whatsapp_number", label: "Número WhatsApp da IA", type: "text", hint: "Ex: 5511999999999 — número que os usuários devem chamar" },
    { key: "google_client_id", label: "Google Client ID", type: "text" },
    { key: "google_client_secret", label: "Google Client Secret", type: "password" },
    { key: "notion_client_id", label: "Notion Client ID", type: "text" },
    { key: "notion_client_secret", label: "Notion Client Secret", type: "password" },
    { key: "dashboard_url", label: "URL do Dashboard", type: "text" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-purple-400" />
          <h1 className="text-xl font-bold">Admin Master — Minha Maya</h1>
          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">{stats.totalUsers} usuários</Badge>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-6">
        <Card><CardContent className="pt-4 text-center">
          <Users className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold">{stats.totalUsers}</p>
          <p className="text-xs text-muted-foreground">Usuários</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Clock className="h-5 w-5 mx-auto text-yellow-400 mb-1" />
          <p className="text-2xl font-bold text-yellow-400">{stats.pendingUsers}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <MessageCircle className="h-5 w-5 mx-auto text-green-400 mb-1" />
          <p className="text-2xl font-bold">{stats.whatsappConnected}</p>
          <p className="text-xs text-muted-foreground">WhatsApp</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <MessageSquare className="h-5 w-5 mx-auto text-blue-400 mb-1" />
          <p className="text-2xl font-bold">{stats.totalMessages}</p>
          <p className="text-xs text-muted-foreground">Mensagens</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Wallet className="h-5 w-5 mx-auto text-yellow-400 mb-1" />
          <p className="text-2xl font-bold">{stats.totalTransactions}</p>
          <p className="text-xs text-muted-foreground">Transações</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="px-6 pb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="pending" className="relative">
              <Clock className="h-4 w-4 mr-1" />Pendentes
              {stats.pendingUsers > 0 && (
                <span className="ml-1.5 bg-yellow-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5">
                  {stats.pendingUsers}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" />Usuários</TabsTrigger>
            <TabsTrigger value="conversations"><MessageSquare className="h-4 w-4 mr-1" />Conversas</TabsTrigger>
            <TabsTrigger value="messages"><MessageCircle className="h-4 w-4 mr-1" />Mensagens</TabsTrigger>
            <TabsTrigger value="transactions"><Wallet className="h-4 w-4 mr-1" />Transações</TabsTrigger>
            <TabsTrigger value="settings"><Settings className="h-4 w-4 mr-1" />Configurações</TabsTrigger>
          </TabsList>

          {/* PENDING */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-400" />
                  Contas aguardando aprovação
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pendingProfiles.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhuma conta pendente.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone / WhatsApp</TableHead>
                      <TableHead>Plano</TableHead>
                      <TableHead>Cadastro</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {pendingProfiles.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.display_name || "—"}</TableCell>
                          <TableCell className="text-sm font-mono">{p.phone_number || <span className="text-muted-foreground italic">Não informado</span>}</TableCell>
                          <TableCell><Badge variant="secondary">{p.plan}</Badge></TableCell>
                          <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={approvingId === p.id}
                                onClick={() => approveUser(p.id)}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={approvingId === p.id}
                                onClick={() => rejectUser(p.id)}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Rejeitar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* USERS */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por nome..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Select value={planFilter} onValueChange={setPlanFilter}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Plano" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead>Msgs</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredProfiles.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.display_name || "—"}</TableCell>
                        <TableCell className="text-sm">{p.phone_number || "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{p.plan}</Badge></TableCell>
                        <TableCell>{statusBadge(p.account_status)}</TableCell>
                        <TableCell>
                          <Badge className={p.whatsapp_lid || p.phone_number ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                            {p.whatsapp_lid || p.phone_number ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(p.created_at)}</TableCell>
                        <TableCell className="text-sm">{p.messages_used}/{p.messages_limit}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => { setSelectedUserId(p.id); setSelectedUserName(p.display_name || "Usuário"); }}>
                            <Eye className="h-4 w-4 mr-1" /> Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredProfiles.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum usuário encontrado</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* CONVERSATIONS */}
          <TabsContent value="conversations">
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Mensagens</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead>Início</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {conversations.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>{getUserName(c.user_id)}</TableCell>
                        <TableCell>{c.contact_name || "—"}</TableCell>
                        <TableCell className="text-sm">{c.phone_number}</TableCell>
                        <TableCell>{c.message_count}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.last_message_at)}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.started_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {conversations.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma conversa</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* MESSAGES */}
          <TabsContent value="messages">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar conteúdo..." value={messageSearch} onChange={e => setMessageSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Select value={intentFilter} onValueChange={setIntentFilter}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Intent" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {uniqueIntents.map(i => <SelectItem key={i} value={i!}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredMessages.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(m.created_at)}</TableCell>
                        <TableCell><Badge variant={m.role === "assistant" ? "default" : "secondary"}>{m.role}</Badge></TableCell>
                        <TableCell className="text-sm">{m.intent || "—"}</TableCell>
                        <TableCell className="text-sm max-w-md truncate">{m.content?.substring(0, 120)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredMessages.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma mensagem</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TRANSACTIONS */}
          <TabsContent value="transactions">
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {transactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">{formatDate(t.transaction_date)}</TableCell>
                        <TableCell>{getUserName(t.user_id)}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell>
                          <Badge className={t.type === "income" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>
                            {t.type === "income" ? "Receita" : "Gasto"}
                          </Badge>
                        </TableCell>
                        <TableCell>{t.category}</TableCell>
                        <TableCell className="font-medium">R$ {Number(t.amount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {transactions.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma transação</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Configurações do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {SETTINGS_FIELDS.map(f => {
                  const s = settings[f.key];
                  return (
                    <div key={f.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label>{f.label}</Label>
                        <Badge className={s?.configured ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-muted text-muted-foreground"}>
                          {s?.configured ? "Configurado" : "Não configurado"}
                        </Badge>
                      </div>
                      <Input
                        type={f.type}
                        placeholder={s?.configured ? `${s.value} — deixe vazio para manter` : `Insira ${f.label}`}
                        value={settingsForm[f.key] || ""}
                        onChange={e => setSettingsForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                  );
                })}
                <Button onClick={saveSettings} disabled={savingSettings} className="bg-purple-600 hover:bg-purple-700">
                  {savingSettings ? "Salvando..." : "Salvar Configurações"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          userName={selectedUserName}
          open={!!selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}
