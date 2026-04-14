-- Broadcasts agendados pelo admin
create table if not exists public.scheduled_broadcasts (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references auth.users(id) on delete set null,
  message      text not null,
  user_ids     jsonb not null,
  send_at      timestamptz not null,
  status       text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  sent         int default 0,
  failed       int default 0,
  skipped      int default 0,
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists scheduled_broadcasts_due_idx
  on public.scheduled_broadcasts (send_at)
  where status = 'pending';

alter table public.scheduled_broadcasts enable row level security;

create policy "admins manage scheduled_broadcasts"
  on public.scheduled_broadcasts for all
  using (auth.uid() in (select id from public.profiles where is_admin = true));
