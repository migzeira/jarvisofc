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
  Crown, ExternalLink, Calendar, MessageSquare, Loader2, MapPin, CreditCard,
  Copy,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PlanCTAButtons } from "@/components/PlanCTAButtons";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SUPPORT_WHATSAPP = "5511999999999"; // TODO: trocar pelo número real de suporte
const MAX_PHONE_CHANGES = 2; // após isso, campo fica bloqueado

// Número oficial do Jarvis (WhatsApp do bot). Single source of truth pra
// botões "Conversar com Jarvis" e exibição do número aos usuários que
// querem salvar manualmente nos contatos.
const JARVIS_WHATSAPP = "5511936196103";
const JARVIS_WHATSAPP_FORMATTED = "+55 11 93619-6103";
const JARVIS_WHATSAPP_LINK = `https://wa.me/${JARVIS_WHATSAPP}?text=Oi%20Jarvis!`;

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

export default function MeuPerfil({ hideTitle = false }: { hideTitle?: boolean } = {}) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkingStatus, setLinkingStatus] = useState<'idle' | 'linking' | 'linked' | 'pending'>('idle');

  // Dados de entrega (seção independente — salva separado)
  const [deliveryStreet, setDeliveryStreet] = useState("");
  const [deliveryNumber, setDeliveryNumber] = useState("");
  const [deliveryComplement, setDeliveryComplement] = useState("");
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");
  const [paymentPreference, setPaymentPreference] = useState("debito");
  const [cpfOrders, setCpfOrders] = useState("");
  const [savingDelivery, setSavingDelivery] = useState(false);

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

    // Carrega dados de entrega
    if (data) {
      setDeliveryStreet(data.delivery_street ?? "");
      setDeliveryNumber(data.delivery_number ?? "");
      setDeliveryComplement(data.delivery_complement ?? "");
      setDeliveryNeighborhood(data.delivery_neighborhood ?? "");
      setDeliveryCity(data.delivery_city ?? "");
      setDeliveryReference(data.delivery_reference ?? "");
      setPaymentPreference(data.payment_preference ?? "debito");
      setCpfOrders(data.cpf_orders ?? "");
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
  // (antes do cron rodar) conseguia cadastrar WhatsApp e depois o Jarvis bloqueava no webhook.
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
      // no WhatsApp com o número do Jarvis, não tem como distinguir.
      if (newPhone && isRealChange) {
        const { data: existing } = await supabase
          .from("profiles")
          .select("id, display_name")
          .or(`phone_number.eq.${newPhone},phone_number.eq.+${newPhone}`)
          .neq("id", user!.id)
          .maybeSingle();

        if (existing) {
          toast.error(
            `Este número já está cadastrado em outra conta do Hey Jarvis. ` +
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
      // Limpar o número NÃO muda o plano. Uma coisa não interfere na outra.
      // Quando phone muda, limpa whatsapp_lid pra forçar re-link
      const profileUpdate: Record<string, unknown> = {
        display_name: profile.display_name?.trim() || null,
        phone_number: newPhone,
        timezone: profile.timezone,
        phone_changes_count: newChangesCount,
      };
      if (isRealChange) {
        profileUpdate.whatsapp_lid = null;
        profileUpdate.link_code = null;
        profileUpdate.link_code_expires_at = null;
      }
      const { error } = await supabase.from("profiles").update(profileUpdate as any).eq("id", user!.id);

      if (error) {
        toast.error("Erro ao salvar. Tente novamente.");
        return;
      }

      // Update local state
      const updatedProfile = {
        ...profile,
        phone_number: newPhone,
        phone_changes_count: newChangesCount,
        // NÃO muda account_status ao limpar phone — plano continua ativo
      };
      setProfile(updatedProfile);

      if (isRealChange && newPhone) {
        // Auto-link WhatsApp + auto-ativar agente em background
        setLinkingStatus('linking');
        const remaining = MAX_PHONE_CHANGES - newChangesCount;
        if (remaining <= 0) {
          toast.success("Número salvo! Ativando seu Jarvis...");
        } else {
          toast.success("Número salvo! Ativando seu Jarvis...");
        }

        // Dispara em background — não bloqueia o save
        (async () => {
          try {
            // 1. Auto-ativa o agente
            await supabase
              .from("agent_configs")
              .upsert({ user_id: user!.id, is_active: true } as any, { onConflict: "user_id" });

            // 2. Chama link-init pra vincular WhatsApp
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) { setLinkingStatus('pending'); return; }

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

            if (data.linked && data.jid) {
              // Resolvido direto — já vinculado!
              setProfile((p: any) => ({ ...p, whatsapp_lid: data.jid }));
              setLinkingStatus('linked');
              toast.success("WhatsApp conectado! Pode conversar com o Jarvis agora.");
            } else {
              // Pending link — botão WhatsApp aparece, webhook linka na 1a mensagem
              setLinkingStatus('pending');
              toast.success("Jarvis ativado! Envie uma mensagem pra ele no WhatsApp.");
            }
          } catch {
            // Falha de rede — webhook safety net cobre
            setLinkingStatus('pending');
          }
        })();
      } else if (!newPhone) {
        setLinkingStatus('idle');
        toast.success("Número removido. O Jarvis não responderá até você adicionar um número.");
      } else {
        toast.success("Perfil atualizado!");
      }
    } finally {
      setSaving(false);
    }
  };

  // Chama a edge function whatsapp-link-init que gera um código JARVIS-XXXXXX
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
          toast.success("✅ WhatsApp conectado! Pode começar a usar o Jarvis agora.");
          // Atualiza profile local pra refletir o whatsapp_lid preenchido
          setProfile((p: any) => ({ ...p, whatsapp_lid: data.jid }));
        } else if (data.sent) {
          toast.success('✅ Mensagem enviada no seu WhatsApp. Responda "oi" lá pra ativar.');
        } else {
          toast.warning("Mensagem gerada. Abra o WhatsApp do Jarvis e mande qualquer mensagem.");
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
    // (conta nova com plan default 'jarvis_mensal' do trigger NÃO é plano ativo)
    if (profile?.account_status !== "active") return "Sem plano ativo";
    const planName = profile?.plan === "maya_anual" ? "Anual"
      : profile?.plan === "maya_mensal" ? "Mensal"
      : null;
    if (accessSource === "admin_trial") return "Plano liberado pelo admin — Período teste";
    if (accessSource === "admin_plan") {
      return planName
        ? `Plano liberado pelo admin — ${planName}`
        : "Plano liberado pelo admin";
    }
    // Kirvano ou demais fontes
    if (planName) {
      const base = `Plano Pro — ${planName}`;
      return subscriptionCancelledAt ? `${base} (cancelado)` : base;
    }
    return "Plano Pro";
  })();
  const accessUntilDate = profile?.access_until ? new Date(profile.access_until) : null;
  const daysLeft = accessUntilDate
    ? Math.max(0, Math.ceil((accessUntilDate.getTime() - Date.now()) / 86400000))
    : null;

  const handleSaveDelivery = async () => {
    setSavingDelivery(true);
    const { error } = await supabase.from("profiles").update({
      delivery_street:      deliveryStreet.trim() || null,
      delivery_number:      deliveryNumber.trim() || null,
      delivery_complement:  deliveryComplement.trim() || null,
      delivery_neighborhood: deliveryNeighborhood.trim() || null,
      delivery_city:        deliveryCity.trim() || null,
      delivery_reference:   deliveryReference.trim() || null,
      payment_preference:   paymentPreference,
      cpf_orders:           cpfOrders.trim() || null,
    } as any).eq("id", user!.id);
    setSavingDelivery(false);
    if (error) toast.error("Erro ao salvar dados de entrega");
    else toast.success("Dados de entrega salvos!");
  };

  if (loading) return <Skeleton className="h-64 max-w-lg" />;
  if (!profile) return null;

  const changesRemaining = Math.max(0, MAX_PHONE_CHANGES - changesCount);

  return (
    <div className="space-y-6 max-w-lg">
      {/* ── Header ── */}
      {!hideTitle && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Meu Perfil</h1>
          <StatusBadge status={profile.account_status} />
        </div>
      )}

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
                    : "Sem plano ativo — assine para usar o Jarvis"}
                </p>
              )}
            </div>
            <StatusBadge status={profile.account_status} />
          </div>
          {!hasActivePlan && <PlanCTAButtons className="pt-1" />}
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
              placeholder="Como quer ser chamado pelo Jarvis"
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
                  Você precisa de uma assinatura ativa (mensal ou anual) para que o Jarvis possa responder no seu número.
                </p>
              </div>
            </div>
          )}

          {/* Status messages */}
          {!profile.phone_number && !isPhoneBlockedByPlan && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/60 border border-border text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">Nenhum número ativo</p>
                <p className="mt-0.5">Selecione o país, informe seu número com DDD e clique em <span className="font-medium text-foreground">Salvar</span> — o Jarvis será ativado automaticamente no seu WhatsApp.</p>
              </div>
            </div>
          )}

          {profile.phone_number && !isPhoneLocked && profile.whatsapp_lid && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-200">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">WhatsApp vinculado ✓</p>
                <p className="mt-0.5">
                  O Jarvis está respondendo no <span className="font-mono font-medium text-green-100">{formatFullPhone(profile.phone_number)}</span>
                </p>
                {changesRemaining > 0 && changesRemaining < MAX_PHONE_CHANGES && (
                  <p className="mt-1.5 text-green-300/70 text-xs">
                    Você ainda pode alterar o número mais {changesRemaining} vez{changesRemaining === 1 ? "" : "es"}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Ativando Jarvis — loading state */}
          {linkingStatus === 'linking' && profile.phone_number && !isPhoneLocked && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-200">
              <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
              <div className="flex-1">
                <p className="font-semibold text-blue-100">Ativando seu Jarvis...</p>
                <p className="mt-1 text-blue-200/80">
                  Estamos conectando seu WhatsApp. Aguarde alguns segundos.
                </p>
              </div>
            </div>
          )}

          {/* ── Card unificado "Converse com seu Jarvis" ─────────────────────
              FIXO sempre que o user tem phone cadastrado + plano ativo
              (independente de já ter linkado). Antes havia 2 cards quase
              duplicados (verde "ativado" + azul "número cadastrado") que
              não cobriam usuários que já tinham linkado e queriam reachar
              o número de novo.
              Responsivo: botão ocupa toda a largura no mobile (w-full) e
              ajusta no desktop (sm:w-auto). Texto curto também adapta. */}
          {profile.phone_number && !isPhoneLocked && hasActivePlan && linkingStatus !== 'linking' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-200">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-100">
                  {profile.whatsapp_lid
                    ? "Jarvis pronto pra conversar!"
                    : "Jarvis ativado! Envie a primeira mensagem."}
                </p>
                <p className="mt-1 text-green-200/80">
                  {profile.whatsapp_lid
                    ? "Clique no botão abaixo pra abrir o WhatsApp ou salve o número do Jarvis nos seus contatos."
                    : "Clique no botão abaixo pra começar. Salve este número nos contatos pra encontrar fácil depois."}
                </p>

                {/* Botão principal — responsivo: full no mobile, auto no desktop */}
                <a
                  href={JARVIS_WHATSAPP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full sm:inline-block sm:w-auto mt-3"
                >
                  <Button
                    size="sm"
                    variant="default"
                    className="h-10 w-full sm:w-auto text-sm bg-green-600 hover:bg-green-500 font-semibold whitespace-normal sm:whitespace-nowrap"
                  >
                    <MessageSquare className="mr-1.5 h-4 w-4 shrink-0" />
                    <span className="sm:hidden">Conversar no WhatsApp</span>
                    <span className="hidden sm:inline">Conversar com Jarvis no WhatsApp</span>
                  </Button>
                </a>

                {/* Número do Jarvis com botão copiar — pra user salvar nos contatos */}
                <div className="mt-3 flex flex-wrap items-center gap-2 p-2 rounded-md bg-green-950/40 border border-green-500/20">
                  <Smartphone className="h-3.5 w-3.5 shrink-0 text-green-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-green-300/70">
                      Ou chame este número:
                    </p>
                    <p className="font-mono text-sm text-green-100 break-all">
                      {JARVIS_WHATSAPP_FORMATTED}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-green-300 hover:text-green-100 hover:bg-green-500/10 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(JARVIS_WHATSAPP_FORMATTED);
                      toast.success("Número copiado!");
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copiar
                  </Button>
                </div>
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

      {/* ── Dados de Entrega ── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            Dados de Entrega
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Salve seu endereço e preferências para que o Jarvis faça pedidos por você sem precisar perguntar toda vez.
            <br />
            Ex: <em>"Jarvis, pede uma pizza de calabresa na Pizzaria Kadalora"</em> — ele usa esses dados automaticamente.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Endereço */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Endereço</Label>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs">Rua / Avenida</Label>
              <Input
                value={deliveryStreet}
                onChange={e => setDeliveryStreet(e.target.value)}
                placeholder="Ex: Rua das Flores"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Número</Label>
              <Input
                value={deliveryNumber}
                onChange={e => setDeliveryNumber(e.target.value)}
                placeholder="Ex: 123"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Complemento</Label>
              <Input
                value={deliveryComplement}
                onChange={e => setDeliveryComplement(e.target.value)}
                placeholder="Ex: Apto 42, Bloco B"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bairro</Label>
              <Input
                value={deliveryNeighborhood}
                onChange={e => setDeliveryNeighborhood(e.target.value)}
                placeholder="Ex: Jardim América"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Cidade</Label>
              <Input
                value={deliveryCity}
                onChange={e => setDeliveryCity(e.target.value)}
                placeholder="Ex: São Paulo"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Referência (opcional)</Label>
              <Input
                value={deliveryReference}
                onChange={e => setDeliveryReference(e.target.value)}
                placeholder="Ex: Portão azul, próximo ao mercado"
              />
            </div>
          </div>

          {/* Pagamento */}
          <div className="space-y-1 pt-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pagamento preferido</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "debito",   label: "Débito" },
              { value: "credito",  label: "Crédito" },
              { value: "pix",      label: "Pix" },
              { value: "dinheiro", label: "Dinheiro" },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentPreference(opt.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                  paymentPreference === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" /> {opt.label}
              </button>
            ))}
          </div>

          {/* CPF */}
          <div className="space-y-1">
            <Label className="text-xs">CPF para nota fiscal (opcional)</Label>
            <Input
              value={cpfOrders}
              onChange={e => setCpfOrders(e.target.value)}
              placeholder="000.000.000-00"
              className="max-w-xs font-mono"
            />
          </div>

          <Button onClick={handleSaveDelivery} disabled={savingDelivery} size="sm" className="gap-2">
            <Save className="h-4 w-4" />
            {savingDelivery ? "Salvando..." : "Salvar dados de entrega"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
