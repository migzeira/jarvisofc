import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  MessageCircle, Wallet, CalendarDays, StickyNote, Bot,
  Check, ArrowRight, Star, Zap, Shield, CreditCard,
  Settings, Sparkles, Users, TrendingUp,
} from "lucide-react";

/* ─────────────────────────────────────────
   Utilities
───────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

function AnimateIn({
  children, delay = 0, className = "",
}: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function Counter({ end, suffix = "" }: { end: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const [ref, inView] = useInView(0.5);
  useEffect(() => {
    if (!inView) return;
    let start: number;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 1800, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.floor(eased * end));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, end]);
  return <span ref={ref}>{count.toLocaleString("pt-BR")}{suffix}</span>;
}

/* ─────────────────────────────────────────
   Data
───────────────────────────────────────── */
const steps = [
  { icon: CreditCard, title: "Escolha um plano", desc: "Acesso imediato, sem fidelidade. Cancele quando quiser.", n: "01" },
  { icon: Settings, title: "Configure em 2 min", desc: "Conecte seu WhatsApp pelo painel e personalize o agente.", n: "02" },
  { icon: MessageCircle, title: "Converse e pronto", desc: "Mande uma mensagem. Sua IA cuida de tudo automaticamente.", n: "03" },
];

const features = [
  {
    icon: Wallet, title: "Finanças Inteligentes",
    desc: "Registre gastos e receitas conversando. Relatórios por categoria, alertas e gráficos no painel.",
    gradient: "from-emerald-500 to-teal-500", glow: "group-hover:shadow-emerald-500/20",
  },
  {
    icon: CalendarDays, title: "Agenda & Lembretes",
    desc: "Crie compromissos com linguagem natural. Maya lembra você no horário certo, sem configuração.",
    gradient: "from-blue-500 to-cyan-500", glow: "group-hover:shadow-blue-500/20",
  },
  {
    icon: StickyNote, title: "Notas & Memória",
    desc: "Salve ideias, listas e informações. Pesquise qualquer coisa que você salvou depois.",
    gradient: "from-violet-500 to-purple-500", glow: "group-hover:shadow-violet-500/20",
  },
  {
    icon: Bot, title: "Conversa com IA",
    desc: "Faça perguntas, peça resumos e analise seus dados. Maya entende contexto e aprende seus hábitos.",
    gradient: "from-orange-500 to-rose-500", glow: "group-hover:shadow-orange-500/20",
  },
];

const testimonials = [
  {
    name: "Ana Clara Silva", role: "Empreendedora", avatar: "AC",
    text: "Antes eu esquecia de anotar meus gastos. Agora só mando uma mensagem e está tudo registrado. Economizei R$800 só no primeiro mês!",
  },
  {
    name: "Rafael Torres", role: "Freelancer", avatar: "RT",
    text: "Os lembretes de reunião são incríveis. Nunca mais perdi um compromisso importante. A IA é surpreendentemente inteligente.",
  },
  {
    name: "Juliana Matos", role: "Médica", avatar: "JM",
    text: "Uso para anotar observações e compromissos durante o dia. Rápido, prático e seguro. Recomendo demais!",
  },
];

const plans = [
  {
    name: "Starter", price: "49", msgs: "500 mensagens/mês",
    features: ["Módulo financeiro", "Módulo agenda", "Painel de controle", "Suporte por email"],
    highlight: false, cta: "Começar agora",
  },
  {
    name: "Pro", price: "99", msgs: "2.000 mensagens/mês",
    features: ["Todos os módulos", "Integrações Google + Notion", "Respostas rápidas", "Suporte prioritário"],
    highlight: true, cta: "Começar agora",
  },
  {
    name: "Business", price: "199", msgs: "Mensagens ilimitadas",
    features: ["Tudo do Pro", "API dedicada", "Múltiplos agentes", "Suporte 24/7"],
    highlight: false, cta: "Falar com vendas",
  },
];

const faqs = [
  { q: "Como o agente funciona no WhatsApp?", a: "Após configurar, você conversa normalmente pelo WhatsApp. A IA interpreta suas mensagens e executa ações como registrar gastos, criar compromissos ou salvar anotações automaticamente." },
  { q: "Preciso instalar algum aplicativo?", a: "Não! Você usa o WhatsApp que já tem no celular. A configuração é feita pelo painel web em menos de 2 minutos." },
  { q: "Meus dados estão seguros?", a: "Sim. Usamos criptografia de ponta e os dados ficam isolados por usuário com políticas de segurança rigorosas." },
  { q: "Posso trocar de plano a qualquer momento?", a: "Sim, upgrade ou downgrade a qualquer momento pelo painel, sem burocracia ou multa." },
  { q: "O que acontece se eu atingir o limite de mensagens?", a: "O agente pausa até o próximo ciclo ou até você fazer upgrade. Você recebe aviso antes de atingir o limite." },
  { q: "Posso personalizar as respostas do agente?", a: "Sim! Tom de voz, idioma, apelido, instruções personalizadas e respostas rápidas para comandos específicos." },
];

const chatMessages = [
  { from: "user", text: "Gastei R$45 no almoço", time: "12:31" },
  { from: "bot",  text: "✅ Anotado! R$ 45,00 em Alimentação.\nTotal este mês: R$ 380,00", time: "12:31" },
  { from: "user", text: "Me lembra da reunião amanhã às 10h", time: "14:05" },
  { from: "bot",  text: "⏰ Lembrete criado para\namanhã às 10:00!", time: "14:05" },
  { from: "user", text: "Quanto gastei essa semana?", time: "18:22" },
  { from: "bot",  text: "📊 Semana: R$ 612,00\n• Alimentação: R$ 245\n• Transporte: R$ 87\n• Outros: R$ 280", time: "18:22" },
];

/* ─────────────────────────────────────────
   Component
───────────────────────────────────────── */
export default function LandingPage() {
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHeroVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">

      {/* ── Background orbs ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-48 -left-32 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px] animate-float" />
        <div className="absolute top-[35%] -right-40 w-[500px] h-[500px] rounded-full bg-purple-500/8 blur-[100px] animate-[float_10s_ease-in-out_infinite_2s]" />
        <div className="absolute -bottom-32 left-[30%] w-[400px] h-[400px] rounded-full bg-blue-600/8 blur-[100px] animate-[float_14s_ease-in-out_infinite_5s]" />
      </div>

      {/* ════════════════════════════════
          HEADER
      ════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] backdrop-blur-xl bg-slate-950/80">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold">MayaChat</span>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
            <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
            <a href="#funcionalidades" className="hover:text-white transition-colors">Funcionalidades</a>
            <a href="#planos" className="hover:text-white transition-colors">Planos</a>
          </nav>

          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/10 hidden sm:flex" asChild>
              <Link to="/login">Entrar</Link>
            </Button>
            <Button
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 border-0 shadow-lg shadow-violet-500/25"
              asChild
            >
              <Link to="/signup">Começar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ════════════════════════════════
          HERO
      ════════════════════════════════ */}
      <section className="container mx-auto px-4 pt-20 pb-32 relative">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center max-w-6xl mx-auto">

          {/* Left */}
          <div>
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-6 transition-all duration-700 ${heroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              Seu assistente de IA no WhatsApp
            </div>

            <h1
              className={`text-5xl md:text-6xl font-black leading-[1.08] mb-6 transition-all duration-700 delay-100 ${heroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              Organize sua vida{" "}
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]">
                conversando
              </span>{" "}
              pelo WhatsApp
            </h1>

            <p
              className={`text-lg text-slate-400 mb-8 max-w-xl leading-relaxed transition-all duration-700 delay-200 ${heroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              Finanças, agenda e anotações — tudo com mensagens simples.
              Sua IA aprende seus hábitos e fica cada vez mais útil, 24h por dia.
            </p>

            <div
              className={`flex flex-col sm:flex-row gap-4 mb-12 transition-all duration-700 delay-[300ms] ${heroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <Button
                size="lg"
                className="text-base px-8 py-6 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 border-0 shadow-xl shadow-violet-500/30 group"
                asChild
              >
                <Link to="/signup">
                  Começar grátis
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-base px-8 py-6 border-white/10 text-white hover:bg-white/5 hover:border-white/20"
                asChild
              >
                <a href="#como-funciona">Ver como funciona</a>
              </Button>
            </div>

            {/* Social proof avatars */}
            <div
              className={`flex items-center gap-5 transition-all duration-700 delay-[400ms] ${heroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <div className="flex -space-x-2.5">
                {["AC", "RT", "JM", "PL", "MS"].map((initials, idx) => (
                  <div
                    key={idx}
                    className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 border-2 border-slate-950 flex items-center justify-center text-[10px] font-bold"
                  >
                    {initials}
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-0.5 mb-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-xs text-slate-400">+1.200 pessoas já usam a Maya</p>
              </div>
            </div>
          </div>

          {/* Right — Phone mockup */}
          <div
            className={`flex justify-center lg:justify-end transition-all duration-1000 delay-500 ${heroVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-10 scale-95"}`}
          >
            <div className="relative">
              {/* Glow */}
              <div className="absolute inset-4 rounded-[3rem] bg-violet-500/25 blur-3xl animate-[float-slow_8s_ease-in-out_infinite]" />

              {/* Phone shell */}
              <div className="relative w-72 bg-[#111827] rounded-[3rem] border-2 border-slate-700/60 shadow-2xl overflow-hidden">
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-[#111827] rounded-b-3xl z-10" />

                {/* WhatsApp header */}
                <div className="bg-[#1f2c34] pt-9 pb-3 px-4 flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                      M
                    </div>
                    <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#1f2c34]" />
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">Maya IA</div>
                    <div className="text-emerald-400 text-xs">online agora</div>
                  </div>
                </div>

                {/* Messages */}
                <div
                  className="bg-[#0b141a] h-[400px] p-3 space-y-2 overflow-hidden"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }}
                >
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}
                      style={{ animation: `fade-up 0.35s ease-out ${0.5 + i * 0.38}s both` }}
                    >
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                          msg.from === "user"
                            ? "bg-[#005c4b] text-white rounded-tr-sm"
                            : "bg-[#202c33] text-slate-200 rounded-tl-sm"
                        }`}
                      >
                        <div className="whitespace-pre-line">{msg.text}</div>
                        <div
                          className={`text-[9px] mt-1 ${
                            msg.from === "user"
                              ? "text-emerald-300/70 text-right"
                              : "text-slate-500"
                          }`}
                        >
                          {msg.time}
                          {msg.from === "user" ? " ✓✓" : ""}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  <div
                    className="flex justify-start"
                    style={{ animation: "fade-up 0.35s ease-out 2.9s both" }}
                  >
                    <div className="bg-[#202c33] px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                      {[0, 0.18, 0.36].map((delay, i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-dot-bounce"
                          style={{ animationDelay: `${delay}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════
          STATS BAR
      ════════════════════════════════ */}
      <section className="border-y border-white/[0.06] bg-white/[0.015] py-14">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto text-center">
            {[
              { value: 1200, suffix: "+", label: "Usuários ativos", icon: Users },
              { value: 98,   suffix: "%", label: "Satisfação",       icon: Star },
              { value: 500000, suffix: "+", label: "Msgs processadas", icon: MessageCircle },
              { value: 2,    suffix: " min", label: "Para configurar", icon: Zap },
            ].map((s, i) => (
              <AnimateIn key={i} delay={i * 80}>
                <div className="flex flex-col items-center gap-2">
                  <s.icon className="h-5 w-5 text-violet-400 mb-1" />
                  <div className="text-3xl md:text-4xl font-black text-white">
                    <Counter end={s.value} suffix={s.suffix} />
                  </div>
                  <div className="text-slate-500 text-sm">{s.label}</div>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════
          COMO FUNCIONA
      ════════════════════════════════ */}
      <section id="como-funciona" className="container mx-auto px-4 py-28">
        <AnimateIn>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-4">
              <Zap className="h-3.5 w-3.5" />
              Simples assim
            </div>
            <h2 className="text-3xl md:text-5xl font-black mb-4">Pronto em 3 passos</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Sem complicação. Você começa a usar em menos de 2 minutos.
            </p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto relative">
          {/* Connecting line */}
          <div className="absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-violet-500/40 via-purple-500/60 to-fuchsia-500/40 hidden md:block" />

          {steps.map((s, i) => (
            <AnimateIn key={i} delay={i * 150}>
              <div className="text-center group cursor-default">
                <div className="relative mx-auto w-24 h-24 mb-6">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500/15 to-purple-500/15 border border-violet-500/25 flex items-center justify-center mx-auto group-hover:border-violet-400/60 group-hover:shadow-lg group-hover:shadow-violet-500/20 transition-all duration-300">
                    <s.icon className="h-10 w-10 text-violet-400" />
                  </div>
                  <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-xs font-black shadow-lg shadow-violet-500/30">
                    {s.n}
                  </div>
                </div>
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════
          FEATURES
      ════════════════════════════════ */}
      <section id="funcionalidades" className="container mx-auto px-4 py-28">
        <AnimateIn>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-4">
              <Sparkles className="h-3.5 w-3.5" />
              Tudo que você precisa
            </div>
            <h2 className="text-3xl md:text-5xl font-black mb-4">Sua IA faz tudo isso</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Módulos inteligentes que se adaptam ao seu jeito de viver.
            </p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <AnimateIn key={i} delay={i * 80}>
              <div
                className={`group relative h-full p-6 rounded-2xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05] transition-all duration-300 hover:border-white/10 hover:-translate-y-1.5 hover:shadow-xl ${f.glow} cursor-default overflow-hidden`}
              >
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-5 shadow-lg`}
                >
                  <f.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-bold mb-2 text-white">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                {/* Subtle gradient overlay on hover */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300 pointer-events-none rounded-2xl`}
                />
              </div>
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════
          TESTIMONIALS
      ════════════════════════════════ */}
      <section className="container mx-auto px-4 py-28">
        <AnimateIn>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm font-medium mb-4">
              <Star className="h-3.5 w-3.5 fill-yellow-300" />
              Depoimentos reais
            </div>
            <h2 className="text-3xl md:text-5xl font-black mb-4">Quem usa, ama</h2>
            <p className="text-slate-400">Veja o que nossos usuários estão dizendo</p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((t, i) => (
            <AnimateIn key={i} delay={i * 120}>
              <div className="p-6 rounded-2xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045] transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
                <div className="flex items-center gap-0.5 mb-5">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-slate-300 text-sm leading-relaxed flex-1 mb-6">
                  "{t.text}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">{t.name}</div>
                    <div className="text-slate-500 text-xs">{t.role}</div>
                  </div>
                </div>
              </div>
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════
          PRICING
      ════════════════════════════════ */}
      <section id="planos" className="container mx-auto px-4 py-28">
        <AnimateIn>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-medium mb-4">
              <Shield className="h-3.5 w-3.5" />
              Sem surpresas
            </div>
            <h2 className="text-3xl md:text-5xl font-black mb-4">Planos e preços</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Sem fidelidade. Cancele quando quiser.
            </p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto items-center">
          {plans.map((p, i) => (
            <AnimateIn key={i} delay={i * 80}>
              <div
                className={`relative p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1.5 ${
                  p.highlight
                    ? "border border-violet-500/50 bg-gradient-to-b from-violet-500/10 to-purple-500/5 shadow-2xl shadow-violet-500/15 md:scale-105"
                    : "border border-white/[0.06] bg-white/[0.025] hover:border-white/10"
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <div className="px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-bold shadow-xl shadow-violet-500/40 animate-pulse">
                      ✨ Mais popular
                    </div>
                  </div>
                )}

                <div className="text-slate-400 font-medium mb-2">{p.name}</div>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-slate-500 text-sm">R$</span>
                  <span className="text-5xl font-black text-white leading-none">{p.price}</span>
                  <span className="text-slate-500 text-sm pb-1">/mês</span>
                </div>
                <div className="text-slate-500 text-sm mb-7">{p.msgs}</div>

                <ul className="space-y-3 mb-8">
                  {p.features.map((feat, j) => (
                    <li key={j} className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                        <Check className="h-3 w-3 text-violet-400" />
                      </div>
                      <span className="text-slate-300">{feat}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full ${
                    p.highlight
                      ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 border-0 shadow-lg shadow-violet-500/30"
                      : "bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20"
                  }`}
                  asChild
                >
                  <Link to="/signup">{p.cta}</Link>
                </Button>
              </div>
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════
          FAQ
      ════════════════════════════════ */}
      <section className="container mx-auto px-4 py-20 max-w-3xl">
        <AnimateIn>
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Perguntas frequentes</h2>
            <p className="text-slate-400">Tudo que você precisa saber</p>
          </div>
        </AnimateIn>
        <AnimateIn delay={100}>
          <Accordion type="single" collapsible className="space-y-2">
            {faqs.map((f, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border border-white/[0.06] rounded-xl px-5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <AccordionTrigger className="text-left hover:no-underline text-white/90 hover:text-white font-medium py-4">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-slate-400 leading-relaxed pb-4">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </AnimateIn>
      </section>

      {/* ════════════════════════════════
          FINAL CTA
      ════════════════════════════════ */}
      <section className="container mx-auto px-4 py-20">
        <AnimateIn>
          <div className="relative overflow-hidden rounded-3xl p-12 md:p-20 text-center border border-violet-500/20 bg-gradient-to-br from-violet-900/50 via-purple-900/30 to-slate-900">
            {/* BG orbs inside CTA */}
            <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
              <div className="absolute -top-1/2 -left-1/4 w-[500px] h-[500px] rounded-full bg-violet-600/15 blur-3xl animate-float" />
              <div className="absolute -bottom-1/2 -right-1/4 w-[400px] h-[400px] rounded-full bg-fuchsia-600/15 blur-3xl animate-[float_10s_ease-in-out_infinite_3s]" />
            </div>

            <div className="relative">
              <div className="flex items-center justify-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-violet-400" />
                <span className="text-violet-300 text-sm font-medium">+1.200 pessoas já transformaram sua rotina</span>
              </div>
              <h2 className="text-4xl md:text-6xl font-black mb-4 leading-tight">
                Comece hoje,{" "}
                <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                  de graça
                </span>{" "}
                🚀
              </h2>
              <p className="text-slate-300 text-lg mb-10 max-w-xl mx-auto">
                Sua IA pessoal no WhatsApp está a um clique de distância.
                Configure em 2 minutos e comece a usar agora.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  size="lg"
                  className="text-base px-10 py-6 bg-white text-violet-900 hover:bg-slate-100 font-bold shadow-2xl shadow-black/30 group"
                  asChild
                >
                  <Link to="/signup">
                    Criar minha conta grátis
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </div>
              <p className="text-slate-500 text-sm mt-5">
                Sem cartão de crédito. Sem fidelidade. Cancele quando quiser.
              </p>
            </div>
          </div>
        </AnimateIn>
      </section>

      {/* ════════════════════════════════
          FOOTER
      ════════════════════════════════ */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <MessageCircle className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-bold text-white">MayaChat</span>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-500">
            <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
            <a href="#funcionalidades" className="hover:text-white transition-colors">Funcionalidades</a>
            <a href="#planos" className="hover:text-white transition-colors">Planos</a>
            <Link to="/login" className="hover:text-white transition-colors">Entrar</Link>
            <Link to="/signup" className="hover:text-white transition-colors">Criar conta</Link>
          </div>
          <p className="text-xs text-slate-600">© 2026 MayaChat. Todos os direitos reservados.</p>
        </div>
      </footer>

    </div>
  );
}
