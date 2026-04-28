-- financial_insights_cache: cacheia o "Resumo Inteligente" gerado pela IA
-- pra cada usuário. TTL de 4h reduz custo de chamada de IA — refresh é
-- forçado quando o user clica no botão "Atualizar" no card.

create table if not exists public.financial_insights_cache (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  insight_text    text not null,
  data_snapshot   jsonb,                                          -- snapshot dos dados usados (debug)
  generated_at    timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '4 hours'),
  unique(user_id)                                                 -- 1 row por user (upsert simples)
);

create index if not exists financial_insights_cache_user_id_idx
  on public.financial_insights_cache(user_id);

create index if not exists financial_insights_cache_expires_at_idx
  on public.financial_insights_cache(expires_at);

-- ── RLS ──
alter table public.financial_insights_cache enable row level security;

-- User vê só o próprio cache
drop policy if exists "user reads own insights cache" on public.financial_insights_cache;
create policy "user reads own insights cache"
  on public.financial_insights_cache for select
  using (user_id = auth.uid());

-- User pode invalidar próprio cache (clicar em "Atualizar" deleta antes do regenerate)
drop policy if exists "user deletes own insights cache" on public.financial_insights_cache;
create policy "user deletes own insights cache"
  on public.financial_insights_cache for delete
  using (user_id = auth.uid());

-- INSERT/UPDATE: feitos pela edge function via service_role (RLS bypass).
-- Sem policy aberta de insert/update pro user comum (segurança defesa-em-profundidade).
