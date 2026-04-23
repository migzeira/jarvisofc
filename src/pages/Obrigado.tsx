import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle2, Mail, AlertTriangle, MessageCircle, Clock, Inbox } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";

/**
 * /obrigado — Thank-you page pos-compra Kirvano.
 *
 * Fluxo:
 *   1) Cliente finaliza compra na Kirvano
 *   2) Kirvano redireciona pra esta pagina com ?email={customer.email}
 *   3) Em paralelo, webhook Kirvano dispara inviteUserByEmail() no Supabase
 *   4) Cliente recebe email com link pra /bem-vindo e define senha
 *
 * Objetivo desta pagina: deixar cristalino o que ele precisa fazer
 * agora, que email procurar, que pode cair no spam. Zero duvida.
 */
// Detecta se um valor de query param é email real (não placeholder literal)
function isRealEmail(v: string | null): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.includes("customer.")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export default function Obrigado() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>("");

  // DEBUG MODE: ativa com ?debug=1 OU quando há params v1/v2/v3/v4 (teste de placeholder Kirvano)
  const debugMode =
    searchParams.get("debug") === "1" ||
    ["v1", "v2", "v3", "v4"].some((k) => searchParams.get(k) !== null);

  // Coleta todos query params pra inspeção no modo debug
  const allParams: Array<{ key: string; value: string; isEmail: boolean }> = [];
  searchParams.forEach((value, key) => {
    allParams.push({ key, value, isEmail: isRealEmail(value) });
  });

  useEffect(() => {
    // Tenta email direto primeiro; se for placeholder literal, tenta as variantes v1-v4
    const direct = searchParams.get("email");
    if (isRealEmail(direct)) {
      setEmail(direct!);
      return;
    }
    for (const k of ["v1", "v2", "v3", "v4"]) {
      const v = searchParams.get(k);
      if (isRealEmail(v)) {
        setEmail(v!);
        return;
      }
    }
    setEmail("");
  }, [searchParams]);

  // Log pra inspeção no console (sempre)
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[Obrigado] query params recebidos:", Object.fromEntries(searchParams.entries()));
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
            {email && (
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
                O email pode levar <strong>até 5 minutos</strong> pra chegar. Se passar disso, chama a gente no WhatsApp.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Suporte */}
        <Card className="bg-card border-border mb-4">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  Algum problema? Fala com a gente
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Se o email não chegou, se clicou e deu erro, qualquer dúvida — estamos aqui.
                </p>
                <a
                  href="https://wa.me/5511954643833"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Suporte via WhatsApp
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA alternativo: ja tem conta */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Já tem uma conta?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Entrar no Jarvis
            </Link>
          </p>
        </div>
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
