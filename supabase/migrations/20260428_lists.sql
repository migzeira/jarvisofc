-- ==================== LISTS & LIST_ITEMS ====================
-- Listas persistentes (compras, tarefas, presentes, etc) que o user adiciona
-- e marca itens ao longo do tempo via WhatsApp ou frontend.
--
-- Diferente de `notes` (texto livre, single-shot) e `reminders` (agendamentos).
-- Listas são "vivas": cresce, marca como feito, eventualmente arquivada.

-- ─────────── Tabela LISTS ───────────
CREATE TABLE IF NOT EXISTS public.lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',     -- 'manual' | 'whatsapp'
  archived_at TIMESTAMPTZ DEFAULT NULL,            -- soft delete (mantém histórico)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lists_name_length CHECK (char_length(name) BETWEEN 1 AND 60)
);

-- Não permite 2 listas ATIVAS com mesmo nome (case-insensitive) por user.
-- Listas arquivadas ficam fora do unique → user pode reaproveitar nome.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lists_user_name_active
  ON public.lists (user_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lists_user_active
  ON public.lists (user_id, created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lists"   ON public.lists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own lists" ON public.lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own lists" ON public.lists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own lists" ON public.lists FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role manages lists" ON public.lists FOR ALL USING (true);

CREATE TRIGGER update_lists_updated_at
  BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────── Tabela LIST_ITEMS ───────────
CREATE TABLE IF NOT EXISTS public.list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ DEFAULT NULL,
  position      INTEGER NOT NULL DEFAULT 0,         -- ordenação manual (não-único)
  source        TEXT NOT NULL DEFAULT 'manual',     -- 'manual' | 'whatsapp'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT list_items_content_length CHECK (char_length(content) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_list_items_list_pos
  ON public.list_items (list_id, completed, position, created_at);

ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

-- list_items herda o user_id da lista pai (via JOIN).
-- RLS via subquery na lists.user_id.
CREATE POLICY "Users can view own list_items" ON public.list_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_items.list_id AND l.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own list_items" ON public.list_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_items.list_id AND l.user_id = auth.uid())
  );
CREATE POLICY "Users can update own list_items" ON public.list_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_items.list_id AND l.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own list_items" ON public.list_items
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_items.list_id AND l.user_id = auth.uid())
  );
CREATE POLICY "Service role manages list_items" ON public.list_items FOR ALL USING (true);

-- Habilita realtime pra que o frontend atualize na hora quando WhatsApp adiciona item.
-- Idempotente: ignora se a tabela já tá na publicação.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'lists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lists;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'list_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.list_items;
  END IF;
END $$;
