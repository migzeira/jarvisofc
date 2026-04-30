import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Heart, Save, Trash2, Phone, User, AlertTriangle } from "lucide-react";

/**
 * ConfigCasal — Aba "Casal" em Configurações.
 *
 * Visível APENAS pra usuários com plano casal (maya_casal_mensal / maya_casal_anual).
 * Permite cadastrar até 2 partners (slot 1 e slot 2). Cada partner tem nome,
 * telefone e apelido (como o Jarvis vai chamar a pessoa).
 *
 * Comportamento:
 *  - Quando o partner manda mensagem do WhatsApp dele, o webhook reconhece
 *    pelo phone e grava sent_by_phone em todos os registros (transactions,
 *    events, reminders, notes).
 *  - Master vê tudo no dashboard com tags de quem registrou.
 *  - Conversas privadas: master não vê msgs do partner e vice-versa.
 */

interface Partner {
  id?: string;
  slot: 1 | 2;
  partner_name: string;
  partner_phone: string;
  partner_nickname: string | null;
  is_active: boolean;
}

const EMPTY_PARTNER = (slot: 1 | 2): Partner => ({
  slot,
  partner_name: "",
  partner_phone: "",
  partner_nickname: null,
  is_active: true,
});

/** Normaliza phone pra formato consistente (só dígitos, com 55 prefix). */
function normalizePhone(raw: string): string {
  let n = raw.replace(/\D/g, "");
  if (n.length > 0 && !n.startsWith("55")) n = `55${n}`;
  return n;
}

/** Valida se phone tem dígitos suficientes (8-15). */
function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/** Formata pra exibição: 55 11 9 9999-9999 → +55 (11) 99999-9999 */
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
  const [partners, setPartners] = useState<{ 1: Partner; 2: Partner }>({
    1: EMPTY_PARTNER(1),
    2: EMPTY_PARTNER(2),
  });
  const [saving, setSaving] = useState<{ 1: boolean; 2: boolean }>({ 1: false, 2: false });

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
      toast.error("Erro ao carregar parceiros");
    } else {
      const next = { 1: EMPTY_PARTNER(1), 2: EMPTY_PARTNER(2) };
      for (const p of (data ?? []) as Partner[]) {
        if (p.slot === 1 || p.slot === 2) {
          next[p.slot] = { ...p };
        }
      }
      setPartners(next);
    }
    setLoading(false);
  };

  const handleSave = async (slot: 1 | 2) => {
    if (!user) return;
    const partner = partners[slot];

    // Validação
    const trimName = partner.partner_name.trim();
    const trimNickname = partner.partner_nickname?.trim() || null;
    const phone = normalizePhone(partner.partner_phone);

    if (trimName.length < 1 || trimName.length > 60) {
      toast.error("Nome precisa ter entre 1 e 60 caracteres");
      return;
    }
    if (!isValidPhone(phone)) {
      toast.error("Telefone inválido — informe DDD + número (ex: 11 99999-9999)");
      return;
    }

    setSaving((s) => ({ ...s, [slot]: true }));

    try {
      // Verifica se phone já está em uso por OUTRO master (constraint do banco)
      const { data: existing } = await (supabase as any)
        .from("profile_partners")
        .select("master_user_id, slot")
        .eq("partner_phone", phone)
        .eq("is_active", true)
        .maybeSingle();

      if (existing && (existing.master_user_id !== user.id || existing.slot !== slot)) {
        toast.error("Esse telefone já está cadastrado como parceiro de outro casal");
        setSaving((s) => ({ ...s, [slot]: false }));
        return;
      }

      // Verifica se o phone bate com o do próprio master
      const { data: me } = await supabase
        .from("profiles")
        .select("phone_number")
        .eq("id", user.id)
        .maybeSingle();
      const mePhone = normalizePhone((me?.phone_number as string) ?? "");
      if (mePhone && mePhone === phone) {
        toast.error("Esse é o seu próprio telefone — cadastre o do parceiro");
        setSaving((s) => ({ ...s, [slot]: false }));
        return;
      }

      const payload = {
        master_user_id: user.id,
        slot,
        partner_name: trimName,
        partner_phone: phone,
        partner_nickname: trimNickname,
        is_active: true,
      };

      let result;
      if (partner.id) {
        // UPDATE (já existe)
        result = await (supabase as any)
          .from("profile_partners")
          .update(payload)
          .eq("id", partner.id)
          .select()
          .single();
      } else {
        // INSERT (novo)
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
        toast.success(partner.id ? "Parceiro atualizado!" : "Parceiro adicionado!");
        await loadPartners();
      }
    } catch (e) {
      console.error("[ConfigCasal] save exception:", e);
      toast.error("Erro ao salvar parceiro");
    } finally {
      setSaving((s) => ({ ...s, [slot]: false }));
    }
  };

  const handleDelete = async (slot: 1 | 2) => {
    if (!user) return;
    const partner = partners[slot];
    if (!partner.id) {
      // Não foi salvo ainda → só limpa o form local
      setPartners((p) => ({ ...p, [slot]: EMPTY_PARTNER(slot) }));
      return;
    }
    if (!window.confirm(`Remover ${partner.partner_name} do plano casal?`)) return;

    // Soft delete — mantém histórico de sent_by_phone nos registros antigos
    const { error } = await (supabase as any)
      .from("profile_partners")
      .update({ is_active: false })
      .eq("id", partner.id);

    if (error) {
      toast.error("Erro ao remover parceiro");
    } else {
      toast.success("Parceiro removido");
      await loadPartners();
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {!hideTitle && (
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-pink-400" /> Plano Casal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre até 2 parceiros. Cada um manda mensagem pelo seu próprio WhatsApp e o Jarvis registra com tag de quem fez.
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
                <li>• Cada parceiro conversa privadamente com o Jarvis pelo WhatsApp dele.</li>
                <li>• Finanças, agenda, anotações e listas ficam <strong>compartilhadas</strong> nesse painel.</li>
                <li>• Cada registro tem badge mostrando quem foi (João / Maria).</li>
                <li>• Lembretes e hábitos são <strong>pessoais</strong> — vão pra quem criou.</li>
                <li>• "Quanto eu gastei?" mostra só seus gastos. "Quanto a gente gastou?" mostra do casal.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slots de partners */}
      {[1, 2].map((slotNum) => {
        const slot = slotNum as 1 | 2;
        const partner = partners[slot];
        const hasData = !!partner.id;
        return (
          <Card key={slot} className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Parceiro {slot}
                  {hasData && (
                    <span className="text-xs font-normal text-emerald-400 ml-1">● ativo</span>
                  )}
                </span>
                {hasData && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(slot)}
                    disabled={saving[slot]}
                    className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-8"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`partner-name-${slot}`}>
                    Nome completo <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    id={`partner-name-${slot}`}
                    value={partner.partner_name}
                    onChange={(e) =>
                      setPartners((p) => ({
                        ...p,
                        [slot]: { ...p[slot], partner_name: e.target.value.slice(0, 60) },
                      }))
                    }
                    placeholder="Ex: Maria Silva"
                    maxLength={60}
                    disabled={saving[slot]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`partner-nickname-${slot}`}>
                    Como o Jarvis vai chamar <span className="text-muted-foreground text-xs">(opcional)</span>
                  </Label>
                  <Input
                    id={`partner-nickname-${slot}`}
                    value={partner.partner_nickname ?? ""}
                    onChange={(e) =>
                      setPartners((p) => ({
                        ...p,
                        [slot]: { ...p[slot], partner_nickname: e.target.value.slice(0, 60) || null },
                      }))
                    }
                    placeholder="Ex: Maria, Mari, Amor"
                    maxLength={60}
                    disabled={saving[slot]}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`partner-phone-${slot}`} className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> Telefone do WhatsApp <span className="text-rose-400">*</span>
                </Label>
                <Input
                  id={`partner-phone-${slot}`}
                  value={partner.partner_phone}
                  onChange={(e) =>
                    setPartners((p) => ({
                      ...p,
                      [slot]: { ...p[slot], partner_phone: e.target.value.slice(0, 20) },
                    }))
                  }
                  placeholder="11 99999-9999"
                  disabled={saving[slot]}
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
                  onClick={() => handleSave(slot)}
                  disabled={
                    saving[slot] ||
                    partner.partner_name.trim().length < 1 ||
                    !isValidPhone(partner.partner_phone)
                  }
                  className="shrink-0"
                >
                  {saving[slot] ? (
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
      })}
    </div>
  );
}
