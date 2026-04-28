/**
 * send-reminder
 * Chamada pelo pg_cron a cada 1 minuto.
 * Busca lembretes pendentes cujo send_at <= agora e envia via WhatsApp.
 * Suporta recorrência: cria próxima ocorrência automaticamente.
 * Suporta hábitos preset com conteúdo dinâmico (versículos, frases).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendButtons } from "../_shared/evolution.ts";

// ─────────────────────────────────────────────────────────────
// Conteúdo dinâmico para hábitos preset
// ─────────────────────────────────────────────────────────────

const BIBLE_VERSES = [
  "João 3:16 — Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito, para que todo o que nele crer não pereça, mas tenha a vida eterna.",
  "Filipenses 4:13 — Tudo posso naquele que me fortalece.",
  "Salmos 23:1 — O Senhor é o meu pastor, nada me faltará.",
  "Jeremias 29:11 — Porque eu sei os planos que tenho para vocês, diz o Senhor, planos de fazê-los prosperar e não de causar dano, planos de dar a vocês esperança e um futuro.",
  "Romanos 8:28 — Sabemos que todas as coisas cooperam para o bem daqueles que amam a Deus.",
  "Isaías 40:31 — Mas aqueles que esperam no Senhor renovarão as suas forças. Voarão alto como águias.",
  "Josué 1:9 — Seja forte e corajoso! Não se apavore nem desanime, pois o Senhor, o seu Deus, estará com você por onde você andar.",
  "Mateus 6:33 — Busquem, pois, em primeiro lugar o reino de Deus e a sua justiça, e todas essas coisas lhes serão acrescentadas.",
  "Provérbios 3:5-6 — Confie no Senhor de todo o seu coração e não se apoie em seu próprio entendimento. Reconheça-o em todos os seus caminhos e Ele endireitará as suas veredas.",
  "Salmos 46:1 — Deus é o nosso refúgio e a nossa fortaleza, socorro bem presente na angústia.",
  "Efésios 3:20 — Ora, àquele que é poderoso para fazer infinitamente mais do que tudo o que pedimos ou pensamos, segundo o seu poder que atua em nós.",
  "2 Coríntios 12:9 — A minha graça é suficiente para você, pois o meu poder se aperfeiçoa na fraqueza.",
  "Salmos 37:4 — Deleita-te no Senhor, e Ele te dará os desejos do teu coração.",
  "Miquéias 6:8 — O que o Senhor requer de você: que você pratique a justiça, ame a misericórdia e caminhe humildemente com o seu Deus.",
  "Marcos 11:24 — Por isso eu lhes digo: tudo o que vocês pedirem em oração, creiam que já o receberam, e vocês o terão.",
  "Mateus 11:28-29 — Venham a mim, todos os que estão cansados e sobrecarregados, e eu lhes darei descanso.",
  "Salmos 121:2 — O meu socorro vem do Senhor, que fez o céu e a terra.",
  "Filipenses 4:6-7 — Não andem ansiosos por coisa alguma, mas em tudo, pela oração e súplica, com ação de graças, apresentem seus pedidos a Deus.",
  "Romanos 15:13 — Que o Deus da esperança os encha de toda alegria e paz, à medida que confiam nele.",
  "Gálatas 5:22-23 — O fruto do Espírito é amor, alegria, paz, paciência, amabilidade, bondade, fidelidade, mansidão e domínio próprio.",
  "Hebreus 11:1 — A fé é a certeza daquilo que esperamos e a prova das coisas que não vemos.",
  "1 Pedro 5:7 — Lançai sobre Ele toda a vossa ansiedade, pois Ele tem cuidado de vós.",
  "Salmos 119:105 — Lâmpada para os meus pés é a tua palavra e luz para o meu caminho.",
  "Romanos 8:38-39 — Pois estou convicto de que nem morte nem vida... poderá nos separar do amor de Deus que está em Cristo Jesus, nosso Senhor.",
  "1 Coríntios 13:4 — O amor é paciente, o amor é bondoso. Não inveja, não se vangloria, não se orgulha.",
  "Salmos 27:1 — O Senhor é a minha luz e a minha salvação; a quem temerei? O Senhor é a força da minha vida; de quem me recearei?",
  "Provérbios 16:3 — Entregue ao Senhor tudo que você faz; seus planos terão sucesso.",
  "Mateus 5:9 — Felizes os pacificadores, porque serão chamados filhos de Deus.",
  "Colossenses 3:23 — Tudo o que vocês fizerem, façam de todo o coração, como para o Senhor, e não para os homens.",
  "Salmos 118:24 — Este é o dia que o Senhor fez; regozijemo-nos e alegremo-nos nele.",
];

const MOTIVATIONAL_QUOTES = [
  "O sucesso é a soma de pequenos esforços repetidos dia após dia. 🏆 — Robert Collier",
  "Você não precisa ser ótimo para começar, mas precisa começar para ser ótimo. 🚀 — Zig Ziglar",
  "A única maneira de fazer um ótimo trabalho é amar o que você faz. ❤️ — Steve Jobs",
  "O futuro pertence a quem acredita na beleza de seus sonhos. ✨ — Eleanor Roosevelt",
  "A persistência é o caminho do êxito. 💪 — Charles Chaplin",
  "Não espere por condições ideais para começar. Comece onde você está. 🎯 — Arthur Ashe",
  "Cada manhã você tem 24 horas. O que vai fazer com o seu tempo hoje? ⏰",
  "Sua atitude é mais importante do que seus fatos. 🌟 — Karl Menninger",
  "O maior risco é não arriscar. 🦁 — Mark Zuckerberg",
  "Seja a mudança que você deseja ver no mundo. 🌍 — Mahatma Gandhi",
  "Não importa quão devagar você vai, desde que não pare. 🐢 — Confúcio",
  "Grandes coisas nunca vêm da zona de conforto. Sai daí! 🔥",
  "A motivação te faz começar. O hábito te faz continuar. ✅",
  "Tenha coragem de seguir seu coração e intuição. 💡 — Steve Jobs",
  "Um passo de cada vez. Você está construindo algo incrível. 🏗️",
  "A disciplina é a ponte entre objetivos e realizações. 🌉 — Jim Rohn",
  "Não existe elevador para o sucesso. Você precisa usar as escadas. 📈 — Zig Ziglar",
  "Você é capaz. Você é forte. Você chegará lá. 💪",
  "O melhor momento para plantar uma árvore foi há 20 anos. O segundo melhor momento é agora. 🌱",
  "Sonhe grande, comece pequeno, aja agora. 🎯 — Robin Sharma",
  "A vida começa no fim da sua zona de conforto. 🚀 — Neale Donald Walsch",
  "Seja tão bom que não possam te ignorar. ⭐ — Steve Martin",
  "Hoje é sempre o melhor dia para começar de novo. 🌅",
  "Cada fracasso é uma lição, não uma derrota. Continue aprendendo! 📚",
  "Quem não arrisca não petisca. Dê o primeiro passo com fé! 🏃",
  "Você foi feito(a) para isso. Bora lá! 💥",
  "Pequenos passos todos os dias constroem grandes conquistas. 🧱",
  "Acredite em você mesmo e todo o resto virá em seguida. 🌟",
  "O segredo do sucesso é a consistência do propósito. 🎯 — Benjamin Disraeli",
  "Hoje você é quem você é. Amanhã você será quem você se tornar. 🦋",
];

/**
 * Resolve mensagens de hábitos preset com conteúdo dinâmico.
 * Versículos e frases são selecionados pelo dia do mês (rotação mensal).
 */
function resolveHabitMessage(message: string): string {
  const dayIndex = new Date().getDate() - 1; // 0-29

  if (message === "{{habit:bible_verse}}") {
    const verse = BIBLE_VERSES[dayIndex % BIBLE_VERSES.length];
    return `✝️ *Versículo do dia:*\n\n_"${verse}"_`;
  }

  if (message === "{{habit:motivation}}") {
    const quote = MOTIVATIONAL_QUOTES[dayIndex % MOTIVATIONAL_QUOTES.length];
    return `💪 *Frase do dia:*\n\n"${quote}"`;
  }

  return message;
}

/**
 * Detecta se o título do lembrete contém intenção de enviar mensagem para contato.
 * Ex: "enviar pro Caio dizendo que vai atrasar" / "manda pra Ana confirmar horário"
 */
function reminderHasSendToContact(title: string): boolean {
  return /\b(enviar?|mandar?|falar?|avisar?)\s+(uma?\s+)?(mensagem\s+)?(pra|para|pro)\s+\w+/i.test(title ?? "");
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─────────────────────────────────────────────
// Helpers para filtro de target_days do hábito
// (suporta "Desativar finais de semana": target_days = [1,2,3,4,5])
// ─────────────────────────────────────────────

/** Parse robusto do JSON target_days vindo do banco. Retorna array de 0-6. */
function parseTargetDays(raw: unknown): number[] {
  if (raw == null) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/** Calcula dia da semana (0=dom, 6=sáb) considerando o timezone do usuário. */
function dayOfWeekInTz(date: Date, tz: string): number {
  try {
    const wd = date.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const v = map[wd];
    return Number.isInteger(v) ? v : date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

/** Cache em memória do timezone do usuário (válido durante a execução do cron). */
const _tzCache = new Map<string, string>();
async function getUserTz(userId: string): Promise<string> {
  const cached = _tzCache.get(userId);
  if (cached) return cached;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const tz = ((data as Record<string, unknown> | null)?.timezone as string) || "America/Sao_Paulo";
    _tzCache.set(userId, tz);
    return tz;
  } catch {
    return "America/Sao_Paulo";
  }
}

// ─────────────────────────────────────────────
// Calcula a próxima data de um lembrete recorrente
// ─────────────────────────────────────────────
function nextOccurrence(
  current: Date,
  recurrence: string,
  recurrenceValue: number | null
): Date | null {
  const next = new Date(current);

  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (recurrence === "weekly") {
    // recurrenceValue = dia da semana (0=dom..6=sáb)
    const targetDay = recurrenceValue ?? current.getDay();
    next.setDate(next.getDate() + 7);
    // Ajusta para o dia correto da semana caso tenha desviado
    while (next.getDay() !== targetDay) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  if (recurrence === "day_of_month") {
    // recurrenceValue = dia do mês (1-31)
    const day = recurrenceValue ?? current.getDate();
    next.setMonth(next.getMonth() + 1);
    // Garante o dia correto (tratando meses com menos dias)
    const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, maxDay));
    return next;
  }

  if (recurrence === "hourly") {
    // recurrenceValue = intervalo em horas (ex: 2 = a cada 2 horas)
    const hours = recurrenceValue ?? 1;
    next.setTime(next.getTime() + hours * 60 * 60 * 1000);
    return next;
  }

  return null; // "none" ou tipo desconhecido → sem próxima
}

serve(async (_req) => {
  // Função interna chamada pelo pg_cron a cada 1 minuto.
  // Sem validação de secret — a função é segura porque:
  //   1. Não aceita parâmetros externos (busca reminders do banco)
  //   2. Pior caso: alguém chama manualmente e dispara envios pendentes
  //      (que iam ser enviados pelo cron de qualquer forma)
  //   3. verify_jwt=false no config.toml (esperado pra cron jobs)
  // A segurança real está no RLS + service_role key do Supabase client.

  const now = new Date();

  // ── Recupera lembretes presos em "processing" há mais de 5 min (crash recovery) ──
  const ago5min = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await supabase
    .from("reminders")
    .update({ status: "pending", processing_at: null } as any)
    .eq("status", "processing")
    .lt("processing_at", ago5min);

  // ── Reclama atomicamente os lembretes pendentes (evita duplicidade entre runs) ──
  const { data: reminders, error } = await supabase
    .rpc("claim_pending_reminders", { p_limit: 50 }) as any;

  if (error) {
    console.error("Error claiming reminders:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!reminders || reminders.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }));
  }

  let sent = 0;
  let failed = 0;
  let scheduled = 0;

  for (const reminder of reminders) {
    try {
      // ─── Grace period: cancela reminders velhos demais (ex: internet voltou tarde) ──
      // Evita entregar bom dia de 8h às 10h, ou hábito atrasado 1h.
      // Reminders recorrentes ainda ganham próxima ocorrência (ciclo não quebra).
      const GRACE_MS: Record<string, number> = {
        daily_briefing:  60 * 60 * 1000,   // 1h  — bom dia: até 1h de tolerância
        habit:           15 * 60 * 1000,   // 15min — hábitos: janela curta
        scheduled_order: 10 * 60 * 1000,   // 10min — pedido: vence rápido
      };
      const DEFAULT_GRACE_MS = 30 * 60 * 1000; // 30min pra tudo mais
      const ageMs = now.getTime() - new Date(reminder.send_at).getTime();
      const graceMs = GRACE_MS[reminder.source ?? ""] ?? DEFAULT_GRACE_MS;

      if (ageMs > graceMs) {
        await supabase
          .from("reminders")
          .update({ status: "cancelled" } as any)
          .eq("id", reminder.id);
        console.log(
          `[stale-skip] reminder=${reminder.id} source=${reminder.source} age=${Math.round(ageMs / 60000)}min grace=${Math.round(graceMs / 60000)}min`
        );
        // Recorrentes: avança para a próxima ocorrência no futuro
        if (reminder.recurrence && reminder.recurrence !== "none") {
          const sendAt = new Date(reminder.send_at);
          let next = nextOccurrence(sendAt, reminder.recurrence, reminder.recurrence_value ?? null);
          let iter = 0;
          while (next && next.getTime() <= now.getTime() && iter < 100) {
            next = nextOccurrence(next, reminder.recurrence, reminder.recurrence_value ?? null);
            iter++;
          }
          if (next && next.getTime() > now.getTime()) {
            const { error: nextErr } = await supabase.from("reminders").insert({
              user_id:          reminder.user_id,
              whatsapp_number:  reminder.whatsapp_number,
              title:            reminder.title,
              message:          reminder.message,
              send_at:          next.toISOString(),
              recurrence:       reminder.recurrence,
              recurrence_value: reminder.recurrence_value,
              source:           reminder.source ?? "whatsapp",
              status:           "pending",
              habit_id:         reminder.habit_id ?? null,
            } as any);
            if (!nextErr || nextErr.code === "23505") scheduled++;
          }
        }
        continue;
      }

      // ─── Guard: reminder de hábito só dispara se o hábito existir e estiver ativo ──
      if (reminder.source === "habit" && !reminder.habit_id) {
        // Zombie: reminder marcado como hábito mas sem habit_id (órfão de deleção antiga).
        // Cancela pra não replicar mais.
        await supabase
          .from("reminders")
          .update({ status: "cancelled" })
          .eq("id", reminder.id);
        continue;
      }
      if (reminder.habit_id) {
        const { data: habit } = await supabase
          .from("habits" as any)
          .select("id, is_active, target_days")
          .eq("id", reminder.habit_id)
          .maybeSingle();
        if (!habit || !(habit as any).is_active) {
          // Hábito foi deletado ou pausado — cancela este reminder e não reagenda
          await supabase
            .from("reminders")
            .update({ status: "cancelled" })
            .eq("id", reminder.id);
          continue;
        }

        // ─── Filtro target_days (ex: "Desativar finais de semana" = [1..5]) ───
        // Se o hábito define dias específicos e HOJE não está na lista, pula
        // o envio e reagenda pra próxima ocorrência num dia válido.
        const targetDays = parseTargetDays((habit as any).target_days);
        if (targetDays.length > 0 && targetDays.length < 7) {
          const userTz = reminder.user_id ? await getUserTz(reminder.user_id) : "America/Sao_Paulo";
          const todayDow = dayOfWeekInTz(now, userTz);
          if (!targetDays.includes(todayDow)) {
            console.log(
              `[skip-day] habit=${reminder.habit_id} reminder=${reminder.id} dow=${todayDow} target=${JSON.stringify(targetDays)} tz=${userTz}`
            );

            // Cria próxima ocorrência num dia válido (max 8 iterações pra cobrir 1 semana inteira)
            if (reminder.recurrence && reminder.recurrence !== "none") {
              const sendAt = new Date(reminder.send_at);
              let next: Date | null = nextOccurrence(sendAt, reminder.recurrence, reminder.recurrence_value ?? null);
              let iter = 0;
              while (next && !targetDays.includes(dayOfWeekInTz(next, userTz)) && iter < 8) {
                next = nextOccurrence(next, reminder.recurrence, reminder.recurrence_value ?? null);
                iter++;
              }
              if (next) {
                const { error: nextErr } = await supabase.from("reminders").insert({
                  user_id:          reminder.user_id,
                  whatsapp_number:  reminder.whatsapp_number,
                  title:            reminder.title,
                  message:          reminder.message,
                  send_at:          next.toISOString(),
                  recurrence:       reminder.recurrence,
                  recurrence_value: reminder.recurrence_value,
                  source:           reminder.source ?? "habit",
                  status:           "pending",
                  habit_id:         reminder.habit_id ?? null,
                } as any);
                if (nextErr && nextErr.code !== "23505") {
                  console.error(`[skip-day] failed to schedule next for ${reminder.id}:`, nextErr.message);
                }
              }
            }

            // Marca atual como sent (skip silencioso, sem erro)
            await supabase
              .from("reminders")
              .update({ status: "sent", sent_at: now.toISOString() })
              .eq("id", reminder.id);
            continue;
          }
        }
      }

      // ─── Delegação de envio: quando o lembrete é "enviar pro X..." ────────
      // Pergunta ao usuário se o Jarvis deve enviar ou se ele mesmo envia.
      const isDelegateReminder =
        reminder.source !== "send_to_contact" && // evita loop
        reminderHasSendToContact(reminder.title ?? "");

      // ─── Resolve conteúdo dinâmico para hábitos preset ────────────────────
      const finalMessage = resolveHabitMessage(reminder.message ?? "");

      // messageId retornado pelo Evolution. Usado pro webhook MESSAGES_UPDATE
      // correlacionar a entrega (delivery tracking). null se for delegate ou
      // se Evolution não devolver id.
      let mainMessageId: string | null = null;

      if (isDelegateReminder) {
        const sessionPhone = String(reminder.whatsapp_number ?? "").replace(/\D/g, "");
        await sendButtons(
          reminder.whatsapp_number,
          `⏰ Lembrete: ${reminder.title}`,
          `Quem envia essa mensagem?`,
          [
            { id: "DELEGATE_JARVIS", text: "🤖 Jarvis envia" },
            { id: "DELEGATE_ME",   text: "✉️ Eu mesmo envio" },
          ]
        );
        // Armazena na sessão para processar a resposta do botão
        await supabase.from("whatsapp_sessions").upsert(
          {
            user_id: reminder.user_id,
            phone_number: sessionPhone,
            pending_action: "reminder_delegate",
            pending_context: { contact_text: reminder.title },
            last_activity: now.toISOString(),
          },
          { onConflict: "phone_number" }
        );
      } else {
        // Envia mensagem principal. Se falhar, loga mas NÃO marca o reminder como failed
        // (o usuário já recebeu/vai receber — não queremos perder a lógica pós-envio).
        // warmUp=true: força refresh da sessão Signal antes do envio. Reminders
        // são enviados em horários programados onde o destino pode estar offline —
        // sem o warm-up, o WhatsApp pode entregar a msg em branco quando ele voltar.
        let mainSendOk = true;
        try {
          mainMessageId = await sendText(reminder.whatsapp_number, finalMessage, { warmUp: true });
        } catch (sendErr) {
          console.error(`[send-reminder] main sendText failed for ${reminder.id}:`, sendErr);
          mainSendOk = false;
        }
        // Se o envio principal falhou E é scheduled_order, avisa o usuário
        if (!mainSendOk && reminder.source === "scheduled_order" && reminder.user_id) {
          const oc = (reminder as any).order_context as Record<string, unknown> | null;
          if (oc?.user_phone && oc?.business_name) {
            await sendText(
              oc.user_phone as string,
              `⚠️ Não consegui entregar seu pedido agendado para *${oc.business_name}*. Tente fazer o pedido novamente.`
            ).catch((e) => console.error("[send-reminder] failure notify:", e));
          }
        }

        // Se for send_to_contact, cria relay_request para que a resposta
        // do contato seja repassada automaticamente ao usuario via Jarvis
        if (reminder.source === "send_to_contact" && reminder.user_id) {
          try {
            const toPhone = String(reminder.whatsapp_number ?? "").replace(/\D/g, "");
            // Busca telefone e config do usuario (sender) em paralelo
            const [profileRes, configRes] = await Promise.all([
              supabase.from("profiles").select("phone_number, display_name").eq("id", reminder.user_id).maybeSingle(),
              supabase.from("agent_configs").select("user_nickname, agent_name").eq("user_id", reminder.user_id).maybeSingle(),
            ]);
            const fromPhone = profileRes.data?.phone_number?.replace(/\D/g, "");
            const senderName = configRes.data?.user_nickname || profileRes.data?.display_name || null;
            const agentName  = configRes.data?.agent_name || "Jarvis";
            if (fromPhone && toPhone) {
              supabase.from("relay_requests").insert({
                from_user_id: reminder.user_id,
                from_phone:   fromPhone,
                to_phone:     toPhone,
                original_message: finalMessage,
                status:       "sent",
                sender_name:  senderName,
                agent_name:   agentName,
                expires_at:   new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
              }).then(() => {}).catch(() => {}); // fire-and-forget

              // Confirma pro usuario que a mensagem agendada foi enviada
              const contactName = reminder.title?.replace(/^Mensagem para /i, "") || "o contato";
              sendText(
                fromPhone,
                `✅ Mensagem enviada para *${contactName}*! 📨`
              ).catch(() => {}); // fire-and-forget
            }
          } catch (_relayErr) { /* nao quebra o fluxo de envio */ }
        }

        // ─── Pedido agendado: dispara pedido ao estabelecimento ───
        if (reminder.source === "scheduled_order" && reminder.user_id) {
          try {
            const ctx = (reminder as any).order_context as Record<string, unknown> | null;
            if (ctx) {
              const bizPhone   = ctx.business_phone as string;
              const bizName    = ctx.business_name  as string;
              const userPhone  = ctx.user_phone     as string;
              const userId     = ctx.user_id        as string;
              const senderName = (ctx.sender_name as string) || "seu usuário";

              // 1. Cria order_session de 3h (CRÍTICO: sem .catch() direto no supabase)
              const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
              try {
                const { error: sessErr } = await supabase.from("order_sessions").insert({
                  user_id:            userId,
                  user_phone:         userPhone,
                  business_phone:     bizPhone,
                  business_name:      bizName,
                  order_summary:      ctx.order_summary,
                  delivery_address:   ctx.delivery_address,
                  payment_preference: ctx.payment_preference,
                  status:             "active",
                  expires_at:         expiresAt,
                } as any);
                if (sessErr) console.error("[send-reminder] order_session insert:", sessErr);
              } catch (e) { console.error("[send-reminder] order_session exception:", e); }

              // 2. Cria follow-up de 1h30
              const followupAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
              const firstName = senderName.split(" ")[0] || "você";
              try {
                await supabase.from("reminders").insert({
                  user_id:          userId,
                  whatsapp_number:  userPhone,
                  title:            `Follow-up pedido ${bizName}`,
                  message:          `Oi ${firstName}! 🍕 Seu pedido na *${bizName}* já chegou?\n\nSe sim, me avisa (ex: _"já chegou"_, _"recebi o pedido"_) que eu encerro o atendimento com eles!`,
                  send_at:          followupAt,
                  recurrence:       "none",
                  recurrence_value: null,
                  source:           "order_followup",
                  status:           "pending",
                } as any);
              } catch (e) { console.error("[send-reminder] followup insert exception:", e); }

              // 3. Notifica o usuario que o pedido foi enviado (sendText retorna Promise — .catch aqui é seguro)
              try {
                await sendText(
                  userPhone,
                  `✅ Seu pedido agendado na *${bizName}* acabou de ser enviado! 🍕\n\nVou te avisar assim que eles responderem.`
                );
              } catch (e) { console.error("[send-reminder] sendText user confirm exception:", e); }
            }
          } catch (_orderErr) {
            console.error("[send-reminder] scheduled_order error:", _orderErr);
          }
        }
      }

      // Marca como enviado. Se temos messageId do Evolution, grava pra que o
      // webhook MESSAGES_UPDATE possa correlacionar e setar delivered_at depois.
      // Coluna evolution_message_id é opcional (default NULL) — só inclui no
      // update se temos valor, mantendo retro-compat caso a migration não tenha
      // sido aplicada ainda.
      const sentUpdate: Record<string, unknown> = {
        status: "sent",
        sent_at: now.toISOString(),
      };
      if (mainMessageId) {
        sentUpdate.evolution_message_id = mainMessageId;
      }
      await supabase
        .from("reminders")
        .update(sentUpdate as any)
        .eq("id", reminder.id);

      sent++;

      // ─── Followup pós-evento: define pending_action na sessão do usuário ───
      if (reminder.source === "event_followup" && reminder.user_id && reminder.whatsapp_number) {
        let eventType = "compromisso";
        if (reminder.event_id) {
          const { data: ev } = await supabase
            .from("events")
            .select("event_type, event_date, event_time")
            .eq("id", reminder.event_id)
            .maybeSingle();
          if (ev) eventType = ev.event_type ?? "compromisso";
        }
        // Seta pending_action na sessão do WhatsApp para capturar resposta do usuário
        await supabase.from("whatsapp_sessions").upsert(
          {
            user_id: reminder.user_id,
            phone_number: reminder.whatsapp_number,
            pending_action: "event_followup",
            pending_context: {
              event_id: reminder.event_id ?? null,
              event_title: reminder.title ?? "",
              event_type: eventType,
            },
            last_activity: now.toISOString(),
          },
          { onConflict: "phone_number" }
        );
      }

      // ── Recorrência: agenda próxima ocorrência ──────────────────
      if (reminder.recurrence && reminder.recurrence !== "none") {
        const sendAt = new Date(reminder.send_at);
        const next = nextOccurrence(sendAt, reminder.recurrence, reminder.recurrence_value ?? null);

        if (next) {
          // Sempre preserva reminder.message (inclui placeholders {{habit:xxx}})
          // para que resolveHabitMessage() selecione novo conteúdo a cada envio
          const { error: nextErr } = await supabase.from("reminders").insert({
            user_id: reminder.user_id,
            whatsapp_number: reminder.whatsapp_number,
            title: reminder.title,
            message: reminder.message,
            send_at: next.toISOString(),
            recurrence: reminder.recurrence,
            recurrence_value: reminder.recurrence_value,
            source: reminder.source ?? "whatsapp",
            status: "pending",
            habit_id: reminder.habit_id ?? null,
          } as any);
          if (nextErr) {
            // 23505 = unique violation → já existe reminder pendente pro mesmo horário (dedup OK, ignora)
            if (nextErr.code !== "23505") {
              console.error(`[send-reminder] Failed to schedule next occurrence for ${reminder.id}:`, nextErr.message);
            }
          } else {
            scheduled++;
          }
        }
      }
    } catch (err) {
      console.error(`Failed to send reminder ${reminder.id}:`, err);

      await supabase
        .from("reminders")
        .update({ status: "failed" })
        .eq("id", reminder.id);

      failed++;
    }
  }

  console.log(`Reminders: ${sent} sent, ${failed} failed, ${scheduled} next scheduled`);
  return new Response(JSON.stringify({ sent, failed, scheduled }));
});
