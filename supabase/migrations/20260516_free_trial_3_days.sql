-- Free Trial de 3 dias automático ao criar conta
--
-- ANTES: novo user sem compra Kirvano nasce com account_status='pending'
--        → Jarvis bloqueado, exige compra antes de qualquer uso.
-- AGORA: novo user sem compra Kirvano nasce com account_status='trial'
--        → 3 dias de uso completo gratuito, depois vira 'pending'.
--
-- O webhook checa trial_ends_at — se passou, manda pro paywall pedindo
-- pra comprar. Frontend mostra banner "X dias restantes" durante trial.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Colunas novas em profiles
-- ──────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists trial_started_at timestamptz;

alter table public.profiles
  add column if not exists trial_ends_at timestamptz;

comment on column public.profiles.trial_started_at is
  'Quando o trial começou (= created_at em geral). NULL se conta foi criada via Kirvano e nunca passou por trial.';
comment on column public.profiles.trial_ends_at is
  'Quando o trial expira. Após essa data, account_status volta pra pending automaticamente.';

-- Index pra cron que vai expirar trials (rodar diariamente)
create index if not exists profiles_trial_ends_at_idx
  on public.profiles(trial_ends_at)
  where account_status = 'trial';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Função handle_new_user atualizada — concede trial automaticamente
-- ──────────────────────────────────────────────────────────────────────────
-- Mudança crítica: se NÃO houver match com kirvano_events (= user pagante
-- existente), em vez de 'pending', cria com 'trial' + datas de trial.
-- Mantém o caminho do Kirvano intacto (user que comprou direto vira 'active').

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_email text;
  v_kirvano record;
  v_plan text := 'maya_mensal';
  v_status text := 'trial';        -- ⚠️ default mudado: 'pending' → 'trial'
  v_sub_id text := null;
  v_agent_active boolean := true;  -- ⚠️ default mudado: false → true (trial libera Jarvis)
  v_trial_started timestamptz := now();
  v_trial_ends timestamptz := now() + interval '3 days';
begin
  v_email := lower(coalesce(new.email, ''));

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
      -- User já comprou via Kirvano antes de criar conta → pula trial, vai direto active
      v_status := 'active';
      v_agent_active := true;
      v_trial_started := null;    -- não conta como trial (já é pagante)
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

  -- Cria profile com status/plano/trial
  insert into public.profiles (
    id, display_name, plan, account_status, kirvano_subscription_id,
    trial_started_at, trial_ends_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    v_plan,
    v_status,
    v_sub_id,
    v_trial_started,
    v_trial_ends
  );

  -- Agent config: trial libera Jarvis automaticamente (was: só active liberava)
  insert into public.agent_configs (user_id, is_active) values (new.id, v_agent_active);

  -- Create default categories
  insert into public.categories (user_id, name, icon, is_default) values
    (new.id, 'Alimentação', '🍔', true),
    (new.id, 'Transporte', '🚗', true),
    (new.id, 'Moradia', '🏠', true),
    (new.id, 'Saúde', '💊', true),
    (new.id, 'Lazer', '🎮', true),
    (new.id, 'Educação', '📚', true),
    (new.id, 'Trabalho', '💼', true),
    (new.id, 'Outros', '📦', true);

  -- Create default integrations
  insert into public.integrations (user_id, provider) values
    (new.id, 'google_calendar'),
    (new.id, 'notion'),
    (new.id, 'google_sheets');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Função pra checar status de acesso (usada pelo backend e frontend)
-- ──────────────────────────────────────────────────────────────────────────
-- Retorna jsonb com:
--   { status: 'trial'|'active'|'expired'|'pending'|'suspended',
--     trial_days_remaining: int | null,
--     trial_ends_at: timestamptz | null,
--     can_use_jarvis: boolean }

create or replace function public.get_user_access_status(p_user_id uuid)
returns jsonb as $$
declare
  v_profile record;
  v_now timestamptz := now();
  v_days_remaining int;
  v_status text;
  v_can_use boolean;
begin
  select account_status, trial_started_at, trial_ends_at, access_until
    into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    return jsonb_build_object(
      'status', 'unknown',
      'trial_days_remaining', null,
      'trial_ends_at', null,
      'can_use_jarvis', false
    );
  end if;

  -- Suspenso = banido (estorno, etc) → sempre bloqueia
  if v_profile.account_status = 'suspended' then
    return jsonb_build_object(
      'status', 'suspended',
      'trial_days_remaining', null,
      'trial_ends_at', null,
      'can_use_jarvis', false
    );
  end if;

  -- Trial: checa se ainda tá dentro do prazo
  if v_profile.account_status = 'trial' then
    if v_profile.trial_ends_at is not null and v_profile.trial_ends_at > v_now then
      v_days_remaining := greatest(0, ceil(extract(epoch from (v_profile.trial_ends_at - v_now)) / 86400)::int);
      return jsonb_build_object(
        'status', 'trial',
        'trial_days_remaining', v_days_remaining,
        'trial_ends_at', v_profile.trial_ends_at,
        'can_use_jarvis', true
      );
    else
      -- Trial expirou → reporta como expired (cron vai converter pra pending)
      return jsonb_build_object(
        'status', 'expired',
        'trial_days_remaining', 0,
        'trial_ends_at', v_profile.trial_ends_at,
        'can_use_jarvis', false
      );
    end if;
  end if;

  -- Active: checa access_until (assinaturas com prazo)
  if v_profile.account_status = 'active' then
    if v_profile.access_until is not null and v_profile.access_until < v_now then
      return jsonb_build_object(
        'status', 'expired',
        'trial_days_remaining', null,
        'trial_ends_at', null,
        'can_use_jarvis', false
      );
    end if;
    return jsonb_build_object(
      'status', 'active',
      'trial_days_remaining', null,
      'trial_ends_at', null,
      'can_use_jarvis', true
    );
  end if;

  -- Pending = sem plano ativo
  return jsonb_build_object(
    'status', 'pending',
    'trial_days_remaining', null,
    'trial_ends_at', null,
    'can_use_jarvis', false
  );
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.get_user_access_status(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Backfill: contas pending existentes SEM kirvano podem virar trial
-- ──────────────────────────────────────────────────────────────────────────
-- ⚠️ DECISÃO: NÃO converto automaticamente users pending existentes pra trial.
-- Trial é só pra NOVOS signups daqui pra frente.
-- Se o user quiser dar trial pra alguém existente, faz manualmente via SQL:
--   update profiles set account_status='trial',
--     trial_started_at=now(), trial_ends_at=now()+interval '3 days'
--     where id = 'user-uuid-aqui';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Cron de expiração de trial (opcional — webhook já checa em runtime)
-- ──────────────────────────────────────────────────────────────────────────
-- Pra rodar manualmente no SQL Editor (precisa pg_cron habilitado):
-- /*
--   select cron.schedule(
--     'expire-trials-daily',
--     '0 13 * * *',  -- 10h Brasília
--     $$
--     update profiles
--     set account_status = 'pending'
--     where account_status = 'trial'
--       and trial_ends_at < now();
--     $$
--   );
-- */
