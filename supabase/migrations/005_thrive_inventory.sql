-- Thrive inventory snapshots — append-only stock-on-hand history.
--
-- Mirrors natures-produce-buying/supabase/migrations/20260427000000_inventory_snapshot.sql
-- but in the Understory project so the order pipeline can read it
-- without cross-project queries.
--
-- Phase 3 of the Vercel migration depends on this table existing.
-- Population is gated until Tasks #5 (endpoint discovery) and #6 (ingest
-- pipeline) land.

create table if not exists public.thrive_inventory_snapshot (
    snapshot_id        bigserial primary key,

    -- Identity
    thrive_item_id     text        not null,
    sales_item_id      text,
    alberts_sku        text,
    item_name          text        not null,

    -- Quantity
    qty_on_hand        numeric(10,2),
    unit               text,

    -- Provenance
    last_counted_at    timestamptz,
    snapshot_ts        timestamptz not null default now(),
    source             text        not null default 'thrive_api',
    api_endpoint       text,
    raw_response       jsonb,

    -- Confidence: 1.0 right after a count, decays with age
    confidence         numeric(4,3),

    -- Stockout: qty_on_hand <= 0 at snapshot time. Used by elasticity
    -- compute to mask zero-sales periods caused by stockout vs no demand.
    stockout           boolean     not null default false
);

create index if not exists thrive_inventory_snapshot_item_ts_idx
  on public.thrive_inventory_snapshot (thrive_item_id, snapshot_ts desc);

create index if not exists thrive_inventory_snapshot_alberts_sku_idx
  on public.thrive_inventory_snapshot (alberts_sku)
  where alberts_sku is not null;

create index if not exists thrive_inventory_snapshot_stockout_idx
  on public.thrive_inventory_snapshot (stockout, snapshot_ts desc)
  where stockout = true;

-- Convenience view: latest snapshot per item.
create or replace view public.thrive_inventory_latest as
select distinct on (thrive_item_id)
    thrive_item_id,
    sales_item_id,
    alberts_sku,
    item_name,
    qty_on_hand,
    unit,
    last_counted_at,
    snapshot_ts,
    confidence,
    stockout,
    extract(epoch from (now() - last_counted_at)) / 3600 as hours_since_count
from public.thrive_inventory_snapshot
order by thrive_item_id, snapshot_ts desc;

comment on table public.thrive_inventory_snapshot is
  'Append-only time-series of Thrive inventory state. Read via thrive_inventory_latest view for current state. Populated by app/api/cron/pull-inventory/route.ts once Task #5 endpoint discovery lands.';
