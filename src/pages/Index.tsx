import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  MessageCircle, Check, ArrowRight,
  Star, Shield, Sparkles, Mic, Camera, Lock, RefreshCw,
  ChevronDown, BarChart3, FileText, Table2, Zap, CalendarDays,
  Menu, X,
} from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.webp";
import logoIcon from "@/assets/logo_icon.webp";
import logoGif from "@/assets/logo_gif.gif";
import googleAgendaImg from "@/assets/google_agenda.png";
import googleSheetsImg from "@/assets/google_sheets.png";
import notionImg from "@/assets/notion_logo.png";

/* ─────────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────────── */
type ChatLine = { from: "user" | "jarvis"; text: string; pause?: number };
type Accent   = "emerald" | "violet" | "amber" | "sky" | "pink";

/* ─────────────────────────────────────────────────────────────────────────────
   CHAT DATA
───────────────────────────────────────────────────────────────────────────── */
const CHAT_FINANCEIRO: ChatLine[] = [
  { from: "user",  text: "gastei 50 reais no mercado hoje",                           pause: 700  },
  { from: "jarvis",  text: "🔴 Registrado!\n📝 Mercado\n💰 R$ 50,00\n📂 Alimentação ✅", pause: 900  },
  { from: "user",  text: "recebi 2 mil de salário",                                   pause: 700  },
  { from: "jarvis",  text: "🟢 Receita salva!\n📝 Salário\n💰 R$ 2.000,00 ✅",          pause: 900  },
  { from: "user",  text: "paguei 120 de conta de luz",                                pause: 600  },
  { from: "jarvis",  text: "🔴 Registrado!\n📝 Conta de luz\n💰 R$ 120,00\n📂 Moradia ✅", pause: 900 },
  { from: "user",  text: "quanto gastei essa semana?",                                pause: 600  },
  { from: "jarvis",  text: "📊 Esta semana:\n🔴 Total: R$ 480,00\n\n🍔 Alimentação: R$ 220\n🏠 Moradia: R$ 120\n🚗 Transporte: R$ 85\n📦 Outros: R$ 55", pause: 0 },
];

const CHAT_COMPROMISSOS: ChatLine[] = [
  { from: "user",  text: "marca dentista segunda 10h",                                pause: 700  },
  { from: "jarvis",  text: "✅ Agendado!\n📅 Dentista — Seg, 07/04\n⏰ 10:00\n🔔 Lembro 1h antes\n📆 Google Calendar ✅", pause: 900 },
  { from: "user",  text: "reunião com equipe quinta 14h",                             pause: 700  },
  { from: "jarvis",  text: "✅ Salvo!\n📅 Reunião equipe — Qui, 10/04\n⏰ 14:00 ✅",     pause: 900  },
  { from: "user",  text: "almoço com minha mãe sábado meio-dia",                     pause: 700  },
  { from: "jarvis",  text: "✅ Anotado!\n📅 Almoço com mamãe — Sáb, 12/04\n⏰ 12:00\n🔔 Aviso às 11:30 ✅", pause: 900 },
  { from: "user",  text: "o que tenho amanhã?",                                       pause: 600  },
  { from: "jarvis",  text: "📅 Amanhã, quarta:\n\n📌 Call diária — 09:00\n📌 Almoço Pedro — 12:30\n📌 Academia — 18:30\n📌 Série com Ju — 21:00", pause: 0 },
];

const CHAT_AUDIO: ChatLine[] = [
  { from: "user",  text: "🎤 áudio 0:09",                                             pause: 600  },
  { from: "jarvis",  text: "🎤 Transcrição:\n\"gastei 80 de jantar ontem no rodízio\"\n\n🔴 Jantar rodízio — R$ 80,00\n📂 Alimentação ✅", pause: 1000 },
  { from: "user",  text: "🎤 áudio 0:05",                                             pause: 600  },
  { from: "jarvis",  text: "🎤 Transcrição:\n\"recebi 500 de freela\"\n\n🟢 Freela — R$ 500,00\n📂 Receita ✅", pause: 900  },
  { from: "user",  text: "📸 [foto da nota fiscal]",                                  pause: 700  },
  { from: "jarvis",  text: "📸 Nota fiscal lida!\n🛒 Supermercado Extra\n💰 R$ 143,60\n📂 Alimentação ✅\n\n📋 Itens detectados: 8 produtos", pause: 0 },
];

const CHAT_LEMBRETES: ChatLine[] = [
  { from: "user",  text: "me lembra amanhã 7h da academia",                           pause: 700  },
  { from: "jarvis",  text: "⏰ Criado!\n📌 Academia\n📅 Amanhã às 07:00\nVai arrasar! 💪", pause: 900 },
  { from: "user",  text: "todo dia 5 me lembra de pagar a internet",                  pause: 700  },
  { from: "jarvis",  text: "🔁 Lembrete recorrente!\n📌 Pagar internet\n📅 Todo dia 5 do mês ✅", pause: 900 },
  { from: "user",  text: "lembra eu de ligar pra minha mãe no domingo às 18h",       pause: 700  },
  { from: "jarvis",  text: "🔁 Toda semana!\n📌 Ligar pra mamãe\n📅 Domingo às 18:00 ✅", pause: 0  },
];

const CHAT_HERO: ChatLine[] = [
  { from: "user",  text: "gastei 45 de gasolina",                                     pause: 700  },
  { from: "jarvis",  text: "🔴 Registrado!\n📝 Gasolina\n💰 R$ 45,00\n📂 Transporte ✅", pause: 900 },
  { from: "user",  text: "marca reunião amanhã 14h",                                  pause: 700  },
  { from: "jarvis",  text: "✅ Agendado!\n📅 Reunião — Amanhã às 14:00\n🔔 Lembro 30 min antes ✅", pause: 900 },
  { from: "user",  text: "me lembra dia 10 de pagar aluguel",                         pause: 700  },
  { from: "jarvis",  text: "🔁 Lembrete mensal criado!\n📌 Pagar aluguel\n📅 Todo dia 10 ✅",       pause: 900 },
  { from: "user",  text: "quanto gastei esse mês?",                                   pause: 700  },
  { from: "jarvis",  text: "📊 Abril até agora:\n🔴 Gastos: R$ 1.820,00\n🟢 Receitas: R$ 4.500,00\n💰 Saldo: R$ 2.680,00 ✅", pause: 0 },
];

const FAQS = [
  { q: "Como funciona a assinatura?",     a: "Você assina por R$29,90/mês e tem acesso imediato a tudo. Sem fidelidade, sem burocracia. Cancele quando quiser direto pelo app." },
  { q: "Meus dados são seguros?",          a: "Sim. Criptografia AES-256, servidores no Brasil. Seus dados são seus e nunca são compartilhados com terceiros." },
  { q: "Funciona com qualquer WhatsApp?",  a: "Sim, pessoal ou Business, qualquer número brasileiro." },
  { q: "Posso cancelar quando quiser?",    a: "Sim, sem fidelidade e sem burocracia. Cancele direto pelo app a qualquer momento." },
  { q: "O Jarvis responde rápido?",          a: "Em segundos, 24 horas por dia, 7 dias por semana, feriados incluídos." },
  { q: "Funciona com áudio e foto?",       a: "Sim! Mande áudio e o Jarvis transcreve e registra. Fotografe nota fiscal e ele extrai o valor e categoriza automaticamente." },
];

const PLAN_FEATURES = [
  "Controle financeiro ilimitado",
  "Registro por texto, áudio e foto",
  "Agenda e compromissos",
  "Lembretes recorrentes ilimitados",
  "Anotações e notas rápidas",
  "Transcrição de áudios",
  "Leitura de notas fiscais",
  "Integração Google Calendar",
  "Integração Google Sheets",
  "Integração Notion",
  "Relatórios semanais e mensais",
  "Dashboard completo no app",
  "Suporte via WhatsApp",
];

/* ─────────────────────────────────────────────────────────────────────────────
   LOGO COMPONENTS (fallback quando imagens não estão na pasta public/)
───────────────────────────────────────────────────────────────────────────── */
function LogoFull() {
  return (
    <img src={logoEscrita} alt="Hey Jarvis" className="h-8 w-auto object-contain" />
  );
}

function ChatAvatar() {
  return (
    <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 border border-white/10 bg-[#16162a]">
      <img src={logoIcon} alt="Hey Jarvis" width={36} height={36} className="w-full h-full object-contain p-1" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   ATOMS
───────────────────────────────────────────────────────────────────────────── */
function Stars() {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

function AnimateIn({
  children, delay = 0, from = "bottom", className = "",
}: {
  children: React.ReactNode; delay?: number;
  from?: "bottom" | "left" | "right" | "scale"; className?: string;
}) {
  const ref  = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const init = { bottom: "translateY(32px)", left: "translateX(-32px)", right: "translateX(32px)", scale: "scale(0.94)" }[from];
  return (
    <div ref={ref} className={className}
      style={{ transform: vis ? "none" : init, opacity: vis ? 1 : 0,
        transition: `transform .65s cubic-bezier(.16,1,.3,1) ${delay}ms, opacity .6s ease ${delay}ms` }}>
      {children}
    </div>
  );
}

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref     = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - t0) / 1800, 1);
          setV(Math.floor((1 - Math.pow(1 - p, 3)) * to));
          if (p < 1) requestAnimationFrame(tick); else setV(to);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{v.toLocaleString("pt-BR")}{suffix}</span>;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(o => !o)}
      className="w-full text-left rounded-xl border border-white/8 bg-white/[0.02] px-5 py-4 hover:border-white/15 hover:bg-white/[0.04] transition-all duration-200 group">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] font-medium text-white group-hover:text-violet-300 transition-colors">{q}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform duration-300 ${open ? "rotate-180 text-violet-400" : ""}`} />
      </div>
      <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: open ? "200px" : 0, opacity: open ? 1 : 0 }}>
        <p className="mt-3 text-[13px] text-gray-400 leading-relaxed">{a}</p>
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   AUTO CHAT — plays once on scroll entry
───────────────────────────────────────────────────────────────────────────── */
function AutoChat({ lines, accent = "violet" }: { lines: ChatLine[]; accent?: Accent }) {
  const [shown,  setShown]  = useState<number[]>([]);
  const [typing, setTyping] = useState(false);
  const rootRef   = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started   = useRef(false);

  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let delay = 500;
        lines.forEach((line, i) => {
          if (line.from === "jarvis") {
            setTimeout(() => setTyping(true),  delay);
            setTimeout(() => { setTyping(false); setShown(p => [...p, i]); }, delay + 820);
            delay += 820 + (line.pause ?? 1000);
          } else {
            setTimeout(() => setShown(p => [...p, i]), delay);
            delay += line.pause ?? 700;
          }
        });
      }
    }, { threshold: 0.2 });
    io.observe(el); return () => io.disconnect();
  }, [lines]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, typing]);

  const bubbleUser: Record<Accent, string> = {
    emerald: "bg-emerald-600",
    violet:  "bg-violet-600",
    amber:   "bg-amber-500",
    sky:     "bg-sky-600",
    pink:    "bg-pink-600",
  };
  const dotColor: Record<Accent, string> = {
    emerald: "bg-emerald-400",
    violet:  "bg-violet-400",
    amber:   "bg-amber-400",
    sky:     "bg-sky-400",
    pink:    "bg-pink-400",
  };
  const glowColor: Record<Accent, string> = {
    emerald: "bg-emerald-500/10",
    violet:  "bg-violet-500/10",
    amber:   "bg-amber-500/10",
    sky:     "bg-sky-500/10",
    pink:    "bg-pink-500/10",
  };

  return (
    <div ref={rootRef} className="relative w-full max-w-[380px] mx-auto">
      <div className={`absolute -inset-6 -z-10 ${glowColor[accent]} blur-3xl rounded-full hidden md:block`} />
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden shadow-2xl shadow-black/60">
        {/* WA header */}
        <div className="flex items-center gap-2.5 px-4 py-3 bg-[#16162a] border-b border-white/[0.06]">
          <ChatAvatar />
          <div>
            <p className="text-[12px] font-semibold text-white leading-none mb-0.5">Hey Jarvis</p>
            <p className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className={`w-1.5 h-1.5 ${dotColor[accent]} rounded-full animate-pulse`} />online agora
            </p>
          </div>
        </div>
        {/* messages with bg */}
        <div
          ref={scrollRef}
          className="px-3 py-3 space-y-2.5 h-[260px] overflow-y-auto"
          style={{
            background: "rgb(8,8,16)",
            scrollbarWidth: "none",
          }}
        >
          {lines.map((line, i) => shown.includes(i) && (
            <div key={i} className={`flex animate-slide-up-fade ${line.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[84%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed whitespace-pre-line ${
                line.from === "user"
                  ? `${bubbleUser[accent]} text-white rounded-tr-sm`
                  : "bg-[#1e1e30] text-gray-200 rounded-tl-sm border border-white/[0.07]"
              }`}>{line.text}</div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start animate-slide-up-fade">
              <div className="bg-[#1e1e30] border border-white/[0.07] px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
                {[0,1,2].map(i => (
                  <span key={i} className={`w-1.5 h-1.5 ${dotColor[accent]} rounded-full animate-bounce`}
                    style={{ animationDelay: `${i*140}ms` }} />
                ))}
              </div>
            </div>
          )}
        </div>
        {/* input strip */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-2 bg-[#0b0b12]">
          <div className="flex-1 bg-white/[0.04] rounded-full px-3 py-1.5 text-[11px] text-gray-600 border border-white/[0.04]">
            Mande uma mensagem...
          </div>
          <div className={`w-7 h-7 rounded-full ${bubbleUser[accent]} flex items-center justify-center flex-shrink-0`}>
            <Mic className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   HERO PHONE MOCKUP
───────────────────────────────────────────────────────────────────────────── */
function HeroPhone() {
  const [msgs,   setMsgs]   = useState<Array<ChatLine & { id: number }>>([]);
  const [typing, setTyping] = useState(false);
  const [cycle,  setCycle]  = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([]); setTyping(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 600;
    CHAT_HERO.forEach((line, i) => {
      if (line.from === "jarvis") {
        timers.push(setTimeout(() => setTyping(true), delay));
        timers.push(setTimeout(() => {
          setTyping(false); setMsgs(p => [...p, { ...line, id: p.length }]);
        }, delay + 800));
        delay += 800 + (line.pause ?? 1000);
      } else {
        timers.push(setTimeout(() => setMsgs(p => [...p, { ...line, id: p.length }]), delay));
        delay += line.pause ?? 700;
      }
    });
    // Restart up to 2 more cycles (3 total) then stop — prevents infinite timer chains
    if (cycle < 2) timers.push(setTimeout(() => setCycle(c => c + 1), delay + 2000));
    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <div className="relative w-[300px] select-none mx-auto">
      <div className="absolute -inset-10 -z-10 bg-violet-600/18 blur-3xl rounded-full hidden md:block" />
      {/* shell */}
      <div className="rounded-[2.4rem] border border-white/10 bg-[#0b0b12] shadow-[0_32px_90px_rgba(0,0,0,.70)] overflow-hidden">
        {/* status */}
        <div className="relative h-9 flex items-center px-6 justify-between bg-[#0b0b12]">
          <span className="text-[10px] text-gray-400">{hhmm}</span>
          <div className="absolute left-1/2 -translate-x-1/2 w-20 h-[18px] bg-black rounded-full" />
          <div className="w-4 h-2 border border-gray-500 rounded-[2px] flex items-center px-px">
            <div className="h-full bg-gray-400 rounded-[1px]" style={{ width: "70%" }} />
          </div>
        </div>
        {/* header */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#16162a] border-b border-white/[0.06]">
          <ChatAvatar />
          <div>
            <p className="text-[11px] font-semibold text-white leading-none mb-0.5">Hey Jarvis</p>
            <p className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />online
            </p>
          </div>
        </div>
        {/* msgs */}
        <div
          ref={scrollRef}
          className="h-[310px] overflow-y-auto flex flex-col px-3 py-3 gap-2"
          style={{
            background: "rgb(8,8,16)",
            scrollbarWidth: "none",
          }}
        >
          {msgs.map(m => (
            <div key={m.id} className={`flex animate-slide-up-fade ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-[11px] leading-relaxed whitespace-pre-line ${
                m.from === "user"
                  ? "bg-violet-600 text-white rounded-tr-sm"
                  : "bg-[#1e1e30] text-gray-200 rounded-tl-sm border border-white/[0.07]"
              }`}>{m.text}</div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start animate-slide-up-fade">
              <div className="bg-[#1e1e30] border border-white/[0.07] px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1">
                {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${i*140}ms` }} />)}
              </div>
            </div>
          )}
        </div>
        {/* input */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[#0b0b12] border-t border-white/[0.06]">
          <div className="flex-1 bg-white/[0.05] rounded-full px-3 py-1.5 text-[10px] text-gray-600">Mande uma mensagem...</div>
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
            <Mic className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   GIF PHONE — exibe o GIF/vídeo diretamente (o próprio GIF já é o celular)

   Usa animated WebP com alpha para TODOS os browsers:
   - Chrome 32+, Firefox 65+, Safari 14+/iOS 14+, Edge 18+ suportam WebP animado
   - <img> com WebP é mais simples e universal que <video> com alpha
   - VP9 alpha no <video> não é confiável no Safari/iOS mesmo em versões recentes
   - Os .webp foram gerados com -pix_fmt yuva420p (alpha confirmado nos chunks VP8X+ALPH)
───────────────────────────────────────────────────────────────────────────── */
function GifPhone({ src, alt }: { src: string; alt: string }) {
  const webpSrc = src.replace(/\.(webm|mp4)$/, ".webp");
  return (
    <div className="relative select-none mx-auto" style={{ maxWidth: "320px" }}>
      <div className="absolute -inset-10 -z-10 bg-violet-600/18 blur-3xl rounded-full hidden md:block" />
      <img
        src={webpSrc}
        alt={alt}
        className="w-full"
        style={{ display: "block" }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   DASHBOARD MOCKUP
───────────────────────────────────────────────────────────────────────────── */
function DashboardMock() {
  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="absolute -inset-4 -z-10 bg-indigo-600/10 blur-3xl rounded-full hidden md:block" />
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#16162a] border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <span className="text-[12px] font-semibold text-white">Dashboard</span>
          </div>
          <span className="text-[10px] text-gray-500">Abril 2026</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-gradient-to-r from-indigo-500/15 to-violet-500/10 border border-indigo-500/20 p-4">
            <p className="text-[11px] text-gray-400 mb-1">Saldo do mês</p>
            <p className="text-2xl font-extrabold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              R$ 2.680,00
            </p>
            <p className="text-[11px] text-emerald-400 mt-1">↑ 18% vs mês anterior</p>
          </div>
          <div>
            <p className="text-[11px] text-gray-500 mb-2.5">Gastos por categoria</p>
            <div className="space-y-2">
              {[
                { label: "🍔 Alimentação", val: 380, max: 650, color: "bg-emerald-500" },
                { label: "🚗 Transporte",  val: 210, max: 650, color: "bg-sky-500"     },
                { label: "🏠 Moradia",     val: 650, max: 650, color: "bg-violet-500"  },
              ].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>{r.label}</span><span>R$ {r.val}</span>
                  </div>
                  <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div className={`h-full ${r.color} rounded-full transition-all duration-1000`}
                      style={{ width: `${(r.val / r.max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {[
              { icon: "🛒", desc: "Mercado Extra",  val: "R$ 180",  cls: "text-red-400"      },
              { icon: "💼", desc: "Salário",         val: "+R$ 4.500", cls: "text-emerald-400" },
              { icon: "⛽", desc: "Gasolina",        val: "R$ 95",   cls: "text-red-400"      },
            ].map(t => (
              <div key={t.desc} className="flex items-center justify-between text-[11px] py-1 border-b border-white/[0.04]">
                <div className="flex items-center gap-2 text-gray-300">
                  <span>{t.icon}</span>{t.desc}
                </div>
                <span className={`font-semibold ${t.cls}`}>{t.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   CATEGORIES VISUAL
───────────────────────────────────────────────────────────────────────────── */
function CategoriesVisual() {
  const cats = [
    { emoji: "🍔", name: "Alimentação", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    { emoji: "🚗", name: "Transporte",  color: "border-sky-500/30 bg-sky-500/10 text-sky-300"             },
    { emoji: "🏠", name: "Moradia",     color: "border-violet-500/30 bg-violet-500/10 text-violet-300"    },
    { emoji: "💊", name: "Saúde",       color: "border-red-500/30 bg-red-500/10 text-red-300"             },
    { emoji: "🎮", name: "Lazer",       color: "border-amber-500/30 bg-amber-500/10 text-amber-300"       },
    { emoji: "📚", name: "Educação",    color: "border-pink-500/30 bg-pink-500/10 text-pink-300"          },
    { emoji: "💼", name: "Trabalho",    color: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"    },
    { emoji: "✨", name: "Personalizada",color: "border-gray-400/30 bg-gray-400/10 text-gray-300"         },
  ];
  return (
    <div className="relative w-full max-w-sm mx-auto">
      <div className="absolute -inset-4 -z-10 bg-pink-600/10 blur-3xl rounded-full hidden md:block" />
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden shadow-2xl shadow-black/50 p-5">
        <p className="text-[12px] font-semibold text-gray-400 mb-3">Categorias disponíveis</p>
        <div className="flex flex-wrap gap-2">
          {cats.map(c => (
            <AnimateIn key={c.name} from="scale" delay={cats.indexOf(c) * 40}>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium ${c.color}`}>
                {c.emoji} {c.name}
              </span>
            </AnimateIn>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-pink-500/10 border border-pink-500/20 px-3 py-2.5 text-[11px] text-pink-300">
          ✨ Crie categorias personalizadas ilimitadas
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION WRAPPER
───────────────────────────────────────────────────────────────────────────── */
function Section({ children, id, className = "" }: {
  children: React.ReactNode; id?: string; className?: string;
}) {
  return (
    <section id={id} className={`py-20 lg:py-24 px-4 overflow-hidden ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   BACKGROUND
───────────────────────────────────────────────────────────────────────────── */
function Background() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.016]"
        style={{ backgroundImage: "radial-gradient(circle,#ffffff 1px,transparent 1px)", backgroundSize: "32px 32px" }} />
      {/* Orb animations hidden on mobile — too GPU-intensive on low-end devices */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden hidden md:block">
        <div className="absolute -top-56 -left-56 w-[700px] h-[700px] rounded-full bg-violet-700/12 blur-[140px] animate-orb-drift" />
        <div className="absolute top-1/2 -right-56 w-[500px] h-[500px] rounded-full bg-purple-600/9 blur-[110px] animate-orb-drift"
          style={{ animationDelay: "3s", animationDuration: "16s" }} />
        <div className="absolute bottom-0 left-1/3 w-[400px] h-[400px] rounded-full bg-indigo-700/8 blur-[90px] animate-orb-drift"
          style={{ animationDelay: "6s", animationDuration: "20s" }} />
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PRICING SECTION — monthly / annual toggle with animated counter
───────────────────────────────────────────────────────────────────────────── */
function AnimatedPrice({ value, suffix }: { value: number; suffix: string }) {
  const [displayed, setDisplayed] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    const t0 = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayed(Math.round(from + (to - from) * ease) / 100 * 100 === 0 ? from + (to - from) * ease : from + (to - from) * ease);
      if (p < 1) requestAnimationFrame(tick);
      else setDisplayed(to);
    };
    requestAnimationFrame(tick);
  }, [value]);

  const formatted = displayed % 1 === 0
    ? displayed.toLocaleString("pt-BR")
    : displayed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <span className="text-[54px] font-extrabold text-white leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      R${formatted}
      <span className="text-gray-400 text-[14px] font-normal ml-1">{suffix}</span>
    </span>
  );
}

function PricingSection() {
  const [annual, setAnnual] = useState(false);

  const price = annual ? 287 : 29.90;
  const oldPrice = annual ? "R$ 1.198" : "R$ 99,90";
  const suffix = annual ? "/ano" : "/mês";
  const link = annual
    ? "https://pay.kirvano.com/59bde07b-9a4a-41a6-9009-48bb1e37c364"
    : "https://pay.kirvano.com/4a308234-3702-4233-9d2a-4dce73bf0d2b";
  const subtext = annual ? "Equivale a R$23,92/mês" : "Menos de R$1 por dia";

  return (
    <section id="planos" className="py-28 px-4">
      <div className="max-w-lg mx-auto">
        <AnimateIn>
          <div className="text-center mb-10">
            <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Um plano. Acesso a tudo.
            </h2>
            <p className="mt-3 text-[15px] text-gray-400">
              Sem nível básico, sem funcionalidade bloqueada. Tudo incluso desde o primeiro dia.
            </p>

            {/* Toggle mensal/anual */}
            <div className="mt-6 inline-flex items-center bg-white/[0.04] border border-white/10 rounded-full p-1 gap-0">
              <button
                onClick={() => setAnnual(false)}
                className={`px-5 py-2 rounded-full text-[13px] font-medium transition-all duration-300 ${
                  !annual ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-500/25" : "text-gray-400 hover:text-white"
                }`}
              >
                Mensal
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`px-5 py-2 rounded-full text-[13px] font-medium transition-all duration-300 ${
                  annual ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-500/25" : "text-gray-400 hover:text-white"
                }`}
              >
                Anual
              </button>
            </div>
          </div>
        </AnimateIn>

        <AnimateIn from="scale" delay={80}>
          <div className="relative rounded-2xl border border-violet-500/40 bg-[#0d0d1a] overflow-hidden shadow-2xl shadow-violet-500/10">
            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-white" />
              <span className="text-[13px] font-bold text-white tracking-wide">Hey Jarvis Completo</span>
            </div>

            <div className="p-8">
              <div className="mb-2">
                <p className="text-[14px] text-gray-500 line-through mb-1">DE {oldPrice}</p>
                <div className="flex items-end gap-1 mb-1">
                  <AnimatedPrice value={price} suffix={suffix} />
                </div>
                <p className="text-[13px] text-emerald-400">{subtext}</p>
              </div>
              <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[12px] font-medium px-3 py-1.5 rounded-full mb-6 mt-3">
                <Check className="w-3 h-3" /> Acesso imediato após assinar
              </div>

              <div className="grid grid-cols-1 gap-2 mb-8">
                {PLAN_FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-4 h-4 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-violet-400" />
                    </div>
                    {f}
                  </div>
                ))}
              </div>

              <Button size="lg" asChild className="w-full group relative overflow-hidden bg-gradient-to-r from-violet-600 via-purple-600 to-violet-600 bg-[length:200%_100%] md:animate-shimmer-slow hover:shadow-violet-500/50 text-white h-14 rounded-xl shadow-xl shadow-violet-500/30 hover:-translate-y-0.5 transition-all duration-300 font-bold text-[16px] border border-violet-400/20">
                <a href={link} target="_blank" rel="noreferrer">
                  <span className="relative z-10 flex items-center gap-2">
                    Começar agora
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" />
                  </span>
                </a>
              </Button>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[12px] text-gray-500">
                <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" />Sem contrato</span>
                <span className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" />Dados seguros</span>
                <span className="flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" />Cancele quando quiser</span>
              </div>
            </div>
          </div>
        </AnimateIn>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function Index() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <div className="min-h-screen bg-[#03030a] text-white overflow-x-hidden">
      <Background />

      {/* ══ ANNOUNCEMENT BAR ══════════════════════════════════════════════ */}
      <div className="relative z-50 bg-gradient-to-r from-violet-600/30 to-purple-600/30 border-b border-violet-500/20 py-2 text-center text-[12px]">
        <span className="text-violet-200">Menos de R$1 por dia para ter um assistente pessoal 24h</span>
      </div>

      {/* ══ NAVBAR ════════════════════════════════════════════════════════ */}
      <header className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled ? "bg-[#03030a]/90 backdrop-blur-2xl border-b border-white/[0.06] shadow-lg shadow-black/20" : "bg-transparent"
      }`}>
        <div className="max-w-6xl mx-auto px-4 h-15 flex items-center justify-between py-3">
          <LogoFull />
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-gray-400">
            {[["#como-funciona","Como funciona"],["#planos","Planos"],["#faq","FAQ"]].map(([h,l]) => (
              <a key={h} href={h} className="hover:text-white transition-colors relative group">
                {l}
                <span className="absolute -bottom-0.5 left-0 w-0 group-hover:w-full h-px bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-300" />
              </a>
            ))}
          </nav>
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-white/8" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button size="sm" asChild
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-lg shadow-lg shadow-violet-500/25 hover:-translate-y-px transition-all duration-200">
              <a href="#planos">Assinar agora</a>
            </Button>
          </div>
          {/* Mobile hamburger */}
          <button
            className="sm:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/8 transition-colors"
            onClick={() => setMobileMenuOpen(o => !o)}
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
          </button>
        </div>
        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="sm:hidden absolute top-full left-0 right-0 bg-[#03030a]/95 backdrop-blur-xl border-b border-white/[0.06] px-4 py-4 space-y-2 animate-slide-up-fade">
            <Button variant="ghost" size="sm" className="w-full justify-center text-violet-300 hover:text-white bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/20 rounded-lg" asChild>
              <Link to="/login" onClick={() => setMobileMenuOpen(false)}>Login</Link>
            </Button>
            <Button size="sm" asChild
              className="w-full justify-center bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-lg shadow-lg shadow-violet-500/25">
              <a href="#planos" onClick={() => setMobileMenuOpen(false)}>Assinar agora</a>
            </Button>
          </div>
        )}
      </header>

      {/* ══ HERO ══════════════════════════════════════════════════════════ */}
      <section className="relative pt-16 pb-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <AnimateIn delay={0}>
              <img src={logoGif} alt="Maya logo animada" className="w-24 h-24 mx-auto mb-4" />
              <p className="text-[13px] font-semibold text-violet-400 mb-4 tracking-wide uppercase">
                Assistente pessoal no seu WhatsApp
              </p>
            </AnimateIn>
            <AnimateIn delay={80}>
              <h1 className="text-[48px] md:text-[60px] lg:text-[68px] font-extrabold leading-[1.06] tracking-tight"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Você ainda cuida<br />
                <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  de tudo sozinho?
                </span>
              </h1>
            </AnimateIn>
            <AnimateIn delay={160}>
              <p className="mt-5 text-[17px] text-gray-400 leading-relaxed max-w-xl mx-auto">
                O Jarvis organiza suas finanças, gerencia sua agenda e te lembra de tudo o que importa. Tudo isso direto pelo WhatsApp.
              </p>
            </AnimateIn>
            <AnimateIn delay={240}>
              <div className="flex flex-wrap justify-center gap-3 mt-8">
                {[
                  { icon: Shield,       text: "Dados 100% seguros",  cls: "border-white/10 bg-white/[0.03] text-gray-300" },
                  { icon: Zap,          text: "Responde em segundos", cls: "border-violet-500/30 bg-violet-500/8 text-violet-300" },
                  { icon: MessageCircle,text: "100% no WhatsApp",     cls: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" },
                ].map(b => (
                  <div key={b.text} className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-[12px] font-medium ${b.cls}`}>
                    <b.icon className="w-3.5 h-3.5" />{b.text}
                  </div>
                ))}
              </div>
            </AnimateIn>
            <AnimateIn delay={320}>
              <div className="mt-5 flex items-center gap-2 justify-center">
                <Stars />
                <span className="font-semibold text-[13px]">4.9</span>
                <span className="text-gray-500 text-[13px]">· +1.200 usuários ativos</span>
              </div>
            </AnimateIn>
          </div>

          <AnimateIn from="scale" delay={120}>
            <GifPhone src="/gifs/gif-inicial.webm" alt="Jarvis no WhatsApp" />
          </AnimateIn>
        </div>
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-[#03030a] to-transparent pointer-events-none" />
      </section>

      {/* ══ BAND — CHEGA DE FAZER MALABARES ═══════════════════════════════ */}
      <section id="como-funciona" className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-700/25 via-purple-700/18 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#03030a] via-transparent to-[#03030a]" />
        <div className="relative max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <AnimateIn from="left">
              <div>
                <p className="text-[13px] text-violet-400 font-semibold uppercase tracking-widest mb-4">Pra quem não tem tempo de lembrar de tudo</p>
                <h2 className="text-[44px] md:text-[52px] font-extrabold leading-tight tracking-tight"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Ela trabalha.{" "}
                  <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                    Você vive.
                  </span>
                </h2>
              </div>
            </AnimateIn>
            <AnimateIn from="right" delay={120}>
              <div className="space-y-5">
                <p className="text-[16px] text-gray-300 leading-relaxed">
                  Trabalho, família, contas, compromissos. A maioria das pessoas vive apagando incêndio.
                </p>
                <p className="text-[15px] text-gray-400 leading-relaxed">
                  A <span className="text-white font-medium">Hey Jarvis</span> tira esse peso das suas costas: ela registra, organiza e te lembra de tudo, direto no WhatsApp onde você já está.
                </p>
                <Button size="lg" asChild
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-11 px-7 rounded-xl shadow-lg shadow-violet-500/25 hover:-translate-y-px transition-all duration-200 font-semibold">
                  <a href="#planos">Quero começar <ArrowRight className="w-4 h-4 ml-2" /></a>
                </Button>
              </div>
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* ══ FINANCEIRO ════════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left">
            <div className="space-y-6">
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Sabe pra onde vai<br /><span className="text-emerald-400">o seu dinheiro?</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Você manda <em className="text-white not-italic font-medium">"gastei 50 no mercado"</em> e pronto. O Jarvis registra, categoriza e atualiza seus relatórios na hora. Sem planilha, sem app separado.
              </p>
              <ul className="space-y-3">
                {[
                  "Registro por texto, áudio ou foto",
                  "Categorização automática por IA",
                  "Relatórios semanais e mensais",
                  "Gráficos de fluxo de caixa",
                  "Integração com Google Sheets",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-emerald-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild variant="ghost"
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-5 h-10 text-[13px]">
                <a href="#planos">Assinar agora <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></a>
              </Button>
            </div>
          </AnimateIn>
          <AnimateIn from="right">
            <GifPhone src="/gifs/gif-gastos.webm" alt="Jarvis controlando gastos" />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ LEMBRETES ═════════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left" className="order-2 lg:order-1">
            <GifPhone src="/gifs/gif-lembretes.webm" alt="Jarvis gerenciando lembretes" />
          </AnimateIn>
          <AnimateIn from="right" className="order-1 lg:order-2">
            <div className="space-y-6">
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Você nunca mais esquecer<br /><span className="text-amber-400">de nada importante</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Fala com o Jarvis como falaria com alguém de confiança: <em className="text-white not-italic font-medium">"me lembra dia 10 de pagar a internet"</em>. Ela cria, repete todo mês e te avisa na hora certa.
              </p>
              <ul className="space-y-3">
                {[
                  "Lembretes únicos e recorrentes",
                  "Diário, semanal ou todo dia X do mês",
                  "Aviso antes do compromisso",
                  "Cobrança de contas a pagar",
                  "Nunca mais esqueça nada importante",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-amber-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild variant="ghost"
                className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/25 rounded-xl px-5 h-10 text-[13px]">
                <a href="#planos">Assinar agora <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></a>
              </Button>
            </div>
          </AnimateIn>
        </div>
      </Section>

      {/* ══ SÓ MANDAR UMA MENSAGEM ═══════════════════════════════════════ */}
      <section className="relative py-24 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-900/10 via-transparent to-transparent" />
        <div className="relative max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="mt-4 text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Só falar. Ela cuida do resto.
              </h2>
              <p className="mt-3 text-[16px] text-gray-400 max-w-lg mx-auto">
                Texto, áudio ou foto de nota fiscal. Do jeito mais fácil pra você.
              </p>
            </div>
          </AnimateIn>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <AnimateIn from="left">
              <div className="space-y-5">
                {[
                  { icon: MessageCircle, title: "Texto",      desc: "\"gastei 50 no mercado\" — direto e simples.",               color: "text-sky-400",   bg: "bg-sky-500/20 border-sky-500/30"   },
                  { icon: Mic,           title: "Áudio",      desc: "Fale enquanto dirige. O Jarvis transcreve e registra.",         color: "text-violet-400",bg: "bg-violet-500/20 border-violet-500/30" },
                  { icon: Camera,        title: "Foto da NF", desc: "Fotografe o cupom. Ela extrai valor e categoria na hora.",    color: "text-pink-400",  bg: "bg-pink-500/20 border-pink-500/30"   },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${f.bg}`}>
                      <f.icon className={`w-5 h-5 ${f.color}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-white text-[14px]">{f.title}</p>
                      <p className="text-[13px] text-gray-500">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </AnimateIn>
            <AnimateIn from="right">
              <GifPhone src="/gifs/gif-contatos.webm" alt="Jarvis processando mensagens" />
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* ══ COMPROMISSOS ══════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left">
            <div className="space-y-6">
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Sua agenda sempre<br /><span className="text-violet-400">no controle</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Esquece o formulário. Fala como você fala com qualquer pessoa: <em className="text-white not-italic font-medium">"marca reunião amanhã 14h"</em>. O Jarvis agenda, te lembra antes e sincroniza com seu Google Calendar.
              </p>
              <ul className="space-y-3">
                {[
                  "Linguagem natural, sem formulários",
                  "Lembretes automáticos antes do evento",
                  "Sincronização com Google Calendar",
                  "Resumo diário da sua agenda",
                  "Consulta a qualquer hora",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-violet-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild variant="ghost"
                className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/25 rounded-xl px-5 h-10 text-[13px]">
                <a href="#planos">Assinar agora <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></a>
              </Button>
            </div>
          </AnimateIn>
          <AnimateIn from="right">
            <GifPhone src="/gifs/gif-reuniao.webm" alt="Jarvis gerenciando agenda" />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ PAINEL ════════════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left" className="order-2 lg:order-1">
            <DashboardMock />
          </AnimateIn>
          <AnimateIn from="right" className="order-1 lg:order-2">
            <div className="space-y-6">
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Tudo organizado,<br /><span className="text-indigo-400">só falando com o Jarvis pelo Whatsapp</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Cada mensagem que você manda no WhatsApp vira dado organizado no seu painel. Você fala, ela registra, o dashboard atualiza sozinho.
              </p>
              <ul className="space-y-3">
                {[
                  "Gráficos de fluxo de caixa",
                  "Organização automática por categorias",
                  "Histórico completo de transações",
                  "Relatórios por período",
                  "Acesso pelo app ou navegador",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-indigo-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </AnimateIn>
        </div>
      </Section>

      {/* ══ CATEGORIAS ════════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left">
            <div className="space-y-6">
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Do jeito que você pensa,<br /><span className="text-pink-400">não do jeito do sistema</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                O Jarvis já vem com categorias prontas pro dia a dia. Mas se a sua vida não se encaixa em caixas padrão, crie quantas categorias personalizadas precisar.
              </p>
              <ul className="space-y-3">
                {[
                  "8 categorias prontas para usar",
                  "Categorias ilimitadas personalizadas",
                  "Categorização automática por IA",
                  "Relatórios por categoria no WhatsApp",
                  "Emojis e cores personalizáveis",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-pink-500/20 border border-pink-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-pink-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </AnimateIn>
          <AnimateIn from="right">
            <CategoriesVisual />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ INTEGRAÇÕES ═══════════════════════════════════════════════════ */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="mt-4 text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Já usa essas ferramentas?
              </h2>
              <p className="mt-3 text-[15px] text-gray-400 max-w-md mx-auto">
                O Jarvis conecta tudo o que você já usa no dia a dia
              </p>
            </div>
          </AnimateIn>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                image: googleAgendaImg, color: "text-blue-400", bg: "from-blue-500/15 to-blue-500/5", border: "border-blue-500/25",
                title: "Google Agenda",
                desc: "Crie eventos mandando uma mensagem no WhatsApp. Aparecem na sua agenda Google em segundos, com lembrete automático.",
                items: ["Sincronização em tempo real","Lembretes no Google","Acesse em qualquer device"],
              },
              {
                image: googleSheetsImg, color: "text-emerald-400", bg: "from-emerald-500/15 to-emerald-500/5", border: "border-emerald-500/25",
                title: "Google Sheets",
                desc: "Cada transação registrada no WhatsApp vai direto pra sua planilha. Seus dados sempre atualizados, prontos pra você usar.",
                items: ["Exportação automática","Planilha sempre atualizada","Use suas próprias fórmulas"],
              },
              {
                image: notionImg, color: "text-gray-300", bg: "from-gray-500/15 to-gray-500/5", border: "border-gray-500/25",
                title: "Notion",
                desc: "Salve ideias, anotações e tarefas no WhatsApp. Elas aparecem organizadas no seu workspace do Notion sem você tocar em nada.",
                items: ["Notas sincronizadas","Organização automática","Integra com databases"],
              },
            ].map((int, i) => (
              <AnimateIn key={int.title} delay={i * 90}>
                <div className={`rounded-2xl border ${int.border} bg-gradient-to-b ${int.bg} p-6 h-full hover:scale-[1.02] transition-all duration-300`}>
                  <div className={`w-12 h-12 rounded-xl bg-[#0b0b12] border ${int.border} flex items-center justify-center mb-4 overflow-hidden`}>
                    <img src={int.image} alt={int.title} className="w-7 h-7 object-contain" loading="lazy" width={28} height={28} />
                  </div>
                  <h3 className="font-bold text-white text-[16px] mb-2">{int.title}</h3>
                  <p className="text-[13px] text-gray-500 leading-relaxed mb-4">{int.desc}</p>
                  <ul className="space-y-1.5">
                    {int.items.map(item => (
                      <li key={item} className="flex items-center gap-2 text-[12px] text-gray-400">
                        <Check className={`w-3.5 h-3.5 ${int.color} flex-shrink-0`} /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </AnimateIn>
            ))}
          </div>

          <AnimateIn delay={200}>
            <div className="mt-8 text-center">
              <Button asChild
                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-xl shadow-lg shadow-violet-500/25 hover:-translate-y-px transition-all duration-200 h-11 px-7 font-semibold">
                <a href="#planos">Assinar agora <ArrowRight className="w-4 h-4 ml-2" /></a>
              </Button>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* ══ NÚMEROS ═══════════════════════════════════════════════════════ */}
      <section className="py-24 px-4 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Números que falam por si
              </h2>
              <p className="mt-3 text-[15px] text-gray-400 max-w-md mx-auto">
                Cada número é resultado de gente real usando o Jarvis todos os dias
              </p>
            </div>
          </AnimateIn>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { val: 200,  suffix: "K+", sub: "Mensagens processadas",     label: "E crescendo todo dia",    color: "from-violet-500/20 to-purple-500/10", border: "border-violet-500/25", textCls: "text-violet-400" },
              { val: 1500, suffix: "K+", sub: "Em finanças organizadas",   label: "R$ real de gente real",   color: "from-emerald-500/20 to-green-500/10",  border: "border-emerald-500/25",textCls: "text-emerald-400" },
              { val: 87,   suffix: "K+", sub: "Lembretes enviados",        label: "Zero esquecimentos",      color: "from-amber-500/20 to-orange-500/10",   border: "border-amber-500/25",  textCls: "text-amber-400"   },
              { val: 99,   suffix: "%",  sub: "de precisão da IA",         label: "Tecnologia de ponta",     color: "from-sky-500/20 to-blue-500/10",       border: "border-sky-500/25",    textCls: "text-sky-400"     },
            ].map((s, i) => (
              <AnimateIn key={i} delay={i * 80}>
                <div className={`rounded-2xl border ${s.border} bg-gradient-to-b ${s.color} p-6 text-center`}>
                  <p className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mb-3 ${s.textCls} truncate`}>{s.label}</p>
                  <p className="text-[28px] sm:text-[38px] font-extrabold text-white leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    <span>+</span><Counter to={s.val} suffix="" />{s.suffix}
                  </p>
                  <p className="text-[11px] sm:text-[12px] text-gray-400 mt-2">{s.sub}</p>
                </div>
              </AnimateIn>
            ))}
          </div>

          <AnimateIn delay={280}>
            <p className="mt-8 text-center text-[13px] text-gray-600">
              92% dos usuários avaliaram como excelente a Hey Jarvis. Baseado em dados reais dos últimos 3 meses.
            </p>
          </AnimateIn>
        </div>
      </section>

      {/* ══ DEPOIMENTOS ══════════════════════════════════════════════════ */}
      <section className="py-16 overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 mb-10">
          <AnimateIn>
            <div className="text-center">
              <h2 className="text-[36px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Quem usa, não larga
              </h2>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Stars />
                <span className="font-bold text-white">4.9</span>
                <span className="text-gray-500 text-[13px]">· +200 avaliações</span>
              </div>
            </div>
          </AnimateIn>
        </div>
        <div className="flex overflow-hidden mb-4">
          <div className="flex animate-marquee flex-shrink-0 gap-0" style={{ width: "max-content" }}>
            {[...Array(2)].flatMap(() => [
              { name: "Amanda Ferreira",  role: "Designer Freelancer", text: "Finalmente controlo meus gastos sem planilha. Mando áudio no carro e o Jarvis registra tudo." },
              { name: "Carlos Mendes",    role: "Empreendedor",        text: "Uso há 3 meses. Agenda, finanças e lembretes num único lugar. Mudou minha rotina." },
              { name: "Priya Nair",       role: "Advogada",            text: "Fotografei nota fiscal e ela categorizou na hora. Não acreditei que funcionou de primeira!" },
              { name: "Lucas Oliveira",   role: "Médico",              text: "Lembretes recorrentes me salvaram. Nunca mais esqueci contas fixas desde que comecei a usar." },
            ]).map((t, i) => (
              <div key={i} className="w-68 flex-shrink-0 rounded-2xl border border-white/8 bg-white/[0.03] p-5 mx-3">
                <Stars />
                <p className="mt-3 text-[13px] text-gray-300 leading-relaxed">"{t.text}"</p>
                <div className="mt-4 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{t.name[0]}</div>
                  <div><p className="text-[12px] font-semibold text-white">{t.name}</p><p className="text-[11px] text-gray-500">{t.role}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex overflow-hidden">
          <div className="flex animate-marquee-reverse flex-shrink-0 gap-0" style={{ width: "max-content" }}>
            {[...Array(2)].flatMap(() => [
              { name: "Beatriz Costa",    role: "Professora",          text: "Simples, direto e funciona. Meu WhatsApp virou minha central de organização pessoal." },
              { name: "Rafael Santos",    role: "Analista de TI",      text: "A transcrição de áudio é demais. Falo no carro, chego em casa e está tudo registrado." },
              { name: "Juliana Lima",     role: "Nutricionista",       text: "Controlo meu faturamento mensal só pelo WhatsApp. Simples assim." },
              { name: "Marcos Alves",     role: "Corretor de Imóveis", text: "Agenda compromissos com clientes direto no chat. Google Calendar integrado e funcionando." },
            ]).map((t, i) => (
              <div key={i} className="w-68 flex-shrink-0 rounded-2xl border border-white/8 bg-white/[0.03] p-5 mx-3">
                <Stars />
                <p className="mt-3 text-[13px] text-gray-300 leading-relaxed">"{t.text}"</p>
                <div className="mt-4 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{t.name[0]}</div>
                  <div><p className="text-[12px] font-semibold text-white">{t.name}</p><p className="text-[11px] text-gray-500">{t.role}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ PLANO ÚNICO ══════════════════════════════════════════════════ */}
      <PricingSection />

      {/* ══ FAQ ══════════════════════════════════════════════════════════ */}
      <section id="faq" className="py-20 px-4">
        <div className="max-w-2xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-12">
              <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Perguntas Frequentes
              </h2>
              <p className="mt-3 text-gray-500 text-[13px]">Tudo que você precisa saber antes de assinar</p>
            </div>
          </AnimateIn>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <AnimateIn key={i} delay={i * 45}>
                <FaqItem q={f.q} a={f.a} />
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FINAL CTA ════════════════════════════════════════════════════ */}
      <section className="py-24 px-4">
        <div className="max-w-3xl mx-auto">
          <AnimateIn from="scale">
            <div className="relative rounded-3xl overflow-hidden border border-violet-500/25 p-14 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/12 via-purple-600/8 to-transparent" />
              <div className="absolute -top-24 -right-24 w-72 h-72 bg-violet-500/12 rounded-full blur-3xl hidden md:block" />
              <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-purple-500/12 rounded-full blur-3xl hidden md:block" />
              <div className="relative">
                <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
                  <ChatAvatar />
                </div>
                <h2 className="text-[28px] sm:text-[40px] font-extrabold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Seu assistente está<br />pronto pra te ajudar
                </h2>
                <p className="text-[14px] sm:text-base text-gray-400 mb-9 max-w-md mx-auto leading-relaxed">
                  Mais de 1.200 pessoas já organizam finanças, agenda e lembretes direto pelo WhatsApp. Começa agora.
                </p>
                <Button size="lg" asChild
                  className="group relative overflow-hidden bg-gradient-to-r from-violet-600 via-purple-600 to-violet-600 bg-[length:200%_100%] md:animate-shimmer-slow text-white h-13 px-6 sm:px-10 rounded-xl shadow-xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:-translate-y-0.5 transition-all duration-300 font-bold text-[14px] sm:text-[16px] border border-violet-400/20">
                  <a href="https://pay.kirvano.com/4a308234-3702-4233-9d2a-4dce73bf0d2b" target="_blank" rel="noreferrer">
                    <span className="relative z-10 flex items-center gap-2">
                      Começar por R$29,90
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" />
                    </span>
                  </a>
                </Button>
                <p className="mt-4 text-[12px] text-gray-600">Sem contrato. Cancele quando quiser.</p>
              </div>
            </div>
          </AnimateIn>
        </div>
      </section>


      {/* ══ FOOTER ═══════════════════════════════════════════════════════ */}
      <footer className="border-t border-white/[0.06] py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="mb-4">
                <LogoFull />
              </div>
              <p className="text-[13px] text-gray-500 leading-relaxed max-w-[260px]">
                Assistente pessoal inteligente no WhatsApp. Finanças, agenda, lembretes e muito mais.
              </p>
              <div className="mt-4 flex items-center gap-1.5">
                <Stars />
                <span className="text-[12px] text-gray-500 ml-1">4.9 · +1.200 avaliações</span>
              </div>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-gray-300 mb-4">Produto</p>
              <ul className="space-y-2.5">
                {[["#como-funciona","Como funciona"],["#planos","Planos"],["#faq","FAQ"]].map(([h,l]) => (
                  <li key={h}><a href={h} className="text-[13px] text-gray-500 hover:text-white transition-colors">{l}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-gray-300 mb-4">Conta</p>
              <ul className="space-y-2.5">
                <li><Link to="/signup" className="text-[13px] text-gray-500 hover:text-white transition-colors">Criar conta</Link></li>
                <li><Link to="/login"  className="text-[13px] text-gray-500 hover:text-white transition-colors">Entrar</Link></li>
                <li><a href="mailto:suporte@heyjarvis.com.br" className="text-[13px] text-gray-500 hover:text-white transition-colors">Suporte</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-white/[0.06] flex flex-col md:flex-row justify-between items-center gap-4 text-[12px] text-gray-600">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>© 2026 Hey Jarvis · Todos os direitos reservados</span>
              <span>·</span>
              <Link to="/termos-de-uso" className="text-gray-500 hover:text-white transition-colors">Termos de Uso</Link>
              <span>·</span>
              <Link to="/politica-de-privacidade" className="text-gray-500 hover:text-white transition-colors">Política de Privacidade</Link>
              <span>· Um produto da{" "}
              <a href="https://mayahub.ai" className="text-violet-400 hover:text-violet-300 transition-colors" target="_blank" rel="noreferrer">MayaHub</a></span>
            </div>
            <div className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Dados criptografados e seguros</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
