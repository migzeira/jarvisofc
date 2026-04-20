-- Renewal links separados por tipo de plano
--
-- Antes: renewal_link (único) era enviado pra todo mundo.
-- Depois: renewal_link_monthly + renewal_link_annual — o cron
-- renewal-reminder escolhe automaticamente baseado em profiles.plan
-- (plan contém "anual"/"annual" → link anual; senão → mensal).
--
-- renewal_link (legacy) permanece no schema e é usado como fallback
-- caso um dos novos esteja vazio — permite migração gradual.

INSERT INTO public.app_settings (key, value) VALUES
  ('renewal_link_monthly', ''),
  ('renewal_link_annual', '')
ON CONFLICT (key) DO NOTHING;
