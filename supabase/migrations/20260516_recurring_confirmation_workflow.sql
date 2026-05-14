-- Recurring transactions: confirmation workflow via WhatsApp
--
-- Antes: cron criava transação automaticamente no dia X (silencioso).
-- Problemas: gasto fantasma se user não pagou, valor errado se negociou,
-- continuava gerando mesmo após cancelamento do serviço.
--
-- Agora: cron pergunta no WhatsApp "Você pagou o Aluguel R$4000?",
-- só cria transação se user confirmar com "sim".
--
-- Estados da pendência (Opção C — escolhida pelo user):
--   idle    → sem pendência ativa
--   awaiting → perguntou e tá esperando resposta
--
-- Lógica do cron diário:
--   1. Acha recurring com next_date <= hoje
--   2. Se pending_status = 'idle' → pergunta + marca awaiting
--   3. Se pending_status = 'awaiting':
--      • Passou 2+ dias da última pergunta E ainda dentro do prazo 7d → re-pergunta
--      • Passou 7+ dias da primeira pergunta → expira (pula esse ciclo, próximo mês)
--
-- Respostas aceitas (em texto, sem botões — Evolution API não suporta):
--   "sim" / "ok" / "paguei" / "confirma"      → cria tx, avança ciclo
--   "ainda não" / "nao" / "ainda nao"          → mantém awaiting (re-pergunta em 2d)
--   "pula" / "pular" / "skip" / "ja paguei"   → avança ciclo SEM criar tx

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Colunas novas em recurring_transactions
-- ──────────────────────────────────────────────────────────────────────────
alter table public.recurring_transactions
  add column if not exists pending_status text not null default 'idle';

alter table public.recurring_transactions
  add column if not exists pending_first_asked_at timestamptz;

alter table public.recurring_transactions
  add column if not exists pending_last_asked_at timestamptz;

alter table public.recurring_transactions
  add column if not exists pending_ask_count integer not null default 0;

-- Constraint pra restringir valores válidos do pending_status
do $$
declare cname text;
begin
  select tc.constraint_name into cname
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
   where tc.table_schema = 'public'
     and tc.table_name = 'recurring_transactions'
     and tc.constraint_type = 'CHECK'
     and ccu.column_name = 'pending_status'
   limit 1;
  if cname is not null then
    execute format('alter table public.recurring_transactions drop constraint %I', cname);
  end if;
end $$;

alter table public.recurring_transactions
  add constraint recurring_pending_status_check
  check (pending_status in ('idle', 'awaiting'));

-- Index pra cron buscar rápido as que precisam ser processadas
create index if not exists recurring_transactions_pending_idx
  on public.recurring_transactions(pending_status, next_date)
  where active = true;

comment on column public.recurring_transactions.pending_status is
  'Estado da pendência de confirmação: idle (sem pergunta ativa) ou awaiting (perguntou no WhatsApp, esperando resposta).';
comment on column public.recurring_transactions.pending_first_asked_at is
  'Quando perguntou pela primeira vez nesse ciclo. Usado pra calcular expiração de 7 dias.';
comment on column public.recurring_transactions.pending_last_asked_at is
  'Última vez que perguntou. Usado pra decidir se re-pergunta (a cada 2 dias).';
comment on column public.recurring_transactions.pending_ask_count is
  'Quantas vezes perguntou nesse ciclo. Limita re-perguntas excessivas.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Habilita extensões necessárias pro cron HTTP
-- ──────────────────────────────────────────────────────────────────────────
-- IDEMPOTENTE: roda mesmo se já estiver habilitado.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Cron job: process-recurring rodando todo dia às 9h Brasília
-- ──────────────────────────────────────────────────────────────────────────
-- IMPORTANTE: pg_cron usa horário UTC. Brasília é UTC-3, então 9h BR = 12h UTC.
-- Em DST (raro no Brasil agora) pode variar 1h — aceitável pra essa feature.
--
-- Idempotente: dropa o job se existir, depois recria.

-- Remove versão antiga caso exista (de runs anteriores ou da migration antiga)
do $$
begin
  perform cron.unschedule('process-recurring-daily');
exception when others then
  -- Não existia — tudo certo
  null;
end $$;

-- Também remove versões antigas com outros nomes (defensivo)
do $$
begin
  perform cron.unschedule('process-recurring');
exception when others then null;
end $$;

-- Cria o job
select cron.schedule(
  'process-recurring-daily',
  '0 12 * * *',  -- 12:00 UTC = 09:00 Brasília
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/process-recurring',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- NOTA: pra cron funcionar, os GUCs `app.supabase_url` e `app.service_role_key`
-- precisam estar configurados no Supabase. Geralmente já estão por default em
-- projetos managed. Se não estiverem, rodar uma vez no SQL Editor:
--   alter database postgres set app.supabase_url = 'https://fnilyapvhhygfzcdxqjm.supabase.co';
--   alter database postgres set app.service_role_key = '<service_role_key>';
