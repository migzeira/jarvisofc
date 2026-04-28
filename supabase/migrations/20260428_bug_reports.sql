-- bug_reports: feedback de bugs e sugestões enviado pelos usuários via UI.
-- Painel admin lista, filtra por status, atualiza status e notas internas.

create table if not exists public.bug_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  user_email    text,                   -- snapshot redundante (preserva caso user delete)
  user_name     text,                   -- snapshot redundante
  title         text not null,
  description   text not null,
  status        text not null default 'new'
                check (status in ('new', 'in_progress', 'resolved', 'wontfix')),
  admin_notes   text,                   -- notas internas do admin (não visível ao user)
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists bug_reports_status_created_idx
  on public.bug_reports(status, created_at desc);

create index if not exists bug_reports_user_id_idx
  on public.bug_reports(user_id);

-- ── RLS ──
alter table public.bug_reports enable row level security;

-- User vê só os próprios reports
drop policy if exists "user reads own bugs" on public.bug_reports;
create policy "user reads own bugs"
  on public.bug_reports for select
  using (user_id = auth.uid());

-- User pode criar reports só com seu próprio user_id
drop policy if exists "user creates own bugs" on public.bug_reports;
create policy "user creates own bugs"
  on public.bug_reports for insert
  with check (user_id = auth.uid());

-- Admin lê tudo
drop policy if exists "admin reads all bugs" on public.bug_reports;
create policy "admin reads all bugs"
  on public.bug_reports for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Admin atualiza status / admin_notes / resolved_at
drop policy if exists "admin updates bugs" on public.bug_reports;
create policy "admin updates bugs"
  on public.bug_reports for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- Trigger pra atualizar updated_at automaticamente em UPDATEs
create or replace function public.update_bug_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  -- Se admin marcou como resolved/wontfix, registra resolved_at automaticamente
  if new.status in ('resolved', 'wontfix') and old.status not in ('resolved', 'wontfix') then
    new.resolved_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bug_reports_updated_at on public.bug_reports;
create trigger trg_bug_reports_updated_at
  before update on public.bug_reports
  for each row execute function public.update_bug_reports_updated_at();
