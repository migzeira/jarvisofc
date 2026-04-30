import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { User, Settings, Heart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { isCouplePlan } from "@/lib/plan";
import MeuPerfil from "./MeuPerfil";
import ConfigAgente from "./ConfigAgente";
import ConfigCasal from "./ConfigCasal";

/**
 * Single unified settings page.
 * Wraps MeuPerfil, ConfigAgente e (pra plano casal) ConfigCasal em tabs.
 *
 * Tab state lives in ?tab=perfil|agente|casal so old links like
 * /dashboard/perfil and /dashboard/agente can deep-link via redirect.
 *
 * A aba "Casal" só aparece pra usuários com plan='maya_casal_*'. Pra outros,
 * a UI fica idêntica à versão pré-casal.
 */
export default function Configuracoes() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [hasCouplePlan, setHasCouplePlan] = useState(false);

  // Carrega plan do user pra saber se mostra aba Casal.
  // Cliente solo nunca recebe true → UI igual versão antiga.
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setHasCouplePlan(isCouplePlan((data?.plan as string) ?? null));
      });
  }, [user]);

  const requestedTab = params.get("tab");
  const tab =
    requestedTab === "agente"
      ? "agente"
      : requestedTab === "casal" && hasCouplePlan
        ? "casal"
        : "perfil";

  const handleChange = (next: string) => {
    const sp = new URLSearchParams(params);
    sp.set("tab", next);
    setParams(sp, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seu perfil, número de WhatsApp, plano e como o Jarvis se comporta — tudo em um lugar.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleChange} className="w-full">
        <TabsList className={`grid w-full ${hasCouplePlan ? "grid-cols-3 max-w-xl" : "grid-cols-2 max-w-md"}`}>
          <TabsTrigger value="perfil" className="gap-2">
            <User className="h-4 w-4" />
            Perfil &amp; Plano
          </TabsTrigger>
          <TabsTrigger value="agente" className="gap-2">
            <Settings className="h-4 w-4" />
            Agente
          </TabsTrigger>
          {hasCouplePlan && (
            <TabsTrigger value="casal" className="gap-2">
              <Heart className="h-4 w-4 text-pink-400" />
              Casal
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="perfil" className="mt-6">
          <MeuPerfil hideTitle />
        </TabsContent>

        <TabsContent value="agente" className="mt-6">
          <ConfigAgente hideTitle />
        </TabsContent>

        {hasCouplePlan && (
          <TabsContent value="casal" className="mt-6">
            <ConfigCasal hideTitle />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
