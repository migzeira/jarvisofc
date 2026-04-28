/**
 * listsHandler.ts — handlers de "listas" (lista de compras, presentes, etc).
 *
 * Cada função recebe o supabase client + userId + texto da mensagem e devolve
 * { response, pendingAction?, pendingContext? } — mesmo contrato dos outros
 * handlers do whatsapp-webhook (ex: handleNotesSave, handleAgendaCreate).
 *
 * Não importa Evolution API direto — quem envia a resposta é o webhook.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ListHandlerResult {
  response: string;
  pendingAction?: string | null;
  pendingContext?: Record<string, unknown> | null;
}

interface ListRow {
  id: string;
  user_id: string;
  name: string;
  archived_at: string | null;
}

// ─────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────

/**
 * Extrai o nome da lista da mensagem.
 * "cria lista de compras" → "compras"
 * "cria uma lista chamada mercado" → "mercado"
 * "cria lista de mercado pra mim e adiciona arroz" → "mercado"
 * "adiciona X na lista de presentes natal" → "presentes natal"
 * "mostra minha lista de mercado" → "mercado"
 *
 * Estratégia conservadora: pega no MÁXIMO 3 palavras após "lista de/chamada/para",
 * e CORTA em qualquer conector/verbo de comando (e, ou, pra, adiciona, etc.).
 * Retorna null se não identificar nome.
 */
export function parseListName(text: string): string | null {
  const t = text.trim();

  // Padrões em ordem de especificidade. Captura até pontuação ou fim de linha,
  // depois cortamos em conectores/comandos pra ficar conservador.
  const patterns: RegExp[] = [
    /\blista\s+chamada\s+(.+?)(?=[.,!?;:\n]|$)/i,
    /\blista\s+de\s+(.+?)(?=[.,!?;:\n]|$)/i,
    /\blista\s+para\s+(.+?)(?=[.,!?;:\n]|$)/i,
    /\blista\s+pra\s+(.+?)(?=[.,!?;:\n]|$)/i,
  ];

  // Palavras que CORTAM o nome (qualquer uma delas no meio = fim do nome).
  // Ordem importa pouco — usamos regex pra cortar na PRIMEIRA ocorrência.
  const STOP_WORDS = [
    // Conectores de continuação que começam novo comando
    "e adiciona", "e adicionar", "e coloca", "e colocar", "e bota", "e botar",
    "e poe", "e põe", "e salva", "e salvar", "e grava", "e gravar",
    "e guarda", "e guardar", "e inclui", "e incluir",
    // Beneficiário / destino (não fazem parte do nome)
    "pra mim", "para mim", "pro meu", "pra meu", "para meu", "pra minha", "para minha",
    // Verbos de comando standalone
    " adiciona ", " adicionar ", " acrescenta ", " coloca ", " colocar ",
    " bota ", " botar ", " salva ", " salvar ", " grava ", " gravar ",
    " guarda ", " guardar ", " inclui ", " incluir ",
    // Preposições típicas que sinalizam novo trecho
    " com os ", " com o ", " com a ", " com as ",
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1]) {
      let name = m[1].trim();

      // Corta na primeira stop-word encontrada (case-insensitive)
      const lowerName = name.toLowerCase();
      let cutAt = name.length;
      for (const sw of STOP_WORDS) {
        const idx = lowerName.indexOf(sw);
        if (idx >= 0 && idx < cutAt) cutAt = idx;
      }
      name = name.slice(0, cutAt).trim();

      // Limpa pontuação residual
      name = name.replace(/[.,!?;:]+$/, "").trim();

      // Limite conservador: máximo 3 palavras (cobre "presentes natal", "mercado central",
      // "filmes pra assistir" mas evita pegar comando inteiro como nome)
      const words = name.split(/\s+/).filter(Boolean);
      if (words.length > 3) {
        name = words.slice(0, 3).join(" ");
      }

      // Garante limites do schema (1-60 chars)
      if (name.length >= 1 && name.length <= 60) return name.toLowerCase();
    }
  }

  return null;
}

/**
 * Extrai os itens da mensagem.
 * "adiciona arroz, feijão e óleo na lista de compras" → ["arroz", "feijão", "óleo"]
 * Suporta separadores: vírgula, " e ", quebras de linha, ponto e vírgula.
 *
 * Estratégia: pega o trecho ANTES de "na lista" (se houver), senão pega tudo
 * depois do verbo de adição.
 */
export function parseItems(text: string): string[] {
  let chunk = text.trim();

  // Remove o "na lista (de X)" e tudo depois (são metadados, não itens)
  chunk = chunk.replace(/\b(na|nas|no|n[aoe]\s+minha)\s+lista\b.*$/i, "");
  // Remove "lista de X:" no início se existir
  chunk = chunk.replace(/^.{0,40}\blista\s+(de\s+|chamada\s+)?\w+\s*:\s*/i, "");

  // Remove "pra mim" / "para mim" iniciais (beneficiário, não item)
  chunk = chunk.replace(/^(pra|para|pro)\s+(mim|meu|minha)\b[,\s]*/i, "");

  // Remove "e " / "e tambem " / "e também " inicial (conectivos)
  chunk = chunk.replace(/^(e|tambem|também)\s+/i, "");

  // Remove verbo de adição inicial (com ou sem "e" prefixado)
  chunk = chunk.replace(
    /^(adiciona|adicionar|acrescenta|acrescentar|coloca|colocar|bota|botar|poe|poem|salva|salvar|grava|gravar|guarda|guardar|inclui|incluir|insere|inserir|anexa|anexar)\b\s*/i,
    ""
  );
  // Remove "para a lista" / "pra lista" no fim ou começo
  chunk = chunk.replace(/\b(para|pra)\s+(a\s+)?lista\b.*$/i, "");

  // Remove afirmações iniciais ("sim", "ok", "claro", "isso", "tambem")
  // — quando user responde "Sim, arroz e feijão" pra pending_action list_await_items,
  // o "Sim" não é item.
  chunk = chunk.replace(/^(sim|claro|ok|certo|beleza|isso|isso ai|isso aí|aham|uhum|tambem|também|tb|tbm)[,\s]+/i, "");

  // Quebra por separadores: vírgula, ; , quebras de linha, " e " (último), " ou "
  // Cuidado com "e" — só split em " e " quando claramente separa itens.
  const parts = chunk
    .split(/\s*(?:,|;|\n|\r|\s+e\s+(?=[a-zA-ZÀ-ÿ])|\s+ou\s+(?=[a-zA-ZÀ-ÿ]))\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 200);

  // Remove duplicatas case-insensitive preservando ordem
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique;
}

/**
 * Extrai item específico de uma mensagem de "marcar/remover".
 * "marca arroz como comprado na lista de mercado" → "arroz"
 * "tira detergente da lista" → "detergente"
 * "ja comprei arroz" → "arroz"
 */
export function parseSingleItem(text: string): string | null {
  let t = text.trim();

  // Remove verbos de comando
  t = t.replace(
    /^(marca(r)?|risca(r)?|conclui(r)?|tira(r)?|remove(r)?|apaga(r)?|deleta(r)?|exclui(r)?|ja\s+comprei|comprei|comprado|feito|concluido|concluida)\s+/i,
    ""
  );
  // Remove "como comprado/feito"
  t = t.replace(/\b(como\s+)?(comprado|feito|concluido|concluida|pronto)\b/gi, "");
  // Remove "na lista (de X)" / "da lista (de X)"
  t = t.replace(/\b(na|da|d[aoe]\s+minha)\s+lista\b.*$/i, "");
  // Remove pontuação final
  t = t.replace(/[.,!?;:]+$/, "").trim();

  if (t.length === 0 || t.length > 200) return null;
  return t;
}

// ─────────────────────────────────────────────────────────────
// Helpers de busca de lista
// ─────────────────────────────────────────────────────────────

/**
 * Busca a lista mais provável pra esse user dado o nome.
 * Se nome fornecido, busca por match case-insensitive (active only).
 * Se nome NÃO fornecido e o user só tem 1 lista ativa, usa essa.
 * Senão retorna null (caller pergunta).
 */
async function findList(
  supabase: SupabaseClient,
  userId: string,
  name: string | null
): Promise<ListRow | null> {
  if (name) {
    const { data } = await (supabase as any)
      .from("lists")
      .select("id, user_id, name, archived_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .ilike("name", name)
      .maybeSingle();
    if (data) return data as ListRow;

    // Se não bateu exato, tenta busca parcial (ex: user disse "compras" mas lista é "lista de compras semanal")
    const { data: partial } = await (supabase as any)
      .from("lists")
      .select("id, user_id, name, archived_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .ilike("name", `%${name}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (partial && partial.length > 0) return partial[0] as ListRow;
    return null;
  }

  // Sem nome: usa a única lista ativa, se houver só uma
  const { data: all } = await (supabase as any)
    .from("lists")
    .select("id, user_id, name, archived_at")
    .eq("user_id", userId)
    .is("archived_at", null);
  if (all && all.length === 1) return all[0] as ListRow;
  return null;
}

// ─────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────

export async function handleListCreate(
  supabase: SupabaseClient,
  userId: string,
  text: string
): Promise<ListHandlerResult> {
  const name = parseListName(text);
  if (!name) {
    return {
      response: "📝 Como você quer chamar a lista? Ex: _\"cria lista de compras\"_ ou _\"nova lista chamada presentes natal\"_",
      pendingAction: "list_await_name",
      pendingContext: {},
    };
  }

  // Tenta criar — se já existir lista ativa com esse nome, retorna ela
  const { data: existing } = await (supabase as any)
    .from("lists")
    .select("id, name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .ilike("name", name)
    .maybeSingle();

  if (existing) {
    return {
      response: `📋 Você já tem a lista *${(existing as any).name}*! Pode adicionar itens com:\n_"adiciona X, Y, Z na lista de ${(existing as any).name}"_`,
      pendingAction: null,
      pendingContext: null,
    };
  }

  const { data: created, error } = await (supabase as any)
    .from("lists")
    .insert({
      user_id: userId,
      name,
      source: "whatsapp",
    })
    .select("id, name")
    .single();

  if (error) {
    console.error("[lists] handleListCreate error:", error);
    return {
      response: "❌ Não consegui criar a lista agora. Tenta de novo em instantes?",
    };
  }

  // ─── Detecta itens na MESMA mensagem ─────────────────────────────────
  // Ex: "cria lista de mercado e adiciona arroz, feijão, açúcar"
  // Pega o trecho APÓS o nome da lista e parseia itens dali. Se tiver
  // itens, insere de uma vez (UX: 1 mensagem ao invés de 2 idas e voltas).
  const lowerText = text.toLowerCase();
  const nameIdx = lowerText.indexOf(name);
  const tailRaw = nameIdx >= 0 ? text.slice(nameIdx + name.length) : "";

  // Só tenta parsear se tem indício de comando de adição no tail
  const hasAddIntent = /\b(adiciona|adicionar|acrescenta|acrescentar|coloca|colocar|bota|botar|inclui|incluir|com\s+|\be\s+(arroz|feij|carne|leite|pao|pão|aç[uú]car|cafe|café|frut|legum|verdur|massa|pasta|sabao|sabão|detergent|papel))/i.test(tailRaw);

  if (hasAddIntent) {
    const items = parseItems(tailRaw);
    if (items.length > 0) {
      const rows = items.map((content, idx) => ({
        list_id: (created as any).id,
        content,
        position: idx,
        source: "whatsapp",
      }));
      const { error: itemsErr } = await (supabase as any).from("list_items").insert(rows);
      if (!itemsErr) {
        const itemsLine = items.map((i) => `• ${i}`).join("\n");
        return {
          response:
            `✅ Lista *${(created as any).name}* criada com ${items.length} item${items.length === 1 ? "" : "s"}:\n${itemsLine}\n\n` +
            `_Pra adicionar mais: "adiciona X, Y na lista de ${(created as any).name}"_`,
          pendingAction: null,
          pendingContext: null,
        };
      }
      // Se falhou inserir itens, ainda confirma criação da lista (não perde o resultado)
      console.error("[lists] handleListCreate combo-insert error:", itemsErr);
    }
  }

  return {
    response:
      `✅ Lista *${(created as any).name}* criada!\n\n` +
      `Quer adicionar itens agora? Manda assim:\n` +
      `_"adiciona arroz, feijão e óleo na lista de ${(created as any).name}"_`,
    pendingAction: "list_await_items",
    pendingContext: { list_id: (created as any).id, list_name: (created as any).name },
  };
}

export async function handleListAddItems(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  pendingContext?: Record<string, unknown> | null
): Promise<ListHandlerResult> {
  // Se chegou via pending_action="list_await_items", já temos o list_id no contexto
  let list: ListRow | null = null;
  if (pendingContext?.list_id) {
    const { data } = await (supabase as any)
      .from("lists")
      .select("id, user_id, name, archived_at")
      .eq("id", pendingContext.list_id)
      .maybeSingle();
    if (data) list = data as ListRow;
  }

  if (!list) {
    const name = parseListName(text);
    list = await findList(supabase, userId, name);
  }

  if (!list) {
    const name = parseListName(text);
    if (name) {
      return {
        response:
          `🤔 Não achei a lista *${name}*. Quer que eu crie ela?\n` +
          `Manda: _"cria lista de ${name}"_`,
      };
    }
    return {
      response:
        "🤔 Não entendi em qual lista. Você tem mais de uma — me diga o nome:\n" +
        '_"adiciona arroz na lista de compras"_',
    };
  }

  const items = parseItems(text);
  if (items.length === 0) {
    return {
      response: `✏️ Quais itens? Manda separado por vírgula:\n_"adiciona arroz, feijão, óleo na lista de ${list.name}"_`,
      pendingAction: "list_await_items",
      pendingContext: { list_id: list.id, list_name: list.name },
    };
  }

  // Pega a maior position atual pra colocar novos itens no fim
  const { data: maxPosRow } = await (supabase as any)
    .from("list_items")
    .select("position")
    .eq("list_id", list.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startPos = ((maxPosRow as any)?.position ?? -1) + 1;

  const rows = items.map((content, idx) => ({
    list_id: list!.id,
    content,
    position: startPos + idx,
    source: "whatsapp",
  }));

  const { error } = await (supabase as any).from("list_items").insert(rows);
  if (error) {
    console.error("[lists] handleListAddItems error:", error);
    return {
      response: "❌ Não consegui salvar os itens. Tenta de novo em instantes?",
    };
  }

  // Atualiza updated_at da lista (trigger faz, mas garante que aparece no topo)
  await (supabase as any).from("lists").update({ updated_at: new Date().toISOString() }).eq("id", list.id);

  const itemsLine = items.map((i) => `• ${i}`).join("\n");
  return {
    response:
      `✅ Adicionado em *${list.name}*:\n${itemsLine}\n\n` +
      `_Pra ver tudo: "mostra minha lista de ${list.name}"_`,
    pendingAction: null,
    pendingContext: null,
  };
}

export async function handleListShow(
  supabase: SupabaseClient,
  userId: string,
  text: string
): Promise<ListHandlerResult> {
  const name = parseListName(text);
  const list = await findList(supabase, userId, name);

  if (!list) {
    if (name) {
      return { response: `🤔 Não achei a lista *${name}*. Quer criar? _"cria lista de ${name}"_` };
    }
    // Sem nome + várias listas → mostra todas pro user escolher
    return await handleListShowAll(supabase, userId);
  }

  const { data: items } = await (supabase as any)
    .from("list_items")
    .select("id, content, completed, completed_at, position, created_at")
    .eq("list_id", list.id)
    .order("completed", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const list_items = (items as Array<{
    id: string;
    content: string;
    completed: boolean;
    position: number;
  }>) ?? [];

  if (list_items.length === 0) {
    return {
      response:
        `📋 Sua lista *${list.name}* tá vazia.\n\n` +
        `Adiciona itens com: _"adiciona X, Y, Z na lista de ${list.name}"_`,
    };
  }

  const pending = list_items.filter((i) => !i.completed);
  const done = list_items.filter((i) => i.completed);

  let body = `📋 *Lista: ${list.name}*\n`;
  if (pending.length > 0) {
    body += "\n*Pendentes:*\n" + pending.map((i) => `▢ ${i.content}`).join("\n");
  }
  if (done.length > 0) {
    body += "\n\n*Já feito:*\n" + done.map((i) => `✅ ${i.content}`).join("\n");
  }
  body += `\n\n_${pending.length} pendente${pending.length === 1 ? "" : "s"} de ${list_items.length} item${list_items.length === 1 ? "" : "s"}_`;

  return { response: body };
}

export async function handleListShowAll(
  supabase: SupabaseClient,
  userId: string
): Promise<ListHandlerResult> {
  const { data: lists } = await (supabase as any)
    .from("lists")
    .select("id, name, created_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  const arr = (lists as Array<{ id: string; name: string; created_at: string }>) ?? [];
  if (arr.length === 0) {
    return {
      response:
        "📋 Você ainda não tem listas. Cria uma com:\n_\"cria lista de compras\"_",
    };
  }

  // Conta itens pendentes em batch
  const ids = arr.map((l) => l.id);
  const { data: counts } = await (supabase as any)
    .from("list_items")
    .select("list_id, completed")
    .in("list_id", ids);

  const countMap = new Map<string, { pending: number; total: number }>();
  for (const id of ids) countMap.set(id, { pending: 0, total: 0 });
  for (const row of (counts as Array<{ list_id: string; completed: boolean }>) ?? []) {
    const c = countMap.get(row.list_id)!;
    c.total++;
    if (!row.completed) c.pending++;
  }

  const lines = arr.map((l) => {
    const c = countMap.get(l.id) ?? { pending: 0, total: 0 };
    return `• *${l.name}* — ${c.pending}/${c.total} pendente${c.pending === 1 ? "" : "s"}`;
  });

  return {
    response:
      `📋 *Suas listas* (${arr.length}):\n\n${lines.join("\n")}\n\n` +
      `_Pra ver uma: "mostra minha lista de NOME"_`,
  };
}

export async function handleListCompleteItem(
  supabase: SupabaseClient,
  userId: string,
  text: string
): Promise<ListHandlerResult> {
  const itemText = parseSingleItem(text);
  if (!itemText) {
    return {
      response: "🤔 Qual item? Manda: _\"marca arroz como comprado na lista de compras\"_",
    };
  }

  const name = parseListName(text);
  const list = await findList(supabase, userId, name);
  if (!list) {
    return {
      response: name
        ? `🤔 Não achei a lista *${name}*.`
        : "🤔 Em qual lista? Manda o nome: _\"comprei arroz na lista de compras\"_",
    };
  }

  // Busca item case-insensitive (match parcial)
  const { data: items } = await (supabase as any)
    .from("list_items")
    .select("id, content, completed")
    .eq("list_id", list.id)
    .ilike("content", `%${itemText}%`)
    .order("completed", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  const found = (items as Array<{ id: string; content: string; completed: boolean }>) ?? [];
  if (found.length === 0) {
    return {
      response: `🤔 Não achei *${itemText}* em *${list.name}*. Você adicionou ele antes?`,
    };
  }

  const item = found[0];
  if (item.completed) {
    return { response: `✅ *${item.content}* já tava marcado como feito em *${list.name}*.` };
  }

  const { error } = await (supabase as any)
    .from("list_items")
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq("id", item.id);

  if (error) {
    console.error("[lists] handleListCompleteItem error:", error);
    return { response: "❌ Não consegui marcar. Tenta de novo?" };
  }

  // Bump updated_at da lista pra triggar realtime no frontend
  await (supabase as any).from("lists").update({ updated_at: new Date().toISOString() }).eq("id", list.id);

  return { response: `✅ Marquei *${item.content}* como feito em *${list.name}*!` };
}

export async function handleListRemoveItem(
  supabase: SupabaseClient,
  userId: string,
  text: string
): Promise<ListHandlerResult> {
  const itemText = parseSingleItem(text);
  if (!itemText) {
    return {
      response: "🤔 Qual item tirar? Manda: _\"tira arroz da lista de compras\"_",
    };
  }

  const name = parseListName(text);
  const list = await findList(supabase, userId, name);
  if (!list) {
    return {
      response: name
        ? `🤔 Não achei a lista *${name}*.`
        : "🤔 De qual lista? Manda o nome: _\"tira arroz da lista de compras\"_",
    };
  }

  const { data: items } = await (supabase as any)
    .from("list_items")
    .select("id, content")
    .eq("list_id", list.id)
    .ilike("content", `%${itemText}%`)
    .limit(1);

  const found = (items as Array<{ id: string; content: string }>) ?? [];
  if (found.length === 0) {
    return { response: `🤔 Não achei *${itemText}* em *${list.name}*.` };
  }

  const item = found[0];
  const { error } = await (supabase as any).from("list_items").delete().eq("id", item.id);
  if (error) {
    console.error("[lists] handleListRemoveItem error:", error);
    return { response: "❌ Não consegui remover. Tenta de novo?" };
  }

  // Bump updated_at da lista pra triggar realtime no frontend
  await (supabase as any).from("lists").update({ updated_at: new Date().toISOString() }).eq("id", list.id);

  return { response: `🗑️ Removi *${item.content}* da lista *${list.name}*.` };
}

export async function handleListDelete(
  supabase: SupabaseClient,
  userId: string,
  text: string
): Promise<ListHandlerResult> {
  const name = parseListName(text);
  const list = await findList(supabase, userId, name);
  if (!list) {
    return {
      response: name
        ? `🤔 Não achei a lista *${name}*.`
        : "🤔 Qual lista deletar? Manda: _\"apaga minha lista de compras\"_",
    };
  }

  // Soft delete (archived_at) — preserva itens pra histórico/recuperação
  const { error } = await (supabase as any)
    .from("lists")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", list.id);

  if (error) {
    console.error("[lists] handleListDelete error:", error);
    return { response: "❌ Não consegui apagar a lista. Tenta de novo?" };
  }

  return { response: `🗑️ Lista *${list.name}* arquivada.` };
}
