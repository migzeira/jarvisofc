-- Adiciona coluna `email` em profiles pra aparecer na tabela do painel admin.
--
-- Por que aqui e nao so em auth.users:
--   auth.users e acessivel so via service_role. Frontend admin usa anon key
--   com RLS, entao nao consegue ler auth.users. Ter uma copia em profiles
--   (atualizada no trigger handle_new_user) e a forma padrao Supabase de
--   expor email pro frontend.
--
-- Migration idempotente — roda seguro em qualquer ambiente, inclusive onde ja
-- exista a coluna (IF NOT EXISTS) ou onde o email ja tenha sido populado
-- manualmente (o UPDATE so preenche quando email IS NULL).

-- 1) Coluna
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 2) Backfill a partir de auth.users (so onde profiles.email ainda e NULL)
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3) Atualiza o trigger handle_new_user pra gravar email no cadastro novo.
--
-- IMPORTANTE: o corpo abaixo e COPIA FIEL da versao atual do trigger
-- (definida em 20260411_access_source.sql) + apenas a coluna `email` no
-- INSERT de profiles. Nao mexer em nenhuma outra logica (match de Kirvano
-- por email, access_source, plan detection, categorias, integracoes) pra
-- nao regredir nada que ja esta em producao.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_email TEXT;
  v_kirvano RECORD;
  v_plan TEXT := 'maya_mensal';
  v_status TEXT := 'pending';
  v_sub_id TEXT := NULL;
  v_agent_active BOOLEAN := false;
  v_access_source TEXT := NULL;
BEGIN
  v_email := LOWER(COALESCE(NEW.email, ''));

  IF v_email <> '' THEN
    SELECT * INTO v_kirvano
    FROM public.kirvano_events
    WHERE LOWER(COALESCE(customer_email, '')) = v_email
      AND status = 'activate'
      AND matched_user_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_status := 'active';
      v_agent_active := true;
      v_access_source := 'kirvano';
      IF LOWER(COALESCE(v_kirvano.product_name, '')) ~ '(anual|annual|annually)' THEN
        v_plan := 'maya_anual';
      ELSE
        v_plan := 'maya_mensal';
      END IF;
      v_sub_id := v_kirvano.subscription_id;

      UPDATE public.kirvano_events
      SET matched_user_id = NEW.id
      WHERE id = v_kirvano.id;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, display_name, email, plan, account_status, kirvano_subscription_id, access_source)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    v_plan,
    v_status,
    v_sub_id,
    v_access_source
  );

  INSERT INTO public.agent_configs (user_id, is_active) VALUES (NEW.id, v_agent_active);

  INSERT INTO public.categories (user_id, name, icon, is_default) VALUES
    (NEW.id, 'Alimentação', '🍔', true),
    (NEW.id, 'Transporte', '🚗', true),
    (NEW.id, 'Moradia', '🏠', true),
    (NEW.id, 'Saúde', '💊', true),
    (NEW.id, 'Lazer', '🎮', true),
    (NEW.id, 'Educação', '📚', true),
    (NEW.id, 'Trabalho', '💼', true),
    (NEW.id, 'Outros', '📦', true);

  INSERT INTO public.integrations (user_id, provider) VALUES
    (NEW.id, 'google_calendar'),
    (NEW.id, 'notion'),
    (NEW.id, 'google_sheets');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4) Indice pra busca por email (usado no painel admin)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
