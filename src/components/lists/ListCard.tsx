import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListChecks, MessageCircle, Trash2, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface ListSummary {
  id: string;
  name: string;
  source: string;
  created_at: string;
  updated_at: string;
  total_items: number;
  pending_items: number;
  preview: string[]; // até 3 itens pendentes
}

const ACCENTS = [
  { border: "border-l-violet-500",  bg: "bg-violet-500/10",  iconBg: "bg-violet-500/15",  text: "text-violet-300" },
  { border: "border-l-cyan-500",    bg: "bg-cyan-500/10",    iconBg: "bg-cyan-500/15",    text: "text-cyan-300" },
  { border: "border-l-emerald-500", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", text: "text-emerald-300" },
  { border: "border-l-amber-500",   bg: "bg-amber-500/10",   iconBg: "bg-amber-500/15",   text: "text-amber-300" },
  { border: "border-l-pink-500",    bg: "bg-pink-500/10",    iconBg: "bg-pink-500/15",    text: "text-pink-300" },
];

function getAccent(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return ACCENTS[Math.abs(h) % ACCENTS.length];
}

interface Props {
  list: ListSummary;
  onClick: (list: ListSummary) => void;
  onDelete: (id: string) => void;
}

export function ListCard({ list, onClick, onDelete }: Props) {
  const accent = getAccent(list.id);
  const isWhatsApp = list.source === "whatsapp";
  const ago = formatDistanceToNow(new Date(list.updated_at), { locale: ptBR, addSuffix: true });
  const allDone = list.total_items > 0 && list.pending_items === 0;

  return (
    <Card
      className={`bg-card border-border border-l-4 ${accent.border} hover:shadow-md hover:shadow-black/20 hover:border-primary/20 transition-all duration-200 cursor-pointer mb-4 group`}
      onClick={() => onClick(list)}
    >
      <CardContent className="pt-4 pb-3 px-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <div className={`shrink-0 h-8 w-8 rounded-lg ${accent.iconBg} flex items-center justify-center`}>
              {allDone ? (
                <CheckCircle2 className={`h-4 w-4 ${accent.text}`} />
              ) : (
                <ListChecks className={`h-4 w-4 ${accent.text}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm leading-tight mb-0.5 truncate capitalize">
                {list.name}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {list.total_items === 0
                  ? "Vazia"
                  : `${list.pending_items}/${list.total_items} pendente${list.pending_items === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </div>

        {/* Preview (até 3 itens pendentes) */}
        {list.preview.length > 0 ? (
          <ul className="space-y-1 mb-3 mt-2">
            {list.preview.map((p, i) => (
              <li key={i} className="text-xs text-muted-foreground/90 flex items-start gap-1.5">
                <span className="text-muted-foreground/40 shrink-0">▢</span>
                <span className="truncate">{p}</span>
              </li>
            ))}
            {list.pending_items > list.preview.length && (
              <li className="text-[10px] text-muted-foreground/60 italic pl-4">
                +{list.pending_items - list.preview.length} mais
              </li>
            )}
          </ul>
        ) : list.total_items > 0 ? (
          <p className="text-xs text-emerald-400/80 italic mb-3 mt-1">✅ Tudo concluído</p>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic mb-3 mt-1">Sem itens ainda</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            {isWhatsApp ? (
              <Badge className="bg-green-500/15 text-green-400 border-green-500/25 text-[10px] gap-1 h-5">
                <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-5">
                <ListChecks className="w-2.5 h-2.5 mr-1" /> Manual
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground/60">{ago}</span>
          </div>

          {/* Action: delete */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(list.id);
              }}
              title="Excluir lista"
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
