import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { Link2, HelpCircle, ChevronDown, Save, ShieldCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Integration {
  id: string;
  provider: string;
  is_connected: boolean;
  connected_at: string | null;
  metadata: Record<string, any> | null;
}

const providerConfig: Record<string, { name: string; icon: string; desc: string; group?: string }> = {
  google_calendar: { name: "Google Calendar", icon: "📅", desc: "Sincroniza compromissos e lembretes automaticamente", group: "google" },
  google_sheets: { name: "Google Sheets", icon: "📊", desc: "Registra transações financeiras na sua planilha", group: "google" },
  notion: { name: "Notion", icon: "📝", desc: "Salva notas e informações importantes no seu Notion" },
};

const instructions: Record<string, string[]> = {
  google: [
    "Clique em Conectar Google",
    "Faça login com sua conta Google",
    "Autorize a Minha Maya a acessar Calendar e Sheets",
    "Para Sheets: copie o ID da planilha (entre /d/ e /edit na URL)",
  ],
  notion: [
    "Clique em Conectar Notion",
    "Selecione seu workspace e autorize a Minha Maya",
    "Cole o ID do database (parte após o último / antes do ? na URL)",
  ],
};

export default function Integracoes() {
  const { user, session } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [notionDbId, setNotionDbId] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);

  // ── Credenciais OAuth ────────────────────────────────────────────
  const [credSettings, setCredSettings] = useState<Record<string, { value: string; configured: boolean }>>({});
  const [credLoading, setCredLoading] = useState(true);
  const [credSaving, setCredSaving] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [notionClientId, setNotionClientId] = useState("");
  const [notionClientSecret, setNotionClientSecret] = useState("");

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
      if (Object.keys(body).length === 0) { toast.error("Preencha pelo menos um campo"); setCredSaving(false); return; }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session!.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro");
      toast.success("Credenciais salvas!");
      setGoogleClientId(""); setGoogleClientSecret(""); setNotionClientId(""); setNotionClientSecret("");
      loadCredentials();
    } catch { toast.error("Erro ao salvar credenciais"); }
    setCredSaving(false);
  };

  const isConfigured = (key: string) => credSettings[key]?.configured ?? false;
  const maskedValue = (key: string) => credSettings[key]?.value || "";

  // Detect OAuth return params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      toast.success("Integração conectada com sucesso!");
      window.history.replaceState({}, "", window.location.pathname);
      if (user) loadData();
    }
    if (error) {
      toast.error(`Erro ao conectar: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    const { data } = await supabase
      .from("integrations")
      .select("id, provider, is_connected, connected_at, metadata")
      .eq("user_id", user!.id);
    const items = (data ?? []) as Integration[];
    setIntegrations(items);

    const sheets = items.find((i) => i.provider === "google_sheets");
    if (sheets?.metadata && typeof sheets.metadata === "object") {
      setSheetId((sheets.metadata as any).sheet_id || "");
    }
    const notion = items.find((i) => i.provider === "notion");
    if (notion?.metadata && typeof notion.metadata === "object") {
      setNotionDbId((notion.metadata as any).database_id || "");
    }
    setLoading(false);
  };

  const handleConnect = async (provider: string) => {
    if (!session?.access_token) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setConnecting(provider);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/oauth-init?provider=${provider}&user_id=${user!.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        toast.error(json.error || "Erro ao iniciar conexão");
        setConnecting(null);
      }
    } catch {
      toast.error("Erro ao conectar");
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    const { error } = await supabase
      .from("integrations")
      .update({ is_connected: false, access_token: null, refresh_token: null, connected_at: null })
      .eq("user_id", user!.id)
      .eq("provider", provider);
    if (error) toast.error("Erro ao desconectar");
    else {
      toast.success("Desconectado");
      loadData();
    }
  };

  const saveMetadataField = async (provider: string, field: string, value: string) => {
    setSavingField(provider);
    const integration = integrations.find((i) => i.provider === provider);
    if (!integration) return;
    const currentMeta = (integration.metadata && typeof integration.metadata === "object" ? integration.metadata : {}) as Record<string, any>;
    const newMeta = { ...currentMeta, [field]: value };
    const { error } = await supabase
      .from("integrations")
      .update({ metadata: newMeta as any })
      .eq("user_id", user!.id)
      .eq("provider", provider);
    if (error) toast.error("Erro ao salvar");
    else { toast.success("Salvo!"); loadData(); }
    setSavingField(null);
  };

  const isGoogleConnected = integrations.some(
    (i) => (i.provider === "google_calendar" || i.provider === "google_sheets") && i.is_connected
  );

  if (loading)
    return (
      <div className="grid sm:grid-cols-2 gap-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}
      </div>
    );

  const renderCard = (integration: Integration) => {
    const config = providerConfig[integration.provider];
    if (!config) return null;
    const isGoogle = config.group === "google";
    const email = integration.metadata && typeof integration.metadata === "object" ? (integration.metadata as any).email : null;
    const workspaceName = integration.metadata && typeof integration.metadata === "object" ? (integration.metadata as any).workspace_name : null;
    const connectedDate = integration.connected_at
      ? format(new Date(integration.connected_at), "dd MMM yyyy, HH:mm", { locale: ptBR })
      : null;

    // For google_sheets or google_calendar, "Conectar Google" triggers google_calendar provider
    const connectProvider = isGoogle ? "google_calendar" : integration.provider;
    // Disable connect button for the second google card if google is already connected
    const hideConnectBtn = isGoogle && isGoogleConnected && !integration.is_connected;

    return (
      <Card key={integration.id} className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="text-3xl mb-3">{config.icon}</div>
          <h3 className="font-semibold mb-1">{config.name}</h3>
          <p className="text-sm text-muted-foreground mb-1">{config.desc}</p>

          {isGoogle && (
            <p className="text-[11px] text-muted-foreground/70 mb-3 italic">
              Ambos usam a mesma conta Google
            </p>
          )}

          <div className="flex items-center justify-between mb-2">
            <div>
              <Badge
                variant={integration.is_connected ? "default" : "secondary"}
                className={integration.is_connected ? "bg-success/20 text-success border-success/30" : ""}
              >
                {integration.is_connected ? "Conectado" : "Desconectado"}
              </Badge>
              {integration.is_connected && email && isGoogle && (
                <p className="text-xs text-muted-foreground mt-1">{email}</p>
              )}
              {integration.is_connected && workspaceName && integration.provider === "notion" && (
                <p className="text-xs text-muted-foreground mt-1">Workspace: {workspaceName}</p>
              )}
              {integration.is_connected && connectedDate && (
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Conectado em {connectedDate}</p>
              )}
            </div>
            {integration.is_connected ? (
              <Button variant="outline" size="sm" onClick={() => handleDisconnect(integration.provider)}>
                Desconectar
              </Button>
            ) : hideConnectBtn ? null : (
              <Button
                size="sm"
                disabled={connecting !== null}
                onClick={() => handleConnect(connectProvider)}
              >
                {connecting === connectProvider ? "Redirecionando..." : isGoogle ? "Conectar Google" : "Conectar Notion"}
              </Button>
            )}
          </div>

          {/* Google Sheets — sheet ID */}
          {integration.provider === "google_sheets" && integration.is_connected && (
            <div className="mt-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">ID da Planilha</label>
              <p className="text-[11px] text-muted-foreground/60">
                Cole o ID da sua planilha (encontrado na URL: sheets.google.com/d/<strong>ID</strong>/edit)
              </p>
              <div className="flex gap-2">
                <Input
                  value={sheetId}
                  onChange={(e) => setSheetId(e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  className="text-xs font-mono h-8"
                />
                <Button
                  size="sm" variant="outline" className="h-8 px-2"
                  disabled={savingField === "google_sheets"}
                  onClick={() => saveMetadataField("google_sheets", "sheet_id", sheetId)}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Notion — database ID */}
          {integration.provider === "notion" && integration.is_connected && (
            <div className="mt-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">ID do Database Notion</label>
              <p className="text-[11px] text-muted-foreground/60">
                Cole o ID do database onde as notas serão salvas
              </p>
              <div className="flex gap-2">
                <Input
                  value={notionDbId}
                  onChange={(e) => setNotionDbId(e.target.value)}
                  placeholder="abc123def456..."
                  className="text-xs font-mono h-8"
                />
                <Button
                  size="sm" variant="outline" className="h-8 px-2"
                  disabled={savingField === "notion"}
                  onClick={() => saveMetadataField("notion", "database_id", notionDbId)}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Collapsible instructions */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-3">
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Como configurar</span>
              <ChevronDown className="h-3 w-3" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside bg-muted/30 rounded-md p-3">
                {(instructions[isGoogle ? "google" : integration.provider] || []).map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    );
  };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const callbackUrl = `${supabaseUrl}/functions/v1/oauth-callback`;
  const googleConfigured = isConfigured("google_client_id") && isConfigured("google_client_secret");
  const notionConfigured = isConfigured("notion_client_id") && isConfigured("notion_client_secret");

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Integrações</h1>

      {/* ── Integrações conectadas ── */}
      <div>
        <h2 className="text-base font-semibold mb-4 text-muted-foreground uppercase tracking-wide text-xs">Serviços conectados</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((i) => renderCard(i))}
          {integrations.length === 0 && (
            <Card className="bg-card border-border col-span-full">
              <CardContent className="py-12 text-center">
                <Link2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhuma integração disponível.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Credenciais OAuth ── */}
      <div className="border-t border-border pt-8">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold">Credenciais OAuth</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure as credenciais necessárias para que Google e Notion funcionem. Faça isso antes de conectar.
        </p>
        <div className="flex items-start gap-2 mb-5 p-3 rounded-md bg-yellow-500/5 border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Essas credenciais são do <strong>app OAuth</strong> que você criará no Google Console / Notion (não sua senha pessoal).
            Deixe em branco para manter o valor atual já salvo.
          </p>
        </div>

        {credLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <Accordion type="multiple" defaultValue={[]} className="space-y-3">
            {/* Google OAuth */}
            <AccordionItem value="google" className="border border-border rounded-xl bg-card px-4">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl">🔑</span>
                  <span className="font-medium text-sm">Google OAuth</span>
                  <Badge
                    variant={googleConfigured ? "default" : "secondary"}
                    className={googleConfigured ? "bg-success/20 text-success border-success/30 text-[10px]" : "text-[10px]"}
                  >
                    {googleConfigured ? "✓ Configurado" : "Não configurado"}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-5">
                <div className="text-xs text-muted-foreground space-y-1.5 bg-muted/20 rounded-md p-3">
                  <p className="font-medium text-foreground">Como obter suas credenciais Google:</p>
                  <p>1. Acesse <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-primary underline font-mono">console.cloud.google.com/apis/credentials</a></p>
                  <p>2. Crie um projeto (ou selecione um existente)</p>
                  <p>3. Clique em <strong>+ Criar Credenciais</strong> → <strong>ID do cliente OAuth</strong></p>
                  <p>4. Tipo de aplicativo: <strong>Aplicativo Web</strong></p>
                  <p>5. Em <strong>"URIs de redirecionamento autorizados"</strong>, adicione:</p>
                  <code className="block bg-muted/40 rounded px-2 py-1 text-[11px] mt-1 break-all select-all">{callbackUrl}</code>
                  <p>6. Copie o <strong>Client ID</strong> e <strong>Client Secret</strong> gerados e cole abaixo</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-2 italic">
                    Obs: Ative as APIs do Google Calendar e Google Sheets no seu projeto Google Cloud.
                  </p>
                </div>
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
              </AccordionContent>
            </AccordionItem>

            {/* Notion OAuth */}
            <AccordionItem value="notion" className="border border-border rounded-xl bg-card px-4">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📝</span>
                  <span className="font-medium text-sm">Notion OAuth</span>
                  <Badge
                    variant={notionConfigured ? "default" : "secondary"}
                    className={notionConfigured ? "bg-success/20 text-success border-success/30 text-[10px]" : "text-[10px]"}
                  >
                    {notionConfigured ? "✓ Configurado" : "Não configurado"}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-5">
                <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 rounded-md p-3">
                  <p className="font-medium text-foreground">Como obter:</p>
                  <p>1. Acesse <span className="font-mono">notion.so/my-integrations</span> → Nova integração</p>
                  <p>2. Tipo: <strong>Público</strong></p>
                  <p>3. URI de redirecionamento:</p>
                  <code className="block bg-muted/40 rounded px-2 py-1 text-[11px] mt-1 break-all select-all">{callbackUrl}</code>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Notion Client ID</Label>
                    <Input
                      value={notionClientId}
                      onChange={e => setNotionClientId(e.target.value)}
                      placeholder={isConfigured("notion_client_id") ? "Já configurado — cole para atualizar" : "notion.so/my-integrations"}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Notion Client Secret</Label>
                    <Input
                      type="password"
                      value={notionClientSecret}
                      onChange={e => setNotionClientSecret(e.target.value)}
                      placeholder={isConfigured("notion_client_secret") ? "Já configurado — cole para atualizar" : "Segredo da integração"}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        )}

        <Button onClick={saveCredentials} disabled={credSaving} className="mt-5 gap-2">
          <ShieldCheck className="h-4 w-4" />
          {credSaving ? "Salvando..." : "Salvar credenciais"}
        </Button>
      </div>
    </div>
  );
}
