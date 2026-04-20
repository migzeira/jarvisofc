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
// Slides — frases reais extraídas do código
// (classify.ts, whatsapp-webhook/index.ts e OnboardingModal)
// ─────────────────────────────────────────────
const SLIDES = [
  // ── Intro ───────────────────────────────────
  {
    emoji: "🎯",
    title: "Frases das Ações",
    subtitle: "Saiba exatamente como falar com o Jarvis",
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          O Jarvis entende linguagem natural — mas usar certos <strong className="text-foreground">verbos e padrões</strong> faz ele reconhecer sua intenção na hora, sem ambiguidade.
        </p>
        <p>
          Nas próximas telas, veja os <strong className="text-foreground">padrões exatos</strong> que acionam cada funcionalidade. Use-os como referência quando quiser garantir o resultado certo.
        </p>
        <div className="bg-accent/40 rounded-lg p-3 text-xs space-y-1">
          <p className="text-violet-400 font-semibold">📌 Dica geral:</p>
          <p>Fale como se estivesse conversando com uma pessoa. Seja direto sobre o que quer — o Jarvis entende frases curtas e longas.</p>
        </div>
      </div>
    ),
  },

  // ── 1. Finanças ─────────────────────────────
  {
    emoji: "💰",
    title: "Finanças",
    subtitle: "Registrar gastos, receitas e consultar relatórios",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para registrar:</p>
        <ExampleList examples={[
          '"Gastei 45 reais no almoço"',
          '"Conta de luz 189 reais"',
          '"Recebi 3.000 de salário"',
          '"Gasolina 120 reais hoje"',
          '"Comprei celular 300 em 3x"',
          '"Paguei 500 no mercado"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para consultar:</p>
        <ExampleList examples={[
          '"Quanto gastei esse mês?"',
          '"Meus gastos da semana"',
          '"Resumo financeiro de outubro"',
          '"Me manda um relatório dos meus gastos"',
        ]} />
        <Tip>
          Você também pode <strong className="text-foreground">enviar foto de nota fiscal ou extrato</strong> — o Jarvis lê e registra automaticamente.
        </Tip>
      </div>
    ),
  },

  // ── 2. Agenda ───────────────────────────────
  {
    emoji: "📅",
    title: "Agenda",
    subtitle: "Compromissos, reuniões e eventos",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para criar:</p>
        <ExampleList examples={[
          '"Dentista amanhã às 14h no centro"',
          '"Reunião com João na sexta às 10h"',
          '"Almoço com cliente segunda 12h30 no Figueira"',
          '"Marca reunião 15h amanhã"',
          '"Tenho consulta terça 9h"',
          '"Agenda call com fornecedor quinta 16h"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para consultar/alterar:</p>
        <ExampleList examples={[
          '"O que tenho hoje?"',
          '"Minha agenda da semana"',
          '"Cancela minha consulta de quinta"',
          '"Muda a reunião de sexta pra segunda às 9h"',
          '"Adiciona lembrete 30 min antes da reunião"',
        ]} />
        <Tip>
          O Jarvis avisa quando há <strong className="text-foreground">conflito de horário</strong> e pergunta como resolver.
        </Tip>
      </div>
    ),
  },

  // ── 3. Lembretes ────────────────────────────
  {
    emoji: "🔔",
    title: "Lembretes",
    subtitle: "Avisos no horário certo, únicos ou recorrentes",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para criar:</p>
        <ExampleList examples={[
          '"Me lembra de ligar pro banco às 15h"',
          '"Lembrete: tomar remédio todo dia às 8h"',
          '"Me avisa toda segunda às 9h de fazer o relatório"',
          '"Lembrete mensal: pagar o aluguel todo dia 5"',
          '"Me lembra daqui a 2 horas de verificar o e-mail"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para consultar/cancelar:</p>
        <ExampleList examples={[
          '"Que lembretes tenho hoje?"',
          '"Lista todos meus lembretes"',
          '"Cancela meu lembrete do banco"',
        ]} />
        <Tip>
          Recorrências suportadas: <strong className="text-foreground">diário, semanal, mensal e de X em X horas</strong>.
        </Tip>
      </div>
    ),
  },

  // ── 4. Anotações ────────────────────────────
  {
    emoji: "📝",
    title: "Anotações",
    subtitle: "Capturar ideias e informações",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para salvar:</p>
        <ExampleList examples={[
          '"Anota: ideia para o projeto X"',
          '"Salva: senha do wifi é casa123"',
          '"Lembra o endereço: Rua das Flores, 42"',
          '"Anota que o prazo do contrato vence em maio"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para buscar/consultar:</p>
        <ExampleList examples={[
          '"Minhas anotações de hoje"',
          '"Busca nas minhas notas sobre projeto X"',
          '"Quais minhas últimas anotações?"',
          '"Apaga a anotação sobre o projeto X"',
        ]} />
        <Tip>
          Use os verbos <strong className="text-foreground">anota, salva, lembra</strong> no começo para acionamento direto.
        </Tip>
      </div>
    ),
  },

  // ── 5. Hábitos ──────────────────────────────
  {
    emoji: "⚡",
    title: "Hábitos",
    subtitle: "Criar rotinas e registrar check-ins",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para criar:</p>
        <ExampleList examples={[
          '"Quero criar hábito de beber água a cada 2h"',
          '"Hábito de exercício todo dia às 7h"',
          '"Criar rotina de leitura"',
          '"Hábito de meditar todo dia às 8h"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para registrar check-in:</p>
        <ExampleList examples={[
          '"Beber água — feito!"',
          '"Tomei o remédio agora"',
          '"Fiz minha leitura de hoje"',
          '"Meditei hoje"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para consultar:</p>
        <ExampleList examples={[
          '"Quais hábitos fiz hoje?"',
          '"Meu progresso de hábitos essa semana"',
          '"Qual meu recorde de sequência de exercícios?"',
        ]} />
        <Tip>
          Quando o Jarvis te avisar do hábito, responda <strong className="text-foreground">"feito"</strong> pra marcar o check-in.
        </Tip>
      </div>
    ),
  },

  // ── 6. Contatos ─────────────────────────────
  {
    emoji: "👥",
    title: "Contatos",
    subtitle: "Salvar e consultar pessoas e empresas",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground font-medium">Para salvar:</p>
        <ExampleList examples={[
          '"Salva o contato: João Silva, (11) 98888-7777"',
          '"Anota: Dr. Carlos, médico, (11) 3333-4444"',
          '"Salva a pizzaria: Bella Pizza, (11) 99999-1111"',
          '"Adiciona contato: Maria, (11) 97777-6666"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Para consultar:</p>
        <ExampleList examples={[
          '"Qual o telefone do João?"',
          '"Busca o número da Bella Pizza"',
          '"Meus contatos de médicos"',
          '"Contatos salvos"',
          '"Lista meus contatos"',
        ]} />
        <Tip>
          Categorias suportadas: <strong className="text-foreground">pessoa, médico, farmácia, restaurante, pizzaria, fornecedor</strong> e outras.
        </Tip>
      </div>
    ),
  },

  // ── 7. Disparar mensagem pra usuário (contato) ──
  {
    emoji: "💬",
    title: "Mandar mensagem pra contato",
    subtitle: "Jarvis envia WhatsApp em seu nome",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O Jarvis dispara uma mensagem direto do seu número pro contato salvo:
        </p>
        <ExampleList examples={[
          '"Manda mensagem pra Cibele dizendo que vou chegar 15min atrasado"',
          '"Fala pro João que a reunião foi adiada"',
          '"Manda uma mensagem pro Pedro que confirmei o orçamento"',
          '"Avisa a Maria que o pedido chegou"',
          '"Escreve pro Carlos: vou passar aí às 18h"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Você também pode agendar:</p>
        <ExampleList examples={[
          '"Daqui 30 min manda pra Cibele que cheguei"',
          '"Amanhã às 9h manda pro João bom dia"',
        ]} />
        <Tip>
          O contato precisa estar <strong className="text-foreground">salvo</strong> antes. Os verbos que acionam: <strong className="text-foreground">manda, envia, fala, diz, avisa, escreve</strong>.
        </Tip>
      </div>
    ),
  },

  // ── 8. Disparar mensagem pra estabelecimento ──
  {
    emoji: "🍕",
    title: "Fazer pedido em estabelecimento",
    subtitle: "Jarvis negocia e fecha pedidos por você",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O Jarvis contata o estabelecimento salvo e cuida do pedido:
        </p>
        <ExampleList examples={[
          '"Pede uma pizza de calabresa na pizzaria Bella Pizza"',
          '"Faz um pedido no restaurante Japa Sushi"',
          '"Pede um remédio na farmácia São João"',
          '"Pede açaí 500ml na Açaiteria do Bairro"',
          '"Encomenda pão na padaria do seu Zé"',
        ]} />
        <p className="text-sm text-muted-foreground font-medium mt-3">Agendar pedido:</p>
        <ExampleList examples={[
          '"Amanhã às 20h pede pizza na Bella Pizza"',
          '"Daqui 1h faz um pedido no sushi"',
        ]} />
        <Tip>
          O estabelecimento precisa estar <strong className="text-foreground">salvo nos contatos</strong> com tipo/categoria (pizzaria, restaurante, farmácia, padaria, mercado, lanchonete). Verbos: <strong className="text-foreground">pede, encomenda, faz um pedido</strong>.
        </Tip>
      </div>
    ),
  },

  // ── Final ───────────────────────────────────
  {
    emoji: "✨",
    title: "Pronto!",
    subtitle: "Agora você tira o máximo do Jarvis",
    content: (
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>Resumo dos verbos-chave pra cada ação:</p>
        <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-lg p-4 space-y-2 text-xs">
          <p>💰 <strong className="text-foreground">Finanças:</strong> gastei, paguei, recebi, comprei</p>
          <p>📅 <strong className="text-foreground">Agenda:</strong> marca, agenda, tenho (reunião), cria</p>
          <p>🔔 <strong className="text-foreground">Lembretes:</strong> me lembra, me avisa, lembrete</p>
          <p>📝 <strong className="text-foreground">Anotações:</strong> anota, salva, lembra o/a</p>
          <p>⚡ <strong className="text-foreground">Hábitos:</strong> hábito de, criar rotina, feito</p>
          <p>👥 <strong className="text-foreground">Contatos:</strong> salva o contato, adiciona</p>
          <p>💬 <strong className="text-foreground">Mensagem:</strong> manda/fala/avisa pra [nome]</p>
          <p>🍕 <strong className="text-foreground">Pedido:</strong> pede/encomenda na [lugar]</p>
        </div>
        <p className="text-xs text-center text-violet-400 font-medium">
          Qualquer dúvida, volta aqui pelo menu lateral! 😊
        </p>
      </div>
    ),
  },
];

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
interface TriggerPhrasesModalProps {
  open: boolean;
  onClose: () => void;
}

export function TriggerPhrasesModal({ open, onClose }: TriggerPhrasesModalProps) {
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
