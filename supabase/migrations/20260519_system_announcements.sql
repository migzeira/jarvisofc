-- ────────────────────────────────────────────────────────────────────────
-- System Announcements — broadcast banner no topo do dashboard
-- ────────────────────────────────────────────────────────────────────────
-- Use case: admin precisa avisar TODOS os usuarios sobre algo (manutencao,
-- nova feature, downtime do WhatsApp etc) sem precisar mandar broadcast por
-- WhatsApp ou email. Aparece no dashboard ao logar.
--
-- Tipos (severity):
--   - info     → azul (novidade, info geral)
--   - warning  → amarelo (manutencao agendada, lentidao)
--   - critical → vermelho (sistema fora do ar, problema grave)
--
-- dismissible: define se o usuario pode fechar o banner (X). Avisos criticos
-- normalmente nao sao dismissiveis pra forcar a leitura.
--
-- is_active: admin liga/desliga. Pode reativar avisos antigos da lista.
--
-- expires_at: opcional, auto-desativa quando passa do prazo (cron limpa).

create table if not exists public.system_announcements (
  id            uuid primary key default gen_random_uuid(),
  emoji         text not null default '📢',
  message       text not null,
  severity      text not null default 'info' check (severity in ('info','warning','critical')),
  is_active     boolean not null default true,
  dismissible   boolean not null default true,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- Index para query "pega o announcement ativo mais recente"
create index if not exists system_announcements_active_idx
  on public.system_announcements(is_active, created_at desc)
  where is_active = true;

-- Trigger pra atualizar updated_at automaticamente
create or replace function public.system_announcements_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_system_announcements_touch on public.system_announcements;
create trigger trg_system_announcements_touch
  before update on public.system_announcements
  for each row execute function public.system_announcements_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.system_announcements enable row level security;

-- SELECT: TODO usuario autenticado pode ler avisos ativos
-- (admin tb le os inativos pra gerenciar via segundo policy abaixo)
create policy "Authenticated users can read active announcements"
  on public.system_announcements
  for select
  to authenticated
  using (
    is_active = true
    and (expires_at is null or expires_at > now())
  );

-- SELECT: admins leem TUDO (ativos, inativos, expirados) pra gerenciar
create policy "Admins can read all announcements"
  on public.system_announcements
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

-- INSERT: so admins
create policy "Admins can create announcements"
  on public.system_announcements
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

-- UPDATE: so admins
create policy "Admins can update announcements"
  on public.system_announcements
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

-- DELETE: so admins
create policy "Admins can delete announcements"
  on public.system_announcements
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

-- Realtime: habilita pub/sub pra banner aparecer instantaneo em todos os
-- dashboards quando admin publicar (sem refresh)
alter publication supabase_realtime add table public.system_announcements;

comment on table public.system_announcements is
  'Avisos globais exibidos no topo do dashboard de todos os usuarios. Gerenciados pelo painel admin.';
