-- Signup com WhatsApp: registrar número direto no momento da criação da conta
--
-- ANTES: user criava conta com nome/email/senha, depois precisava ir em
-- Configurações → Perfil pra cadastrar o WhatsApp. Isso fazia muitos users
-- ficarem com profile sem phone_number, dificultando suporte.
--
-- AGORA: campo WhatsApp aparece no Signup. handle_new_user trigger pega
-- phone_number do raw_user_meta_data e salva direto. Trial de 3 dias ainda
-- rola automático (sem necessidade de plano pra começar a usar).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Função de normalização de telefone (idempotente, IMMUTABLE)
-- ──────────────────────────────────────────────────────────────────────────
-- Filosofia: frontend ENVIA o phone já com DDI (CountrySelect garante isso).
-- Backend NÃO assume nada — só valida formato (8-15 dígitos, E.164) e retorna
-- limpo. Isso permite suportar Brasil, EUA, Espanha, Argentina, etc sem hack.
--
-- Exemplos:
--   "5511999999999"      → "5511999999999"  (Brasil)
--   "+55 11 99999-9999"  → "5511999999999"
--   "34612345678"        → "34612345678"    (Espanha)
--   "+1 (555) 555-5555"  → "15555555555"    (EUA)
--   "5491112345678"      → "5491112345678"  (Argentina)
--   ""                   → NULL
--   "999"                → NULL (muito curto)
--   "1234567890123456"   → NULL (muito longo, > 15 dígitos E.164)
create or replace function public.normalize_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if p is null or trim(p) = '' then
    return null;
  end if;

  -- Remove tudo que não é dígito (espaços, parênteses, hífens, '+')
  digits := regexp_replace(p, '[^0-9]', '', 'g');

  -- E.164: phones globais têm entre 8 e 15 dígitos
  -- 8 mínimo: phones locais sem DDI/DDD (raro mas aceito como fallback)
  -- 15 máximo: limite ITU-T E.164
  if length(digits) < 8 or length(digits) > 15 then
    return null;
  end if;

  return digits;
end;
$$;

comment on function public.normalize_phone(text) is
  'Normaliza telefone removendo formatação. Aceita 8-15 dígitos (E.164). Retorna NULL se inválido. Frontend deve enviar DDI já incluído.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE parcial em profiles.phone_number
-- ──────────────────────────────────────────────────────────────────────────
-- Evita 2 contas com mesmo WhatsApp (causa de bug no webhook que busca
-- por phone). Index parcial permite múltiplos NULLs (users antigos sem phone)
-- mas garante unicidade pros phones populados.
--
-- Antes de criar o index, normaliza phones existentes pra evitar conflitos
-- de phones já duplicados (ex: um user com "11999" e outro com "5511999").

-- Backfill: normaliza phones existentes
update public.profiles
set phone_number = public.normalize_phone(phone_number)
where phone_number is not null
  and phone_number != public.normalize_phone(phone_number);

-- Cria index UNIQUE (parcial — só pra phones não-nulos)
create unique index if not exists profiles_phone_number_unique
  on public.profiles(phone_number)
  where phone_number is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Atualiza handle_new_user pra pegar phone_number do raw_user_meta_data
-- ──────────────────────────────────────────────────────────────────────────
-- Mudanças vs versão anterior (20260516_free_trial_3_days):
--   - Lê new.raw_user_meta_data->>'phone_number' e normaliza
--   - Salva em profiles.phone_number
--   - Se phone falhar (formato inválido), profile é criado SEM phone
--     (user corrige depois em Configurações — não bloqueia signup)
--   - Se phone já existir em outro profile (UNIQUE violation), o trigger
--     da exception e signup falha → frontend mostra erro amigável

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_email text;
  v_phone text;
  v_kirvano record;
  v_plan text := 'maya_mensal';
  v_status text := 'trial';
  v_sub_id text := null;
  v_agent_active boolean := true;
  v_trial_started timestamptz := now();
  v_trial_ends timestamptz := now() + interval '3 days';
begin
  v_email := lower(coalesce(new.email, ''));
  v_phone := public.normalize_phone(new.raw_user_meta_data->>'phone_number');

  -- Busca último evento Kirvano 'activate' não matcheado para este email
  if v_email <> '' then
    select * into v_kirvano
    from public.kirvano_events
    where lower(coalesce(customer_email, '')) = v_email
      and status = 'activate'
      and matched_user_id is null
    order by created_at desc
    limit 1;

    if found then
      -- User já comprou via Kirvano → pula trial, vai direto active
      v_status := 'active';
      v_agent_active := true;
      v_trial_started := null;
      v_trial_ends := null;
      if lower(coalesce(v_kirvano.product_name, '')) ~ '(anual|annual|annually)' then
        v_plan := 'maya_anual';
      else
        v_plan := 'maya_mensal';
      end if;
      v_sub_id := v_kirvano.subscription_id;

      update public.kirvano_events
      set matched_user_id = new.id
      where id = v_kirvano.id;
    end if;
  end if;

  -- Cria profile (com phone se vier no signup)
  insert into public.profiles (
    id, display_name, phone_number, plan, account_status,
    kirvano_subscription_id, trial_started_at, trial_ends_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    v_phone,
    v_plan,
    v_status,
    v_sub_id,
    v_trial_started,
    v_trial_ends
  );

  insert into public.agent_configs (user_id, is_active) values (new.id, v_agent_active);

  insert into public.categories (user_id, name, icon, is_default) values
    (new.id, 'Alimentação', '🍔', true),
    (new.id, 'Transporte', '🚗', true),
    (new.id, 'Moradia', '🏠', true),
    (new.id, 'Saúde', '💊', true),
    (new.id, 'Lazer', '🎮', true),
    (new.id, 'Educação', '📚', true),
    (new.id, 'Trabalho', '💼', true),
    (new.id, 'Outros', '📦', true);

  insert into public.integrations (user_id, provider) values
    (new.id, 'google_calendar'),
    (new.id, 'notion'),
    (new.id, 'google_sheets');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. NOTA SOBRE APLICAÇÃO MANUAL
-- ──────────────────────────────────────────────────────────────────────────
-- Migration pode ser aplicada via SQL Editor do Supabase. As partes 1-3 são
-- idempotentes (rodar 2x não quebra). Se houver duplicatas de phone_number
-- no DB que o backfill (parte 2) não consiga limpar, o CREATE UNIQUE INDEX
-- vai falhar — nesse caso, rodar manualmente:
--   SELECT phone_number, count(*) FROM profiles
--     WHERE phone_number IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- E resolver duplicatas (NULLificando o phone do user inativo, por exemplo).
