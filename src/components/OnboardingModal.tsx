import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────
// Bloco reutilizável de exemplos de frases
// ─────────────────────────────────────────────
function ExampleList({ examples }: { examples: string[] }) {
  return (
    <div className="space-y-1.5">
      {examples.map((ex, i) => (
        <div key={i} className="bg-accent/40 rounded-lg px-3 py-2 text-xs font-mono text-foreground leading-relaxed">
          {ex}
        </div>
      ))}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground bg-accent/30 rounded-lg p-2.5 leading-relaxed">
      💡 {children}
    </p>
  );
}

// ─────────────────────────────────────────────
// Slides do tutorial
// ─────────────────────────────────────────────
const SLIDES = [
  // ── 1. Boas-vindas ──────────────────────────
  {
    emoji: "👋",
    title: "Bem-vindo ao Hey Jarvis!",
    subtitle: "Seu assistente pessoal inteligente via WhatsApp",
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          O Jarvis é uma IA que você controla <strong className="text-foreground">pelo WhatsApp</strong> — sem app pra instalar, sem interface complicada. Fale em linguagem natural, como faria com um assistente humano.
        </p>
        <p>Ele gerencia sua <strong className="text-foreground">agenda, finanças, lembretes, hábitos, anotações e contatos</strong> — tudo por mensagem.</p>
        <div className="bg-accent/40 rounded-lg p-3 text-xs font-mono space-y-1">
          <p className="text-violet-400">Você → Jarvis:</p>
          <p className="text-foreground">"Gastei 45 reais no almoço e tenho reunião amanhã às 10h"</p>
          <p className="text-violet-400 mt-2">Jarvis → Você:</p>
          <p className="text-foreground">"Gasto de R$45,00 registrado em Alimentação. Reunião criada para amanhã às 10h. ✅"</p>
        </div>
      </div>
    ),
  },

  // ── 2. Primeiros passos ─────────────────────
  {
    emoji: "⚙️",
    title: "Configure em 3 passos",
    subtitle: "Leva menos de 2 minutos",
    content: (
      <div className="space-y-4">
        {[
          {
            step: "1",
            title: "Cadastre seu WhatsApp",
            desc: 'Vá em "Meu Perfil" no menu lateral e salve seu número com DDI (ex: +55 11 99999-9999)',
          },
          {
            step: "2",
            title: "Mande uma mensagem para o Jarvis",
            desc: "Após salvar o número, o Jarvis já está ativo. Mande um \"Oi\" e ele responde na hora.",
          },
          {
            step: "3",
            title: "Comece a usar!",
            desc: "Registre um gasto, crie um lembrete ou agende algo — use linguagem natural, o Jarvis entende.",
          },
        ].map((item) => (
          <div key={item.step} className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-500 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              {item.step}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
        <Tip>Você pode trocar seu número até 2 vezes. Depois disso ele fica bloqueado por segurança.</Tip>
      </div>
    ),
  },

  // ── 3. Finanças ─────────────────────────────
  {
    emoji: "💰",
    title: "Controle Financeiro",
    subtitle: "Registre gastos e receitas sem esforço",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Fale naturalmente — ele categoriza tudo automaticamente:</p>
        <ExampleList examples={[
          '"Gastei 45 reais no almoço"',
          '"Conta de luz 189 reais"',
          '"Recebi 3.000 de salário"',
          '"Gasolina 120 reais hoje"',
          '"Quanto gastei esse mês?"',
          '"Meus gastos da semana"',
          '"Resumo financeiro de outubro"',
          '"Me manda um relatório dos meus gastos"',
        ]} />
        <Tip>
          Você também pode <strong className="text-foreground">enviar foto de nota fiscal ou extrato</strong> — o Jarvis lê e registra automaticamente. Veja os gráficos detalhados no painel em <span className="text-violet-400">Finanças</span>.
        </Tip>
      </div>
    ),
  },

  // ── 4. Agenda ───────────────────────────────
  {
    emoji: "📅",
    title: "Agenda & Compromissos",
    subtitle: "Organize sua agenda pelo WhatsApp",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Datas, horários e detalhes — ele entende tudo:</p>
        <ExampleList examples={[
          '"Dentista amanhã às 14h no centro"',
          '"Reunião com João na sexta às 10h"',
          '"Almoço com cliente segunda 12h30 no Figueira"',
          '"O que tenho hoje?"',
          '"Minha agenda da semana"',
          '"Cancela minha consulta de quinta"',
          '"Muda a reunião de sexta pra segunda às 9h"',
          '"Adiciona lembrete 30 min antes da reunião"',
        ]} />
        <Tip>
          O Jarvis avisa quando há <strong className="text-foreground">conflito de horário</strong> e pergunta como resolver. Conecte o Google Calendar em <span className="text-violet-400">Integrações</span> para sincronizar tudo.
        </Tip>
      </div>
    ),
  },

  // ── 5. Lembretes ────────────────────────────
  {
    emoji: "🔔",
    title: "Lembretes",
    subtitle: "Nunca mais esqueça nada importante",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">O Jarvis te manda uma mensagem no horário certo:</p>
        <ExampleList examples={[
          '"Me lembra de ligar pro banco às 15h"',
          '"Lembrete: tomar remédio todo dia às 8h"',
          '"Me avisa toda segunda às 9h de fazer o relatório"',
          '"Lembrete mensal: pagar o aluguel todo dia 5"',
          '"Me lembra daqui a 2 horas de verificar o e-mail"',
          '"Que lembretes tenho hoje?"',
          '"Cancela meu lembrete do banco"',
          '"Lista todos meus lembretes"',
        ]} />
        <Tip>
          Lembretes recorrentes funcionam — <strong className="text-foreground">diário, semanal, mensal e de X em X horas</strong>. Gerencie tudo no painel em <span className="text-violet-400">Lembretes</span>.
        </Tip>
      </div>
    ),
  },

  // ── 6. Hábitos ──────────────────────────────
  {
    emoji: "⚡",
    title: "Hábitos & Rotina",
    subtitle: "Construa hábitos consistentes com apoio da IA",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">O Jarvis te lembra e registra seus hábitos diários:</p>
        <ExampleList examples={[
          '"Beber água — feito!"',
          '"Tomei o remédio agora"',
          '"Fiz minha leitura de hoje"',
          '"Meditei hoje"',
          '"Quais hábitos fiz hoje?"',
          '"Meu progresso de hábitos essa semana"',
          '"Qual meu recorde de sequência de exercícios?"',
        ]} />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Hábitos disponíveis no painel:</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
            {["💧 Água", "💊 Remédio", "📖 Leitura", "🧘 Respiração",
              "🌅 Gratidão", "🐾 Passear com pet", "🛌 Sono", "😊 Check emocional",
              "📞 Ligar pra família", "🌱 Regar plantas", "🍽️ Refeições", "☀️ Protetor solar"
            ].map((h) => (
              <span key={h} className="bg-accent/30 rounded px-2 py-0.5">{h}</span>
            ))}
          </div>
        </div>
        <Tip>Configure hábitos personalizados e frequência de lembretes (de hora em hora, em horários fixos ou por dia da semana) em <span className="text-violet-400">Hábitos</span>.</Tip>
      </div>
    ),
  },

  // ── 7. Anotações ────────────────────────────
  {
    emoji: "📝",
    title: "Anotações",
    subtitle: "Capture qualquer ideia ou informação na hora",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">O Jarvis salva e organiza suas anotações automaticamente:</p>
        <ExampleList examples={[
          '"Anota: ideia para o projeto X"',
          '"Salva: senha do wifi é casa123"',
          '"Lembra o endereço: Rua das Flores, 42"',
          '"Anota que o prazo do contrato vence em maio"',
          '"Minhas anotações de hoje"',
          '"Busca nas minhas notas sobre projeto X"',
          '"Apaga a anotação sobre o projeto X"',
          '"Quais minhas últimas anotações?"',
        ]} />
        <Tip>
          Todas as anotações aparecem no painel em <span className="text-violet-400">Anotações</span> organizadas por data e origem (WhatsApp ou painel web).
        </Tip>
      </div>
    ),
  },

  // ── 8. Contatos ─────────────────────────────
  {
    emoji: "👥",
    title: "Contatos",
    subtitle: "Guarde informações de pessoas e empresas",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Salve e consulte contatos diretamente pelo WhatsApp:</p>
        <ExampleList examples={[
          '"Salva o contato: João Silva, (11) 98888-7777"',
          '"Anota: Dr. Carlos, médico, (11) 3333-4444"',
          '"Salva a pizzaria: Bella Pizza, (11) 99999-1111"',
          '"Qual o telefone do João?"',
          '"Contatos de médicos que tenho"',
          '"Busca o número da Bella Pizza"',
          '"Meus contatos de fornecedores"',
        ]} />
        <Tip>
          Gerencie a lista completa de pessoas e empresas no painel em <span className="text-violet-400">Contatos</span>. Suporta categorias como farmácia, restaurante, médico, fornecedor e mais.
        </Tip>
      </div>
    ),
  },

  // ── 9. Resumo Diário ────────────────────────
  {
    emoji: "🌅",
    title: "Resumo Diário",
    subtitle: "Todo dia às 8h o Jarvis te manda um resumo",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Automaticamente, o Jarvis envia um resumo personalizado com:</p>
        <div className="space-y-2">
          {[
            { icon: "📌", text: "Compromissos do dia com horários e locais" },
            { icon: "🔔", text: "Lembretes pendentes para hoje" },
            { icon: "⚡", text: "Hábitos programados para o dia" },
            { icon: "💬", text: "Mensagem motivadora personalizada" },
            { icon: "📭", text: "Pergunta se precisa organizar algo (quando agenda livre)" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="shrink-0">{item.icon}</span>
              <span className="text-muted-foreground">{item.text}</span>
            </div>
          ))}
        </div>
        <ExampleList examples={[
          '"Me manda o resumo do dia"',
          '"O que tenho pra hoje?"',
        ]} />
        <Tip>
          Ajuste o horário ou desative em <span className="text-violet-400">Config. do Agente → Resumo diário</span>.
        </Tip>
      </div>
    ),
  },

  // ── 10. Personalização ──────────────────────
  {
    emoji: "🤖",
    title: "Personalize o Agente",
    subtitle: "Faça o Jarvis do seu jeito",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Em <span className="text-violet-400">Config. do Agente</span> você pode ajustar:
        </p>
        <div className="space-y-2">
          {[
            { icon: "👤", text: "Como o Jarvis te chama (apelido)" },
            { icon: "🎭", text: "Tom de voz: profissional, casual ou formal" },
            { icon: "🌍", text: "Idioma das respostas (PT, EN, ES e outros)" },
            { icon: "🌅", text: "Ativar/desativar o resumo matinal e o horário" },
            { icon: "💡", text: "Ativar insights proativos sobre seus hábitos e finanças" },
            { icon: "⚡", text: "Respostas rápidas: configure atalhos de texto automáticos" },
            { icon: "🔗", text: "Ativar/desativar módulos (finanças, agenda, notas, chat)" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="shrink-0">{item.icon}</span>
              <span className="text-muted-foreground">{item.text}</span>
            </div>
          ))}
        </div>
        <Tip>Quanto mais contexto você der sobre sua rotina, mais preciso e útil o Jarvis fica.</Tip>
      </div>
    ),
  },

  // ── 11. Painel Web ──────────────────────────
  {
    emoji: "📊",
    title: "Painel Web",
    subtitle: "Visualize e gerencie tudo pelo computador",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">O painel complementa o WhatsApp com visualizações detalhadas:</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: "💰", label: "Finanças", desc: "Gráficos, orçamentos e exportação CSV" },
            { icon: "📅", label: "Agenda", desc: "Visualização mensal, semanal e diária" },
            { icon: "🔔", label: "Lembretes", desc: "Gerencie todos com recorrência" },
            { icon: "⚡", label: "Hábitos", desc: "Streaks, calendário e presets" },
            { icon: "📝", label: "Anotações", desc: "Busca e edição de notas" },
            { icon: "👥", label: "Contatos", desc: "Pessoas e empresas organizadas" },
            { icon: "📈", label: "Analytics", desc: "Métricas de uso do agente" },
            { icon: "🔗", label: "Integrações", desc: "Google Calendar, Sheets, Notion" },
          ].map((item) => (
            <div key={item.label} className="bg-accent/30 rounded-lg p-2 flex items-start gap-2">
              <span className="text-base shrink-0">{item.icon}</span>
              <div>
                <p className="text-xs font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground leading-tight">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },

  // ── 12. Tudo pronto! ────────────────────────
  {
    emoji: "🚀",
    title: "Tudo pronto para começar!",
    subtitle: "Você já sabe tudo que precisa",
    content: (
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>O Jarvis aprende com o tempo e fica cada vez mais personalizado para a sua rotina.</p>
        <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-lg p-4 space-y-2">
          <p className="text-foreground font-semibold text-sm mb-3">Resumo rápido:</p>
          {[
            "📱 WhatsApp é o canal principal — fale natural",
            "💰 Gastos e receitas registrados por mensagem",
            "📅 Agenda e lembretes com recorrência",
            "⚡ Hábitos com streak e lembretes automáticos",
            "📝 Anotações e contatos organizados",
            "🌅 Resumo diário automático às 8h",
            "📊 Painel web para visualizar tudo",
            "🤖 Configure o agente ao seu gosto",
          ].map((item, i) => (
            <p key={i} className="text-xs">{item}</p>
          ))}
        </div>
        <p className="text-xs text-center text-violet-400 font-medium">
          Qualquer dúvida, abra este guia de novo pelo menu lateral! 😊
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
        <div className="p-6 pb-4 min-h-[400px] flex flex-col">
          {/* Emoji + title */}
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">{slide.emoji}</div>
            <h2 className="text-lg font-bold text-foreground">{slide.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{slide.subtitle}</p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto pr-0.5">{slide.content}</div>
        </div>

        {/* Footer navigation */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {/* Dots */}
          <div className="flex items-center gap-1 flex-wrap max-w-[180px]">
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
          <div className="flex items-center gap-2 shrink-0">
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
