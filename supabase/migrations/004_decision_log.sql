-- decision_log — first-class table replacing the JSONL files written by
-- pipeline/decision_log.py. Same shape; one row per Decision per run.
--
-- Why a table instead of files: order history dashboards need to query
-- across runs (this morning's draft vs last Monday's draft for the same
-- SKU), and audience-tagged note diffing across runs is the canonical
-- use case Clark calls out. Querying flat JSONL across N weeks doesn't
-- scale to the dashboard.

create table if not exists public.decision_log (
  id            bigserial primary key,
  order_date    date    not null,
  run_label     text    not null,        -- 'morning_draft', 'rehearsal', 'reconciliation'
  run_ts        timestamptz not null default now(),

  -- Identity
  sku           text    not null,
  item_name     text    not null,
  description   text,

  -- Quantities
  requested_qty int,
  final_qty     numeric(8,2),

  -- Pricing
  bid_price       numeric(10,2),
  drop            boolean not null default false,
  drop_reason     text,
  include_as_filler boolean not null default false,

  -- Audience-tagged notes (matches alberts_order_lines columns 1:1)
  supplier_facing  jsonb not null default '[]'::jsonb,
  internal_po      jsonb not null default '[]'::jsonb,
  both             jsonb not null default '[]'::jsonb,
  supplier_note_text text,
  internal_po_text   text,
  user_note          text,                 -- legacy single-audience field, kept for backfill

  -- Reasoning
  rationale  jsonb not null default '[]'::jsonb,  -- list of bullets
  features   jsonb not null default '{}'::jsonb   -- snapshot of FeatureResults at decision time
);

create index if not exists decision_log_order_idx
  on public.decision_log (order_date desc, sku);
create index if not exists decision_log_sku_idx
  on public.decision_log (sku, order_date desc);
create index if not exists decision_log_run_ts_idx
  on public.decision_log (run_ts desc);

comment on table public.decision_log is
  'One row per Decision per pipeline run. Audience-tagged notes match alberts_order_lines. Used by /orders dashboard and cross-run diffing.';
