-- v7.7.12: audit trail for wholesale price + wholesale_active toggle changes.
-- Applied via Supabase MCP `apply_migration` on 2026-07-12; this file
-- is committed for repo parity with what's live in the database.
create table if not exists wholesale_price_history (
  id uuid primary key default gen_random_uuid(),
  variant_id text not null,
  product_id text,
  product_title text,
  variant_title text,
  tier text not null check (tier in ('T1','T2','RETAIL','WHOLESALE_ACTIVE')),
  price_cents integer,
  previous_price_cents integer,
  change_type text not null check (change_type in ('set','cleared','toggled_on','toggled_off')),
  changed_by_user_id uuid,
  changed_by_email text,
  source text default 'wholesale_ui',
  changed_at timestamptz default now()
);
create index if not exists wholesale_price_history_variant_idx
  on wholesale_price_history(variant_id, changed_at desc);
create index if not exists wholesale_price_history_product_idx
  on wholesale_price_history(product_id, changed_at desc);
create index if not exists wholesale_price_history_time_idx
  on wholesale_price_history(changed_at desc);
comment on table wholesale_price_history is
  'v7.7.12 audit trail: every wholesale price/toggle change written by the wholesale-pricing UI or backfill scripts.';
