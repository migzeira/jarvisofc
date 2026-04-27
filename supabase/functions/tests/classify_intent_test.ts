/**
 * Testes unitários para classifyIntent e parsers de data/hora.
 * Executar: deno test supabase/functions/tests/
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  classifyIntent,
  isReminderDecline,
  isReminderAtTime,
  isReminderAccept,
  parseMinutes,
  parseReminderAnswer,
} from "../_shared/classify.ts";

// ─────────────────────────────────────────────
// greeting
// ─────────────────────────────────────────────

Deno.test("classifyIntent - greeting: 'oi'", () => {
  assertEquals(classifyIntent("oi"), "greeting");
});

Deno.test("classifyIntent - greeting: 'olá'", () => {
  assertEquals(classifyIntent("olá"), "greeting");
});

Deno.test("classifyIntent - greeting: 'bom dia'", () => {
  assertEquals(classifyIntent("bom dia"), "greeting");
});

Deno.test("classifyIntent - greeting: 'boa tarde'", () => {
  assertEquals(classifyIntent("boa tarde"), "greeting");
});

Deno.test("classifyIntent - greeting: 'boa noite'", () => {
  assertEquals(classifyIntent("boa noite"), "greeting");
});

Deno.test("classifyIntent - greeting: 'hello'", () => {
  assertEquals(classifyIntent("hello"), "greeting");
});

Deno.test("classifyIntent - greeting: 'oi tudo bem?'", () => {
  assertEquals(classifyIntent("oi tudo bem?"), "greeting");
});

// ─────────────────────────────────────────────
// finance_record
// ─────────────────────────────────────────────

Deno.test("classifyIntent - finance_record: 'gastei 50 reais de almoço'", () => {
  assertEquals(classifyIntent("gastei 50 reais de almoço"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'comprei pão por 5 reais'", () => {
  assertEquals(classifyIntent("comprei pão por 5 reais"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'paguei 200 no dentista'", () => {
  assertEquals(classifyIntent("paguei 200 no dentista"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'recebi meu salário'", () => {
  assertEquals(classifyIntent("recebi meu salário"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'ganhei 1000 de freelance'", () => {
  assertEquals(classifyIntent("ganhei 1000 de freelance"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'custou 30 reais'", () => {
  assertEquals(classifyIntent("custou 30 reais"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'recebi um pix de 500'", () => {
  assertEquals(classifyIntent("recebi um pix de 500"), "finance_record");
});

Deno.test("classifyIntent - finance_record: 'paguei a conta de luz'", () => {
  assertEquals(classifyIntent("paguei a conta de luz"), "finance_record");
});

// ─────────────────────────────────────────────
// finance_report
// ─────────────────────────────────────────────

Deno.test("classifyIntent - finance_report: 'quanto gastei esse mês'", () => {
  assertEquals(classifyIntent("quanto gastei esse mês"), "finance_report");
});

Deno.test("classifyIntent - finance_report: 'relatório de gastos'", () => {
  assertEquals(classifyIntent("relatório de gastos"), "finance_report");
});

Deno.test("classifyIntent - finance_report: 'meus gastos de hoje'", () => {
  assertEquals(classifyIntent("meus gastos de hoje"), "finance_report");
});

Deno.test("classifyIntent - finance_report: 'total de despesas'", () => {
  assertEquals(classifyIntent("total de despesas"), "finance_report");
});

Deno.test("classifyIntent - finance_report: 'quanto eu gastei essa semana'", () => {
  assertEquals(classifyIntent("quanto eu gastei essa semana"), "finance_report");
});

Deno.test("classifyIntent - finance_report: 'resumo dos gastos'", () => {
  assertEquals(classifyIntent("resumo dos gastos"), "finance_report");
});

// ─────────────────────────────────────────────
// budget_set
// ─────────────────────────────────────────────

Deno.test("classifyIntent - budget_set: 'quero gastar no máximo 2000 em alimentação'", () => {
  assertEquals(classifyIntent("quero gastar no máximo 2000 em alimentação"), "budget_set");
});

Deno.test("classifyIntent - budget_set: 'meu orçamento de alimentação é 500'", () => {
  assertEquals(classifyIntent("meu orçamento de alimentação é 500"), "budget_set");
});

Deno.test("classifyIntent - budget_set: 'limite de gasto em transporte 300'", () => {
  assertEquals(classifyIntent("limite de gasto em transporte 300"), "budget_set");
});

Deno.test("classifyIntent - budget_set: 'meta de gastos de 3000'", () => {
  assertEquals(classifyIntent("meta de gastos de 3000"), "budget_set");
});

// ─────────────────────────────────────────────
// habit_create
// ─────────────────────────────────────────────

Deno.test("classifyIntent - habit_create: 'quero criar hábito de exercício'", () => {
  assertEquals(classifyIntent("quero criar hábito de exercício"), "habit_create");
});

Deno.test("classifyIntent - habit_create: 'criar rotina de meditação'", () => {
  assertEquals(classifyIntent("criar rotina de meditação"), "habit_create");
});

Deno.test("classifyIntent - habit_create: 'novo hábito de beber água'", () => {
  assertEquals(classifyIntent("novo hábito de beber água"), "habit_create");
});

Deno.test("classifyIntent - habit_create: 'hábito de leitura todo dia'", () => {
  assertEquals(classifyIntent("hábito de leitura todo dia"), "habit_create");
});

// ─────────────────────────────────────────────
// habit_checkin
// ─────────────────────────────────────────────

Deno.test("classifyIntent - habit_checkin: 'fiz'", () => {
  assertEquals(classifyIntent("fiz"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: 'feito'", () => {
  assertEquals(classifyIntent("feito"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: 'pronto'", () => {
  assertEquals(classifyIntent("pronto"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: 'done'", () => {
  assertEquals(classifyIntent("done"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: '✅'", () => {
  assertEquals(classifyIntent("✅"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: '👍'", () => {
  assertEquals(classifyIntent("👍"), "habit_checkin");
});

Deno.test("classifyIntent - habit_checkin: 'fiz sim'", () => {
  assertEquals(classifyIntent("fiz sim"), "habit_checkin");
});

// ─────────────────────────────────────────────
// agenda_create
// ─────────────────────────────────────────────

Deno.test("classifyIntent - agenda_create: 'marcar reunião amanhã às 14h'", () => {
  assertEquals(classifyIntent("marcar reunião amanhã às 14h"), "agenda_create");
});

Deno.test("classifyIntent - agenda_create: 'agendar consulta médica'", () => {
  assertEquals(classifyIntent("agendar consulta médica"), "agenda_create");
});

Deno.test("classifyIntent - agenda_create: 'tenho reunião sexta às 10h'", () => {
  assertEquals(classifyIntent("tenho reunião sexta às 10h"), "agenda_create");
});

Deno.test("classifyIntent - agenda_create: 'colocar na agenda dentista'", () => {
  assertEquals(classifyIntent("colocar na agenda dentista"), "agenda_create");
});

Deno.test("classifyIntent - agenda_create: 'criar evento de treinamento'", () => {
  assertEquals(classifyIntent("criar evento de treinamento"), "agenda_create");
});

Deno.test("classifyIntent - agenda_create: 'marcar com o doutor na quinta'", () => {
  assertEquals(classifyIntent("marcar com o doutor na quinta"), "agenda_create");
});

// ─────────────────────────────────────────────
// agenda_query
// ─────────────────────────────────────────────

Deno.test("classifyIntent - agenda_query: 'o que tenho hoje'", () => {
  assertEquals(classifyIntent("o que tenho hoje"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query: 'minha agenda dessa semana'", () => {
  assertEquals(classifyIntent("minha agenda dessa semana"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query: 'próximos compromissos'", () => {
  assertEquals(classifyIntent("próximos compromissos"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query: 'tem algo marcado amanhã'", () => {
  assertEquals(classifyIntent("tem algo marcado amanhã"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query: 'compromissos da semana'", () => {
  assertEquals(classifyIntent("compromissos da semana"), "agenda_query");
});

// ─────────────────────────────────────────────
// notes_save
// ─────────────────────────────────────────────

Deno.test("classifyIntent - notes_save: 'anota: reunião com João'", () => {
  assertEquals(classifyIntent("anota: reunião com João"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'salva isso: ideia de negócio'", () => {
  assertEquals(classifyIntent("salva isso: ideia de negócio"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'guarda ai esse número: 12345'", () => {
  assertEquals(classifyIntent("guarda ai esse número: 12345"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'preciso lembrar de comprar leite'", () => {
  assertEquals(classifyIntent("preciso lembrar de comprar leite"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'para não esquecer: ligar pro banco'", () => {
  assertEquals(classifyIntent("para não esquecer: ligar pro banco"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'quero anotar um recado'", () => {
  assertEquals(classifyIntent("quero anotar um recado"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'anote esse endereço'", () => {
  assertEquals(classifyIntent("anote esse endereço"), "notes_save");
});

Deno.test("classifyIntent - notes_save: 'marca ai: senha 1234'", () => {
  assertEquals(classifyIntent("marca ai: senha 1234"), "notes_save");
});

// ─────────────────────────────────────────────
// reminder_set
// ─────────────────────────────────────────────

Deno.test("classifyIntent - reminder_set: 'me lembra de ligar amanhã às 14h'", () => {
  assertEquals(classifyIntent("me lembra de ligar amanhã às 14h"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'me avisa às 10h para reunião'", () => {
  assertEquals(classifyIntent("me avisa às 10h para reunião"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'quero um lembrete para sexta'", () => {
  assertEquals(classifyIntent("quero um lembrete para sexta"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'me lembre do dentista amanhã'", () => {
  assertEquals(classifyIntent("me lembre do dentista amanhã"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'me lembra desse lembrete 18h' (regression)", () => {
  assertEquals(classifyIntent("me lembra desse lembrete 18h"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'me lembra disso às 15h'", () => {
  assertEquals(classifyIntent("me lembra disso às 15h"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'você me lembra da reunião'", () => {
  assertEquals(classifyIntent("você me lembra da reunião"), "reminder_set");
});

Deno.test("classifyIntent - reminder_set: 'criar lembrete para reunião'", () => {
  assertEquals(classifyIntent("criar lembrete para reunião"), "reminder_set");
});

// ─────────────────────────────────────────────
// reminder_list
// ─────────────────────────────────────────────

Deno.test("classifyIntent - reminder_list: 'meus lembretes'", () => {
  assertEquals(classifyIntent("meus lembretes"), "reminder_list");
});

Deno.test("classifyIntent - reminder_list: 'quais são meus lembretes'", () => {
  assertEquals(classifyIntent("quais são meus lembretes"), "reminder_list");
});

Deno.test("classifyIntent - reminder_list: 'tenho lembretes pendentes'", () => {
  assertEquals(classifyIntent("tenho lembretes pendentes"), "reminder_list");
});

// ─────────────────────────────────────────────
// reminder_snooze
// ─────────────────────────────────────────────

Deno.test("classifyIntent - reminder_snooze: 'me lembra de novo daqui 30 minutos'", () => {
  assertEquals(classifyIntent("me lembra de novo daqui 30 minutos"), "reminder_snooze");
});

Deno.test("classifyIntent - reminder_snooze: 'snooze'", () => {
  assertEquals(classifyIntent("snooze"), "reminder_snooze");
});

Deno.test("classifyIntent - reminder_snooze: 'adiar'", () => {
  assertEquals(classifyIntent("adiar"), "reminder_snooze");
});

Deno.test("classifyIntent - reminder_snooze: 'adiar 15 minutos'", () => {
  assertEquals(classifyIntent("adiar 15 minutos"), "reminder_snooze");
});

// ─────────────────────────────────────────────
// ai_chat (should NOT be misclassified)
// ─────────────────────────────────────────────

Deno.test("classifyIntent - ai_chat: 'como você funciona'", () => {
  assertEquals(classifyIntent("como você funciona"), "ai_chat");
});

Deno.test("classifyIntent - ai_chat: 'me conta uma piada'", () => {
  assertEquals(classifyIntent("me conta uma piada"), "ai_chat");
});

Deno.test("classifyIntent - ai_chat: 'qual o sentido da vida'", () => {
  assertEquals(classifyIntent("qual o sentido da vida"), "ai_chat");
});

Deno.test("classifyIntent - ai_chat: 'obrigado pela ajuda'", () => {
  assertEquals(classifyIntent("obrigado pela ajuda"), "ai_chat");
});

Deno.test("classifyIntent - ai_chat: 'quanto é 2 + 2'", () => {
  assertEquals(classifyIntent("quanto é 2 + 2"), "ai_chat");
});

// ─────────────────────────────────────────────
// COLLISION tests (CRITICAL — easily misclassified)
// ─────────────────────────────────────────────

Deno.test("classifyIntent - collision: 'recebi um pix de 500' should be finance_record not reminder_set", () => {
  assertEquals(classifyIntent("recebi um pix de 500"), "finance_record");
});

Deno.test("classifyIntent - collision: 'me lembra desse lembrete 18h' should be reminder_set not ai_chat", () => {
  assertEquals(classifyIntent("me lembra desse lembrete 18h"), "reminder_set");
});

Deno.test("classifyIntent - collision: finance_report before finance_record (quanto gastei)", () => {
  assertEquals(classifyIntent("quanto gastei esse mês"), "finance_report");
  assertNotEquals(classifyIntent("quanto gastei esse mês"), "finance_record");
});

Deno.test("classifyIntent - collision: recurring before finance (netflix todo mês)", () => {
  assertEquals(classifyIntent("netflix todo mês 55 reais"), "recurring_create");
  assertNotEquals(classifyIntent("netflix todo mês 55 reais"), "finance_record");
});

Deno.test("classifyIntent - collision: snooze vs reminder_set ('me lembra de novo daqui 30 minutos')", () => {
  assertEquals(classifyIntent("me lembra de novo daqui 30 minutos"), "reminder_snooze");
  assertNotEquals(classifyIntent("me lembra de novo daqui 30 minutos"), "reminder_set");
});

Deno.test("classifyIntent - collision: 'paguei 200 no dentista' should be finance_record not agenda_create", () => {
  assertEquals(classifyIntent("paguei 200 no dentista"), "finance_record");
  assertNotEquals(classifyIntent("paguei 200 no dentista"), "agenda_create");
});

Deno.test("classifyIntent - collision: 'ganhei 1000 de freelance' should be finance_record not finance_report", () => {
  assertEquals(classifyIntent("ganhei 1000 de freelance"), "finance_record");
  assertNotEquals(classifyIntent("ganhei 1000 de freelance"), "finance_report");
});

Deno.test("classifyIntent - collision: 'criar lembrete para reunião' should be reminder_set not agenda_create", () => {
  assertEquals(classifyIntent("criar lembrete para reunião"), "reminder_set");
  assertNotEquals(classifyIntent("criar lembrete para reunião"), "agenda_create");
});

Deno.test("classifyIntent - collision: 'meus gastos de hoje' should be finance_report not notes_save", () => {
  assertEquals(classifyIntent("meus gastos de hoje"), "finance_report");
  assertNotEquals(classifyIntent("meus gastos de hoje"), "notes_save");
});

// ─────────────────────────────────────────────
// parseMinutes
// ─────────────────────────────────────────────

Deno.test("parseMinutes - '15 min' → 15", () => {
  assertEquals(parseMinutes("15 min"), 15);
});

Deno.test("parseMinutes - '15 minutos' → 15", () => {
  assertEquals(parseMinutes("15 minutos"), 15);
});

Deno.test("parseMinutes - '30 min' → 30", () => {
  assertEquals(parseMinutes("30 min"), 30);
});

Deno.test("parseMinutes - '1 hora' → 60", () => {
  assertEquals(parseMinutes("1 hora"), 60);
});

Deno.test("parseMinutes - '2 horas' → 120", () => {
  assertEquals(parseMinutes("2 horas"), 120);
});

Deno.test("parseMinutes - 'meia hora' → 30", () => {
  assertEquals(parseMinutes("meia hora"), 30);
});

Deno.test("parseMinutes - '45 minutos' → 45", () => {
  assertEquals(parseMinutes("45 minutos"), 45);
});

Deno.test("parseMinutes - 'só na hora' → 0 (avisa na hora)", () => {
  assertEquals(parseMinutes("só na hora"), 0);
});

Deno.test("parseMinutes - 'na hora' → 0", () => {
  assertEquals(parseMinutes("na hora"), 0);
});

Deno.test("parseMinutes - 'hora e meia' → 90", () => {
  assertEquals(parseMinutes("hora e meia"), 90);
});

Deno.test("parseMinutes - 'não precisa' → null (not a duration)", () => {
  assertEquals(parseMinutes("não precisa"), null);
});

Deno.test("parseMinutes - 'sim' → null", () => {
  assertEquals(parseMinutes("sim"), null);
});

Deno.test("parseMinutes - 'nao' → null", () => {
  assertEquals(parseMinutes("nao"), null);
});

// ─────────────────────────────────────────────
// isReminderDecline
// ─────────────────────────────────────────────

Deno.test("isReminderDecline - 'não precisa' → true", () => {
  assertEquals(isReminderDecline("não precisa"), true);
});

Deno.test("isReminderDecline - 'não' → true", () => {
  assertEquals(isReminderDecline("não"), true);
});

Deno.test("isReminderDecline - 'nao obrigado' → true", () => {
  assertEquals(isReminderDecline("nao obrigado"), true);
});

Deno.test("isReminderDecline - 'sem lembrete' → true", () => {
  assertEquals(isReminderDecline("sem lembrete"), true);
});

Deno.test("isReminderDecline - 'pode não' → true", () => {
  assertEquals(isReminderDecline("pode não"), true);
});

Deno.test("isReminderDecline - 'sim' → false", () => {
  assertEquals(isReminderDecline("sim"), false);
});

Deno.test("isReminderDecline - '15 min' → false", () => {
  assertEquals(isReminderDecline("15 min"), false);
});

Deno.test("isReminderDecline - 'dispenso' → true", () => {
  assertEquals(isReminderDecline("dispenso"), true);
});

// ─────────────────────────────────────────────
// isReminderAtTime
// ─────────────────────────────────────────────

Deno.test("isReminderAtTime - 'só na hora' → true", () => {
  assertEquals(isReminderAtTime("só na hora"), true);
});

Deno.test("isReminderAtTime - 'na hora' → true", () => {
  assertEquals(isReminderAtTime("na hora"), true);
});

Deno.test("isReminderAtTime - 'só na hora mesmo' → true", () => {
  assertEquals(isReminderAtTime("só na hora mesmo"), true);
});

Deno.test("isReminderAtTime - 'me avisa na hora' → true", () => {
  assertEquals(isReminderAtTime("me avisa na hora"), true);
});

Deno.test("isReminderAtTime - '15 minutos antes' → false", () => {
  assertEquals(isReminderAtTime("15 minutos antes"), false);
});

Deno.test("isReminderAtTime - '1 hora antes' → false", () => {
  assertEquals(isReminderAtTime("1 hora antes"), false);
});

Deno.test("isReminderAtTime - 'sim' → false", () => {
  assertEquals(isReminderAtTime("sim"), false);
});

// ─────────────────────────────────────────────
// isReminderAccept
// ─────────────────────────────────────────────

Deno.test("isReminderAccept - 'sim' → true", () => {
  assertEquals(isReminderAccept("sim"), true);
});

Deno.test("isReminderAccept - 'quero' → true", () => {
  assertEquals(isReminderAccept("quero"), true);
});

Deno.test("isReminderAccept - 'ok' → true", () => {
  assertEquals(isReminderAccept("ok"), true);
});

Deno.test("isReminderAccept - 'claro' → true", () => {
  assertEquals(isReminderAccept("claro"), true);
});

Deno.test("isReminderAccept - 'pode ser' → true", () => {
  assertEquals(isReminderAccept("pode ser"), true);
});

Deno.test("isReminderAccept - 'não' → false", () => {
  assertEquals(isReminderAccept("não"), false);
});

Deno.test("isReminderAccept - '15 min' → false", () => {
  assertEquals(isReminderAccept("15 min"), false);
});

Deno.test("isReminderAccept - 'quero ser lembrado' → true", () => {
  assertEquals(isReminderAccept("quero ser lembrado"), true);
});

// ─────────────────────────────────────────────
// Onda 2 — Novos intents + regex expandidos
// ─────────────────────────────────────────────

// category_list
Deno.test("classifyIntent - category_list: 'quais categorias tenho?'", () => {
  assertEquals(classifyIntent("quais categorias tenho?"), "category_list");
});

Deno.test("classifyIntent - category_list: 'mostra minhas categorias'", () => {
  assertEquals(classifyIntent("mostra minhas categorias"), "category_list");
});

Deno.test("classifyIntent - category_list: 'lista de categorias'", () => {
  assertEquals(classifyIntent("lista de categorias"), "category_list");
});

Deno.test("classifyIntent - category_list: 'minhas categorias'", () => {
  assertEquals(classifyIntent("minhas categorias"), "category_list");
});

// finance_delete
Deno.test("classifyIntent - finance_delete: 'apaga a última transação'", () => {
  assertEquals(classifyIntent("apaga a ultima transacao"), "finance_delete");
});

Deno.test("classifyIntent - finance_delete: 'apaga transação de 50 reais'", () => {
  assertEquals(classifyIntent("apaga transacao de 50 reais"), "finance_delete");
});

Deno.test("classifyIntent - finance_delete: 'deleta o gasto de mercado'", () => {
  assertEquals(classifyIntent("deleta o gasto de mercado"), "finance_delete");
});

Deno.test("classifyIntent - finance_delete: 'remove a ultima despesa'", () => {
  assertEquals(classifyIntent("remove a ultima despesa"), "finance_delete");
});

// finance_report expandido
Deno.test("classifyIntent - finance_report expandido: 'quanto gastei mês passado'", () => {
  assertEquals(classifyIntent("quanto gastei mes passado"), "finance_report");
});

Deno.test("classifyIntent - finance_report expandido: 'gastos de março'", () => {
  assertEquals(classifyIntent("gastos de marco"), "finance_report");
});

Deno.test("classifyIntent - finance_report expandido: 'quantas despesas esse mes'", () => {
  assertEquals(classifyIntent("quantas despesas esse mes"), "finance_report");
});

Deno.test("classifyIntent - finance_report expandido: 'meu saldo'", () => {
  assertEquals(classifyIntent("meu saldo"), "finance_report");
});

Deno.test("classifyIntent - finance_report expandido: 'extrato'", () => {
  assertEquals(classifyIntent("extrato"), "finance_report");
});

Deno.test("classifyIntent - finance_report expandido: 'quanto recebi ontem'", () => {
  assertEquals(classifyIntent("quanto recebi ontem"), "finance_report");
});

// agenda_query expandido
Deno.test("classifyIntent - agenda_query expandido: 'quais compromissos tenho amanhã?'", () => {
  assertEquals(classifyIntent("quais compromissos tenho amanha?"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query expandido: 'quantos eventos hoje?'", () => {
  assertEquals(classifyIntent("quantos eventos hoje?"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query expandido: 'qual é meu próximo compromisso?'", () => {
  assertEquals(classifyIntent("qual e meu proximo compromisso?"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query expandido: 'primeiro compromisso'", () => {
  assertEquals(classifyIntent("primeiro compromisso"), "agenda_query");
});

Deno.test("classifyIntent - agenda_query expandido: 'tenho algum compromisso amanhã?'", () => {
  assertEquals(classifyIntent("tenho algum compromisso amanha?"), "agenda_query");
});

// reminder_list expandido
Deno.test("classifyIntent - reminder_list expandido: 'quantos lembretes tenho?'", () => {
  assertEquals(classifyIntent("quantos lembretes tenho?"), "reminder_list");
});

Deno.test("classifyIntent - reminder_list expandido: 'qual é meu próximo lembrete?'", () => {
  assertEquals(classifyIntent("qual e meu proximo lembrete?"), "reminder_list");
});

Deno.test("classifyIntent - reminder_list expandido: 'lembretes de hoje'", () => {
  assertEquals(classifyIntent("lembretes de hoje"), "reminder_list");
});

Deno.test("classifyIntent - reminder_list expandido: 'próximo lembrete'", () => {
  assertEquals(classifyIntent("proximo lembrete"), "reminder_list");
});

// reminder_snooze expandido
Deno.test("classifyIntent - reminder_snooze expandido: 'snooze por 2 horas'", () => {
  assertEquals(classifyIntent("snooze por 2 horas"), "reminder_snooze");
});

Deno.test("classifyIntent - reminder_snooze expandido: 'adia por 30 minutos'", () => {
  assertEquals(classifyIntent("adia por 30 minutos"), "reminder_snooze");
});

// ─────────────────────────────────────────────
// Testes de regressão — garantir que fixes não quebraram nada
// ─────────────────────────────────────────────

// finance_record ainda funciona (não colide com novos finance_report/finance_delete)
Deno.test("classifyIntent regressão: 'gastei 50 no mercado' ainda é finance_record", () => {
  assertEquals(classifyIntent("gastei 50 no mercado"), "finance_record");
});

Deno.test("classifyIntent regressão: 'paguei 200 no aluguel' ainda é finance_record", () => {
  assertEquals(classifyIntent("paguei 200 no aluguel"), "finance_record");
});

// reminder_set ainda funciona (não colide com reminder_list expandido)
Deno.test("classifyIntent regressão: 'me lembra daqui 30 min' ainda é reminder_set", () => {
  assertEquals(classifyIntent("me lembra daqui 30 min sobre cafe"), "reminder_set");
});

// greeting ainda pega "oi"
Deno.test("classifyIntent regressão: 'oi' ainda é greeting", () => {
  assertEquals(classifyIntent("oi"), "greeting");
});

// agenda_create ainda pega "marcar reunião"
Deno.test("classifyIntent regressão: 'marcar reunião amanha' ainda é agenda_create", () => {
  assertEquals(classifyIntent("marcar reuniao amanha"), "agenda_create");
});

// budget_set ainda pega
Deno.test("classifyIntent regressão: 'quero gastar no maximo 500 em alimentacao'", () => {
  assertEquals(classifyIntent("quero gastar no maximo 500 em alimentacao"), "budget_set");
});

// ─────────────────────────────────────────────
// parseReminderAnswer — parser unificado de resposta
// (cobre o bug do Guilherme: "sim me avisa antes" caía em loop)
// ─────────────────────────────────────────────

// ── ACCEPT_NO_TIME (afirmação sem tempo específico) ──

Deno.test("parseReminderAnswer - 'sim, me avisa antes' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("sim, me avisa antes").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'sim me avisa antes' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("sim me avisa antes").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'sim avisa antes' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("sim avisa antes").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'sim me avisa' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("sim me avisa").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'claro' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("claro").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'pode me avisar' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("pode me avisar").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'pode' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("pode").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'beleza' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("beleza").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'ok me avisa antes' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("ok me avisa antes").kind, "accept_no_time");
});

Deno.test("parseReminderAnswer - 'quero ser lembrado' → accept_no_time", () => {
  assertEquals(parseReminderAnswer("quero ser lembrado").kind, "accept_no_time");
});

// ── ACCEPT_WITH_TIME (afirmação + tempo na mesma frase) ──

Deno.test("parseReminderAnswer - 'sim me avisa 30 min antes' → accept_with_time, 30", () => {
  const r = parseReminderAnswer("sim me avisa 30 min antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 30);
});

Deno.test("parseReminderAnswer - 'sim, 2 horas antes' → accept_with_time, 120", () => {
  const r = parseReminderAnswer("sim, 2 horas antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 120);
});

Deno.test("parseReminderAnswer - 'sim, uma hora antes' → accept_with_time, 60", () => {
  const r = parseReminderAnswer("sim, uma hora antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 60);
});

Deno.test("parseReminderAnswer - 'me avisa 15min antes' → accept_with_time, 15", () => {
  const r = parseReminderAnswer("me avisa 15min antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 15);
});

Deno.test("parseReminderAnswer - 'claro, 30 minutos antes' → accept_with_time, 30", () => {
  const r = parseReminderAnswer("claro, 30 minutos antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 30);
});

Deno.test("parseReminderAnswer - 'meia hora antes' → accept_with_time, 30", () => {
  const r = parseReminderAnswer("meia hora antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 30);
});

Deno.test("parseReminderAnswer - 'hora e meia antes' → accept_with_time, 90", () => {
  const r = parseReminderAnswer("hora e meia antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 90);
});

Deno.test("parseReminderAnswer - 'duas horas antes' → accept_with_time, 120", () => {
  const r = parseReminderAnswer("duas horas antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 120);
});

Deno.test("parseReminderAnswer - 'manda 15min antes blz' → accept_with_time, 15", () => {
  const r = parseReminderAnswer("manda 15min antes blz");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 15);
});

Deno.test("parseReminderAnswer - '1h antes' → accept_with_time, 60", () => {
  const r = parseReminderAnswer("1h antes");
  assertEquals(r.kind, "accept_with_time");
  if (r.kind === "accept_with_time") assertEquals(r.minutes, 60);
});

// ── AT_TIME (avisar exatamente no horário) ──

Deno.test("parseReminderAnswer - 'só na hora' → at_time", () => {
  assertEquals(parseReminderAnswer("só na hora").kind, "at_time");
});

Deno.test("parseReminderAnswer - 'sim me avisa na hora' → at_time", () => {
  assertEquals(parseReminderAnswer("sim me avisa na hora").kind, "at_time");
});

Deno.test("parseReminderAnswer - 'no horário' → at_time", () => {
  assertEquals(parseReminderAnswer("no horário").kind, "at_time");
});

Deno.test("parseReminderAnswer - 'na hora' → at_time", () => {
  assertEquals(parseReminderAnswer("na hora").kind, "at_time");
});

Deno.test("parseReminderAnswer - 'avisa na hora exata' → at_time", () => {
  assertEquals(parseReminderAnswer("avisa na hora exata").kind, "at_time");
});

// ── DECLINE (recusa) ──

Deno.test("parseReminderAnswer - 'não' → decline", () => {
  assertEquals(parseReminderAnswer("não").kind, "decline");
});

Deno.test("parseReminderAnswer - 'não precisa' → decline", () => {
  assertEquals(parseReminderAnswer("não precisa").kind, "decline");
});

Deno.test("parseReminderAnswer - 'nem precisa' → decline", () => {
  assertEquals(parseReminderAnswer("nem precisa").kind, "decline");
});

Deno.test("parseReminderAnswer - 'dispensa' → decline", () => {
  assertEquals(parseReminderAnswer("dispensa").kind, "decline");
});

Deno.test("parseReminderAnswer - 'deixa pra lá' → decline", () => {
  assertEquals(parseReminderAnswer("deixa pra lá").kind, "decline");
});

Deno.test("parseReminderAnswer - 'sem lembrete' → decline", () => {
  assertEquals(parseReminderAnswer("sem lembrete").kind, "decline");
});

Deno.test("parseReminderAnswer - 'pode esquecer' → decline", () => {
  assertEquals(parseReminderAnswer("pode esquecer").kind, "decline");
});

// ── UNKNOWN (resposta ambígua que precisa de fallback IA ou pergunta) ──

Deno.test("parseReminderAnswer - 'talvez' → unknown", () => {
  assertEquals(parseReminderAnswer("talvez").kind, "unknown");
});

Deno.test("parseReminderAnswer - '' (vazio) → unknown", () => {
  assertEquals(parseReminderAnswer("").kind, "unknown");
});

Deno.test("parseReminderAnswer - resposta sem sentido → unknown", () => {
  assertEquals(parseReminderAnswer("xyzabc").kind, "unknown");
});

// ── REGRESSÃO: garantir que funções antigas continuam funcionando ──
Deno.test("regressão - isReminderAccept('sim') ainda retorna true", () => {
  assertEquals(isReminderAccept("sim"), true);
});

Deno.test("regressão - isReminderDecline('não precisa') ainda retorna true", () => {
  assertEquals(isReminderDecline("não precisa"), true);
});

Deno.test("regressão - isReminderAtTime('só na hora') ainda retorna true", () => {
  assertEquals(isReminderAtTime("só na hora"), true);
});

Deno.test("regressão - parseMinutes('30 min') ainda retorna 30", () => {
  assertEquals(parseMinutes("30 min"), 30);
});
