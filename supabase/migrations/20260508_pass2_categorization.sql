-- Pass 2 categorization: enables AI-driven re-categorization with DeepSeek/GPT-4o
-- when Pass 1 (Haiku/GPT-4o-mini) returns low confidence or "outros".
--
-- BACKWARDS COMPATIBLE: defaults preserve current behavior.
-- Pass 2 only activates when admin sets ai_pass2_enabled='true' in app_settings.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. transactions.needs_review
-- ──────────────────────────────────────────────────────────────────────────
-- Flags transactions where even Pass 2 couldn't confidently categorize.
-- Default false ensures:
--   • existing rows are unaffected (no backfill needed)
--   • new inserts without explicit value continue to work
alter table public.transactions
  add column if not exists needs_review boolean not null default false;

-- Partial index: only rows that need review (most are false → tiny index)
create index if not exists transactions_needs_review_idx
  on public.transactions(user_id, needs_review)
  where needs_review = true;

comment on column public.transactions.needs_review is
  'True when AI could not confidently categorize this transaction. Surfaced in Finanças UI for user review.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. ai_usage_log: allow 'deepseek' provider + add confidence column
-- ──────────────────────────────────────────────────────────────────────────
-- Drop existing CHECK constraint by name (Postgres auto-generates the name
-- from the column when constraint is inline). Robust: tries the conventional
-- name first, then falls back to scanning information_schema if needed.
do $$
declare
  cname text;
begin
  -- Find the existing CHECK constraint on ai_usage_log.provider
  select tc.constraint_name into cname
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
      and tc.table_schema = ccu.table_schema
   where tc.table_schema = 'public'
     and tc.table_name = 'ai_usage_log'
     and tc.constraint_type = 'CHECK'
     and ccu.column_name = 'provider'
   limit 1;

  if cname is not null then
    execute format('alter table public.ai_usage_log drop constraint %I', cname);
  end if;
end $$;

-- Recreate with explicit name + 'deepseek' included
alter table public.ai_usage_log
  add constraint ai_usage_log_provider_check
  check (provider in ('claude', 'openai', 'deepseek'));

-- Confidence column for telemetry: lets admin track Pass 1 vs Pass 2 accuracy
alter table public.ai_usage_log
  add column if not exists confidence numeric(3,2);

comment on column public.ai_usage_log.confidence is
  'Confidence score 0.00-1.00 returned by the model. Null for non-categorization calls.';
