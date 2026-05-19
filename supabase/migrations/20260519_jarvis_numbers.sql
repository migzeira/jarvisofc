-- ────────────────────────────────────────────────────────────────────────
-- Jarvis Multi-Number — sticky smart assignment de WhatsApps
-- ────────────────────────────────────────────────────────────────────────
-- Use case: distribuir users por multiplos numeros do Jarvis pra:
--   1. Reduzir risco de ban concentrado em 1 chip (se 1 cair, outros seguem)
--   2. Escalar pra centenas/milhares de users sem estourar quota informal
--      do WhatsApp (~1000 msgs/dia/numero pessoal)
--   3. Operar via UI no admin (sem terminal-fu pra adicionar numero novo)
--
-- Estrategia: STICKY SMART ASSIGNMENT
--   - Primeira interacao do user: sistema escolhe numero com menos carga
--   - Daí gruda — todo trafico desse user vai/vem do mesmo numero
--   - Se o numero atribuido cair (banned), user e reassignado automaticamente
--
-- Razao do sticky: cliente recebendo de numero diferente a cada msg
--   confunde, parece spam, e acelera ban. Sticky preserva UX e contexto.

-- ── Tabela jarvis_numbers — catalogo dos chips ──────────────────────────
create table if not exists public.jarvis_numbers (
  id                  uuid primary key default gen_random_uuid(),
  session_name        text not null unique,                     -- nome no WPPConnect ("jarvis", "jarvis2", ...)
  phone_number        text,                                     -- numero real (preenchido apos conexao)
  display_label       text not null default 'Jarvis',           -- "Jarvis Principal", "Jarvis Backup"
  is_active           boolean not null default true,            -- desliga sem deletar
  connection_status   text not null default 'pending'           -- estado da conexao
                        check (connection_status in ('pending','qrcode','connecting','connected','closed','banned')),
  last_qr_at          timestamptz,                              -- ultima vez que gerou QR (pra UI saber se ta velho)
  last_connected_at   timestamptz,                              -- ultima conexao bem-sucedida
  daily_msg_count     int not null default 0,                   -- contador de msgs enviadas hoje
  daily_msg_reset_at  date not null default current_date,       -- data do ultimo reset
  total_msg_count     bigint not null default 0,                -- contador total (lifetime)
  notes               text,                                     -- anotacoes admin
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists jarvis_numbers_active_idx
  on public.jarvis_numbers(is_active, connection_status)
  where is_active = true;

create index if not exists jarvis_numbers_session_idx
  on public.jarvis_numbers(session_name);

-- Trigger updated_at
create or replace function public.jarvis_numbers_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_jarvis_numbers_touch on public.jarvis_numbers;
create trigger trg_jarvis_numbers_touch
  before update on public.jarvis_numbers
  for each row execute function public.jarvis_numbers_touch_updated_at();

-- ── Tabela user_jarvis_assignments — sticky assignment ──────────────────
-- 1 user = 1 numero atribuido. PK no user_id garante 1 row por user.
create table if not exists public.user_jarvis_assignments (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  jarvis_number_id  uuid not null references public.jarvis_numbers(id) on delete restrict,
  assigned_at       timestamptz not null default now(),
  -- Ao reassignar (numero banido), guardamos qual era o anterior pra debug
  previous_number_id uuid references public.jarvis_numbers(id) on delete set null,
  reassign_count    int not null default 0,
  reassign_reason   text,                                       -- 'banned', 'manual', 'load_balance'
  updated_at        timestamptz not null default now()
);

create index if not exists user_jarvis_assignments_number_idx
  on public.user_jarvis_assignments(jarvis_number_id);

drop trigger if exists trg_user_jarvis_assignments_touch on public.user_jarvis_assignments;
create trigger trg_user_jarvis_assignments_touch
  before update on public.user_jarvis_assignments
  for each row execute function public.jarvis_numbers_touch_updated_at();

-- ── View auxiliar pra UI admin: numeros + count de users ────────────────
-- Card no painel admin mostra "X users atribuidos" — view evita N+1 query.
create or replace view public.jarvis_numbers_with_stats as
select
  jn.*,
  coalesce(uja.user_count, 0) as user_count
from public.jarvis_numbers jn
left join (
  select jarvis_number_id, count(*)::int as user_count
  from public.user_jarvis_assignments
  group by jarvis_number_id
) uja on uja.jarvis_number_id = jn.id;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.jarvis_numbers enable row level security;
alter table public.user_jarvis_assignments enable row level security;

-- jarvis_numbers: so admins manipulam via UI. Edge functions usam service_role.
create policy "Admins read jarvis_numbers"
  on public.jarvis_numbers for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins insert jarvis_numbers"
  on public.jarvis_numbers for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins update jarvis_numbers"
  on public.jarvis_numbers for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins delete jarvis_numbers"
  on public.jarvis_numbers for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- user_jarvis_assignments: admins leem tudo, users nao precisam ver (e nem podem alterar)
create policy "Admins read assignments"
  on public.user_jarvis_assignments for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins write assignments"
  on public.user_jarvis_assignments for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- ── Helper function: smart assignment ───────────────────────────────────
-- Escolhe o numero menos carregado entre os ATIVOS e CONNECTED.
-- Usada pela edge function (via service_role) na primeira interacao do user.
--
-- Criterios de escolha (ordem):
--   1. connection_status = 'connected' AND is_active = true
--   2. daily_msg_count < 900 (margem de seguranca p/ limite informal ~1000)
--   3. ORDER BY user_count ASC, daily_msg_count ASC (menos carregado primeiro)
--
-- Retorna NULL se nenhum numero disponivel — caller decide o que fazer
-- (provavelmente avisar admin que precisa parear novo numero).
create or replace function public.pick_best_jarvis_number()
returns uuid
language sql
stable
as $$
  select jn.id
  from public.jarvis_numbers jn
  left join (
    select jarvis_number_id, count(*)::int as user_count
    from public.user_jarvis_assignments
    group by jarvis_number_id
  ) uja on uja.jarvis_number_id = jn.id
  where jn.is_active = true
    and jn.connection_status = 'connected'
    and jn.daily_msg_count < 900
  order by coalesce(uja.user_count, 0) asc, jn.daily_msg_count asc, jn.created_at asc
  limit 1;
$$;

-- ── Backfill: cria entrada inicial pro numero atual do Jarvis ───────────
-- Status 'pending' porque o WhatsApp ainda esta em analise. Quando voltar,
-- admin pareia via UI e status vira 'connected'.
insert into public.jarvis_numbers (session_name, phone_number, display_label, connection_status, notes)
values ('jarvis', '5511936196103', 'Jarvis Principal', 'pending',
        'Numero original. Em analise no WhatsApp em 19/05/2026. Re-pareiar quando voltar.')
on conflict (session_name) do nothing;

-- Realtime: habilita pra UI admin atualizar status sem refresh
alter publication supabase_realtime add table public.jarvis_numbers;

comment on table public.jarvis_numbers is
  'Catalogo de chips/sessoes WhatsApp usados pelo Jarvis. Gerenciado via painel admin.';
comment on table public.user_jarvis_assignments is
  'Sticky assignment user -> numero. Primeira interacao decide, depois gruda.';
comment on function public.pick_best_jarvis_number is
  'Smart load balancing: retorna o numero ATIVO + CONNECTED com menor carga (users + msgs/dia).';
