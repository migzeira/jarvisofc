-- Tabela de log das mensagens broadcast enviadas pelo admin
create table if not exists public.broadcast_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users(id) on delete set null,
  message     text not null,
  total       int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  skipped     int not null default 0,
  created_at  timestamptz not null default now()
);

-- Apenas admins podem ver/inserir (RLS)
alter table public.broadcast_logs enable row level security;

create policy "admins can manage broadcast_logs"
  on public.broadcast_logs
  for all
  using (
    auth.uid() in (
      select id from public.profiles where is_admin = true
    )
  );
