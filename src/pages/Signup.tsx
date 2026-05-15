import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";
import { FlagImg } from "@/components/FlagImg";
import {
  COUNTRIES,
  findCountry,
  formatLocalByCountry,
  isValidLocalForCountry,
  buildFullPhone,
} from "@/lib/phone";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Telefone: DDI separado do número local pra evitar ambiguidade
  const [ddi, setDdi] = useState("55");                    // Brasil default
  const [localPhone, setLocalPhone] = useState("");        // só a parte local, sem DDI

  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const selectedCountry = findCountry(ddi);
  const localTouched = localPhone.replace(/\D/g, "").length > 0;
  const localValid = isValidLocalForCountry(localPhone, selectedCountry);
  const localError = localTouched && !localValid
    ? `Digite seu WhatsApp completo (mínimo ${selectedCountry.minLen} dígitos)`
    : null;

  const handleLocalChange = (raw: string) => {
    setLocalPhone(formatLocalByCountry(raw, selectedCountry));
  };

  const handleDDIChange = (newDdi: string) => {
    setDdi(newDdi);
    // Re-formata o número local conforme o novo país
    setLocalPhone(formatLocalByCountry(localPhone, findCountry(newDdi)));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!acceptedTerms) {
      toast.error("Você precisa aceitar os termos de uso para criar sua conta.");
      return;
    }

    if (!localValid) {
      toast.error(`Digite um WhatsApp válido pra ${selectedCountry.name}. Ex: ${selectedCountry.placeholder}`);
      return;
    }

    setLoading(true);

    // Monta phone completo: DDI + número local (só dígitos)
    const fullPhone = buildFullPhone(ddi, localPhone);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/email-confirmado`,
        data: {
          display_name: displayName,
          phone_number: fullPhone,
        },
      },
    });

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("phone") && (msg.includes("unique") || msg.includes("duplicate") || msg.includes("já"))) {
        toast.error("Esse WhatsApp já está cadastrado em outra conta. Use outro número ou faça login.");
      } else if (msg.includes("user already") || msg.includes("already registered")) {
        toast.error("Esse email já tem conta. Tente fazer login.");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Conta criada! Verifique seu email para confirmar.");
      navigate("/dashboard");
    }

    setLoading(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="flex justify-start mb-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
            </Button>
          </div>
          <div className="flex items-center justify-center mb-4">
            <img src={logoEscrita} alt="Hey Jarvis" fetchPriority="high" decoding="async" className="h-8 w-auto object-contain" />
          </div>
          <CardTitle className="text-xl">Criar sua conta</CardTitle>
          <CardDescription>Comece a usar seu assistente de IA no WhatsApp</CardDescription>
          <div className="mt-3 mx-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
            🎁 3 dias grátis pra testar tudo
          </div>
        </CardHeader>
        <form onSubmit={handleSignup}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Seu nome</Label>
              <Input
                id="name"
                placeholder="Como quer ser chamado"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                WhatsApp
              </Label>
              <div className="flex gap-2">
                {/* DDI Select com bandeira */}
                <Select value={ddi} onValueChange={handleDDIChange}>
                  <SelectTrigger
                    className="w-[120px] shrink-0"
                    aria-label="Selecionar país"
                  >
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        <FlagImg code={selectedCountry.code} />
                        <span className="text-sm">+{selectedCountry.ddi}</span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.ddi}>
                        <div className="flex items-center gap-2">
                          <FlagImg code={c.code} />
                          <span className="text-sm">+{c.ddi}</span>
                          <span className="text-xs text-muted-foreground">{c.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Input do número local */}
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={selectedCountry.placeholder}
                  value={localPhone}
                  onChange={e => handleLocalChange(e.target.value)}
                  required
                  aria-invalid={localError ? "true" : "false"}
                  className={localError ? "border-red-500/50 focus-visible:ring-red-500/50 flex-1" : "flex-1"}
                />
              </div>
              {localError && (
                <p className="text-xs text-red-400">{localError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox id="terms" checked={acceptedTerms} onCheckedChange={(v) => setAcceptedTerms(v === true)} className="mt-0.5" />
              <Label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                Li e concordo com os{" "}
                <Link to="/termos-de-uso" className="text-primary underline underline-offset-4" target="_blank">Termos de Uso</Link>
                {" "}e a{" "}
                <Link to="/politica-de-privacidade" className="text-primary underline underline-offset-4" target="_blank">Política de Privacidade</Link>
              </Label>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !acceptedTerms || !localValid}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar conta
            </Button>
            <p className="text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/login" className="text-primary underline underline-offset-4">Entrar</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
