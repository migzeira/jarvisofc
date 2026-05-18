-- ────────────────────────────────────────────────────────────────────────
-- Admin Audit Log — registra todas as acoes admin sobre contas de users
-- ────────────────────────────────────────────────────────────────────────
-- Motivacao: feature "Ver painel do cliente" gera um token de impersonation
-- que dá ao admin acesso completo a UMA conta especifica. Por seguranca e
-- compliance, TODA geracao de token fica registrada aqui.
--
-- Outras acoes admin no futuro tambem podem usar essa tabela (ativar plano,
-- suspender conta, broadcast, etc). Mantemos generica via campo 'action'.

create table if not exists public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action        text not null,           -- ex: 'impersonate_token_generated', 'plan_activated', 'account_suspended'
  metadata      jsonb default '{}'::jsonb, -- dados extras (target_email, expires_at, ip, user_agent)
  ip_address    text,                    -- ip de origem da requisicao admin
  user_agent    text,                    -- browser/dispositivo do admin
  created_at    timestamptz not null default now()
);

-- Indices pra busca rapida no painel admin
create index if not exists admin_audit_log_admin_idx     on public.admin_audit_log(admin_user_id, created_at desc);
create index if not exists admin_audit_log_target_idx    on public.admin_audit_log(target_user_id, created_at desc);
create index if not exists admin_audit_log_action_idx    on public.admin_audit_log(action, created_at desc);
create index if not exists admin_audit_log_created_idx   on public.admin_audit_log(created_at desc);

-- RLS: somente admins podem ler. Edge functions usam service_role e ignoram RLS.
alter table public.admin_audit_log enable row level security;

-- SELECT: admins podem ler tudo
create policy "Admins can read audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

-- INSERT: ninguem do client (so service_role via edge functions)
-- Sem policy de INSERT = INSERT do client e bloqueado por padrao com RLS ON.

-- UPDATE/DELETE: ninguem. Audit log e append-only.
-- Sem policy = bloqueado.

comment on table public.admin_audit_log is
  'Log append-only de acoes admin sobre contas de users. Inclui geracao de tokens de impersonation, mudancas de plano, suspensoes, etc.';
