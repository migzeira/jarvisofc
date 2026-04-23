import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";

type Status = "loading" | "success" | "error";

export default function EmailConfirmed() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    const confirmEmail = async () => {
      const hash = window.location.hash;
      const search = window.location.search;

      // Erro vindo do Supabase (ex: link expirado)
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(search);
      const errorDescription =
        hashParams.get("error_description") || searchParams.get("error_description");
      if (errorDescription) {
        setErrorMsg(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
        setStatus("error");
        return;
      }

      // Fluxo PKCE: ?code=...
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }
        setStatus("success");
        return;
      }

      // Fluxo implicit: #access_token=...
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }
        setStatus("success");
        return;
      }

      // Sessão já ativa (usuário voltou pela URL depois de confirmado)
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setStatus("success");
        return;
      }

      setErrorMsg("Link de confirmação inválido ou expirado.");
      setStatus("error");
    };

    confirmEmail();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <img
              src={logoEscrita}
              alt="Hey Jarvis"
              fetchPriority="high"
              decoding="async"
              className="h-8 w-auto object-contain"
            />
          </div>

          {status === "loading" && (
            <>
              <div className="flex justify-center mb-2">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              </div>
              <CardTitle className="text-xl">Confirmando seu email...</CardTitle>
              <CardDescription>Só um instante.</CardDescription>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center mb-2">
                <CheckCircle2 className="w-14 h-14 text-green-500" />
              </div>
              <CardTitle className="text-xl">Email confirmado!</CardTitle>
              <CardDescription>
                Sua conta está ativa. Bem-vindo ao Hey Jarvis.
              </CardDescription>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex justify-center mb-2">
                <XCircle className="w-14 h-14 text-destructive" />
              </div>
              <CardTitle className="text-xl">Não foi possível confirmar</CardTitle>
              <CardDescription>{errorMsg}</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent />

        <CardFooter className="flex flex-col gap-3">
          {status === "success" && (
            <Button className="w-full" onClick={() => navigate("/dashboard")}>
              Ir para o Dashboard
            </Button>
          )}

          {status === "error" && (
            <Button asChild className="w-full">
              <Link to="/login">Voltar para o login</Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
