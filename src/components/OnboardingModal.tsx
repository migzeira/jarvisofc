import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// ─────────────────────────────────────────────
// Slides do onboarding
// ─────────────────────────────────────────────
const SLIDES = [
  {
    emoji: "👋",
    title: "Bem-vindo à Minha Maya!",
    subtitle: "Sua assistente pessoal inteligente via WhatsApp",
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          A Maya é uma IA que você controla <strong className="text-foreground">pelo WhatsApp</strong> — sem app pra instalar, sem interface complicada.
        </p>
        <p>
          Fale com ela em linguagem natural, como faria com uma assistente humana. Ela entende contexto, lembra do que você disse e age de verdade.
        </p>
        <div className="bg-accent/40 rounded-lg p-3 text-xs font-mono">
          <p className="text-violet-400">Você → Maya:</p>
          <p className="text-foreground mt-1">"Oi Maya, tudo bem?"</p>
          <p className="text-violet-400 mt-2">Maya → Você:</p>
          <p className="text-foreground mt-1">"Tudo ótimo! Como posso te ajudar hoje? 😊"</p>
        </div>
      </div>
    ),
  },
  {
    emoji: "⚙️",
    title: "Configure em 3 passos",
    subtitle: "Leva menos de 2 minutos",
    content: (
      <div className="space-y-4">
        {[
          {
            step: "1",
            done: false,
            title: "Cadastre seu WhatsApp",
            desc: 'Vá em "Meu Perfil" e salve seu número com DDD (ex: 11999999999)',
          },
          {
            step: "2",
            done: false,
            title: 'Mande "oi" para o número da Maya',
            desc: "A Maya vai te responder automaticamente e perguntar seu nome",
          },
          {
            step: "3",
            done: false,
            title: "Comece a usar!",
            desc: "Pode pedir para criar um lembrete, registrar um gasto ou agendar algo",
          },
        ].map((item) => (
          <div key={item.step} className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {item.step}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    emoji: "📅",
    title: "Agenda & Compromissos",
    subtitle: "A Maya organiza sua agenda pelo WhatsApp",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Fale naturalmente — ela entende datas, horários e detalhes:</p>
        <div className="space-y-2">
          {[
            "\"Dentista amanhã às 14h no centro\"",
            "\"Reunião com João na sexta às 10h\"",
            "\"O que tenho hoje?\"",
            "\"Cancela minha consulta de quinta\"",
            "\"Muda a reunião de sexta pra segunda às 9h\"",
          ].map((ex, i) => (
            <div key={i} className="bg-accent/40 rounded-lg px-3 py-2 text-xs font-mono text-foreground">
              {ex}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          💡 A Maya avisa quando há conflito de horário e pergunta como resolver.
        </p>
      </div>
    ),
  },
  {
    emoji: "🔔",
    title: "Lembretes",
    subtitle: "Nunca mais esqueça nada importante",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">A Maya te manda uma mensagem no horário certo:</p>
        <div className="space-y-2">
          {[
            "\"Me lembra de ligar para o banco às 15h\"",
            "\"Lembrete: tomar remédio todo dia às 8h\"",
            "\"Me avisa 30 min antes da reunião de amanhã\"",
            "\"Cancelar meu lembrete do banco\"",
            "\"Que lembretes tenho hoje?\"",
          ].map((ex, i) => (
            <div key={i} className="bg-accent/40 rounded-lg px-3 py-2 text-xs font-mono text-foreground">
              {ex}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          💡 Lembretes recorrentes também funcionam — diário, semanal, mensal.
        </p>
      </div>
    ),
  },
  {
    emoji: "💰",
    title: "Controle Financeiro",
    subtitle: "Registre gastos e entradas sem esforço",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Sem planilhas, sem apps de finanças — só manda mensagem:</p>
        <div className="space-y-2">
          {[
            "\"Gastei 45 reais no almoço\"",
            "\"Conta de luz 189 reais\"",
            "\"Recebi 3000 de salário hoje\"",
            "\"Quanto gastei esse mês?\"",
            "\"Mostra meus gastos da semana\"",
          ].map((ex, i) => (
            <div key={i} className="bg-accent/40 rounded-lg px-3 py-2 text-xs font-mono text-foreground">
              {ex}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          💡 Veja os gráficos detalhados aqui no painel em{" "}
          <span className="text-violet-400">Finanças</span>.
        </p>
      </div>
    ),
  },
  {
    emoji: "📝",
    title: "Anotações",
    subtitle: "Capture ideias e informações na hora",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">A Maya salva e organiza suas anotações automaticamente:</p>
        <div className="space-y-2">
          {[
            "\"Anota: ideia para o projeto X\"",
            "\"Salva a senha do wifi: casa123\"",
            "\"Lembra o endereço: Rua das Flores, 42\"",
            "\"Quais minhas anotações?\"",
            "\"Apaga a anotação sobre o projeto X\"",
          ].map((ex, i) => (
            <div key={i} className="bg-accent/40 rounded-lg px-3 py-2 text-xs font-mono text-foreground">
              {ex}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          💡 Todas as anotações aparecem no painel em{" "}
          <span className="text-violet-400">Anotações</span> organizadas por data.
        </p>
      </div>
    ),
  },
  {
    emoji: "🌅",
    title: "Resumo Diário",
    subtitle: "Toda manhã às 8h a Maya te manda um resumo",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Automaticamente, a Maya envia um resumo personalizado com:
        </p>
        <div className="space-y-2">
          {[
            { icon: "📌", text: "Compromissos do dia com horários" },
            { icon: "🔔", text: "Lembretes pendentes para hoje" },
            { icon: "💬", text: "Mensagem motivadora personalizada" },
            { icon: "📭", text: "Pergunta se precisa organizar algo (quando agenda livre)" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span>{item.icon}</span>
              <span className="text-muted-foreground">{item.text}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground bg-accent/40 rounded-lg p-2">
          💡 Você pode desativar o resumo diário em{" "}
          <span className="text-violet-400">Configurar Agente → Resumo diário</span>.
        </p>
      </div>
    ),
  },
  {
    emoji: "🤖",
    title: "Personalização do Agente",
    subtitle: "Faça a Maya do seu jeito",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Em <span className="text-violet-400">Configurar Agente</span> você pode ajustar:
        </p>
        <div className="space-y-2">
          {[
            { icon: "👤", text: "Como a Maya te chama (apelido)" },
            { icon: "🎭", text: "Tom de voz: formal, casual ou direto" },
            { icon: "🌅", text: "Ativar/desativar o resumo matinal" },
            { icon: "💬", text: "Contexto sobre você (trabalho, rotina, preferências)" },
            { icon: "🔗", text: "Conectar integrações externas" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span>{item.icon}</span>
              <span className="text-muted-foreground">{item.text}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Quanto mais contexto você der, mais precisa e útil ela fica.
        </p>
      </div>
    ),
  },
  {
    emoji: "🚀",
    title: "Tudo pronto!",
    subtitle: "Você já sabe tudo que precisa para começar",
    content: (
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>
          A Maya aprende com o tempo e fica cada vez mais personalizada para a sua rotina.
        </p>
        <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-lg p-4 space-y-2">
          <p className="text-foreground font-semibold text-sm">Resumo rápido:</p>
          {[
            "📱 WhatsApp é o canal principal",
            "🗓️ Agenda, lembretes, gastos e notas",
            "🌅 Resumo diário automático às 8h",
            "🤖 Configure o agente ao seu gosto",
            "📊 Painel para visualizar tudo",
          ].map((item, i) => (
            <p key={i} className="text-xs">{item}</p>
          ))}
        </div>
        <p className="text-xs text-center text-violet-400 font-medium">
          Qualquer dúvida, é só abrir esse tutorial de novo! 😊
        </p>
      </div>
    ),
  },
];

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [current, setCurrent] = useState(0);
  const total = SLIDES.length;
  const slide = SLIDES[current];

  const prev = () => setCurrent((c) => Math.max(0, c - 1));
  const next = () => {
    if (current === total - 1) {
      onClose();
    } else {
      setCurrent((c) => c + 1);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reseta pro início quando fechar
      setTimeout(() => setCurrent(0), 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md p-0 overflow-hidden gap-0 rounded-xl">
        {/* Progress bar */}
        <div className="h-1 bg-accent w-full">
          <div
            className="h-1 bg-violet-500 transition-all duration-300"
            style={{ width: `${((current + 1) / total) * 100}%` }}
          />
        </div>

        {/* Slide content */}
        <div className="p-6 pb-4 min-h-[380px] flex flex-col">
          {/* Emoji + title */}
          <div className="text-center mb-5">
            <div className="text-5xl mb-3">{slide.emoji}</div>
            <h2 className="text-lg font-bold text-foreground">{slide.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{slide.subtitle}</p>
          </div>

          {/* Content */}
          <div className="flex-1">{slide.content}</div>
        </div>

        {/* Footer navigation */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === current
                    ? "w-4 h-2 bg-violet-500"
                    : "w-2 h-2 bg-accent hover:bg-accent-foreground/20"
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {current > 0 && (
              <Button variant="ghost" size="sm" onClick={prev} className="gap-1">
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
            )}
            <Button
              size="sm"
              onClick={next}
              className="gap-1 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {current === total - 1 ? (
                "Fechar"
              ) : (
                <>
                  {current === 0 ? "Começar" : "Próximo"}
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
