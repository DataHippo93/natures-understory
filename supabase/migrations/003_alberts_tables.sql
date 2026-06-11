-- Albert's / UNFI Chesterfield tables
--
-- Mirrors the natures-produce-buying schema (20260330000000_alberts_schema.sql
-- in that repo) but scoped to the Understory Supabase project so the
-- order pipeline can join sales history × pricelist × decision history
-- in-DB without cross-project queries.
--
-- Run once in Supabase SQL editor: Dashboard → SQL Editor → New Query.

-- -----------------------------------------------------------------------
-- alberts_price_list_meta — one row per ingested price-list email
-- -----------------------------------------------------------------------
create table if not exists public.alberts_price_list_meta (
  id              bigserial primary key,
  list_date       date not null,
  list_type       text not null check (list_type in ('fresh', 'produce')),
  source_filename text not null,
  msg_id          text,                -- Gmail message ID for idempotency
  content_hash    text,                -- sha256 of the CSV content
  row_count       int  not null,
  ingested_at     timestamptz not null default now(),
  unique (list_date, list_type, source_filename)
);
create index if not exists alberts_price_list_meta_date_idx
  on public.alberts_price_list_meta (list_date desc);

-- -----------------------------------------------------------------------
-- alberts_price_entries — current pricelist (latest per list_date+sku)
-- -----------------------------------------------------------------------
create table if not exists public.alberts_price_entries (
  list_date     date    not null,
  list_type     text    not null check (list_type in ('fresh', 'produce')),
  sku           text    not null,
  product_desc  text    not null,
  size          text,
  prod_type     text,                  -- '' = organic, 'C' = conv, 'O2' = 95% organic
  shipper_code  text,
  price         numeric(10,2),
  unit_cost     numeric(10,4),
  pack_size     text,
  pack          int,
  upc_plu       text,
  origin        text,
  availability  text,                  -- '' = in stock, 'Due Tuesday', 'Preorder', etc.
  primary key (list_date, list_type, sku)
);
create index if not exists alberts_price_entries_sku_idx
  on public.alberts_price_entries (sku);

-- -----------------------------------------------------------------------
-- alberts_price_history — append-only price-by-date snapshots
-- -----------------------------------------------------------------------
create table if not exists public.alberts_price_history (
  list_date  date    not null,
  list_type  text    not null check (list_type in ('fresh', 'produce')),
  sku        text    not null,
  price      numeric(10,2),
  unit_cost  numeric(10,4),
  prod_type  text,
  primary key (list_date, list_type, sku)
);
create index if not exists alberts_price_history_sku_date_idx
  on public.alberts_price_history (sku, list_date desc);

-- -----------------------------------------------------------------------
-- alberts_orders — one row per Mon/Thu order, header-level
-- -----------------------------------------------------------------------
create table if not exists public.alberts_orders (
  order_date     date primary key,
  rehearsal      boolean not null default false,
  ref_pricelist  date    not null,
  vendor_id      text    not null default '2257570029409417467',
  ship_loc_id    text    not null default '2182076284535060639',
  bill_loc_id    text    not null default '2182076284535060639',
  status         text    not null default 'draft'
                 check (status in ('draft', 'review', 'sent', 'received', 'reconciled', 'cancelled')),

  -- Totals
  subtotal_cents          int,
  subtotal_if_bids_cents  int,
  n_lines                 int,
  n_so_lines              int,
  n_bid_lines             int,

  -- Email + PO surfaces (rendered at order-build time)
  email_subject     text,
  email_body_text   text,
  email_body_html   text,
  email_eml         bytea,    -- final RFC-822 .eml file
  po_memo           text,
  po_total_cents    int,

  -- Lifecycle
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  invoice_number    text,
  invoice_received_at timestamptz,
  thrive_po_id      text,

  -- Open questions / exceptions for the morning's review
  open_questions    jsonb not null default '[]'::jsonb,
  availability_flags jsonb not null default '[]'::jsonb,
  conv_unavoidable  jsonb not null default '[]'::jsonb,
  added_per_clark   jsonb not null default '[]'::jsonb,
  dropped           jsonb not null default '[]'::jsonb
);

-- -----------------------------------------------------------------------
-- alberts_order_lines — one row per line item; carries audience-tagged notes
-- -----------------------------------------------------------------------
create table if not exists public.alberts_order_lines (
  id             bigserial primary key,
  order_date     date not null references public.alberts_orders(order_date) on delete cascade,
  line_no        int  not null,
  alberts_sku    text not null,
  description    text not null,
  size           text,
  qty            numeric(8,2) not null default 1,
  case_price     numeric(10,2),
  real_case_cost numeric(10,2),
  bid_price      numeric(10,2),

  -- Audience-tagged notes (per Clark's split rule). Bullets in lists.
  supplier_facing jsonb not null default '[]'::jsonb,
  internal_po     jsonb not null default '[]'::jsonb,
  both            jsonb not null default '[]'::jsonb,

  -- Pre-rendered convenience strings (for email/PO surfaces and diffing)
  supplier_note_text text,
  internal_po_text   text,

  -- Decision provenance
  is_organic     boolean,
  is_filler      boolean not null default false,
  is_so          boolean not null default false,
  so_customer    text,
  so_customer_phone text,

  -- Feature snapshot at decision time (price_stats / sales_velocity / seasonal / elasticity / margin)
  features jsonb not null default '{}'::jsonb,
  rationale jsonb not null default '[]'::jsonb,

  unique (order_date, line_no)
);
create index if not exists alberts_order_lines_order_idx
  on public.alberts_order_lines (order_date);
create index if not exists alberts_order_lines_sku_idx
  on public.alberts_order_lines (alberts_sku);

-- -----------------------------------------------------------------------
-- alberts_invoices — Albert's confirmation/invoice CSV ingest
-- -----------------------------------------------------------------------
create table if not exists public.alberts_invoices (
  invoice_no       text primary key,
  order_date       date references public.alberts_orders(order_date),
  cust_po          text,
  invoice_date     date,
  ingested_at      timestamptz not null default now(),
  raw_csv          bytea,
  total_cents      int
);

create table if not exists public.alberts_invoice_lines (
  id            bigserial primary key,
  invoice_no    text not null references public.alberts_invoices(invoice_no) on delete cascade,
  alberts_sku   text not null,
  ship_qty      numeric(8,2),
  case_price    numeric(10,2),
  each_price    numeric(10,4),
  long_desc     text,
  brand_name    text,
  pack_count    int,
  pkg_size      text,
  upc_plu       text,
  variety       text,
  grade         text,
  commodity     text,
  uom_desc      text,
  uom_abbr      text,
  category      text,
  origin        text
);
create index if not exists alberts_invoice_lines_invoice_idx
  on public.alberts_invoice_lines (invoice_no);
