import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Heart, Save, Trash2, Phone, User, AlertTriangle, Plus } from "lucide-react";

/**
 * ConfigCasal — Aba "Casal" em Configurações.
 *
 * Visível APENAS pra usuários com plano casal (maya_casal_mensal / maya_casal_anual).
 *
 * Modelo:
 *  - Master (dono da conta) está cadastrado em Perfil & Plano (display_name +
 *    phone_number) — não duplica aqui.
 *  - Aba Casal cadastra APENAS o parceiro(a) — total de 2 pessoas no plano:
 *    o master + 1 parceiro.
 *
 * Comportamento:
 *  - Quando o parceiro manda mensagem do WhatsApp dele, o webhook reconhece
 *    pelo phone e grava sent_by_phone em todos os registros (transactions,
 *    events, reminders, notes).
 *  - Master vê tudo no dashboard com tags de quem registrou.
 *  - Conversas privadas: master não vê msgs do parceiro e vice-versa.
 *
 * Slot:
 *  - Schema permite slot 1 e 2 (futuro plano "Família" com até 4 pessoas).
 *  - Pra v1 do Casal usamos APENAS slot 1.
 *  - Se houver dados antigos no slot 2, exibimos pro user remover.
 */

interface Partner {
  id?: string;
  slot: number;
  partner_name: string;
  partner_phone: string;
  partner_nickname: string | null;
}

const EMPTY_PARTNER = (): Partner => ({
  slot: 1,
  partner_name: "",
  partner_phone: "",
  partner_nickname: null,
});

const MAX_PARTNERS = 1; // v1 Casal = 1 parceiro. Futuro família = 3.

/** Normaliza phone pra formato consistente (só dígitos, com 55 prefix). */
function normalizePhone(raw: string): string {
  let n = raw.replace(/\D/g, "");
  if (n.length > 0 && !n.startsWith("55")) n = `55${n}`;
  return n;
}

/** Valida se phone tem dígitos suficientes. */
function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return raw;
}

export default function ConfigCasal({ hideTitle = false }: { hideTitle?: boolean } = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [draft, setDraft] = useState<Partner | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) loadPartners();
  }, [user]);

  const loadPartners = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("profile_partners")
      .select("id, slot, partner_name, partner_phone, partner_nickname, is_active")
      .eq("master_user_id", user.id)
      .eq("is_active", true)
      .order("slot");

    if (error) {
      console.error("[ConfigCasal] load error:", error);
      toast.error("Erro ao carregar parceiro");
      setPartners([]);
    } else {
      setPartners(((data ?? []) as Partner[]).map((p) => ({ ...p })));
    }
    setDraft(null);
    setLoading(false);
  };

  const handleSave = async (p: Partner) => {
    if (!user) return;

    const trimName = p.partner_name.trim();
    const trimNickname = p.partner_nickname?.trim() || null;
    const phone = normalizePhone(p.partner_phone);

    if (trimName.length < 1 || trimName.length > 60) {
      toast.error("Nome precisa ter entre 1 e 60 caracteres");
      return;
    }
    if (!isValidPhone(phone)) {
      toast.error("Telefone inválido — informe DDD + número (ex: 11 99999-9999)");
      return;
    }

    setSaving(true);
    try {
      // Verifica se phone já é de outro casal
      const { data: existing } = await (supabase as any)
        .from("profile_partners")
        .select("master_user_id, slot")
        .eq("partner_phone", phone)
        .eq("is_active", true)
        .maybeSingle();

      if (existing && (existing.master_user_id !== user.id || existing.slot !== p.slot)) {
        toast.error("Esse telefone já é parceiro de outro casal");
        setSaving(false);
        return;
      }

      // Verifica se phone bate com o do próprio master
      const { data: me } = await supabase
        .from("profiles")
        .select("phone_number")
        .eq("id", user.id)
        .maybeSingle();
      const mePhone = normalizePhone((me?.phone_number as string) ?? "");
      if (mePhone && mePhone === phone) {
        toast.error("Esse é o seu próprio telefone — cadastre o do parceiro");
        setSaving(false);
        return;
      }

      const payload = {
        master_user_id: user.id,
        slot: p.slot,
        partner_name: trimName,
        partner_phone: phone,
        partner_nickname: trimNickname,
        is_active: true,
      };

      let result;
      if (p.id) {
        result = await (supabase as any)
          .from("profile_partners")
          .update(payload)
          .eq("id", p.id)
          .select()
          .single();
      } else {
        result = await (supabase as any)
          .from("profile_partners")
          .insert(payload)
          .select()
          .single();
      }

      if (result.error) {
        console.error("[ConfigCasal] save error:", result.error);
        toast.error("Erro ao salvar parceiro");
      } else {
        toast.success(p.id ? "Parceiro atualizado!" : "Parceiro adicionado!");
        await loadPartners();
      }
    } catch (e) {
      console.error("[ConfigCasal] save exception:", e);
      toast.error("Erro ao salvar parceiro");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Partner) => {
    if (!user || !p.id) return;
    if (!window.confirm(`Remover ${p.partner_name} do plano casal?`)) return;

    // Soft delete preserva sent_by_phone nos registros antigos
    const { error } = await (supabase as any)
      .from("profile_partners")
      .update({ is_active: false })
      .eq("id", p.id);

    if (error) {
      toast.error("Erro ao remover parceiro");
    } else {
      toast.success("Parceiro removido");
      await loadPartners();
    }
  };

  const startNewDraft = () => {
    // Próximo slot disponível (1 ou 2)
    const usedSlots = new Set(partners.map((p) => p.slot));
    const slot = usedSlots.has(1) ? 2 : 1;
    setDraft({ ...EMPTY_PARTNER(), slot });
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const canAdd = partners.length < MAX_PARTNERS && !draft;

  return (
    <div className="space-y-6 max-w-3xl">
      {!hideTitle && (
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-pink-400" /> Plano Casal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Adicione seu parceiro(a). Cada um manda mensagem pelo WhatsApp dele e o Jarvis registra com tag de quem fez.
          </p>
        </div>
      )}

      {/* Info card */}
      <Card className="bg-pink-500/5 border-pink-500/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Heart className="h-5 w-5 text-pink-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Como funciona:</p>
              <ul className="mt-2 space-y-1 text-muted-foreground text-xs leading-relaxed">
                <li>• Você já está cadastrado(a) em <strong>Configurações &gt; Perfil &amp; Plano</strong> (seu nome e WhatsApp).</li>
                <li>• Aqui você adiciona apenas <strong>seu parceiro(a)</strong> — total de 2 pessoas no plano.</li>
                <li>• Cada um conversa privadamente com o Jarvis pelo WhatsApp dele.</li>
                <li>• Finanças, agenda, anotações e listas ficam <strong>compartilhadas</strong> nesse painel.</li>
                <li>• Cada registro tem badge mostrando quem foi (você / parceiro).</li>
                <li>• Lembretes e hábitos são <strong>pessoais</strong> — vão pra quem criou.</li>
                <li>• "Quanto eu gastei?" mostra só seus gastos. "Quanto a gente gastou?" mostra do casal.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de parceiros existentes */}
      {partners.map((p) => (
        <PartnerCard
          key={p.id ?? `slot-${p.slot}`}
          partner={p}
          saving={saving}
          onChange={(updated) =>
            setPartners((prev) => prev.map((x) => (x.id === p.id ? updated : x)))
          }
          onSave={() => handleSave(p)}
          onDelete={() => handleDelete(p)}
        />
      ))}

      {/* Form de novo parceiro */}
      {draft && (
        <PartnerCard
          partner={draft}
          saving={saving}
          isDraft
          onChange={(updated) => setDraft(updated)}
          onSave={async () => {
            await handleSave(draft);
            // loadPartners já reseta draft via setDraft(null) interno
          }}
          onDelete={() => setDraft(null)}
        />
      )}

      {/* Botão adicionar (só se ainda há slot disponível) */}
      {canAdd && (
        <Button
          variant="outline"
          onClick={startNewDraft}
          className="w-full gap-2 border-dashed h-14"
        >
          <Plus className="h-4 w-4" />
          Adicionar parceiro(a)
        </Button>
      )}

      {!canAdd && partners.length >= MAX_PARTNERS && (
        <p className="text-xs text-muted-foreground text-center">
          O plano casal permite 1 parceiro. Pra adicionar mais pessoas, espere o plano Família 👨‍👩‍👧.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Card individual de parceiro (form de criar/editar)
// ─────────────────────────────────────────────────────────────

function PartnerCard({
  partner,
  saving,
  isDraft = false,
  onChange,
  onSave,
  onDelete,
}: {
  partner: Partner;
  saving: boolean;
  isDraft?: boolean;
  onChange: (p: Partner) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const hasData = !!partner.id;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            {isDraft ? "Novo parceiro(a)" : "Parceiro(a)"}
            {hasData && (
              <span className="text-xs font-normal text-emerald-400 ml-1">● ativo</span>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={saving}
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {hasData ? "Remover" : "Cancelar"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>
              Nome completo <span className="text-rose-400">*</span>
            </Label>
            <Input
              value={partner.partner_name}
              onChange={(e) =>
                onChange({ ...partner, partner_name: e.target.value.slice(0, 60) })
              }
              placeholder="Ex: Maria Silva"
              maxLength={60}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Como o Jarvis vai chamar <span className="text-muted-foreground text-xs">(opcional)</span>
            </Label>
            <Input
              value={partner.partner_nickname ?? ""}
              onChange={(e) =>
                onChange({
                  ...partner,
                  partner_nickname: e.target.value.slice(0, 60) || null,
                })
              }
              placeholder="Ex: Maria, Mari, Amor"
              maxLength={60}
              disabled={saving}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Telefone do WhatsApp{" "}
            <span className="text-rose-400">*</span>
          </Label>
          <Input
            value={partner.partner_phone}
            onChange={(e) =>
              onChange({ ...partner, partner_phone: e.target.value.slice(0, 20) })
            }
            placeholder="11 99999-9999"
            disabled={saving}
          />
          {partner.partner_phone && (
            <p className="text-xs text-muted-foreground">
              Salvo como: <span className="font-mono">{formatPhone(partner.partner_phone)}</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground/70 flex items-start gap-1.5 flex-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              O parceiro precisa mandar a primeira mensagem pelo WhatsApp dele pra ativar.
            </span>
          </p>
          <Button
            size="sm"
            onClick={onSave}
            disabled={
              saving ||
              partner.partner_name.trim().length < 1 ||
              !isValidPhone(partner.partner_phone)
            }
            className="shrink-0"
          >
            {saving ? (
              "Salvando..."
            ) : (
              <>
                <Save className="h-4 w-4 mr-1.5" />
                {hasData ? "Atualizar" : "Salvar"}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
