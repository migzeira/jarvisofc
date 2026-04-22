import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { User, Settings } from "lucide-react";
import MeuPerfil from "./MeuPerfil";
import ConfigAgente from "./ConfigAgente";

/**
 * Single unified settings page.
 * Wraps MeuPerfil and ConfigAgente inside tabs so users configure
 * everything (plan, WhatsApp, delivery, agent personality, modules,
 * quick replies) from one place.
 *
 * Tab state lives in ?tab=perfil|agente so old links like
 * /dashboard/perfil and /dashboard/agente can deep-link via redirect.
 */
export default function Configuracoes() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "agente" ? "agente" : "perfil";

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
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="perfil" className="gap-2">
            <User className="h-4 w-4" />
            Perfil &amp; Plano
          </TabsTrigger>
          <TabsTrigger value="agente" className="gap-2">
            <Settings className="h-4 w-4" />
            Agente
          </TabsTrigger>
        </TabsList>

        <TabsContent value="perfil" className="mt-6">
          <MeuPerfil hideTitle />
        </TabsContent>

        <TabsContent value="agente" className="mt-6">
          <ConfigAgente hideTitle />
        </TabsContent>
      </Tabs>
    </div>
  );
}
