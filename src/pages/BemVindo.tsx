import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Sparkles } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";

type Status = "loading" | "ready" | "success" | "error";

/**
 * /bem-vindo — Destino do link de convite do Supabase apos compra Kirvano.
 *
 * Fluxo:
 *   1) Webhook Kirvano chamou inviteUserByEmail(email, { redirectTo: '/bem-vindo' })
 *   2) Supabase enviou email com link contendo token
 *   3) Cliente clica no link → cai aqui com ?code=... (PKCE) ou #access_token=... (implicit)
 *   4) Fazemos exchange/setSession → mostra form de senha
 *   5) Cliente define senha → updateUser → redireciona pra /dashboard
 *
 * O trigger handle_new_user ja criou o profile com conta ATIVA e plano correto
 * (match por email com kirvano_events pendente). Entao ao entrar ele ja ta liberado.
 */
export default function BemVindo() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Step 1: processa o token do link de convite (igual EmailConfirmed.tsx).
  useEffect(() => {
    const consumeInvite = async () => {
      const hash = window.location.hash;
      const search = window.location.search;

      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(search);

      // Erro vindo do Supabase (ex: link expirado)
      const errorDescription =
        hashParams.get("error_description") || searchParams.get("error_description");
      if (errorDescription) {
        setErrorMsg(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
        setStatus("error");
        return;
      }

      // PKCE: ?code=...
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }
        setStatus("ready");
        return;
      }

      // Implicit: #access_token=...&refresh_token=...
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
        setStatus("ready");
        return;
      }

      // Sessão já ativa (ex: usuário voltou pra URL depois de logado)
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setStatus("ready");
        return;
      }

      setErrorMsg("Link de ativação inválido ou expirado. Se o problema persistir, entre em contato pelo WhatsApp.");
      setStatus("error");
    };

    consumeInvite();
  }, []);

  // Step 2: submissao da senha.
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha precisa ter no mínimo 6 caracteres.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }
    setStatus("success");
    toast.success("Conta ativada! Bem-vindo ao Jarvis.");
    // Pequeno delay pra o user ver a confirmação antes do redirect
    setTimeout(() => navigate("/dashboard"), 1200);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img
              src={logoEscrita}
              alt="Hey Jarvis"
              className="h-8 w-auto object-contain"
            />
          </div>

          {status === "loading" && (
            <>
              <div className="flex justify-center mb-3">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              </div>
              <CardTitle className="text-xl">Validando seu acesso...</CardTitle>
              <CardDescription>Só um instante.</CardDescription>
            </>
          )}

          {status === "ready" && (
            <>
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">Bem-vindo ao Jarvis!</CardTitle>
              <CardDescription>
                Sua assinatura está ativa. Crie uma senha pra acessar sua conta.
              </CardDescription>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center mb-3">
                <CheckCircle2 className="w-14 h-14 text-green-500" />
              </div>
              <CardTitle className="text-xl">Tudo pronto!</CardTitle>
              <CardDescription>Te levando pro seu dashboard...</CardDescription>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex justify-center mb-3">
                <XCircle className="w-14 h-14 text-destructive" />
              </div>
              <CardTitle className="text-xl">Não foi possível ativar</CardTitle>
              <CardDescription>{errorMsg}</CardDescription>
            </>
          )}
        </CardHeader>

        {status === "ready" && (
          <form onSubmit={handleSetPassword}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Sua senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoFocus
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use essa senha sempre que entrar no Jarvis.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar senha e entrar
              </Button>
            </CardFooter>
          </form>
        )}

        {status === "error" && (
          <CardFooter className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link to="/login">Ir para o login</Link>
            </Button>
            <a
              href="https://wa.me/5511954643833"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Falar com suporte via WhatsApp
            </a>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
