import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle2, Mail, AlertTriangle, MessageCircle, Clock, Inbox, LogIn, ArrowRight } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://fnilyapvhhygfzcdxqjm.supabase.co";

/**
 * /obrigado — Thank-you page pos-compra Kirvano.
 *
 * Fluxo:
 *   1) Cliente finaliza compra na Kirvano
 *   2) Kirvano redireciona aqui injetando ?ref={sale_id}&kirvano_upsell=<token>
 *      (a Kirvano NAO suporta placeholders tipo {customer.email} na URL)
 *   3) Em paralelo, webhook Kirvano grava o evento em kirvano_events e
 *      dispara inviteUserByEmail() no Supabase (cria auth user + email de ativacao)
 *   4) Esta pagina chama a edge function lookup-sale-email?ref=<sale_id>
 *      que retorna o email do cliente (pra mostrar "foi pra xxx@yyy.com")
 *   5) Cliente recebe email com link pra /bem-vindo e define senha
 *
 * Race condition: webhook e redirect rodam em paralelo. Se o cliente chegar
 * antes do evento estar gravado, fazemos polling ate aparecer (max 10s).
 */
function isRealEmail(v: string | null | undefined): boolean {
  if (!v) return false;
  const trimmed = String(v).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.includes("customer.")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function lookupEmailByRef(ref: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lookup-sale-email?ref=${encodeURIComponent(ref)}`, {
      method: "GET",
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return isRealEmail(data?.email) ? data.email : null;
  } catch {
    return null;
  }
}

export default function Obrigado() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>("");
  const [lookingUp, setLookingUp] = useState<boolean>(false);

  // Debug panel so ativa com ?debug=1 (usado pra troubleshoot quando necessario)
  const debugMode = searchParams.get("debug") === "1";

  const allParams: Array<{ key: string; value: string; isEmail: boolean }> = [];
  searchParams.forEach((value, key) => {
    allParams.push({ key, value, isEmail: isRealEmail(value) });
  });

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[Obrigado] query params recebidos:", Object.fromEntries(searchParams.entries()));

    let cancelled = false;
    const abort = new AbortController();

    const resolveEmail = async () => {
      // 1) Email direto na URL (caso Kirvano venha a suportar placeholder no futuro)
      const direct = searchParams.get("email");
      if (isRealEmail(direct)) {
        setEmail(direct!);
        return;
      }

      // 2) Lookup via ref (sale_id) — edge function consulta kirvano_events
      const ref = (searchParams.get("ref") ?? "").trim();
      if (!ref) return;

      setLookingUp(true);
      // Polling: webhook pode estar processando. Tenta 5x com ~1.5s de espera.
      const delays = [0, 1500, 2000, 2500, 3000];
      for (const delay of delays) {
        if (cancelled) return;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        const found = await lookupEmailByRef(ref, abort.signal);
        if (cancelled) return;
        if (found) {
          setEmail(found);
          setLookingUp(false);
          return;
        }
      }
      setLookingUp(false);
    };

    resolveEmail();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [searchParams]);

  return (
    <main className="min-h-screen bg-background px-4 py-8 flex flex-col items-center">
      <div className="w-full max-w-xl">
        {/* Header com logo */}
        <div className="flex justify-center mb-6">
          <img
            src={logoEscrita}
            alt="Hey Jarvis"
            className="h-8 w-auto object-contain"
          />
        </div>

        {/* Card principal */}
        <Card className="bg-card border-border mb-4">
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Compra confirmada!</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Obrigado por assinar o Hey Jarvis. Sua conta está sendo criada agora.
            </p>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* DEBUG PANEL — teste de placeholder Kirvano (aparece só em modo debug) */}
            {debugMode && (
              <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/40 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <p className="text-sm font-bold text-yellow-200 uppercase tracking-wider">
                    Modo Debug — Teste Kirvano
                  </p>
                </div>
                <p className="text-xs text-yellow-100/80">
                  Query params recebidos da Kirvano. O que virou email real é o placeholder correto.
                </p>
                <div className="space-y-1.5 font-mono text-xs">
                  {allParams.length === 0 ? (
                    <p className="text-yellow-200/70 italic">Nenhum query param recebido.</p>
                  ) : (
                    allParams.map((p) => (
                      <div
                        key={p.key}
                        className={`flex items-start gap-2 p-2 rounded ${
                          p.isEmail ? "bg-green-500/20 border border-green-500/40" : "bg-black/20"
                        }`}
                      >
                        <span className={`font-bold shrink-0 ${p.isEmail ? "text-green-300" : "text-yellow-300"}`}>
                          {p.key}=
                        </span>
                        <span className={`break-all ${p.isEmail ? "text-green-100" : "text-yellow-100/70"}`}>
                          {p.value}
                        </span>
                        {p.isEmail && (
                          <span className="ml-auto text-[10px] font-bold text-green-300 shrink-0">
                            ✓ EMAIL OK
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-yellow-100/60 italic">
                  Quando souber qual placeholder funciona, ajuste a thank-you URL da Kirvano pra usar só <code>?email=&lt;placeholder&gt;</code>.
                </p>
              </div>
            )}

            {/* Email usado */}
            {email ? (
              <div className="rounded-lg bg-accent/40 border border-border p-4">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Email da compra
                    </p>
                    <p className="text-sm font-medium text-foreground break-all mt-1">
                      {email}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      É pra este email que enviamos o link de acesso.
                    </p>
                  </div>
                </div>
              </div>
            ) : lookingUp ? (
              <div className="rounded-lg bg-accent/40 border border-border p-4">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-primary shrink-0 mt-0.5 animate-pulse" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Verificando sua compra...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Estamos confirmando os dados. Isso leva alguns segundos.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-accent/40 border border-border p-4">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Email da compra
                    </p>
                    <p className="text-sm font-medium text-foreground mt-1">
                      Verifique o email que você cadastrou na compra.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      É pra este email que enviamos o link de acesso.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Proximos passos */}
            <div>
              <h2 className="text-base font-semibold text-foreground mb-3">
                Próximos passos:
              </h2>
              <div className="space-y-3">
                <StepItem
                  num={1}
                  icon={<Inbox className="w-4 h-4" />}
                  title="Abra seu email"
                  desc="Procure por uma mensagem do Hey Jarvis com o assunto 'Ative sua conta'."
                />
                <StepItem
                  num={2}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  title="Não achou? Verifique o SPAM"
                  desc="O email pode cair na pasta de spam, lixo eletrônico ou promoções. Vale verificar lá também."
                  highlight
                />
                <StepItem
                  num={3}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  title="Clique no botão do email"
                  desc="Você vai ser levado pra uma página onde cria sua senha de acesso."
                />
                <StepItem
                  num={4}
                  icon={<MessageCircle className="w-4 h-4" />}
                  title="Comece a usar o Jarvis"
                  desc="Depois de criar a senha, você entra direto no app e já pode cadastrar seu WhatsApp."
                />
              </div>
            </div>

            {/* Aviso de tempo */}
            <div className="flex items-start gap-3 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
              <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300/90">
                O email pode levar <strong>até 5 minutos</strong> pra chegar. Enquanto isso, verifique também o spam.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* CTA destacado: ja tem conta */}
        <Card className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border-primary/40 mb-4 shadow-[0_0_40px_-12px] shadow-primary/30">
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                <LogIn className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  Já tem uma conta?
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Entre direto no Jarvis e comece a usar agora mesmo.
                </p>
              </div>
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto font-semibold gap-2 px-8 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all"
                >
                  Entrar no Jarvis
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────
// StepItem — item numerado com ícone
// ─────────────────────────────────────────────
function StepItem({
  num,
  icon,
  title,
  desc,
  highlight = false,
}: {
  num: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg p-3 ${
        highlight
          ? "bg-amber-500/10 border border-amber-500/30"
          : "bg-accent/30 border border-border"
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
          highlight
            ? "bg-amber-500/20 text-amber-300"
            : "bg-primary/10 text-primary"
        }`}
      >
        {num}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={highlight ? "text-amber-300" : "text-muted-foreground"}>
            {icon}
          </span>
          <p className={`text-sm font-semibold ${highlight ? "text-amber-200" : "text-foreground"}`}>
            {title}
          </p>
        </div>
        <p className={`text-xs ${highlight ? "text-amber-200/80" : "text-muted-foreground"}`}>
          {desc}
        </p>
      </div>
    </div>
  );
}
