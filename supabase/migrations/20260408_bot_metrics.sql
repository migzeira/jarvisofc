-- bot_metrics: rastreia performance do bot por mensagem processada
CREATE TABLE IF NOT EXISTS public.bot_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  intent            TEXT NOT NULL DEFAULT 'ai_chat',
  processing_time_ms INTEGER,
  success           BOOLEAN NOT NULL DEFAULT true,
  error_type        TEXT,
  message_length    INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_metrics_user_created
  ON public.bot_metrics (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_metrics_intent
  ON public.bot_metrics (intent, created_at DESC);

ALTER TABLE public.bot_metrics ENABLE ROW LEVEL SECURITY;

-- Users can read their own metrics
CREATE POLICY "users_read_own" ON public.bot_metrics
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Service role can do everything
CREATE POLICY "service_role_all" ON public.bot_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);
