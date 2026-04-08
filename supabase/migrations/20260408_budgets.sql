-- Tabela de orcamentos/metas financeiras por categoria
CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'outros',
  amount_limit NUMERIC(12,2) NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  alert_at_percent INTEGER NOT NULL DEFAULT 80,
  last_alert_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, category, period)
);

-- Indice para busca rapida por usuario
CREATE INDEX IF NOT EXISTS idx_budgets_user ON public.budgets(user_id);

-- RLS
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budgets"
  ON public.budgets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own budgets"
  ON public.budgets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budgets"
  ON public.budgets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budgets"
  ON public.budgets FOR DELETE
  USING (auth.uid() = user_id);

-- Service role pode tudo (para Edge Functions)
CREATE POLICY "Service role full access on budgets"
  ON public.budgets FOR ALL
  USING (true)
  WITH CHECK (true);
