import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { CalendarDays, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Copy, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Integration {
  id: string;
  provider: string;
  is_connected: boolean;
  connected_at: string | null;
  metadata: Record<string, any> | null;
}

export default function Integracoes() {
  const { user, session } = useAuth();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const [credSettings, setCredSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [credLoading, setCredLoading] = useState(true);
  const [credSaving, setCredSaving] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://fnilyapvhhygfzcdxqjm.supabase.co";
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;

  useEffect(() => { if (session?.access_token) loadCredentials(); }, [session]);
  useEffect(() => { if (user) loadData(); }, [user]);

  // Detect OAuth return params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      toast.success("Google Calendar conectado com sucesso!");
      window.history.replaceState({}, "", window.location.pathname);
      if (user) loadData();
    }
    if (error) {
      toast.error(`Erro ao conectar: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadData = async () => {
    const { data } = await supabase
      .from("integrations")
      .select("id, provider, is_connected, connected_at, metadata")
      .eq("user_id", user!.id)
      .eq("provider", "google_calendar")
      .maybeSingle();
    setIntegration(data as Integration | null);
    setLoading(false);
  };

  const loadCredentials = async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, { value: string; configured: boolean }> = {};
        data.forEach((s: any) => { map[s.key] = { value: s.value || "", configured: !!s.configured }; });
        setCredSettings(map);
      }
    } catch { /* silent */ }
    setCredLoading(false);
  };

  const saveCredentials = async () => {
    setCredSaving(true);
    try {
      const body: Record<string, string> = {};
      if (googleClientId) body.google_client_id = googleClientId;
      if (googleClientSecret) body.google_client_secret = googleClientSecret;
      if (Object.keys(body).length === 0) {
        toast.error("Preencha pelo menos um campo");
        setCredSaving(false);
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session!.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success("Credenciais salvas com sucesso!");
      setGoogleClientId("");
      setGoogleClientSecret("");
      loadCredentials();
    } catch { toast.error("Erro ao salvar credenciais"); }
    setCredSaving(false);
  };

  const handleConnect = async () => {
    if (!session?.access_token) { toast.error("Sessão expirada. Faça login novamente."); return; }
    setConnecting(true);
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/oauth-init?provider=google_calendar&user_id=${user!.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        toast.error(json.error || "Erro ao iniciar conexão. Verifique se as credenciais foram configuradas.");
        setConnecting(false);
      }
    } catch {
      toast.error("Erro ao conectar");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const { error } = await supabase
      .from("integrations")
      .update({ is_connected: false, access_token: null, refresh_token: null, connected_at: null } as any)
      .eq("user_id", user!.id)
      .eq("provider", "google_calendar");
    if (error) toast.error("Erro ao desconectar");
    else { toast.success("Google Calendar desconectado"); loadData(); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copiado!"));
  };

  const isConfigured = (key: string) => credSettings[key]?.configured ?? false;
  const googleConfigured = isConfigured("google_client_id") && isConfigured("google_client_secret");

  const email = integration?.metadata?.email ?? null;
  const connectedDate = integration?.connected_at
    ? format(new Date(integration.connected_at), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })
    : null;

  const steps = [
    {
      id: "step1",
      number: "01",
      title: "Criar projeto no Google Cloud",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Acesse o Google Cloud Console e crie um projeto para o Jarvis:</p>
          <ol className="space-y-2 list-none">
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Acesse <a href="https://console.cloud.google.com" target="_blank" rel="noopener" className="text-primary underline font-medium">console.cloud.google.com</a> e faça login com sua conta Google</span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>No topo da página, clique em <strong className="text-foreground">Selecionar projeto</strong> → <strong className="text-foreground">Novo projeto</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Dê um nome como <strong className="text-foreground">"Jarvis Calendar"</strong> e clique em <strong className="text-foreground">Criar</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Aguarde a criação e certifique-se de que o projeto novo está selecionado no topo</span></li>
          </ol>
        </div>
      ),
    },
    {
      id: "step2",
      title: "Ativar a API do Google Calendar",
      number: "02",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Com o projeto selecionado, ative a API que o Jarvis vai usar:</p>
          <ol className="space-y-2 list-none">
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>No menu lateral esquerdo, clique em <strong className="text-foreground">APIs e serviços</strong> → <strong className="text-foreground">Biblioteca</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Na barra de pesquisa, digite <strong className="text-foreground">"Google Calendar API"</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Clique no resultado <strong className="text-foreground">Google Calendar API</strong> e depois em <strong className="text-foreground">Ativar</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Aguarde a ativação — você será redirecionado para a página da API</span></li>
          </ol>
          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/10 border border-blue-500/20 mt-2">
            <AlertTriangle className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs">Você também pode ativar a <strong className="text-foreground">People API</strong> se quiser que o Jarvis acesse seu nome e foto do perfil Google.</p>
          </div>
        </div>
      ),
    },
    {
      id: "step3",
      title: "Configurar a tela de consentimento OAuth",
      number: "03",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Antes de criar as credenciais, configure a tela que aparece quando o usuário autoriza o acesso:</p>
          <ol className="space-y-2 list-none">
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>No menu lateral, clique em <strong className="text-foreground">APIs e serviços</strong> → <strong className="text-foreground">Tela de consentimento OAuth</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Selecione <strong className="text-foreground">Externo</strong> como tipo de usuário e clique em <strong className="text-foreground">Criar</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Preencha <strong className="text-foreground">Nome do app</strong> (ex: "Jarvis"), <strong className="text-foreground">Email de suporte</strong> e <strong className="text-foreground">Email do desenvolvedor</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Na etapa <strong className="text-foreground">Escopos</strong>, clique em <strong className="text-foreground">Adicionar ou remover escopos</strong> e marque <code className="bg-muted/50 px-1 rounded text-xs">.../auth/calendar</code></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Na etapa <strong className="text-foreground">Usuários de teste</strong>, adicione o seu email Google (obrigatório enquanto o app estiver em modo de teste)</span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Clique em <strong className="text-foreground">Salvar e continuar</strong> até o final</span></li>
          </ol>
          <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 mt-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-xs"><strong className="text-foreground">Importante:</strong> Enquanto o app estiver em modo de teste (não publicado), somente os emails adicionados como "usuários de teste" conseguirão conectar. Adicione todos os seus usuários Jarvis que precisam usar o Calendar.</p>
          </div>
        </div>
      ),
    },
    {
      id: "step4",
      title: "Criar as credenciais OAuth (Client ID e Secret)",
      number: "04",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Agora crie as credenciais que o Jarvis vai usar para se autenticar:</p>
          <ol className="space-y-2 list-none">
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>No menu lateral, clique em <strong className="text-foreground">APIs e serviços</strong> → <strong className="text-foreground">Credenciais</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Clique em <strong className="text-foreground">+ Criar credenciais</strong> → <strong className="text-foreground">ID do cliente OAuth</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Em <strong className="text-foreground">Tipo de aplicativo</strong>, selecione <strong className="text-foreground">Aplicativo Web</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Dê um nome (ex: "Jarvis Web") e em <strong className="text-foreground">URIs de redirecionamento autorizados</strong> clique em <strong className="text-foreground">+ Adicionar URI</strong></span></li>
            <li className="flex gap-2 items-start"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex-1">
                <span>Cole exatamente este URL:</span>
                <div className="flex items-center gap-2 mt-1.5 p-2 bg-muted/40 rounded-md border border-border">
                  <code className="text-xs font-mono flex-1 break-all select-all text-foreground">{callbackUrl}</code>
                  <Button variant="ghost" size="icon" aria-label="Copiar URL de redirecionamento" className="h-6 w-6 shrink-0" onClick={() => copyToClipboard(callbackUrl)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Clique em <strong className="text-foreground">Criar</strong> — uma janela mostrará seu <strong className="text-foreground">Client ID</strong> e <strong className="text-foreground">Client Secret</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Copie os dois valores e cole na seção <strong className="text-foreground">"Credenciais Google"</strong> abaixo</span></li>
          </ol>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-primary underline text-xs mt-1"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir Google Cloud Console — Credenciais
          </a>
        </div>
      ),
    },
    {
      id: "step5",
      title: "Salvar credenciais e conectar no Jarvis",
      number: "05",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Com o Client ID e Client Secret em mãos, finalize a conexão:</p>
          <ol className="space-y-2 list-none">
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Role esta página para baixo até a seção <strong className="text-foreground">"Credenciais Google OAuth"</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Cole o <strong className="text-foreground">Client ID</strong> e o <strong className="text-foreground">Client Secret</strong> nos campos correspondentes</span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Clique em <strong className="text-foreground">Salvar credenciais</strong> e aguarde a confirmação</span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Volte ao topo e clique em <strong className="text-foreground">Conectar Google Calendar</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Uma janela do Google vai abrir — faça login com sua conta e clique em <strong className="text-foreground">Permitir</strong></span></li>
            <li className="flex gap-2"><ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /><span>Pronto! O badge na página vai mudar para <strong className="text-green-400">Conectado</strong> ✓</span></li>
          </ol>
          <div className="flex items-start gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20 mt-2">
            <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
            <p className="text-xs"><strong className="text-foreground">Teste no WhatsApp:</strong> Mande uma mensagem pro Jarvis: <em>"O que tenho hoje na agenda?"</em> ou <em>"Cria reunião amanhã às 10h com o João"</em> — ele vai buscar e criar direto no seu Google Calendar.</p>
          </div>
        </div>
      ),
    },
    {
      id: "step6",
      title: "O que o Jarvis pode fazer com o Google Calendar",
      number: "✦",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Depois de conectado, você pode usar o Jarvis pelo WhatsApp para:</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: "📅", title: "Ver sua agenda", desc: "\"O que tenho hoje?\", \"Minha semana?\", \"Próximos compromissos\"" },
              { icon: "➕", title: "Criar eventos", desc: "\"Cria reunião sexta 15h\", \"Agenda consulta amanhã 9h\"" },
              { icon: "🔗", title: "Google Meet", desc: "\"Marca call com a Cibele sexta 14h\" — gera link Meet automaticamente" },
              { icon: "✏️", title: "Editar eventos", desc: "\"Muda minha reunião de amanhã pra 16h\"" },
              { icon: "🗑️", title: "Cancelar eventos", desc: "\"Cancela minha consulta de quinta\"" },
              { icon: "🔔", title: "Lembretes automáticos", desc: "Jarvis envia aviso no WhatsApp 10min antes dos seus compromissos" },
            ].map((f) => (
              <div key={f.title} className="flex gap-2.5 p-3 rounded-lg bg-muted/20 border border-border/50">
                <span className="text-lg shrink-0">{f.icon}</span>
                <div>
                  <p className="font-medium text-foreground text-xs">{f.title}</p>
                  <p className="text-[11px] mt-0.5 italic">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Google Calendar</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta Google para que o Jarvis acesse e gerencie seus compromissos direto pelo WhatsApp.
        </p>
      </div>

      {/* Status de conexão */}
      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-muted/30 flex items-center justify-center text-2xl">📅</div>
                <div>
                  <p className="font-semibold">Google Calendar</p>
                  {integration?.is_connected && email && (
                    <p className="text-xs text-muted-foreground mt-0.5">{email}</p>
                  )}
                  {integration?.is_connected && connectedDate && (
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">Conectado em {connectedDate}</p>
                  )}
                  {!integration?.is_connected && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {googleConfigured ? "Credenciais configuradas — pronto para conectar" : "Configure as credenciais antes de conectar"}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant={integration?.is_connected ? "default" : "secondary"}
                  className={integration?.is_connected ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}
                >
                  {integration?.is_connected ? "✓ Conectado" : "Desconectado"}
                </Badge>
                {integration?.is_connected ? (
                  <Button variant="outline" size="sm" onClick={handleDisconnect}>
                    Desconectar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={connecting || !googleConfigured}
                    onClick={handleConnect}
                    title={!googleConfigured ? "Configure as credenciais primeiro" : undefined}
                  >
                    {connecting ? "Redirecionando..." : "Conectar Google Calendar"}
                  </Button>
                )}
              </div>
            </div>
            {!googleConfigured && !integration?.is_connected && (
              <div className="flex items-center gap-2 mt-4 p-2.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Siga o passo a passo abaixo, configure as credenciais e depois conecte.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Passo a passo */}
      <div>
        <h2 className="text-base font-semibold mb-1">Passo a passo completo</h2>
        <p className="text-xs text-muted-foreground mb-4">Siga cada etapa para conectar o Google Calendar sem precisar de suporte.</p>
        <Accordion type="multiple" defaultValue={["step1"]} className="space-y-2">
          {steps.map((step) => (
            <AccordionItem key={step.id} value={step.id} className="border border-border rounded-xl bg-card px-4">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                    {step.number}
                  </span>
                  <span className="font-medium text-sm text-left">{step.title}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-5 pt-1">
                {step.content}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Credenciais OAuth */}
      <div className="border-t border-border pt-8">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold">Credenciais Google OAuth</h2>
          {!credLoading && (
            <Badge
              variant={googleConfigured ? "default" : "secondary"}
              className={googleConfigured ? "bg-green-500/20 text-green-400 border-green-500/30 text-[10px]" : "text-[10px]"}
            >
              {googleConfigured ? "✓ Configurado" : "Não configurado"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Cole aqui o <strong>Client ID</strong> e <strong>Client Secret</strong> gerados no passo 4. Faça isso antes de clicar em "Conectar".
        </p>
        <div className="flex items-start gap-2 mb-5 p-3 rounded-md bg-yellow-500/5 border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Essas são as credenciais do <strong>app OAuth</strong> criado por você no Google Cloud — não é sua senha pessoal do Google.
            Deixe em branco para manter o valor já salvo.
          </p>
        </div>

        {credLoading ? (
          <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Google Client ID</Label>
              <Input
                value={googleClientId}
                onChange={e => setGoogleClientId(e.target.value)}
                placeholder={isConfigured("google_client_id") ? "Já configurado — cole para atualizar" : "Obtenha em console.cloud.google.com"}
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Google Client Secret</Label>
              <Input
                type="password"
                value={googleClientSecret}
                onChange={e => setGoogleClientSecret(e.target.value)}
                placeholder={isConfigured("google_client_secret") ? "Já configurado — cole para atualizar" : "Segredo do cliente OAuth"}
                className="text-xs font-mono"
              />
            </div>
          </div>
        )}

        <Button onClick={saveCredentials} disabled={credSaving} className="mt-5 gap-2">
          <ShieldCheck className="h-4 w-4" />
          {credSaving ? "Salvando..." : "Salvar credenciais"}
        </Button>
      </div>
    </div>
  );
}
