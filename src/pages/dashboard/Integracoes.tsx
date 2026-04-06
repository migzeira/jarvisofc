import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Link2, HelpCircle, ChevronDown, Save, ExternalLink } from "lucide-react";
import { useSearchParams } from "react-router-dom";

interface Integration {
  id: string;
  provider: string;
  is_connected: boolean;
  metadata: Record<string, any> | null;
}

const providerConfig: Record<string, { name: string; icon: string; desc: string; group?: string }> = {
  google_calendar: { name: "Google Calendar", icon: "📅", desc: "Sincronize compromissos automaticamente", group: "google" },
  google_sheets: { name: "Google Sheets", icon: "📊", desc: "Exporte seus dados financeiros pra planilha", group: "google" },
  notion: { name: "Notion", icon: "📝", desc: "Salve anotações direto no seu workspace" },
};

const instructions: Record<string, string[]> = {
  google: [
    "Clique em Conectar Google",
    "Faça login com sua conta Google",
    "Autorize o MayaChat a acessar Calendar e Sheets",
    "Para Sheets: copie o ID da planilha que quer usar (está na URL entre /d/ e /edit)",
  ],
  notion: [
    "Clique em Conectar Notion",
    "Selecione seu workspace e autorize o MayaChat",
    "Cole o ID do database onde quer salvar as notas (parte após o último / antes do ? na URL)",
  ],
};

export default function Integracoes() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [notionDbId, setNotionDbId] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success) {
      toast.success(`${providerConfig[success]?.name || success} conectado com sucesso!`);
      setSearchParams({}, { replace: true });
    }
    if (error) {
      toast.error(`Erro ao conectar: ${error}`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    const { data } = await supabase.from("integrations").select("*").eq("user_id", user!.id);
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
    setConnecting(provider);
    try {
      const { data, error } = await supabase.functions.invoke("oauth-init", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });

      // supabase.functions.invoke doesn't support query params well for GET,
      // so we build the URL manually
      const projectUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${projectUrl}/functions/v1/oauth-init?provider=${provider}&user_id=${user!.id}`,
        {
          headers: {
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
        }
      );
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        toast.error(json.error || "Erro ao iniciar conexão");
        setConnecting(null);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao conectar");
      setConnecting(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    const { error } = await supabase
      .from("integrations")
      .update({ is_connected: false, access_token: null, refresh_token: null, connected_at: null })
      .eq("id", id);
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
      .eq("id", integration.id);

    if (error) toast.error("Erro ao salvar");
    else {
      toast.success("Salvo!");
      loadData();
    }
    setSavingField(null);
  };

  const getConnectedEmail = (integration: Integration) => {
    if (integration.metadata && typeof integration.metadata === "object") {
      return (integration.metadata as any).email;
    }
    return null;
  };

  const getNotionWorkspace = (integration: Integration) => {
    if (integration.metadata && typeof integration.metadata === "object") {
      return (integration.metadata as any).workspace_name;
    }
    return null;
  };

  const isGoogleConnected = integrations.some(
    (i) => (i.provider === "google_calendar" || i.provider === "google_sheets") && i.is_connected
  );

  if (loading)
    return (
      <div className="grid sm:grid-cols-2 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );

  const renderInstructionSteps = (group: string) => {
    const steps = instructions[group];
    if (!steps) return null;
    return (
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-3">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Como configurar</span>
          <ChevronDown className="h-3 w-3" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside bg-muted/30 rounded-md p-3">
            {steps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const renderCard = (integration: Integration) => {
    const config = providerConfig[integration.provider] || { name: integration.provider, icon: "🔗", desc: "" };
    const isGoogle = config.group === "google";
    const email = getConnectedEmail(integration);
    const workspaceName = getNotionWorkspace(integration);

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
            </div>
            {integration.is_connected ? (
              <Button variant="outline" size="sm" onClick={() => handleDisconnect(integration.id)}>
                Desconectar
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={connecting !== null || (isGoogle && isGoogleConnected)}
                onClick={() => handleConnect(integration.provider)}
              >
                {connecting === integration.provider ? "Redirecionando..." : isGoogle ? "Conectar Google" : "Conectar"}
              </Button>
            )}
          </div>

          {/* Google Sheets — sheet ID field */}
          {integration.provider === "google_sheets" && integration.is_connected && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-muted-foreground">ID da Planilha</label>
              <div className="flex gap-2">
                <Input
                  value={sheetId}
                  onChange={(e) => setSheetId(e.target.value)}
                  placeholder="Cole o ID da planilha (entre /d/ e /edit na URL)"
                  className="text-xs font-mono h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  disabled={savingField === "google_sheets"}
                  onClick={() => saveMetadataField("google_sheets", "sheet_id", sheetId)}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Notion — database ID field */}
          {integration.provider === "notion" && integration.is_connected && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-muted-foreground">ID do Database Notion</label>
              <div className="flex gap-2">
                <Input
                  value={notionDbId}
                  onChange={(e) => setNotionDbId(e.target.value)}
                  placeholder="Parte após o último / antes do ? na URL"
                  className="text-xs font-mono h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  disabled={savingField === "notion"}
                  onClick={() => saveMetadataField("notion", "database_id", notionDbId)}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Instructions */}
          {renderInstructionSteps(isGoogle ? "google" : integration.provider)}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Integrações</h1>
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
  );
}
