/**
 * classify.ts — pure intent classification and parser helpers.
 * Extracted from whatsapp-webhook for testability.
 * No external dependencies (no Supabase, no Evolution API).
 */

// INTENT CLASSIFIER (regex first, sem custo IA)
// ─────────────────────────────────────────────
export type Intent =
  | "greeting"
  | "finance_record"
  | "finance_report"
  | "finance_delete"
  | "installment_query"
  | "category_list"
  | "budget_set"
  | "budget_query"
  | "recurring_create"
  | "habit_create"
  | "habit_checkin"
  | "habit_checkin_choose"
  | "notes_list"
  | "notes_delete"
  | "notes_delete_confirm"
  | "agenda_create"
  | "agenda_query"
  | "agenda_lookup"
  | "agenda_edit"
  | "agenda_delete"
  | "notes_save"
  | "reminder_set"
  | "reminder_list"
  | "reminder_cancel"
  | "reminder_edit"
  | "reminder_snooze"
  | "event_followup"
  | "statement_import"
  | "shadow_finance_confirm"
  | "shadow_event_confirm"
  | "shadow_reminder_confirm"
  | "order_on_behalf"
  | "send_to_contact"
  | "schedule_meeting"
  | "meeting_invite_confirm"
  | "contact_save"
  | "contact_save_confirm"
  | "contact_save_type"
  | "contact_save_category"
  | "contact_delete"
  | "contact_delete_confirm"
  | "list_contacts"
  | "reminder_delegate"
  | "finance_delete_confirm"
  | "agenda_edit_choose"
  | "anota_ambiguous"
  | "ai_chat";

export function classifyIntent(msg: string): Intent {
  const m = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Saudação simples — deve ser primeira verificação (antes de qualquer outro intent)
  if (
    /^(oi|ola|olá|hello|hi|hey|bom dia|boa tarde|boa noite|hola|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|good evening|good night|e ai|e aí|salve|fala|opa|tudo bem|tudo bom|como vai|como estas|como esta)[\s!,?.]*$/.test(m)
  )
    return "greeting";

  // Consultar orçamento/meta — verificado ANTES de budget_set para evitar falso positivo
  if (
    /como.{0,10}(estou|esta|ta).{0,10}orcamento/.test(m) ||
    /\bmeu(s)?\s+orcamentos?\b/.test(m) ||
    /\bminha(s)?\s+(meta|metas)\b/.test(m) ||
    /\bstatus.{0,10}(orcamento|limite)/.test(m) ||
    /\b(quais|ver|lista(r)?|mostra(r)?|mostre|veja|exib[ei])\s+(s[aã]o\s+)?(meus\s+|os\s+)?(orcamentos?|metas?|limites?)\b/.test(m) ||
    /\b(todos?|todas?)\s+(meus\s+|os\s+)?(orcamentos?|metas?|limites?)\b/.test(m) ||
    /\borcamento\s+de\s+(alimenta|transport|morad|saude|lazer|educa|trabalh|outros)\b/.test(m) ||
    /\borcamento\s+(atual|mensal|do\s+mes|esse\s+mes|este\s+mes)\b/.test(m) ||
    /\bmeta de (gasto|alimenta|transport|morad|saude|lazer|educa|trabalh)/.test(m) ||
    /^orcamentos?\s*\??$/.test(m) ||
    /\bmeus\s+limites?\b/.test(m) ||
    /\bquanto\s+(posso\s+)?gastar\b/.test(m) ||
    /\bquanto\s+me\s+sobra\b/.test(m) ||
    /\b(to|estou|fico)\s+dentro\s+do\s+orcamento\b/.test(m) ||
    /\bestourei\s+(algum|o|meu)?\s*orcamento\b/.test(m) ||
    /\btem\s+algum\s+orcamento\s+(no\s+limite|estourado|ultrapassado)\b/.test(m) ||
    /\bresumo\s+(dos?|de)\s+(meus\s+)?orcamentos?\b/.test(m) ||
    /\bquanto\s+tenho\s+(de|em|pra?|para)\s+(alimenta|transport|morad|saude|lazer|educa|trabalh|outros)\b/.test(m) ||
    /\bainda\s+tenho\s+limite\s+(em|de|pra?|para)\b/.test(m)
  )
    return "budget_query";

  // Definir orçamento/meta — requer valor numérico ou palavra de limite explícita
  if (
    /maximo.{0,20}(gastar|gasto)/.test(m) ||
    /quero gastar no maximo/.test(m) ||
    /definir (orcamento|meta|limite)/.test(m) ||
    /criar (orcamento|meta|limite)/.test(m) ||
    /limite.{0,15}(de |pra |para ).{0,20}\d/.test(m) ||
    /meta.{0,15}(de |pra |para )?(gasto|gastar).{0,20}\d/.test(m) ||
    /orcamento.{0,15}(de |pra |para ).{0,20}\d/.test(m)
  )
    return "budget_set";

  // Criar habito
  if (
    /(criar|quero|adicionar|comecar|iniciar|novo).{0,15}(habito|rotina|costume)|habito de .{3,}|rotina de .{3,}/.test(m)
  )
    return "habit_create";

  // Check-in de habito (respostas curtas apos lembrete)
  if (
    /^(fiz|feito|pronto|concluido|completo|done|check|✅|✔️|👍|sim fiz|fiz sim|ja fiz)\s*[!.]?$/.test(m)
  )
    return "habit_checkin";

  // Transação recorrente (antes de finance_record)
  if (
    /todo (dia|mes|m[eê]s|semana|ano).{0,30}(pago|gasto|recebo|ganho|cobr|custa|debito|aluguel|salario|netflix|spotify|gym|academia|assinatura|mensalidade|parcela|fatura|conta de)/i.test(m) ||
    /(aluguel|salario|sal[aá]rio|netflix|spotify|academia|mensalidade|assinatura|parcela|fatura).{0,20}(todo|mensal|semanal|diario)/i.test(m) ||
    /(criar|adicionar|cadastrar|registrar).{0,10}(recorrente|fixo|fixa)/i.test(m)
  )
    return "recurring_create";

  // Consultar parcelas ativas
  // "quantas parcelas tenho?", "minhas parcelas", "parcelas ativas"
  if (
    /\b(quantas|minhas|quais|lista(r)?|mostra(r)?|ver)\s+(s[ãa]o\s+)?(minhas\s+|as\s+|de\s+)?parcelas?\b/.test(m) ||
    /\bparcelas?\s+(ativa|ativas|pendente|pendentes|abertas?|restantes?)\b/.test(m) ||
    /^parcelas?\s*\??$/.test(m)
  )
    return "installment_query";

  // Listar categorias (antes de finance_report pra priorizar)
  // "quais categorias tenho?" / "mostra minhas categorias" / "lista de categorias"
  if (
    /\b(quais|minhas|liste?|lista(r)?|mostra(r)?|ver|veja|mostre)\s+(s[ãa]o\s+)?(minhas\s+|as\s+|de\s+|das\s+|os\s+)?categorias?\b/.test(m) ||
    /^(categorias?|minhas categorias)\s*\??$/.test(m) ||
    /\b(que|quais)\s+categorias?\s+(eu\s+)?(tenho|existe|temos)\b/.test(m)
  )
    return "category_list";

  // Deletar/apagar transação (antes de finance_record pra priorizar)
  // "apaga transação de 50 reais" / "remove o gasto de mercado" / "deleta a ultima transacao"
  if (
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|cancela(r)?)\s+(a\s+|o\s+|as\s+|os\s+|meu\s+|minha\s+)?(ultima?|ultimo|ultimas?|ultimos|recente|mais\s+recente)\s+(transacao|transacoes|gasto|gastos|despesa|despesas|receita|receitas|lancamento|lancamentos)\b/.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?)\s+(a\s+|o\s+|meu\s+|minha\s+)?(transacao|gasto|despesa|receita|lancamento)\s+(de|do|da)\s+/.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?)\s+(aquele|aquela|esse|essa|meu|minha)\s+(gasto|despesa|transacao|receita|lancamento)/.test(m)
  )
    return "finance_delete";

  // Relatório financeiro (antes de finance_record para evitar falso positivo)
  // Expandido: inclui "quanto", "quantos", "quantas", "qual", "mes passado", "semana passada",
  // "ano passado", "media", "gasto medio", nomes de mês, "em [categoria]", etc.
  if (
    /quanto.{0,15}(gastei|ganhei|recebi|devo|entrou|saiu|sobrou|restou)/.test(m) ||
    /quant[ao]s\s+(gastos?|despesas?|receitas?|transacoes?|lancamentos?|reais)\s+/.test(m) ||
    /total (de |dos |das )?(gastos?|despesas?|receitas?)/.test(m) ||
    /\b(relat[oó]rio|resumo)\b.*(financ|gasto|despesa|receita|mes|semana|hoje|ontem)/.test(m) ||
    /^(relat[oó]rio|resumo)\s*(financeiro|do mes|da semana|de hoje|de ontem)?\s*\??$/.test(m) ||
    /\b(meus|minhas)\s+(gastos?|despesas?|receitas?|lancamentos?)\b/.test(m) ||
    /\bgast[oa]s?\s+(de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(m) ||
    /\b(gasto|despesa|receita)\s+(medi[oa]|total|geral)\b/.test(m) ||
    /\b(qual|quanto|como)\s+(e|esta|foi|ficou)\s+(meu|minha)\s+(saldo|balanco|financeiro|extrato)\b/.test(m) ||
    /\bmeu\s+(saldo|balanco|extrato)\b/.test(m) ||
    /\bextrato\b/.test(m) ||
    /\bgastei\s+(mais|menos|muito|pouco)\s+(com|em|de)\s+/.test(m) ||
    // "em alimentação mês passado?" — pergunta implícita
    /\b(em|com|de)\s+\w+\s+(mes\s+passado|semana\s+passada|ano\s+passado|anterior)\b/.test(m)
  )
    return "finance_report";

  // Registro financeiro — expandido
  if (
    /gastei|comprei|paguei|recebi|ganhei|custou|vale |custa |despesa|despendi|gasei|gasto|gasta|sai|saiu|de quanto/.test(m)
  )
    return "finance_record";

  // Salvar contato digitado (nome + número no texto)
  // "salva o contato João 11999" / "adiciona o João: 11999" / "guarda o numero da Cibele 11999"
  if (
    /\b(salva(r)?|adiciona(r)?|cadastra(r)?|guarda(r)?|registra(r)?|anota(r)?|coloca(r)?|armazena(r)?)\s+(o\s+|a\s+)?(contato|numero|telefone)\s+(d[oa]\s+|do\s+meu\s+|da\s+minha\s+)?[A-ZÁÉÍÓÚ]/i.test(m) ||
    /\b(salva(r)?|adiciona(r)?|cadastra(r)?|guarda(r)?|registra(r)?|anota(r)?|coloca(r)?|armazena(r)?)\s+(o\s+)?[A-ZÁÉÍÓÚ][a-záéíóú]+.{0,20}\d{8,}/i.test(m)
  )
    return "contact_save";

  // Agendar reunião com Google Meet COM um contato (nome após "com")
  // Dispara pra qualquer "marca/agenda/cria reunião/call com [Nome]" — handler
  // cria o evento, e SE o nome for um contato salvo, pergunta se quer enviar
  // o convite pra essa pessoa. Se nao for contato salvo, fallback pra agenda_create.
  // Ex: "marca reunião com Cibele amanhã 10h sobre dinheiro"
  //     "agenda call com João sexta 14h"
  //     "marca reuniao com Guilherme e manda o link pra ele" (compatível com pedido explícito)
  if (
    // Permite palavras intermediárias entre o substantivo e "com [Nome]"
    // ex: "marca reuniao sexta 12h com o roberto", "agenda call amanha 14h com joao"
    /\b(marca(r)?|agenda(r)?|cria(r)?|marcar)\s+(uma?\s+)?(reuniao|meeting|call|chamada|videochamada|videoconferencia|conferencia)\b.{0,80}?\bcom\s+(o\s+|a\s+|os\s+|as\s+)?[a-záéíóúâêîôûãõç][a-záéíóúâêîôûãõç]+/i.test(m)
  )
    return "schedule_meeting";

  // Listar contatos salvos no Jarvis
  if (
    /\b(meus|minha|quais|lista(r)?|mostra(r)?|ver|veja|mostre)\s+(os\s+)?(meus\s+)?(contatos?|numeros?|pessoas?)\s*(salvos?|cadastrados?|da maya|do jarvis|que tenho)?\b/i.test(m) ||
    /\bquem\s+(tenho|esta|estao|tenho\s+salvo)\s*(nos\s+)?(contatos?|agenda)?\b/i.test(m) ||
    /\bcontatos?\s+salvos?\b/i.test(m)
  )
    return "list_contacts";

  // Fazer pedido em nome do usuario em um estabelecimento
  // "pede uma pizza de calabresa na pizzaria kadalora"
  // "faz um pedido no restaurante X" / "pizzaria maya faz um pedido"
  // "pede um remedio na farmacia" / "pede uma pizza pra mim"
  // Deve vir ANTES de send_to_contact para nao ser confundido
  if (
    // verbo ANTES do lugar: "faz um pedido na pizzaria X"
    /\b(ped(e|ir|ido)|faz(er)?\s+um\s+pedido|encomend(a|ar)|comand(a|ar))\b.{0,60}?\b(n[ao]\s+|n[ao]\s+)(pizzaria|restaurante|farmacia|mercado|padaria|lanchonete|sushi|hamburguer|acai|loja|estabelecimento)/i.test(m) ||
    // lugar ANTES do verbo: "pizzaria maya faz um pedido"
    /\b(pizzaria|restaurante|farmacia|mercado|padaria|lanchonete|hamburgueria|acai|loja|estabelecimento)\b.{0,40}?\b(ped(e|ir|ido)|faz(er)?\s+(um\s+)?pedido|encomend(a|ar))\b/i.test(m) ||
    // "pede pizza/lanche/etc" genérico
    /\b(ped(e|ir))\b.{0,40}?\b(pizza|hamburguer|lanche|sushi|comida|remedio|medicamento|acai|delivery)\b/i.test(m) ||
    // "pedir uma X na Y"
    /\b(pedir|pecar|encomendar)\s+(uma?|um)\s+\w.{0,60}?\b(n[ao]\s+|n[ao]\s+)\w/i.test(m) ||
    // "faz pedido na/para/pra"
    /\bfaz(er)?\s+(um\s+)?(pedido|order)\b.{0,60}?\b(n[ao]|para|pra)\b/i.test(m) ||
    // "faz um pedido" sem preposição (intent claro pelo contexto)
    /\bfaz(er)?\s+um\s+pedido\b/i.test(m) ||
    // "pede pra mim na pizzaria" / "pede pra mim por favor"
    /\b(ped(e|ir))\b.{0,20}?\b(pra mim|para mim)\b.{0,40}?\b(n[ao]|na|por favor)\b/i.test(m)
  )
    return "order_on_behalf";

  // Enviar mensagem para um contato salvo
  // "manda mensagem pra cibele dizendo X" / "manda uma mensagem pro Joao que..."
  // "fala pra/pro X que..." / "daqui 30min manda pra X..."
  if (
    (// "manda uma mensagem [agora/já/aqui/...] pra João dizendo..."
     // .{0,25}? permite palavras intermediárias entre "mensagem" e "pra/pro"
     /\b(manda(r)?|envia(r)?|fala(r)?|diz(er)?|avisa(r)?|escreve(r)?)\s+(uma?\s+)?(mensagem|msg)?.{0,25}?(pra|para|pro|ao)\s+\w/i.test(m) ||
    /\b(fala(r)?|diz(er)?|avisa(r)?)\s+(pra|para|pro|ao)\s+\w+\s+(que|dizendo|falando|sobre)/i.test(m) ||
    /\b(manda(r)?|envia(r)?)\s+(pra|para|pro|ao)\s+\w+\s+(dizendo|falando|contando)/i.test(m)) &&
    !/\b(lembrete|reminder|me avisa|me lembra|agenda|marcar)\b/i.test(m)
  )
    return "send_to_contact";

  // Criar agenda
  if (
    /marca(r)?( na| uma| pra)?(\s+(minha|sua|nossa))?\s+(agenda|reuniao|meeting|compromisso|consulta|evento|call|chamada)|agendar|marcar reuniao|tenho (reuniao|consulta|compromisso|medico|dentista|medica|aula|treino|academia|voo|entrevista|exame|evento|cirurgia|apresentacao|aniversario|palestra)|colocar na (minha )?agenda|adicionar na (minha )?agenda|criar evento|novo compromisso|nova reuniao|nova consulta|novo evento|agenda dia \d|vou ao (medico|dentista|hospital|especialista)|vou a (clinica|consulta)|preciso ir ao (medico|dentista|hospital)|marcar com o (medico|dentista|doutor|dra|dr)|marca (uma )?reuniao|agenda (uma )?consulta|tenho que ir ao/.test(
      m
    ) ||
    // Verbos imperativos de criação: "cria/crie/criar uma reuniao", "faz uma reuniao", "bota/coloca/poe na agenda"
    /\b(cria(r)?|crie|faz(er)?|faca|faça|bota(r)?|coloca(r)?|poe|por|adiciona(r)?|inclui(r)?|salva(r)?|registra(r)?|monta(r)?|monte)\b.{0,30}\b(reuniao|reunioes|meeting|call|chamada|compromisso|consulta|evento|agenda|sessao|appointment)\b/.test(m) ||
    // "quero/preciso/vou marcar|agendar|criar reuniao|evento..."
    /\b(quero|queria|preciso|vou|gostaria de|pode)\b.{0,20}\b(marcar|agendar|cria(r)?|criar|adiciona(r)?|colocar|incluir|salvar|registrar|montar|botar)\b.{0,30}\b(reuniao|meeting|call|chamada|compromisso|consulta|evento|agenda|sessao|appointment)?\b/.test(m) ||
    // Forma minimalista com horário: "reuniao 10h", "reuniao amanha 10h", "consulta sexta 14:30", "call 15h com fulano"
    /^(reuniao|reunioes|meeting|call|chamada|compromisso|consulta|evento|sessao|appointment|aula|treino|academia|voo|entrevista|exame|cirurgia|apresentacao)\b.{0,60}(\d{1,2}\s*[h:]\d{0,2}|\d{1,2}\s*horas?|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|dia \d|às |as |ao meio dia|ao meio-dia)/.test(m) ||
    // Mesma forma com horário ANTES: "10h reuniao", "amanha 10h reuniao com fulano"
    /\b(\d{1,2}\s*[h:]\d{0,2}|\d{1,2}\s*horas?)\b.{0,30}\b(reuniao|meeting|call|chamada|compromisso|consulta|evento|sessao|appointment|aula|treino|entrevista|exame|apresentacao)\b/.test(m) ||
    // Grupo 2 — confirmação passada: "marquei/agendei X pra/para Y"
    /\b(marquei|agendei)\b.{1,60}\b(pra|para|dia|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(m) ||
    // Grupo 3 — anúncio futuro: "vai ter X amanhã", "vou ter consulta sexta", "lembrei que tenho X"
    /\bvai ter\b.{1,50}\b(reuniao|consulta|compromisso|evento|aula|treino|voo|entrevista|exame|cirurgia|apresentacao|call|meeting)\b/.test(m) ||
    /\bvou ter\b.{1,50}\b(reuniao|consulta|compromisso|evento|aula|treino|voo|entrevista|exame|cirurgia|apresentacao|call|meeting)\b/.test(m) ||
    /\blembrei que tenho\b.{1,60}\b(reuniao|consulta|compromisso|evento|aula|treino|voo|entrevista|exame|cirurgia|apresentacao|medico|dentista|call|meeting)\b/.test(m)
  )
    return "agenda_create";

  // Consultar agenda — expandido com "quais", "quantos", "primeiro", "próximo"
  if (
    /o que (tenho|tem) (hoje|amanha|marcado|essa semana|semana|na agenda)/.test(m) ||
    /minha agenda/.test(m) ||
    /(proximos?|pr[oó]ximos?) (eventos?|compromissos?|reunioes?|consultas?)/.test(m) ||
    /(agenda de|agenda do|agenda da|agenda dessa|agenda desta) (hoje|amanha|semana|mes)/.test(m) ||
    /meus compromissos/.test(m) ||
    /tem algo marcado/.test(m) ||
    /compromissos de (hoje|amanha|semana)/.test(m) ||
    /agenda dessa semana|compromissos da semana/.test(m) ||
    /eventos? (de|da|do) (hoje|amanha|semana|mes)/.test(m) ||
    /o que tenho marcado/.test(m) ||
    // NOVO: "quais compromissos tenho amanhã?" / "quais eventos" / "quais reuniões"
    /\bquais\s+(s[ãa]o\s+)?(meus\s+)?(compromissos?|eventos?|reunioes?|consultas?|tarefas?)\b/.test(m) ||
    // "quantos compromissos tenho hoje?"
    /\bquantos?\s+(compromissos?|eventos?|reunioes?|consultas?|tarefas?)\b/.test(m) ||
    // "qual é meu próximo/primeiro compromisso?"
    /\b(qual|quando)\s+(e|é|foi)\s+(meu|minha)\s+(proximo|proxima|pr[oó]ximo|pr[oó]xima|primeiro|primeira|ultimo|ultima)\s+(compromisso|evento|reuniao|consulta|tarefa)/.test(m) ||
    /\b(proximo|pr[oó]ximo|primeiro)\s+(compromisso|evento|reuniao|consulta)/.test(m) ||
    // "tenho algum compromisso amanhã?"
    /\btenho\s+(algum|algo)\s+(compromisso|evento|reuniao|consulta)\b/.test(m)
  )
    return "agenda_query";

  // Listar notas/anotações — gatilhos expandidos
  // Após NFD normalize: "anotações" → "anotacoes", "anotação" → "anotacao"
  // Usa "anotac" (prefixo) sem \b no final — matcha "anotacao" e "anotacoes"
  if (
    /\b(quais|mostra|mostrar|lista|listar|ver|veja|mostre|me fala|me mostra|me diz|exib[ei]|abre|abrir)\b.{0,25}(anotac|notas?)/.test(m) ||
    /\bminhas?\s+(anotac|notas)/.test(m) ||
    /^(minhas?\s+)?(anotac\w*|notas)\s*\??$/.test(m) ||
    /\b(tenho|tem)\s+.{0,15}(anotac|notas?)/.test(m) ||
    /\bo que\s+(eu\s+)?(anotei|salvei|registrei|guardei)\b/.test(m) ||
    /\bo que\s+(ta|esta)\s+(anotado|salvo|registrado)\b/.test(m) ||
    /\b(quero|preciso|posso)\s+(ver|consultar|acessar)\s+.{0,15}(anotac|notas?)/.test(m) ||
    /\bresumo\s+(das?\s+|de\s+)?(anotac|notas)/.test(m)
  )
    return "notes_list";

  // Deletar nota/anotação — ANTES de notes_save pra priorizar
  // "apaga a nota sobre X", "deleta anotacao de reunião", "remove a ultima anotacao"
  if (
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?)\s+(a\s+|o\s+|as\s+|os\s+|meu\s+|minha\s+|meus\s+|minhas\s+)?(ultima?|ultimo|ultimas?|ultimos|recente|mais\s+recente)\s+(nota|notas|anotacao|anotacoes)\b/.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?)\s+(a\s+|o\s+|meu\s+|minha\s+)?(nota|anotacao)\s+(de|do|da|sobre)\s+/.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?)\s+(aquela|essa|esta|minha|meu)\s+(nota|anotacao)/.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?)\s+(a\s+)?(nota\s+sobre|anotacao\s+sobre|anotacao\s+d[eo])\s+/.test(m)
  )
    return "notes_delete";

  // ── "anota" com destino EXPLÍCITO ──
  // Se o usuário especifica onde salvar, direcionamos sem ambiguidade.
  // "anota na agenda ..." → agenda_create
  if (/\b(anota|anote|anotar|salva|registra)\b.{0,25}\b(na agenda|no calendario|em agenda|pra agenda)\b/.test(m)) {
    return "agenda_create";
  }
  // "anota em lembretes ..." / "anota um lembrete ..." → reminder_set
  if (/\b(anota|anote|anotar|salva|registra|cria|criar)\b.{0,25}\b(em lembrete|nos lembretes|no lembrete|um lembrete|lembrete de|de lembrete|nos meus lembretes)\b/.test(m)) {
    return "reminder_set";
  }
  // "anota em anotações / bloco de notas / nas notas" — explicit note destination → notes_save (fall-through)
  // (não retornamos aqui, deixa o regex de notes_save abaixo pegar normalmente)

  // ── "anota" SOZINHO ou sem destino claro → ambíguo ──
  // Casos: "anota", "anota aí", "anota isso", "anota pra mim" (sem destino após)
  // Só dispara quando a mensagem é CURTA e não tem indicadores de destino
  if (
    /^(anota|anote|anotar)(\s+(ai|aí|isso|aqui|pra mim|por favor))?[\s!?.]*$/.test(m) &&
    !/\b(agenda|calendario|lembrete|anotacao|anotacoes|notas|bloco de notas|reuniao|reunioes|consulta|consultas|evento|eventos|compromisso|compromissos)\b/.test(m)
  ) {
    return "anota_ambiguous";
  }

  // Salvar nota — cobre formas diretas, casuais e indiretas
  if (
    // Formas diretas com palavra-chave no início
    /^(anota|anotacao|anote|salva|escreve|registra|guarda|coloca|bota|grava)[\s:,]/.test(m) ||
    /^nota[\s:,]|^toma nota\b|^presta atencao\b/.test(m) ||
    // "anota ai", "salva ai", "guarda isso", "bota ai", "coloca ai", "marca ai"
    /\b(anota|salva|guarda|escreve|registra|bota|coloca|grava) (ai|isso|aqui|pra mim)\b/.test(m) ||
    // "marca ai" (sem referência à agenda)
    /^marca (ai|isso|aqui|pra mim)\b/.test(m) ||
    // Formas explícitas de intenção
    /^(quero|pode|preciso que voce|por favor) (anotar|salvar|registrar|guardar)\b/.test(m) ||
    /^(pode |por favor )?(anotar|salvar|registrar|guardar) (isso|esse|essa|aqui|ai)\b/.test(m) ||
    // "faz/faca/cria uma anotacao/nota pra mim" — imperativo com substantivo
    /(faz|faca|faça|cria|crie|criar|fazer|me faz|me faca) (uma |a )?(anota(cao|cao|c[aã]o)|nota)\b/.test(m) ||
    // "quero criar/fazer uma nota/anotacao"
    /(quero|preciso) (criar|fazer|registrar) (uma )?(nota|anotacao)\b/.test(m) ||
    // título de anotação explícito
    /titulo (da|de|dessa?) anota(c[aã]o|cao)/.test(m) ||
    // Frases de contexto
    /para nao esquecer|pra nao esquecer|nao quero esquecer/.test(m) ||
    /preciso lembrar|lembrar de /.test(m)
  )
    return "notes_save";

  // Snooze de lembrete — adiar um lembrete que JÁ foi disparado
  // IMPORTANTE: só ativa com "de novo", "novamente", "isso", "adiar", "snooze" etc.
  // NÃO ativa com "me lembra daqui X sobre Y" (isso é reminder_set)
  if (
    /^snooze\b/.test(m) ||
    /^snooze\s+(por|de|em)?\s*\d+\s*(min|minuto|minutos|h|hora|horas)/.test(m) ||
    m === "adiar" || m === "adia" ||
    /^adiar?\s+\d+\s*(min|minuto|hora)/.test(m) ||
    /^(adia|adiar)\s+(por|em|de)\s*\d+/.test(m) ||
    /me lembra (de novo|novamente) (daqui|em)/.test(m) ||
    /me lembra isso (daqui|em) \d/.test(m) ||
    /me avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /manda (de novo|novamente) (daqui|em) \d/.test(m) ||
    /repete (daqui|em) \d/.test(m) ||
    /avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /(de novo|novamente) em \d/.test(m) ||
    /daqui a pouco de novo/.test(m)
  ) return "reminder_snooze";

  // Listar lembretes — expandido com "quantos", "próximo", "tem algum"
  if (
    /^(quais|mostra|lista|ver|veja|mostre|me mostra)\s+(s[ãa]o\s+)?(meus\s+)?lembretes?/.test(m) ||
    /^meus lembretes?$/.test(m) ||
    /^(tem|tenho|tenho\s+algum)\s+(lembrete|lembretes)\s*(pendente|ativo|marcado)?/.test(m) ||
    /^(lembretes?\s*(pendentes?|ativos?|marcados?))$/.test(m) ||
    // NOVO: "quantos lembretes tenho?"
    /\bquantos?\s+lembretes?\b/.test(m) ||
    // "qual é meu próximo/primeiro lembrete?"
    /\b(qual|quando)\s+(e|é|foi)\s+(meu|minha)\s+(proximo|proxima|pr[oó]ximo|pr[oó]xima|primeiro|primeira|ultimo|ultima)\s+lembrete/.test(m) ||
    /\b(proximo|pr[oó]ximo|primeiro)\s+lembrete\b/.test(m) ||
    // "quais são meus lembretes de hoje/amanhã/semana"
    /\blembretes?\s+(de|da|do|dessa|desta)\s+(hoje|amanha|semana|mes|tarde|manha|noite)\b/.test(m) ||
    // "lembretes de hoje"
    /^lembretes?\s+(de|da|do|dessa|desta)?\s*(hoje|amanha|semana|mes)\s*\??$/.test(m)
  ) return "reminder_list";

  // Cancelar lembrete
  if (
    /^(cancela|cancelar|remove|apaga|deleta|exclui)\s+(o\s+)?(lembrete|aviso|alarme)\s+(d[eo]\s+)?.+/.test(m) ||
    /^(cancela|remove|apaga|deleta)\s+lembrete\b/.test(m)
  ) return "reminder_cancel";

  // Editar lembrete (muda horário ou dia)
  if (
    /^(muda|mudar|alterar|altera|atualiza|reagenda|remarca)\s+(o\s+)?(lembrete|aviso)\s+(d[eo]\s+)?.+/.test(m) ||
    /(lembrete\s+d[eo]\s+.+\s+para?\s+\d)/.test(m)
  ) return "reminder_edit";

  // Lembrete simples — cobre formas imperativas, subjuntivo e indiretas
  if (
    // Formas diretas: "me lembra", "me lembre", "me avisa", etc.
    /^me lembra\b|^me lembre\b|^me avisa\b|^me notifica\b/.test(m) ||
    // Formas de criação explícita
    /^quero um lembrete|^cria(r)? (um )?lembrete|^salva (um )?lembrete|^adiciona (um )?lembrete|^lembrete:/.test(m) ||
    // "me lembra/lembre" em qualquer posição com referência de tempo/assunto
    /\bme lembra (de|que|do|da|desse|disso|às|as|amanha|hoje|semana|todo|toda|daqui|em \d|dia \d|sobre)\b/.test(m) ||
    /\bme lembre (de|que|do|da|desse|disso|às|as|amanha|hoje|semana|todo|toda|daqui|em \d|dia \d|sobre)\b/.test(m) ||
    /\bme avisa (às|as|quando|amanha|hoje|dia \d|daqui)\b/.test(m) ||
    // Formas indiretas: "voce me lembra", "quero que voce me lembra/lembre"
    /\b(voce|você) me (lembra|lembre)\b/.test(m) ||
    /(quero que|pode|preciso que).*(me lembra|me lembre|me avisa)\b/.test(m)
  ) return "reminder_set";

  // Buscar evento específico
  if (/voce lembra (do|da|de) (meu|minha)|lembra (do|da|de) (meu|minha)|tem (meu|minha) .{2,30} marcad|qual (e|é) (meu|minha)|quando (e|é) (meu|minha)|tem algo (marcado|agendado) (dia|no dia|para)/.test(m))
    return "agenda_lookup";

  // Deletar contato — ANTES de agenda_delete para não conflitar
  if (
    // Grupo base: verbo + contato/numero/telefone + nome
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?|cancela(r)?)\s+(o\s+|a\s+)?(contato|numero|telefone)\s+/i.test(m) ||
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?|cancela(r)?)\s+(o\s+contato|a\s+entrada)\s+(d[oa]\s+)?[a-z]/i.test(m) ||
    // Grupo 1: possessivos — "do meu / da minha"
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?|cancela(r)?)\s+o\s+contato\s+(d[oa]\s+)?(meu|minha)\b/i.test(m) ||
    // Grupo 2: "da minha lista / dos meus contatos"
    /\b(apaga(r)?|deleta(r)?|remove(r)?|exclui(r)?|tira(r)?|descarta(r)?|limpa(r)?)\s+o\s+contato\s+.{2,40}\s+(da\s+(minha\s+)?lista|dos\s+(meus\s+)?contatos)\b/i.test(m)
  )
    return "contact_delete";

  // Cancelar/excluir evento direto (sem edição)
  if (
    /^(cancela|exclui|apaga|deleta|remove|desmarca)\s+(meu|minha|o|a)?\s*.{2,40}$/.test(m) ||
    /nao vou mais (ao|a|para o|para a|ao |a )\s*.{2,30}/.test(m) ||
    /(cancela|exclui|apaga|deleta|desmarca) (o evento|a reuniao|o compromisso|a consulta|o|a)\s+.{2,30}/.test(m)
  )
    return "agenda_delete";

  // Editar/remarcar evento
  if (
    /(mudei|muda|mude|alterei|altera|altere|remarca|remarcar|atualiza|cancela|cancelar|excluir|deletar|mover) .{0,20}(dia|hora|horario|data|evento|compromisso|reuniao|consulta)/.test(m) ||
    /mudei de (data|dia|horario|hora)/.test(m) ||
    /nao e mais (dia|hora)/.test(m) ||
    /e (dia|hora) \d/.test(m) ||
    /muda (o|a) (dia|hora|horario|data)/.test(m) ||
    // Grupo 1: mudar compromisso/reunião/consulta/treino com destino explícito
    /\b(muda|mude|altera|altere|remarca|remarque)\s+(meu|minha|o|a)\s+(compromisso|reuniao|consulta|treino|aula|evento)\s+.{2,50}\s+para\b/.test(m) ||
    /\b(muda|mude|altera|altere)\s+o\s+horario\s+(do|da|de)\s+.{2,40}\s+para\b/.test(m) ||
    /\b(muda|mude|altera|altere)\s+a\s+(data|hora)\s+(do|da|de)\s+.{2,40}\s+para\b/.test(m) ||
    // Grupo 2: verbo passado indicando correção
    /\bmarquei errado\b/.test(m) ||
    /\bcoloquei (a hora|o horario|o dia|a data) errad/.test(m) ||
    /\bmudei de ideia.{0,30}\bremarca\b/.test(m) ||
    // Grupo 3: "novo horário/nova data para [evento]"
    /\bnov[ao]\s+(horario|hora|data)\s+(para|do|da|de)\s+(meu|minha|o|a)?\s*.{2,40}/.test(m)
  )
    return "agenda_edit";

  return "ai_chat";
}

/** Returns true when the user declines a reminder (says "not needed") */
export function isReminderDecline(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /^(nao|n|nope|nah|sem lembrete|nao precisa|nao quero|dispenso|pode nao|nao obrigado|nao, obrigado|ta bom assim|nao quero lembrete|sem aviso)$/.test(m);
}

/** Returns true when user wants reminder at exact time (not advance) */
export function isReminderAtTime(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /(so (me avisa|avisa|notifica) na hora|na hora|no horario|quando chegar a hora|so na hora|avisa na hora|me avisa na hora|no momento)/.test(m);
}

/** Returns true when user accepts/wants a reminder (without specifying time) */
export function isReminderAccept(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /^(sim|s|quero|pode ser|claro|por favor|bora|pode|yes|ok|beleza|blz|com certeza|isso|quero sim|pode|quero ser lembrado)$/.test(m);
}

/**
 * Parses advance notice in minutes from natural language.
 * Returns null if not parseable.
 * Examples: "15 min" → 15, "1 hora" → 60, "meia hora" → 30
 */
export function parseMinutes(msg: string): number | null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // "na hora" ou "no momento" → 0 min (avisa na hora)
  if (/(na hora|no momento|no horario|so na hora)/.test(m)) return 0;
  // "X horas antes" / "X hora antes" / "1h antes" / "2h"
  const hoursMatch = m.match(/(\d+(?:[.,]\d+)?)\s*h(ora)?/);
  if (hoursMatch) return Math.round(parseFloat(hoursMatch[1].replace(",", ".")) * 60);
  // "meia hora"
  if (/meia hora/.test(m)) return 30;
  // "hora e meia"
  if (/hora e meia/.test(m)) return 90;
  // número simples (minutos)
  const numMatch = m.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return null;
}

// ─────────────────────────────────────────────
// REMINDER ANSWER — combined parser
// ─────────────────────────────────────────────
// Detects intent (accept / decline / at_time) AND advance time in a single pass.
// Handles natural variations: "sim me avisa antes", "sim 30 min antes",
// "claro, uma hora antes", "pode avisar", "só na hora", "não precisa", etc.
// Used by agenda_create, agenda_edit and reminder_set follow-ups.

export type ReminderAnswer =
  | { kind: "accept_with_time"; minutes: number }
  | { kind: "accept_no_time" }
  | { kind: "at_time" }
  | { kind: "decline" }
  | { kind: "unknown" };

const WORD_TO_NUM: Record<string, number> = {
  "uma": 1, "um": 1, "duas": 2, "dois": 2, "tres": 3,
  "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8,
  "nove": 9, "dez": 10,
};

const WORD_TO_MIN: Record<string, number> = {
  "quinze": 15, "vinte": 20, "trinta": 30, "quarenta": 40,
  "cinquenta": 50, "sessenta": 60, "noventa": 90,
};

function extractAdvanceMinutes(m: string): number | null {
  // Compostos primeiro (antes de match de "hora" ou "meia")
  if (/\bhora\s+e\s+meia\b/.test(m)) return 90;
  if (/\bmeia\s+hora\b/.test(m)) return 30;

  // "uma hora", "duas horas", "tres horas"...
  const wordHour = m.match(/\b(uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+hora(?:s)?\b/);
  if (wordHour) {
    const n = WORD_TO_NUM[wordHour[1]];
    if (n !== undefined) return n * 60;
  }

  // "quinze minutos", "trinta minutos"...
  const wordMin = m.match(/\b(quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa)\s+minuto(?:s)?\b/);
  if (wordMin) {
    const n = WORD_TO_MIN[wordMin[1]];
    if (n !== undefined) return n;
  }

  // "1.5h", "2h", "1h30" — número + h
  const hoursMatch = m.match(/\b(\d+(?:[.,]\d+)?)\s*h(?:ora(?:s)?)?\b/);
  if (hoursMatch) {
    return Math.round(parseFloat(hoursMatch[1].replace(",", ".")) * 60);
  }

  // "30 min", "30 minutos", "30min"
  const minMatch = m.match(/\b(\d+)\s*(?:m|min|minuto|minutos)\b/);
  if (minMatch) return parseInt(minMatch[1], 10);

  // Número + "antes" (ex: "30 antes")
  const numAntes = m.match(/\b(\d{1,3})\b[^\d]{0,15}\bantes\b/);
  if (numAntes) return parseInt(numAntes[1], 10);

  return null;
}

function hasAffirmativeWord(m: string): boolean {
  // Palavra afirmativa em qualquer posição
  if (/\b(sim|claro|certeza|com certeza|obvio|obviamente|positivo|afirmativo|ok|okay|beleza|blz|bora|isso|exato|perfeito|fechado|combinado|yes|yep|sure|please|por favor)\b/.test(m)) {
    return true;
  }
  // "pode" / "manda" sozinho ou no início (resposta curta de aceite)
  if (/^(pode|manda|mande|envia|envie|quero|queria)[\s.,!?]*$/.test(m)) {
    return true;
  }
  // Verbos que indicam aceite no contexto da pergunta ("me avisa", "pode lembrar"...)
  if (/\b(me\s+(avisa|avise|notifica|lembra|lembre)|pode\s+(avisar|lembrar)|pode\s+me\s+(avisar|lembrar)|quero\s+(ser\s+)?(lembrado|avisado|notificado))\b/.test(m)) {
    return true;
  }
  // "avisa antes", "lembra antes" sem pronome
  if (/^\s*(avisa|avise|lembra|lembre|notifica)\s+(antes|com antecedencia|antecipado)\b/.test(m)) {
    return true;
  }
  return false;
}

function isDeclineAnswer(m: string): boolean {
  // Recusa exclusiva: a mensagem inteira gira em torno de negar o lembrete
  if (/^(nao|n|nope|nah)[\s,.!]*$/.test(m)) return true;
  if (/^(nao|n)\s+(precisa|preciso|quero|obrigado|obg|valeu)\b/.test(m)) return true;
  if (/^(sem|nem|dispensa|dispenso|deixa|tanto faz|tudo bem|ta tranquilo|ta bom)\b.*$/.test(m) &&
      !/\b(antes|antecedencia|me avisa|me lembra|na hora)\b/.test(m)) return true;
  if (/\b(nao precisa|nem precisa|sem lembrete|sem aviso|nao quero lembrete|deixa pra la|pode esquecer|melhor nao|pode nao)\b/.test(m)) return true;
  return false;
}

function isAtTimeAnswer(m: string): boolean {
  // "só na hora", "na hora exata", "no horário", "no momento"
  if (/\b(so na hora|so no horario|na hora exata|no horario exato|no horario|no momento|quando chegar a hora|quando for a hora|exatamente na hora|so quando comecar)\b/.test(m)) return true;
  // "(sim) me avisa na hora", "avisa só na hora"
  if (/\b(me\s+)?(avisa|avise|notifica|lembra|lembre)\s+(so\s+)?na hora\b/.test(m)) return true;
  // "na hora" sozinho
  if (/^na hora[\s,.!]*$/.test(m)) return true;
  return false;
}

/**
 * Combined parser for the "Quer que eu te lembre antes?" answer.
 * Replaces the chain of isReminderAccept / isReminderAtTime / isReminderDecline / parseMinutes
 * inside the waiting_reminder_answer handlers, capturing intent + time in a single call.
 */
export function parseReminderAnswer(msg: string): ReminderAnswer {
  if (!msg || !msg.trim()) return { kind: "unknown" };
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  // 1. DECLINE — recusa explícita tem prioridade
  if (isDeclineAnswer(m)) return { kind: "decline" };

  // 2. AT_TIME — "só na hora" / "me avisa na hora" antes de extrair número
  if (isAtTimeAnswer(m)) return { kind: "at_time" };

  // 3. ACCEPT_WITH_TIME — extrai tempo de antecedência (ex: "sim 30 min antes")
  const minutes = extractAdvanceMinutes(m);
  if (minutes !== null && minutes > 0) {
    return { kind: "accept_with_time", minutes };
  }

  // 4. ACCEPT_NO_TIME — afirmação genérica sem tempo específico
  if (hasAffirmativeWord(m)) return { kind: "accept_no_time" };

  return { kind: "unknown" };
}
