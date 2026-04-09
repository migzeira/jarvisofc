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
  | "budget_set"
  | "budget_query"
  | "recurring_create"
  | "habit_create"
  | "habit_checkin"
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

  // Definir orçamento/meta
  if (
    /maximo.{0,20}(gastar|gasto)|orcamento.{0,15}(de |pra |para )|meta.{0,15}(de |pra |para )?(gasto|gastar)|limite.{0,15}(de |pra |para )?(gasto|gastar)|definir (orcamento|meta|limite)|criar (orcamento|meta|limite)|quero gastar no maximo/.test(m)
  )
    return "budget_set";

  // Consultar orçamento/meta
  if (
    /como.{0,10}(estou|esta|tá|ta).{0,10}orcamento|meu orcamento|minha meta|status.{0,10}orcamento|orcamento de|meta de (gasto|alimenta|transport|morad|saude|lazer|educa|trabalh)/.test(m)
  )
    return "budget_query";

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

  // Relatório financeiro (antes de finance_record para evitar falso positivo)
  if (
    /quanto.{0,15}(gastei|ganhei|recebi|devo)|total (de |dos |das )?(gastos?|despesas?)|relat[oó]rio|resumo (de |dos )?(gastos?|financ)|meus gastos|minhas despesas/.test(
      m
    )
  )
    return "finance_report";

  // Registro financeiro
  if (
    /gastei|comprei|paguei|recebi|ganhei|custou|vale |custa |despesa|despendi|gasei/.test(
      m
    )
  )
    return "finance_record";

  // Criar agenda
  if (
    /marca(r)?( na| uma| pra)? (agenda|reuniao|meeting|compromisso|consulta|evento)|agendar|marcar reuniao|tenho (reuniao|consulta|compromisso|medico|dentista|medica)|colocar na agenda|adicionar na agenda|criar evento|novo compromisso|nova reuniao|nova consulta|novo evento|agenda dia \d|vou ao (medico|dentista|hospital|especialista)|vou a (clinica|consulta)|preciso ir ao (medico|dentista|hospital)|marcar com o (medico|dentista|doutor|dra|dr)/.test(
      m
    )
  )
    return "agenda_create";

  // Consultar agenda
  if (
    /o que (tenho|tem) (hoje|amanha|marcado|essa semana|semana|na agenda)|minha agenda|(proximos?|pr[oó]ximos?) (eventos?|compromissos?|reunioes?)|(agenda de|agenda do|agenda da|agenda dessa|agenda desta) (hoje|amanha|semana|mes)|meus compromissos|tem algo marcado|compromissos de (hoje|amanha|semana)|agenda dessa semana|compromissos da semana|eventos? (de|da|do) (hoje|amanha|semana|mes)|o que tenho marcado/.test(
      m
    )
  )
    return "agenda_query";

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
    // Frases de contexto
    /para nao esquecer|pra nao esquecer|nao quero esquecer/.test(m) ||
    /preciso lembrar|lembrar de /.test(m)
  )
    return "notes_save";

  // Snooze de lembrete — adiar um lembrete que JÁ foi disparado
  // IMPORTANTE: só ativa com "de novo", "novamente", "isso", "adiar" etc.
  // NÃO ativa com "me lembra daqui X sobre Y" (isso é reminder_set)
  if (
    /^snooze\b/.test(m) ||
    m === "adiar" || m === "adia" ||
    /^adiar?\s+\d+\s*(min|minuto|hora)/.test(m) ||
    /me lembra (de novo|novamente) (daqui|em)/.test(m) ||
    /me lembra isso (daqui|em) \d/.test(m) ||
    /me avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /manda (de novo|novamente) (daqui|em) \d/.test(m) ||
    /repete (daqui|em) \d/.test(m) ||
    /avisa (de novo|novamente) (daqui|em) \d/.test(m) ||
    /(de novo|novamente) em \d/.test(m) ||
    /daqui a pouco de novo/.test(m)
  ) return "reminder_snooze";

  // Listar lembretes
  if (
    /^(quais|mostra|lista|ver|veja|mostre|me mostra)\s+(s[ãa]o\s+)?(meus\s+)?lembretes?/.test(m) ||
    /^meus lembretes?$/.test(m) ||
    /^(tem|tenho|tenho\s+algum)\s+(lembrete|lembretes)\s*(pendente|ativo|marcado)?/.test(m) ||
    /^(lembretes?\s*(pendentes?|ativos?|marcados?))$/.test(m)
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

  // Cancelar/excluir evento direto (sem edição)
  if (
    /^(cancela|exclui|apaga|deleta|remove|desmarca)\s+(meu|minha|o|a)?\s*.{2,40}$/.test(m) ||
    /nao vou mais (ao|a|para o|para a|ao |a )\s*.{2,30}/.test(m) ||
    /(cancela|exclui|apaga|deleta|desmarca) (o evento|a reuniao|o compromisso|a consulta|o|a)\s+.{2,30}/.test(m)
  )
    return "agenda_delete";

  // Editar/remarcar evento
  if (/(mudei|muda|mude|alterei|altera|altere|remarca|remarcar|atualiza|cancela|cancelar|excluir|deletar|mover) .{0,20}(dia|hora|horario|data|evento|compromisso|reuniao|consulta)|mudei de (data|dia|horario|hora)|nao e mais (dia|hora)|e (dia|hora) \d|muda (o|a) (dia|hora|horario|data)/.test(m))
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
  // "X horas antes" / "X hora antes"
  const hoursMatch = m.match(/(\d+(?:[.,]\d+)?)\s*hora/);
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
