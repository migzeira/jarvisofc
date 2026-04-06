import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  MessageCircle, Wallet, CalendarDays, Bot, Check, ArrowRight,
  Star, Shield, Sparkles, Mic, Camera, Bell, Lock, RefreshCw,
  ChevronDown, Phone, Repeat, Tag, BarChart3, FileText, Table2,
  Zap, Users,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────────── */
type ChatLine = { from: "user" | "maya"; text: string; pause?: number };
type Accent   = "emerald" | "violet" | "amber" | "sky" | "pink";

/* ─────────────────────────────────────────────────────────────────────────────
   CHAT DATA PER SECTION
───────────────────────────────────────────────────────────────────────────── */
const CHAT_FINANCEIRO: ChatLine[] = [
  { from: "user",  text: "gastei 50 reais no mercado hoje",           pause: 700  },
  { from: "maya",  text: "🔴 Registrado!\n📝 Mercado\n💰 R$ 50,00\n📂 Alimentação ✅", pause: 1000 },
  { from: "user",  text: "recebi 2 mil de salário",                   pause: 700  },
  { from: "maya",  text: "🟢 Receita salva!\n📝 Salário\n💰 R$ 2.000,00",           pause: 900  },
  { from: "user",  text: "quanto gastei essa semana?",                pause: 600  },
  { from: "maya",  text: "📊 Esta semana:\n🔴 Total: R$ 320\n\n🍔 Alimentação: R$ 180\n🚗 Transporte: R$ 90\n🏠 Outros: R$ 50", pause: 0 },
];

const CHAT_COMPROMISSOS: ChatLine[] = [
  { from: "user",  text: "marca dentista segunda 10h",               pause: 700  },
  { from: "maya",  text: "✅ Agendado!\n📅 Dentista — Seg, 07/04\n⏰ 10:00\n🔔 Te lembro 1h antes\n📆 Google Calendar ✅", pause: 900 },
  { from: "user",  text: "reunião com equipe quinta 14h",            pause: 700  },
  { from: "maya",  text: "✅ Salvo!\n📅 Reunião equipe — Qui, 10/04\n⏰ 14:00",      pause: 900  },
  { from: "user",  text: "o que tenho amanhã?",                      pause: 600  },
  { from: "maya",  text: "📅 Amanhã:\n\n📌 Call diária — 09:00\n📌 Almoço Pedro — 12:30\n📌 Academia — 18:30", pause: 0 },
];

const CHAT_AUDIO: ChatLine[] = [
  { from: "user",  text: "🎤  áudio — 0:09",                         pause: 600  },
  { from: "maya",  text: "🎤 Transcrição:\n\"gastei 80 reais de jantar ontem no rodízio\"\n\n🔴 Jantar rodízio — R$ 80,00\n📂 Alimentação ✅", pause: 1000 },
  { from: "user",  text: "🎤  áudio — 0:05",                         pause: 600  },
  { from: "maya",  text: "🎤 Transcrição:\n\"recebi 500 de freela\"\n\n🟢 Freela — R$ 500,00\n📂 Receita ✅", pause: 0 },
];

const CHAT_LEMBRETES: ChatLine[] = [
  { from: "user",  text: "me lembra amanhã 7h da academia",          pause: 700  },
  { from: "maya",  text: "⏰ Criado!\n📌 Academia\n📅 Amanhã às 07:00\nVai arrasar! 💪", pause: 900 },
  { from: "user",  text: "todo dia 5 me lembra de pagar a internet", pause: 700  },
  { from: "maya",  text: "🔁 Lembrete recorrente!\n📌 Pagar internet\n📅 Todo dia 5 do mês\nConfirmado! ✅", pause: 0 },
];

const CHAT_HERO: ChatLine[] = [
  { from: "user",  text: "gastei 45 de gasolina",                    pause: 700  },
  { from: "maya",  text: "🔴 Registrado!\n📝 Gasolina\n💰 R$ 45,00\n📂 Transporte", pause: 1000 },
  { from: "user",  text: "marca reunião amanhã 14h",                 pause: 700  },
  { from: "maya",  text: "✅ Agendado!\n📅 Reunião — Amanhã às 14:00\n🔔 Lembro 30 min antes", pause: 1000 },
  { from: "user",  text: "me lembra dia 10 de pagar aluguel",        pause: 700  },
  { from: "maya",  text: "🔁 Lembrete mensal criado!\n📌 Pagar aluguel\n📅 Todo dia 10 ✅", pause: 0 },
];

const FAQS = [
  { q: "Como funciona o período gratuito?",     a: "7 dias com acesso completo a todas as funcionalidades, sem cartão de crédito. Após o período, assine por R$29,90/mês." },
  { q: "Meus dados são seguros?",               a: "Sim. Criptografia AES-256, servidores no Brasil. Nunca compartilhamos seus dados com terceiros." },
  { q: "Funciona com qualquer WhatsApp?",       a: "Sim — pessoal ou Business, qualquer número brasileiro." },
  { q: "Posso cancelar quando quiser?",         a: "Sim, sem fidelidade e sem burocracia. Cancele direto pelo app." },
  { q: "A Maya responde rápido?",               a: "Em segundos, 24 horas por dia, 7 dias por semana — inclusive fins de semana e feriados." },
  { q: "Funciona com áudio e foto?",            a: "Sim! Mande áudio e a Maya transcreve e registra. Fotografe nota fiscal e ela extrai o valor e categoriza automaticamente." },
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

function Badge({ icon: Icon, label, color }: {
  icon: React.ElementType; label: string;
  color: "emerald" | "violet" | "amber" | "sky" | "pink" | "indigo";
}) {
  const cls: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    violet:  "border-violet-500/30 bg-violet-500/10 text-violet-400",
    amber:   "border-amber-500/30 bg-amber-500/10 text-amber-400",
    sky:     "border-sky-500/30 bg-sky-500/10 text-sky-400",
    pink:    "border-pink-500/30 bg-pink-500/10 text-pink-400",
    indigo:  "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
  };
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-medium ${cls[color]}`}>
      <Icon className="w-3 h-3" />{label}
    </div>
  );
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
  const rootRef    = useRef<HTMLDivElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const started    = useRef(false);

  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let delay = 500;
        lines.forEach((line, i) => {
          if (line.from === "maya") {
            setTimeout(() => setTyping(true),  delay);
            setTimeout(() => { setTyping(false); setShown(p => [...p, i]); }, delay + 820);
            delay += 820 + (line.pause ?? 1000);
          } else {
            setTimeout(() => setShown(p => [...p, i]), delay);
            delay += line.pause ?? 700;
          }
        });
      }
    }, { threshold: 0.25 });
    io.observe(el); return () => io.disconnect();
  }, [lines]);

  // Scroll apenas dentro do container — nunca afeta a página
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

  return (
    <div ref={rootRef} className="relative w-full max-w-[360px] mx-auto">
      {/* glow */}
      <div className={`absolute -inset-4 -z-10 ${bubbleUser[accent]}/10 blur-3xl rounded-full`} />
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden shadow-2xl shadow-black/50">
        {/* WA header */}
        <div className="flex items-center gap-2.5 px-4 py-3 bg-[#16162a] border-b border-white/[0.06]">
          <div className={`w-8 h-8 rounded-full ${bubbleUser[accent]} flex items-center justify-center flex-shrink-0`}>
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-white leading-none mb-0.5">Minha Maya</p>
            <p className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className={`w-1.5 h-1.5 ${dotColor[accent]} rounded-full animate-pulse`} />online agora
            </p>
          </div>
        </div>
        {/* messages */}
        <div ref={scrollRef} className="px-3 py-3 space-y-2.5 h-[240px] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {lines.map((line, i) => shown.includes(i) && (
            <div key={i} className={`flex animate-slide-up-fade ${line.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[84%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed whitespace-pre-line ${
                line.from === "user"
                  ? `${bubbleUser[accent]} text-white rounded-tr-sm`
                  : "bg-white/[0.07] text-gray-200 rounded-tl-sm border border-white/[0.05]"
              }`}>{line.text}</div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start animate-slide-up-fade">
              <div className="bg-white/[0.07] border border-white/[0.05] px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
                {[0,1,2].map(i => (
                  <span key={i} className={`w-1.5 h-1.5 ${dotColor[accent]} rounded-full animate-bounce`}
                    style={{ animationDelay: `${i*140}ms` }} />
                ))}
              </div>
            </div>
          )}
        </div>
        {/* input strip */}
        <div className="flex items-center gap-2 px-3 pb-3">
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
   HERO PHONE MOCKUP (cycles through CHAT_HERO)
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
      if (line.from === "maya") {
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
    timers.push(setTimeout(() => setCycle(c => c + 1), delay + 2000));
    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  // Scroll apenas dentro do container do phone — nunca afeta a página
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <div className="relative w-[265px] select-none mx-auto">
      <div className="absolute -inset-8 -z-10 bg-violet-600/18 blur-3xl rounded-full" />
      {/* shell */}
      <div className="rounded-[2.4rem] border border-white/10 bg-[#0b0b12] shadow-[0_28px_80px_rgba(0,0,0,.65)] overflow-hidden">
        {/* status */}
        <div className="relative h-9 flex items-center px-6 justify-between">
          <span className="text-[10px] text-gray-400">{hhmm}</span>
          <div className="absolute left-1/2 -translate-x-1/2 w-20 h-[18px] bg-black rounded-full" />
          <div className="w-4 h-2 border border-gray-500 rounded-[2px] flex items-center px-px">
            <div className="h-full bg-gray-400 rounded-[1px]" style={{ width: "70%" }} />
          </div>
        </div>
        {/* header */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#16162a] border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-white leading-none mb-0.5">Minha Maya</p>
            <p className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />online
            </p>
          </div>
        </div>
        {/* msgs */}
        <div ref={scrollRef} className="h-[252px] overflow-y-auto flex flex-col px-3 py-3 gap-2"
          style={{ background: "linear-gradient(180deg,#0b0b12 0%,#080810 100%)", scrollbarWidth: "none" }}>
          {msgs.map(m => (
            <div key={m.id} className={`flex animate-slide-up-fade ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-[11px] leading-relaxed whitespace-pre-line ${
                m.from === "user"
                  ? "bg-violet-600 text-white rounded-tr-sm"
                  : "bg-white/[0.07] text-gray-200 rounded-tl-sm border border-white/[0.05]"
              }`}>{m.text}</div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start animate-slide-up-fade">
              <div className="bg-white/[0.07] border border-white/[0.05] px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1">
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
      {/* floating badges */}
      <div className="absolute -right-6 top-16 bg-[#16162a] border border-white/10 rounded-xl px-3 py-2 text-[11px] shadow-xl">
        <p className="text-emerald-400 font-semibold flex items-center gap-1.5"><Zap className="w-3 h-3" />Responde em segundos</p>
      </div>
      <div className="absolute -left-6 bottom-20 bg-[#16162a] border border-white/10 rounded-xl px-3 py-2 text-[11px] shadow-xl">
        <p className="text-violet-400 font-semibold">Disponível 24h · 7 dias</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   DASHBOARD MOCKUP
───────────────────────────────────────────────────────────────────────────── */
function DashboardMock() {
  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="absolute -inset-4 -z-10 bg-indigo-600/10 blur-3xl rounded-full" />
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12] overflow-hidden shadow-2xl shadow-black/50">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#16162a] border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <span className="text-[12px] font-semibold text-white">Dashboard</span>
          </div>
          <span className="text-[10px] text-gray-500">Abril 2026</span>
        </div>
        <div className="p-5 space-y-4">
          {/* saldo */}
          <div className="rounded-xl bg-gradient-to-r from-indigo-500/15 to-violet-500/10 border border-indigo-500/20 p-4">
            <p className="text-[11px] text-gray-400 mb-1">Saldo do mês</p>
            <p className="text-2xl font-extrabold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              R$ 1.240,00
            </p>
            <p className="text-[11px] text-emerald-400 mt-1">↑ 12% vs mês anterior</p>
          </div>
          {/* bars */}
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
          {/* transactions */}
          <div className="space-y-2">
            {[
              { icon: "🛒", desc: "Mercado Extra",  val: "−R$ 180",  cls: "text-red-400"   },
              { icon: "💼", desc: "Salário",         val: "+R$ 4.500", cls: "text-emerald-400" },
              { icon: "⛽", desc: "Gasolina",        val: "−R$ 95",   cls: "text-red-400"   },
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
    { emoji: "📦", name: "Outros",      color: "border-gray-500/30 bg-gray-500/10 text-gray-300"          },
  ];
  return (
    <div className="relative w-full max-w-sm mx-auto">
      <div className="absolute -inset-4 -z-10 bg-pink-600/10 blur-3xl rounded-full" />
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
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
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
   PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function Index() {
  const [scrolled, setScrolled] = useState(false);
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
        <span className="text-violet-200">✨ 7 dias grátis, sem cartão de crédito —</span>{" "}
        <Link to="/signup" className="text-white font-semibold underline underline-offset-2 hover:text-violet-200 transition-colors">
          Ativar agora
        </Link>
      </div>

      {/* ══ NAVBAR ════════════════════════════════════════════════════════ */}
      <header className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled ? "bg-[#03030a]/90 backdrop-blur-2xl border-b border-white/[0.06] shadow-lg shadow-black/20" : "bg-transparent"
      }`}>
        <div className="max-w-6xl mx-auto px-4 h-15 flex items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/40">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <span className="text-[17px] font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Minha Maya
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-gray-400">
            {[["#como-funciona","Como funciona"],["#planos","Planos"],["#faq","FAQ"]].map(([h,l]) => (
              <a key={h} href={h} className="hover:text-white transition-colors relative group">
                {l}
                <span className="absolute -bottom-0.5 left-0 w-0 group-hover:w-full h-px bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-300" />
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:flex text-gray-300 hover:text-white hover:bg-white/8" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button size="sm" asChild
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-lg shadow-lg shadow-violet-500/25 hover:-translate-y-px transition-all duration-200">
              <Link to="/signup">Começar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ══ HERO ══════════════════════════════════════════════════════════ */}
      <section className="relative pt-16 pb-20 px-4">
        <div className="max-w-6xl mx-auto">
          {/* headline + CTA */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <AnimateIn delay={0}>
              <p className="text-[13px] font-semibold text-violet-400 mb-4 tracking-wide uppercase">
                Assistente pessoal 24h no seu bolso
              </p>
            </AnimateIn>
            <AnimateIn delay={80}>
              <h1 className="text-[48px] md:text-[60px] lg:text-[68px] font-extrabold leading-[1.06] tracking-tight"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Tenha uma assistente pessoal<br />
                <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  trabalhando 24h pra você
                </span>
              </h1>
            </AnimateIn>
            <AnimateIn delay={160}>
              <p className="mt-5 text-[17px] text-gray-400 leading-relaxed max-w-xl mx-auto">
                Finanças, agenda, lembretes e anotações — tudo direto no WhatsApp, por texto, áudio ou foto.
              </p>
            </AnimateIn>
            {/* 3 mini badges */}
            <AnimateIn delay={240}>
              <div className="flex flex-wrap justify-center gap-3 mt-8">
                {[
                  { icon: Shield,  text: "Dados 100% seguros",      cls: "border-white/10 bg-white/[0.03] text-gray-300" },
                  { icon: Zap,     text: "Responde em segundos",     cls: "border-violet-500/30 bg-violet-500/8 text-violet-300" },
                  { icon: MessageCircle, text: "100% no WhatsApp",   cls: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" },
                ].map(b => (
                  <div key={b.text} className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-[12px] font-medium ${b.cls}`}>
                    <b.icon className="w-3.5 h-3.5" />{b.text}
                  </div>
                ))}
              </div>
            </AnimateIn>
            <AnimateIn delay={320}>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                <Button size="lg" asChild
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-12 px-8 rounded-xl shadow-xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:-translate-y-0.5 transition-all duration-200 font-semibold text-[15px]">
                  <Link to="/signup">Quero a minha Maya <ArrowRight className="w-4 h-4 ml-2" /></Link>
                </Button>
                <Button size="lg" variant="ghost" asChild
                  className="text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/7 h-12 px-6 rounded-xl text-[15px]">
                  <a href="#como-funciona">Ver como funciona</a>
                </Button>
              </div>
              <div className="mt-5 flex items-center gap-5 justify-center">
                <div className="flex -space-x-2">
                  {["AM","CB","PL","RS","JF"].map((ini, i) => (
                    <div key={i} className="w-7 h-7 rounded-full border-2 border-[#03030a] bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-[9px] font-bold">
                      {ini}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[13px]">
                  <Stars />
                  <span className="font-semibold">4.9</span>
                  <span className="text-gray-500">· +1.200 usuários</span>
                </div>
              </div>
            </AnimateIn>
          </div>

          {/* Phone mockup centered */}
          <AnimateIn from="scale" delay={120}>
            <HeroPhone />
          </AnimateIn>
        </div>
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-[#03030a] to-transparent pointer-events-none" />
      </section>

      {/* ══ SUA VIDA ORGANIZADA SEM ESFORÇO ══════════════════════════════ */}
      <section id="como-funciona" className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-700/25 via-purple-700/18 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#03030a] via-transparent to-[#03030a]" />
        <div className="relative max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <AnimateIn from="left">
              <div>
                <p className="text-[13px] text-violet-400 font-semibold uppercase tracking-widest mb-4">Chega de descontrole</p>
                <h2 className="text-[44px] md:text-[52px] font-extrabold leading-tight tracking-tight"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Sua vida{" "}
                  <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">organizada.</span>
                  <br />Sem esforço.
                </h2>
              </div>
            </AnimateIn>
            <AnimateIn from="right" delay={120}>
              <div className="space-y-5">
                <p className="text-[16px] text-gray-300 leading-relaxed">
                  Você ainda tá tentando lembrar tudo de cabeça ou não sabe pra onde está indo seu dinheiro?
                </p>
                <p className="text-[15px] text-gray-400 leading-relaxed">
                  A <span className="text-white font-medium">Minha Maya</span> resolve isso: organização financeira, agenda e lembretes — tudo de forma simples e direto no WhatsApp, onde você já está.
                </p>
                <Button size="lg" asChild
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-11 px-7 rounded-xl shadow-lg shadow-violet-500/25 hover:-translate-y-px transition-all duration-200 font-semibold">
                  <Link to="/signup">Começar agora — grátis <ArrowRight className="w-4 h-4 ml-2" /></Link>
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
              <Badge icon={Wallet} label="FINANCEIRO" color="emerald" />
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Controle financeiro<br /><span className="text-emerald-400">sem planilha</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Envie mensagens como <em className="text-white not-italic font-medium">"gastei 50 no mercado"</em> ou <em className="text-white not-italic font-medium">"recebi 2 mil de salário"</em> — a Maya registra, categoriza e atualiza seus relatórios na hora.
              </p>
              <ul className="space-y-3">
                {["Registro por texto, áudio ou foto","Categorização automática por IA","Relatórios semanais e mensais","Gráficos de fluxo de caixa","Integração com Google Sheets"].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-emerald-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-gray-500 italic">Fácil, prático e 100% no WhatsApp — pra você ter o controle do seu dinheiro na palma da mão.</p>
              <Button asChild variant="ghost"
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-5 h-10 text-[13px]">
                <Link to="/signup">Contratar agora →</Link>
              </Button>
            </div>
          </AnimateIn>
          <AnimateIn from="right">
            <AutoChat lines={CHAT_FINANCEIRO} accent="emerald" />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ COMPROMISSOS ══════════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left" className="order-2 lg:order-1">
            <AutoChat lines={CHAT_COMPROMISSOS} accent="violet" />
          </AnimateIn>
          <AnimateIn from="right" className="order-1 lg:order-2">
            <div className="space-y-6">
              <Badge icon={CalendarDays} label="COMPROMISSOS" color="violet" />
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Organize sua agenda<br /><span className="text-violet-400">por mensagem</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Envie mensagens como <em className="text-white not-italic font-medium">"marca reunião amanhã às 14h"</em> — a Maya agenda, te lembra antes e sincroniza com seu Google Calendar.
              </p>
              <ul className="space-y-3">
                {["Linguagem natural, sem formulários","Lembretes automáticos antes do evento","Sincronização com Google Calendar","Resumo diário da agenda","Consulta a qualquer hora"].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-violet-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-gray-500 italic">Simples, rápido e sempre à mão — pra você nunca mais perder um compromisso.</p>
              <Button asChild variant="ghost"
                className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/25 rounded-xl px-5 h-10 text-[13px]">
                <Link to="/signup">Contratar agora →</Link>
              </Button>
            </div>
          </AnimateIn>
        </div>
      </Section>

      {/* ══ REGISTRE TUDO NO WHATSAPP ════════════════════════════════════ */}
      <section className="relative py-24 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-900/10 via-transparent to-transparent" />
        <div className="relative max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <Badge icon={MessageCircle} label="REGISTRE TUDO NO WHATSAPP" color="sky" />
              <h2 className="mt-4 text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Registre tudo no WhatsApp
              </h2>
              <p className="mt-3 text-[16px] text-gray-400 max-w-lg mx-auto">
                Envie uma mensagem e a Maya lança tudo automaticamente — sem apps extras, sem formulários.
              </p>
            </div>
          </AnimateIn>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <AnimateIn from="left">
              <div className="space-y-5">
                {[
                  { icon: MessageCircle, title: "Texto",           desc: "\"gastei 50 no mercado\" — direto e simples.",              color: "text-sky-400",   bg: "bg-sky-500/20 border-sky-500/30"   },
                  { icon: Mic,           title: "Áudio",           desc: "Fale enquanto dirige. A Maya transcreve e registra.",        color: "text-violet-400",bg: "bg-violet-500/20 border-violet-500/30" },
                  { icon: Camera,        title: "Foto da NF",      desc: "Fotografe o cupom. Ela extrai valor e categoria na hora.",  color: "text-pink-400",  bg: "bg-pink-500/20 border-pink-500/30"   },
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
              <AutoChat lines={CHAT_AUDIO} accent="sky" />
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* ══ PAINEL PROFISSIONAL ═══════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left">
            <div className="space-y-6">
              <Badge icon={BarChart3} label="PAINEL PROFISSIONAL" color="indigo" />
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Tudo organizado<br /><span className="text-indigo-400">no seu dashboard</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                Sem perder tempo com cadastros — a Maya faz tudo por você no WhatsApp e exibe tudo organizado no seu painel.
              </p>
              <ul className="space-y-3">
                {["Gráficos de fluxo de caixa","Organização automática por categorias","Histórico completo de transações","Relatórios em PDF por período","Prático e acessível"].map((item) => (
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
          <AnimateIn from="right">
            <DashboardMock />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ CATEGORIAS PERSONALIZADAS ════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left" className="order-2 lg:order-1">
            <CategoriesVisual />
          </AnimateIn>
          <AnimateIn from="right" className="order-1 lg:order-2">
            <div className="space-y-6">
              <Badge icon={Tag} label="CATEGORIAS PERSONALIZADAS" color="pink" />
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Use as que já vêm<br /><span className="text-pink-400">ou crie as suas</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                A Maya já vem com categorias prontas para o dia a dia. Mas se quiser algo específico, crie quantas categorias personalizadas precisar.
              </p>
              <ul className="space-y-3">
                {["8 categorias prontas para usar","Categorias ilimitadas personalizadas","Categorização automática por IA","Relatórios por categoria no WhatsApp","Emojis e cores personalizáveis"].map((item) => (
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
        </div>
      </Section>

      {/* ══ LEMBRETES DIÁRIOS ═════════════════════════════════════════════ */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <AnimateIn from="left">
            <div className="space-y-6">
              <Badge icon={Bell} label="LEMBRETES DIÁRIOS" color="amber" />
              <h2 className="text-[38px] font-extrabold tracking-tight leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Lembretes diários<br /><span className="text-amber-400">direto no WhatsApp</span>
              </h2>
              <p className="text-gray-400 leading-relaxed">
                A Maya te lembra dos compromissos e contas — todo dia de manhã e 30 minutos antes de cada evento.
              </p>
              <ul className="space-y-3">
                {["Lembretes únicos e recorrentes","Diário, semanal ou todo dia X do mês","Aviso antes do compromisso","Cobrança de contas a pagar","Nunca mais esqueça nada importante"].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[13px] text-gray-300">
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-amber-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </AnimateIn>
          <AnimateIn from="right">
            <AutoChat lines={CHAT_LEMBRETES} accent="amber" />
          </AnimateIn>
        </div>
      </Section>

      {/* ══ INTEGRAÇÕES ═══════════════════════════════════════════════════ */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <Badge icon={Zap} label="INTEGRAÇÕES" color="sky" />
              <h2 className="mt-4 text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Conecta com o que você já usa
              </h2>
              <p className="mt-3 text-[15px] text-gray-400 max-w-md mx-auto">
                Sincronização automática com as ferramentas mais populares do mercado
              </p>
            </div>
          </AnimateIn>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: CalendarDays, color: "text-blue-400", bg: "from-blue-500/15 to-blue-500/5", border: "border-blue-500/25",
                title: "Google Agenda",
                desc: "Sincronização automática dos compromissos. Crie eventos no WhatsApp e aparecem na sua agenda Google em segundos.",
                items: ["Sincronização automática","Lembretes no Google","Acesse em qualquer device"],
              },
              {
                icon: Table2, color: "text-emerald-400", bg: "from-emerald-500/15 to-emerald-500/5", border: "border-emerald-500/25",
                title: "Google Sheets",
                desc: "Exporte suas transações automaticamente para uma planilha Google. Seus dados sempre atualizados e acessíveis.",
                items: ["Exportação automática","Planilha sempre atualizada","Fórmulas e gráficos seus"],
              },
              {
                icon: FileText, color: "text-gray-300", bg: "from-gray-500/15 to-gray-500/5", border: "border-gray-500/25",
                title: "Notion",
                desc: "Suas anotações vão direto para o Notion. Salve ideias no WhatsApp e elas aparecem organizadas no seu workspace.",
                items: ["Notas sincronizadas","Organize no Notion","Integração com databases"],
              },
            ].map((int, i) => (
              <AnimateIn key={int.title} delay={i * 90}>
                <div className={`rounded-2xl border ${int.border} bg-gradient-to-b ${int.bg} p-6 h-full hover:scale-[1.02] transition-all duration-300`}>
                  <div className={`w-12 h-12 rounded-xl bg-[#0b0b12] border ${int.border} flex items-center justify-center mb-4`}>
                    <int.icon className={`w-6 h-6 ${int.color}`} />
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
                <Link to="/signup">Quero utilizar <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* ══ NÚMEROS QUE COMPROVAM ═════════════════════════════════════════ */}
      <section className="py-24 px-4 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Números que Comprovam
              </h2>
              <p className="mt-3 text-[15px] text-gray-400 max-w-md mx-auto">
                Faça parte da revolução da inteligência artificial e tenha uma assistente te ajudando 24h por dia
              </p>
            </div>
          </AnimateIn>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { val: 200,    suffix: "K+", sub: "Mensagens processadas",   label: "PROCESSAMENTO EM SEGUNDOS",   color: "from-violet-500/20 to-purple-500/10", border: "border-violet-500/25", textCls: "text-violet-400" },
              { val: 1.5,    suffix: "M+", sub: "Em finanças organizadas", label: "CRESCENDO A CADA DIA",        color: "from-emerald-500/20 to-green-500/10",  border: "border-emerald-500/25",textCls: "text-emerald-400" },
              { val: 87,     suffix: "K+", sub: "Lembretes enviados",      label: "LEMBRETES ILIMITADOS",        color: "from-amber-500/20 to-orange-500/10",   border: "border-amber-500/25",  textCls: "text-amber-400"   },
              { val: 99.9,   suffix: "%",  sub: "Precisão da IA",          label: "TECNOLOGIA DE PONTA",         color: "from-sky-500/20 to-blue-500/10",       border: "border-sky-500/25",    textCls: "text-sky-400"     },
            ].map((s, i) => (
              <AnimateIn key={i} delay={i * 80}>
                <div className={`rounded-2xl border ${s.border} bg-gradient-to-b ${s.color} p-6 text-center`}>
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${s.textCls}`}>{s.label}</p>
                  <p className="text-[38px] font-extrabold text-white leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {s.val < 10 ? (
                      <>+<Counter to={Math.round(s.val * 10)} suffix="" /><span>M+</span></>
                    ) : (
                      <><span>+</span><Counter to={s.val} suffix="" />{s.suffix}</>
                    )}
                  </p>
                  <p className="text-[12px] text-gray-400 mt-2">{s.sub}</p>
                </div>
              </AnimateIn>
            ))}
          </div>

          <AnimateIn delay={280}>
            <p className="mt-8 text-center text-[13px] text-gray-600">
              92% dos usuários avaliaram como "excelente" a Minha Maya · Baseado em dados reais dos últimos 3 meses
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
                O que dizem nossos usuários
              </h2>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Stars />
                <span className="font-bold text-white">4.9</span>
                <span className="text-gray-500 text-[13px]">· +200 avaliações</span>
              </div>
            </div>
          </AnimateIn>
        </div>
        {/* marquee row 1 */}
        <div className="flex overflow-hidden mb-4">
          <div className="flex animate-marquee flex-shrink-0 gap-0" style={{ width: "max-content" }}>
            {[...Array(2)].flatMap(() => [
              { name: "Amanda Ferreira",  role: "Designer Freelancer", text: "Finalmente controlo gastos sem planilha. Mando áudio e a Maya registra tudo." },
              { name: "Carlos Mendes",    role: "Empreendedor",        text: "Uso há 3 meses. Agenda, finanças e lembretes num único lugar. Incrível." },
              { name: "Priya Nair",       role: "Advogada",            text: "Fotografei nota fiscal e ela categorizou na hora. Que praticidade!" },
              { name: "Lucas Oliveira",   role: "Médico",              text: "Lembretes recorrentes me salvaram. Nunca mais esqueci contas fixas." },
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
        {/* marquee row 2 */}
        <div className="flex overflow-hidden">
          <div className="flex animate-marquee-reverse flex-shrink-0 gap-0" style={{ width: "max-content" }}>
            {[...Array(2)].flatMap(() => [
              { name: "Beatriz Costa",    role: "Professora",          text: "Simples, direto e funciona. Meu WhatsApp virou central de organização." },
              { name: "Rafael Santos",    role: "Analista de TI",      text: "Transcrição de áudios é demais. Falo no carro e ela registra tudo." },
              { name: "Juliana Lima",     role: "Nutricionista",       text: "Controlo faturamento mensal só no WhatsApp. Economizei muito." },
              { name: "Marcos Alves",     role: "Corretor de Imóveis", text: "Agenda compromissos com clientes direto no chat. Google Calendar integrado." },
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
      <section id="planos" className="py-28 px-4">
        <div className="max-w-lg mx-auto">
          <AnimateIn>
            <div className="text-center mb-10">
              <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Conheça nosso plano
              </h2>
              <p className="mt-3 text-[15px] text-gray-400">
                Organização financeira e pessoal direto no WhatsApp 24h por dia
              </p>
            </div>
          </AnimateIn>

          <AnimateIn from="scale" delay={80}>
            <div className="relative rounded-2xl border border-violet-500/40 bg-[#0d0d1a] overflow-hidden shadow-2xl shadow-violet-500/10">
              {/* top badge */}
              <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-white" />
                  <span className="text-[13px] font-bold text-white">Organizar-se Agora</span>
                </div>
                <span className="text-[11px] bg-white/20 text-white px-2.5 py-1 rounded-full font-medium">
                  Preço por tempo limitado
                </span>
              </div>

              <div className="p-8">
                {/* price */}
                <div className="mb-2">
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-[54px] font-extrabold text-white leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      R$29,90
                    </span>
                    <span className="text-gray-400 text-[14px] mb-2">/mês</span>
                  </div>
                  <p className="text-[13px] text-gray-500">12 x R$29,90 · ou R$29,90 por mês</p>
                </div>
                <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[12px] font-medium px-3 py-1.5 rounded-full mb-6">
                  <Check className="w-3 h-3" /> Equivale a menos de R$1 por dia
                </div>

                {/* features */}
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

                <Button size="lg" asChild className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-13 rounded-xl shadow-xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:-translate-y-0.5 transition-all duration-200 font-bold text-[16px]">
                  <Link to="/signup">Garantir agora — 7 dias grátis</Link>
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

      {/* ══ FAQ ══════════════════════════════════════════════════════════ */}
      <section id="faq" className="py-20 px-4">
        <div className="max-w-2xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-12">
              <h2 className="text-[40px] font-extrabold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Perguntas Frequentes
              </h2>
              <p className="mt-3 text-gray-500 text-[13px]">Tudo que você precisa saber</p>
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
              <div className="absolute -top-24 -right-24 w-72 h-72 bg-violet-500/12 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-purple-500/12 rounded-full blur-3xl" />
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-violet-500/40">
                  <MessageCircle className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-[40px] font-extrabold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Sua assistente está<br />pronta pra te ajudar
                </h2>
                <p className="text-gray-400 mb-9 max-w-md mx-auto leading-relaxed">
                  +1.200 pessoas já organizam a vida toda pelo WhatsApp. Comece hoje, sem cartão de crédito.
                </p>
                <Button size="lg" asChild
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-13 px-10 rounded-xl shadow-xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:-translate-y-0.5 transition-all duration-200 font-bold text-[16px]">
                  <Link to="/signup">Criar conta grátis — 7 dias <ArrowRight className="w-5 h-5 ml-2" /></Link>
                </Button>
                <p className="mt-4 text-[12px] text-gray-600">Sem cartão de crédito · Cancele quando quiser</p>
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
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <MessageCircle className="h-4 w-4 text-white" />
                </div>
                <span className="text-[17px] font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Minha Maya</span>
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
                <li><Link to="/signup" className="text-[13px] text-gray-500 hover:text-white transition-colors">Criar conta grátis</Link></li>
                <li><Link to="/login"  className="text-[13px] text-gray-500 hover:text-white transition-colors">Entrar</Link></li>
                <li><a href="mailto:suporte@minhamaya.com.br" className="text-[13px] text-gray-500 hover:text-white transition-colors">Suporte</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-white/[0.06] flex flex-col md:flex-row justify-between items-center gap-4 text-[12px] text-gray-600">
            <div>
              © 2026 Minha Maya · Todos os direitos reservados · Um produto da{" "}
              <a href="https://mayahub.ai" className="text-violet-400 hover:text-violet-300 transition-colors" target="_blank" rel="noreferrer">MayaHub</a>
            </div>
            <div className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Dados criptografados e seguros</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
