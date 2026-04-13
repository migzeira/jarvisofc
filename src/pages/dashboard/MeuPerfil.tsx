import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Save, Clock, CheckCircle, XCircle, Info, Smartphone, Lock, AlertTriangle,
  Crown, ExternalLink, Calendar, MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SUPPORT_WHATSAPP = "5511999999999"; // TODO: trocar pelo número real de suporte
const MAX_PHONE_CHANGES = 2; // após isso, campo fica bloqueado

const COUNTRIES = [
  { ddi: "55",  code: "br", name: "Brasil",          placeholder: "11 99999-9999",  minLen: 10 },
  { ddi: "1",   code: "us", name: "EUA / Canadá",    placeholder: "555 555-5555",   minLen: 10 },
  { ddi: "351", code: "pt", name: "Portugal",         placeholder: "912 345 678",    minLen: 9  },
  { ddi: "54",  code: "ar", name: "Argentina",        placeholder: "11 1234-5678",   minLen: 10 },
  { ddi: "52",  code: "mx", name: "México",           placeholder: "55 1234-5678",   minLen: 10 },
  { ddi: "57",  code: "co", name: "Colômbia",         placeholder: "300 123 4567",   minLen: 10 },
  { ddi: "56",  code: "cl", name: "Chile",            placeholder: "9 1234 5678",    minLen: 9  },
  { ddi: "595", code: "py", name: "Paraguai",         placeholder: "981 123 456",    minLen: 9  },
  { ddi: "598", code: "uy", name: "Uruguai",          placeholder: "094 123 456",    minLen: 9  },
  { ddi: "58",  code: "ve", name: "Venezuela",        placeholder: "412 123 4567",   minLen: 10 },
  { ddi: "51",  code: "pe", name: "Peru",             placeholder: "912 345 678",    minLen: 9  },
  { ddi: "593", code: "ec", name: "Equador",          placeholder: "99 123 4567",    minLen: 9  },
  { ddi: "244", code: "ao", name: "Angola",           placeholder: "923 123 456",    minLen: 9  },
  { ddi: "258", code: "mz", name: "Moçambique",       placeholder: "82 123 4567",    minLen: 9  },
  { ddi: "44",  code: "gb", name: "Reino Unido",      placeholder: "7911 123456",    minLen: 10 },
  { ddi: "49",  code: "de", name: "Alemanha",         placeholder: "151 23456789",   minLen: 10 },
  { ddi: "34",  code: "es", name: "Espanha",          placeholder: "612 345 678",    minLen: 9  },
  { ddi: "33",  code: "fr", name: "França",           placeholder: "6 12 34 56 78",  minLen: 9  },
  { ddi: "39",  code: "it", name: "Itália",           placeholder: "312 345 6789",   minLen: 9  },
];

const timezones = [
  "America/Sao_Paulo", "America/Fortaleza", "America/Manaus", "America/Cuiaba",
  "America/Belem", "America/Recife", "America/Bahia", "America/Porto_Velho",
  "America/Rio_Branco", "America/Noronha",
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Flag image from flagcdn.com (works on all OSes including Windows) */
function FlagImg({ code, className = "" }: { code: string; className?: string }) {
  return (
    <img
      src={`https://flagcdn.com/20x15/${code}.png`}
      srcSet={`https://flagcdn.com/40x30/${code}.png 2x`}
      width={20}
      height={15}
      alt={code.toUpperCase()}
      className={`rounded-[2px] object-cover shrink-0 ${className}`}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/** Formats a full stored phone number (digits only) for display: +55 (11) 99999-9999 */
function formatFullPhone(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return phone;
  // Brazil 13-digit (55 + DDD 2 + 9 digits)
  if (d.startsWith("55") && d.length === 13)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  // Brazil 12-digit (55 + DDD 2 + 8 digits)
  if (d.startsWith("55") && d.length === 12)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  // Generic: find DDI prefix
  const sorted = [...COUNTRIES].sort((a, b) => b.ddi.length - a.ddi.length);
  for (const c of sorted) {
    if (d.startsWith(c.ddi)) return `+${c.ddi} ${d.slice(c.ddi.length)}`;
  }
  return `+${d}`;
}

/** Extracts DDI and local part from a stored full phone number (digits only) */
function extractDDI(fullNumber: string): { ddi: string; local: string } {
  const digits = (fullNumber ?? "").replace(/\D/g, "");
  if (!digits) return { ddi: "55", local: "" };
  // Try longest DDI first to avoid false prefix matches (e.g. "595" before "59")
  const sorted = [...COUNTRIES].sort((a, b) => b.ddi.length - a.ddi.length);
  for (const c of sorted) {
    if (digits.startsWith(c.ddi)) {
      return { ddi: c.ddi, local: digits.slice(c.ddi.length) };
    }
  }
  return { ddi: "55", local: digits };
}

/** Formats Brazilian local number as (XX) XXXXX-XXXX for display */
function formatBRLocal(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "active") return (
    <Badge className="bg-green-500/20 text-green-300 border-green-500/30 flex items-center gap-1">
      <CheckCircle className="h-3 w-3" /> Ativa
    </Badge>
  );
  if (status === "suspended") return (
    <Badge className="bg-red-500/20 text-red-300 border-red-500/30 flex items-center gap-1">
      <XCircle className="h-3 w-3" /> Suspensa
    </Badge>
  );
  return (
    <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 flex items-center gap-1">
      <Clock className="h-3 w-3" /> Aguardando ativação
    </Badge>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function MeuPerfil() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);

  // Phone fields (split from stored number)
  const [selectedDdi, setSelectedDdi] = useState("55");
  const [localNumber, setLocalNumber] = useState("");

  useEffect(() => { if (user) loadData(); }, [user]);

  const loadData = async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
    setProfile(data);

    // Extract DDI + local from stored phone_number
    if (data?.phone_number) {
      const { ddi, local } = extractDDI(data.phone_number);
      setSelectedDdi(ddi);
      setLocalNumber(local);
    }
    setLoading(false);
  };

  // ── Derived state ──
  const selectedCountry = COUNTRIES.find(c => c.ddi === selectedDdi) ?? COUNTRIES[0];
  const localDigits = localNumber.replace(/\D/g, "");
  const isValidLocal = localDigits.length >= selectedCountry.minLen;
  const builtPhone = isValidLocal ? selectedDdi + localDigits : null;

  const storedPhone = profile?.phone_number ?? null;
  const isPhoneChanging = builtPhone !== storedPhone && !(builtPhone === null && storedPhone === null);
  const changesCount = profile?.phone_changes_count ?? 0;

  // Locked: already set a number AND exhausted change allowance
  const isPhoneLocked = storedPhone !== null && changesCount >= MAX_PHONE_CHANGES;

  // Plan gate: só pode cadastrar/editar WhatsApp se tiver plano ativo
  // Verifica account_status E access_until (se tiver data, precisa estar no futuro).
  // Sem essa segunda checagem, um user expirado com status ainda 'active' no banco
  // (antes do cron rodar) conseguia cadastrar WhatsApp e depois a Maya bloqueava no webhook.
  const hasActivePlan =
    profile?.account_status === "active" &&
    (!profile?.access_until || new Date(profile.access_until) > new Date());
  const isPhoneBlockedByPlan = !hasActivePlan;

  // ── Save ──
  const handleSave = async () => {
    if (!profile) return;

    // Plan gate: sem plano ativo não pode cadastrar/trocar telefone
    if (isPhoneBlockedByPlan && isPhoneChanging) {
      toast.error("Assine um plano para cadastrar seu WhatsApp.");
      return;
    }

    // If trying to change a locked phone → block
    if (isPhoneLocked && isPhoneChanging) {
      toast.error("Número bloqueado para alteração. Entre em contato com o suporte.");
      return;
    }

    // If phone provided but invalid format → block
    if (localDigits.length > 0 && !isValidLocal) {
      toast.error(`Número inválido. Informe pelo menos ${selectedCountry.minLen} dígitos após o DDI.`);
      return;
    }

    setSaving(true);

    try {
      // Increment change counter only when actually changing to a different number
      const newPhone = isValidLocal ? builtPhone : null;
      const isRealChange = newPhone !== storedPhone;

      // Verifica se o número já está cadastrado em OUTRA conta.
      // Não pode ter o mesmo número em 2 contas — é uma única conversa
      // no WhatsApp com o número da Maya, não tem como distinguir.
      if (newPhone && isRealChange) {
        const { data: existing } = await supabase
          .from("profiles")
          .select("id, display_name")
          .or(`phone_number.eq.${newPhone},phone_number.eq.+${newPhone}`)
          .neq("id", user!.id)
          .maybeSingle();

        if (existing) {
          toast.error(
            `Este número já está cadastrado em outra conta da Minha Maya. ` +
            `Cada número só pode ser usado em uma conta. Use outro número.`
          );
          setSaving(false);
          return;
        }
      }
      const newChangesCount = isRealChange && newPhone !== null
        ? changesCount + 1
        : changesCount;

      // NÃO altera account_status aqui — isso é função do admin ou Kirvano webhook.
      // O trigger sync_account_status_on_phone_change só reverte pra pending se limpar o número.
      const { error } = await supabase.from("profiles").update({
        display_name: profile.display_name?.trim() || null,
        phone_number: newPhone,
        timezone: profile.timezone,
        phone_changes_count: newChangesCount,
      }).eq("id", user!.id);

      if (error) {
        toast.error("Erro ao salvar. Tente novamente.");
        return;
      }

      // Update local state
      const updatedProfile = {
        ...profile,
        phone_number: newPhone,
        phone_changes_count: newChangesCount,
        ...(!newPhone && { account_status: "pending" }),
      };
      setProfile(updatedProfile);

      if (isRealChange && newPhone) {
        const remaining = MAX_PHONE_CHANGES - newChangesCount;
        if (remaining <= 0) {
          toast.success("Número salvo! ⚠️ Este foi seu último ajuste permitido.");
        } else if (!storedPhone) {
          toast.success("🎉 Número salvo! Agora ative o agente na aba Início e envie uma mensagem pra Maya.");
        } else {
          toast.success(`Número atualizado! Você ainda pode alterá-lo mais ${remaining} vez${remaining === 1 ? "" : "es"}.`);
        }
      } else if (!newPhone) {
        toast.success("Número removido. A Maya não responderá até você adicionar um número.");
      } else {
        toast.success("Perfil atualizado!");
      }
    } finally {
      setSaving(false);
    }
  };

  // Chama a edge function whatsapp-link-init que gera um código MAYA-XXXXXX
  // e envia pro WhatsApp do usuário via Evolution API.
  const sendLinkCode = async (opts: { silent?: boolean } = {}) => {
    setLinking(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada. Recarregue a página."); return; }

      const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1/whatsapp-link-init`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (!opts.silent) toast.error(data.message || "Não consegui enviar o código. Tente novamente.");
        return;
      }

      // Atualiza profile local com o novo código
      setProfile((p: any) => ({ ...p, link_code: data.code, link_code_expires_at: data.expires_at }));

      if (!opts.silent) {
        if (data.linked) {
          // Resolvido direto pelo endpoint do Evolution — cliente já está vinculado
          toast.success("✅ WhatsApp conectado! Pode começar a usar a Maya agora.");
          // Atualiza profile local pra refletir o whatsapp_lid preenchido
          setProfile((p: any) => ({ ...p, whatsapp_lid: data.jid }));
        } else if (data.sent) {
          toast.success('✅ Mensagem enviada no seu WhatsApp. Responda "oi" lá pra ativar.');
        } else {
          toast.warning("Mensagem gerada. Abra o WhatsApp da Maya e mande qualquer mensagem.");
        }
      }
    } catch (err) {
      if (!opts.silent) toast.error("Erro de rede. Tente novamente.");
      console.error("sendLinkCode error:", err);
    } finally {
      setLinking(false);
    }
  };

  // ── Plan label helpers ──
  // Se foi admin_trial → "Período teste"
  // Se foi admin_plan  → "Mensal/Anual (admin)"
  // Se foi kirvano     → "Mensal/Anual"
  const accessSource = profile?.access_source as string | null;
  const subscriptionCancelledAt = profile?.subscription_cancelled_at ? new Date(profile.subscription_cancelled_at) : null;
  const planLabel = (() => {
    // Sem plano ativo: account_status != 'active' OU sem access_source
    // (conta nova com plan default 'maya_mensal' do trigger NÃO é plano ativo)
    if (profile?.account_status !== "active") return "Sem plano ativo";
    if (accessSource === "admin_trial") return "Período teste";
    const planName = profile?.plan === "maya_anual" ? "Anual"
      : profile?.plan === "maya_mensal" ? "Mensal"
      : profile?.plan || "Sem plano";
    if (accessSource === "admin_plan") return `${planName} (liberado pelo admin)`;
    if (subscriptionCancelledAt) return `${planName} (cancelado)`;
    return planName;
  })();
  const accessUntilDate = profile?.access_until ? new Date(profile.access_until) : null;
  const daysLeft = accessUntilDate
    ? Math.max(0, Math.ceil((accessUntilDate.getTime() - Date.now()) / 86400000))
    : null;

  if (loading) return <Skeleton className="h-64 max-w-lg" />;
  if (!profile) return null;

  const changesRemaining = Math.max(0, MAX_PHONE_CHANGES - changesCount);

  return (
    <div className="space-y-6 max-w-lg">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Meu Perfil</h1>
        <StatusBadge status={profile.account_status} />
      </div>

      {/* ── Seu plano ── */}
      <Card className={`border-2 ${
        hasActivePlan
          ? "border-violet-500/40 bg-violet-500/5"
          : "border-muted bg-muted/20"
      }`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Crown className={`h-5 w-5 ${hasActivePlan ? "text-violet-400" : "text-muted-foreground"}`} />
            Seu plano
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-lg font-bold">{planLabel}</p>
              {hasActivePlan && accessUntilDate && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3" />
                  {daysLeft === 0 ? "Expira hoje" : `Expira em ${daysLeft} dia${daysLeft !== 1 ? "s" : ""}`}
                  {" — "}
                  {format(accessUntilDate, "dd/MM/yyyy", { locale: ptBR })}
                </p>
              )}
              {hasActivePlan && !accessUntilDate && (
                <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                  <CheckCircle className="h-3 w-3" /> Assinatura ativa
                </p>
              )}
              {!hasActivePlan && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {profile.account_status === "suspended"
                    ? "Acesso suspenso"
                    : "Sem plano ativo — assine para usar a Maya"}
                </p>
              )}
            </div>
            <StatusBadge status={profile.account_status} />
          </div>
          {!hasActivePlan && (
            <a href="https://minhamaya.com" target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full gap-2" variant="default">
                <ExternalLink className="h-4 w-4" />
                Ver planos
              </Button>
            </a>
          )}
        </CardContent>
      </Card>

      {/* ── Dados pessoais ── */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Dados pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome de exibição</Label>
            <Input
              value={profile.display_name || ""}
              onChange={e => setProfile({ ...profile, display_name: e.target.value })}
              placeholder="Como quer ser chamado pela Maya"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled className="opacity-50 cursor-not-allowed" />
          </div>
          <div className="space-y-2">
            <Label>Fuso horário</Label>
            <Select
              value={profile.timezone}
              onValueChange={v => setProfile({ ...profile, timezone: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {timezones.map(tz => (
                  <SelectItem key={tz} value={tz}>{tz.replace("America/", "")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── WhatsApp ── */}
      <Card className={`border-2 transition-colors ${
        profile.phone_number
          ? isPhoneLocked
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-green-500/40 bg-green-500/5"
          : "border-primary/40 bg-primary/5"
      }`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Smartphone className={`h-5 w-5 ${profile.phone_number ? isPhoneLocked ? "text-amber-400" : "text-green-400" : "text-primary"}`} />
            Número do WhatsApp
            {profile.phone_number
              ? isPhoneLocked
                ? <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs flex items-center gap-1"><Lock className="h-3 w-3" /> Bloqueado</Badge>
                : <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Ativo</Badge>
              : <Badge className="bg-muted text-muted-foreground border-border text-xs">Nenhum número ativo</Badge>
            }
            {/* Counter persistente: mostra quantas mudanças restam, sempre visível */}
            {profile.phone_number && !isPhoneLocked && (
              <Badge className="bg-muted/60 text-muted-foreground border-border text-xs font-normal">
                {changesRemaining === MAX_PHONE_CHANGES
                  ? `${MAX_PHONE_CHANGES} mudanças disponíveis`
                  : `${changesRemaining} de ${MAX_PHONE_CHANGES} mudanças restantes`}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* Plan gate — bloqueia cadastro sem plano ativo */}
          {isPhoneBlockedByPlan && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 text-sm text-violet-200">
              <Lock className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-violet-100">Assine um plano para cadastrar seu WhatsApp</p>
                <p className="mt-0.5 text-violet-300/80 text-xs">
                  Você precisa de uma assinatura ativa (mensal ou anual) para que a Maya possa responder no seu número.
                </p>
                <a href="https://minhamaya.com" target="_blank" rel="noopener noreferrer" className="inline-block mt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs border-violet-500/40 text-violet-200 hover:bg-violet-500/20">
                    <ExternalLink className="mr-1 h-3 w-3" /> Ver planos
                  </Button>
                </a>
              </div>
            </div>
          )}

          {/* Status messages */}
          {!profile.phone_number && !isPhoneBlockedByPlan && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/60 border border-border text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">Nenhum número ativo</p>
                <p className="mt-0.5">Selecione o país, informe seu número com DDD e clique em <span className="font-medium text-foreground">Salvar</span> — a Maya será ativada automaticamente no seu WhatsApp.</p>
              </div>
            </div>
          )}

          {profile.phone_number && !isPhoneLocked && profile.whatsapp_lid && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-200">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">WhatsApp vinculado ✓</p>
                <p className="mt-0.5">
                  A Maya está respondendo no <span className="font-mono font-medium text-green-100">{formatFullPhone(profile.phone_number)}</span>
                </p>
                {changesRemaining > 0 && changesRemaining < MAX_PHONE_CHANGES && (
                  <p className="mt-1.5 text-green-300/70 text-xs">
                    Você ainda pode alterar o número mais {changesRemaining} vez{changesRemaining === 1 ? "" : "es"}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Número ativo — instruções pra conectar com a Maya */}
          {profile.phone_number && !isPhoneLocked && !profile.whatsapp_lid && hasActivePlan && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-200">
              <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-blue-100">Número ativo na plataforma!</p>
                <p className="mt-1 text-blue-200/80">
                  Agora ative o agente na aba <span className="font-semibold text-blue-100">Início</span> (toggle de liga/desliga) e depois envie uma mensagem pra Maya.
                </p>
                <p className="mt-2 text-blue-200/80">
                  Número da Maya: <span className="font-mono font-semibold text-blue-100">+55 11 93619-6103</span>
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <a
                    href="https://wa.me/5511936196103?text=Acabei%20de%20ativar%20minha%20Maya!%20%F0%9F%9A%80"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 text-xs bg-green-600 hover:bg-green-500"
                    >
                      <MessageSquare className="mr-1 h-3 w-3" /> Enviar mensagem pra Maya
                    </Button>
                  </a>
                </div>
                <p className="mt-2 text-blue-300/60 text-xs">
                  Ou envie manualmente uma mensagem pro número <span className="font-mono">+55 11 93619-6103</span> no seu WhatsApp.
                </p>
              </div>
            </div>
          )}

          {isPhoneLocked && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
              <Lock className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Alteração de número bloqueada.</p>
                <p className="mt-1 text-amber-300/80 text-xs">
                  Para alterar seu número, entre em contato com o suporte pelo WhatsApp:{" "}
                  <a
                    href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-mono"
                  >
                    {SUPPORT_WHATSAPP}
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* DDI + Number input */}
          <div className="space-y-2">
            <Label>País / DDI</Label>
            <Select
              value={selectedDdi}
              onValueChange={v => { setSelectedDdi(v); setLocalNumber(""); }}
              disabled={isPhoneLocked || isPhoneBlockedByPlan}
            >
              <SelectTrigger className={(isPhoneLocked || isPhoneBlockedByPlan) ? "opacity-50 cursor-not-allowed" : ""}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FlagImg code={selectedCountry.code} />
                  <span className="font-mono text-muted-foreground">+{selectedCountry.ddi}</span>
                  <span className="truncate">{selectedCountry.name}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => (
                  <SelectItem key={c.ddi} value={c.ddi}>
                    <div className="flex items-center gap-2">
                      <FlagImg code={c.code} />
                      <span className="font-mono text-muted-foreground w-10">+{c.ddi}</span>
                      <span>{c.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Número (sem DDI)</Label>
            <div className="flex items-center gap-2">
              {/* DDI badge */}
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-muted border border-border text-sm font-mono shrink-0 text-muted-foreground select-none">
                <FlagImg code={selectedCountry.code} />
                +{selectedCountry.ddi}
              </div>
              {/* Local number */}
              <Input
                value={selectedDdi === "55" ? formatBRLocal(localNumber) : localNumber}
                onChange={e => {
                  const raw = e.target.value.replace(/\D/g, "");
                  setLocalNumber(raw);
                }}
                placeholder={selectedCountry.placeholder}
                disabled={isPhoneLocked || isPhoneBlockedByPlan}
                className={`font-mono flex-1 ${(isPhoneLocked || isPhoneBlockedByPlan) ? "opacity-50 cursor-not-allowed" : ""}`}
                inputMode="numeric"
                maxLength={selectedDdi === "55" ? 15 : 18}
              />
            </div>

            {/* Validation feedback */}
            {localDigits.length > 0 && !isValidLocal && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Número incompleto — informe DDD + número completo.
              </p>
            )}
            {isValidLocal && (
              <p className="text-xs text-muted-foreground font-mono">
                Será salvo como: <span className="text-foreground">+{selectedDdi} {localDigits}</span>
              </p>
            )}
            {!localDigits && !isPhoneLocked && (
              <p className="text-xs text-muted-foreground">
                Digite apenas DDD + número. Ex: <span className="font-mono">{selectedCountry.placeholder}</span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Save button ── */}
      <Button
        onClick={handleSave}
        className="w-full"
        disabled={saving || (localDigits.length > 0 && !isValidLocal) || (isPhoneBlockedByPlan && isPhoneChanging)}
      >
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  );
}
