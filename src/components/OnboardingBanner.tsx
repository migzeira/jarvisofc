import { useAccountStatus } from "@/hooks/useAccountStatus";
import { AlertCircle, Clock, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

export function OnboardingBanner() {
  const { status, loading } = useAccountStatus();

  if (loading || status === "active") return null;

  if (status === "pending") {
    return (
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3 flex items-center gap-3 text-sm">
        <Clock className="h-4 w-4 text-yellow-400 shrink-0" />
        <span className="text-yellow-200">
          <strong>Sua conta não tem um plano ativo.</strong> Ative um plano e registre seu número de WhatsApp no{" "}
          <Link to="/dashboard/perfil" className="underline underline-offset-2 font-semibold">
            Meu Perfil
          </Link>{" "}
          para utilizar o Jarvis.
        </span>
      </div>
    );
  }

  if (status === "suspended") {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3 flex items-center gap-3 text-sm">
        <XCircle className="h-4 w-4 text-red-400 shrink-0" />
        <span className="text-red-200">
          <strong>Conta suspensa.</strong> Seu acesso foi suspenso. Entre em contato com o suporte para reativar.
        </span>
      </div>
    );
  }

  return null;
}
