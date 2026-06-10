-- Phase 3 of the Thrive/Supabase data integrity audit (Claude session local_4cc14fae).
-- One row per /api/cron/thrive-sync-health invocation. Catches the silent-failure
-- class (crons that stop firing without raising an error) by writing a daily
-- snapshot of every thrive_* table's freshness + every thrive_* cron's last-24h
-- health.
create table if not exists public.thrive_sync_health (
  id             bigserial primary key,
  checked_at     timestamptz not null default now(),
  overall_status text        not null check (overall_status in ('green','yellow','red')),
  red_count      int         not null default 0,
  yellow_count   int         not null default 0,
  summary        text,
  table_checks   jsonb       not null,
  cron_checks    jsonb       not null
);

create index if not exists thrive_sync_health_checked_at_idx
  on public.thrive_sync_health (checked_at desc);

alter table public.thrive_sync_health enable row level security;

-- Service role bypasses RLS, which is how the cron writes. No anon policies on
-- purpose -- this is internal observability data.

comment on table public.thrive_sync_health is
  'One row per /api/cron/thrive-sync-health invocation. Snapshot of every thrive_* table freshness + every thrive_* cron last-24h health. Populated daily at 08:00 UTC. Created 2026-06-10 by session local_4cc14fae as Phase 3 of the Thrive/Supabase data integrity audit. Applied to Supabase 2026-06-10 as migration 20260610100000.';
