-- ai_usage_log: rastreia uso das APIs de IA (Claude / OpenAI) por função.
-- Permite ao admin ver economia ao migrar para OpenAI e diagnosticar
-- quando o fallback foi acionado.

create table if not exists public.ai_usage_log (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('claude', 'openai')),
  function_name text not null,
  model         text,
  tokens_in     integer,
  tokens_out    integer,
  fallback_used boolean not null default false,
  error_message text,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_log_provider_created_idx
  on public.ai_usage_log(provider, created_at desc);

create index if not exists ai_usage_log_function_created_idx
  on public.ai_usage_log(function_name, created_at desc);

create index if not exists ai_usage_log_fallback_idx
  on public.ai_usage_log(fallback_used, created_at desc)
  where fallback_used = true;

-- RLS
alter table public.ai_usage_log enable row level security;

-- Apenas admins podem ler (consistente com outras tabelas de telemetria)
drop policy if exists "admin reads ai_usage_log" on public.ai_usage_log;
create policy "admin reads ai_usage_log"
  on public.ai_usage_log for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

-- Service role insere (edge functions usam service_role_key, que ignora RLS;
-- a policy abaixo cobre o caso de chamadas com authed role)
drop policy if exists "service role inserts ai_usage_log" on public.ai_usage_log;
create policy "service role inserts ai_usage_log"
  on public.ai_usage_log for insert
  with check (true);
