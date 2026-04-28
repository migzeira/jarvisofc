import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Bug, Send, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BugReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_TITLE_LEN = 80;
const MAX_DESCRIPTION_LEN = 2000;

export function BugReportModal({ open, onOpenChange }: BugReportModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const titleTrim = title.trim();
  const descTrim = description.trim();
  const titleValid = titleTrim.length >= 3 && titleTrim.length <= MAX_TITLE_LEN;
  const descValid = descTrim.length >= 10 && descTrim.length <= MAX_DESCRIPTION_LEN;
  const canSubmit = titleValid && descValid && !submitting;

  const reset = () => {
    setTitle("");
    setDescription("");
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (submitting) return; // não fecha enquanto envia
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    try {
      // Busca display_name do profile pra snapshot (não bloqueia se falhar)
      let displayName: string | null = null;
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        displayName = (profile as { display_name?: string } | null)?.display_name ?? null;
      } catch { /* silent */ }

      const { error } = await (supabase.from("bug_reports" as any) as any).insert({
        user_id: user.id,
        user_email: user.email ?? null,
        user_name: displayName,
        title: titleTrim,
        description: descTrim,
        status: "new",
      });

      if (error) throw error;

      toast.success("✅ Recebemos seu reporte! Vamos analisar.");
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error("[BugReportModal] erro ao enviar:", err);
      toast.error("Não consegui enviar o reporte. Tenta de novo daqui a pouco.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-rose-400" />
            Reportar bug ou sugestão
          </DialogTitle>
          <DialogDescription className="text-xs">
            Conta o que aconteceu (ou o que você gostaria de melhorar).
            A equipe lê todos os reportes e responde no painel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="bug-title" className="text-xs">
              Título <span className="text-muted-foreground">(curto e direto)</span>
            </Label>
            <Input
              id="bug-title"
              placeholder="Ex: Lembrete não chegou"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LEN))}
              maxLength={MAX_TITLE_LEN}
              disabled={submitting}
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              {titleTrim.length}/{MAX_TITLE_LEN}
              {titleTrim.length > 0 && titleTrim.length < 3 && (
                <span className="text-amber-400 ml-2">Mínimo 3 caracteres</span>
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bug-desc" className="text-xs">
              Descrição <span className="text-muted-foreground">(o que aconteceu, passo-a-passo)</span>
            </Label>
            <Textarea
              id="bug-desc"
              placeholder="Ex: Marquei um evento pra amanhã às 14h e o lembrete não chegou no horário. Eu mandei pelo WhatsApp..."
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LEN))}
              maxLength={MAX_DESCRIPTION_LEN}
              disabled={submitting}
              rows={6}
              className="resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              {descTrim.length}/{MAX_DESCRIPTION_LEN}
              {descTrim.length > 0 && descTrim.length < 10 && (
                <span className="text-amber-400 ml-2">Mínimo 10 caracteres</span>
              )}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1.5" />
                  Enviar
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
