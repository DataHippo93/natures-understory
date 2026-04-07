-- Nature's Understory — Sales tables
-- Run once in Supabase SQL editor: Dashboard → SQL Editor → New Query

-- Categories (mirrors Clover category list)
create table if not exists public.sales_categories (
  id          text primary key,
  name        text not null,
  sort_order  int  default 0,
  pos_source  text default 'clover',
  updated_at  timestamptz default now()
);

-- Items (mirrors Clover item catalog)
create table if not exists public.sales_items (
  id            text primary key,
  name          text not null,
  category_id   text references public.sales_categories(id),
  category_name text,
  price_cents   int  default 0,
  pos_source    text default 'clover',
  active        boolean default true,
  updated_at    timestamptz default now()
);

-- Line items (one row per line item in each Clover order)
create table if not exists public.sales_line_items (
  id                text primary key,
  order_id          text not null,
  item_id           text,
  item_name         text,
  category_id       text,
  category_name     text,
  quantity          int  default 1,
  unit_price_cents  int  default 0,
  discount_cents    int  default 0,
  net_price_cents   int  default 0,
  sale_date         date not null,
  sale_hour         int,
  sale_ts           timestamptz,
  pos_source        text default 'clover',
  created_at        timestamptz default now()
);

create index if not exists idx_sli_sale_date    on public.sales_line_items(sale_date);
create index if not exists idx_sli_category_id  on public.sales_line_items(category_id);
create index if not exists idx_sli_item_id      on public.sales_line_items(item_id);

-- Saved SQL views (custom query builder)
create table if not exists public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  query       text not null,
  is_public   boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Sync log
create table if not exists public.sync_log (
  id                uuid primary key default gen_random_uuid(),
  sync_type         text not null,
  date_range_start  date,
  date_range_end    date,
  records_synced    int,
  error             text,
  completed_at      timestamptz,
  created_at        timestamptz default now()
);

-- RLS: enable on user-facing tables
alter table public.sales_categories  enable row level security;
alter table public.sales_items       enable row level security;
alter table public.sales_line_items  enable row level security;
alter table public.saved_views       enable row level security;
alter table public.sync_log          enable row level security;

-- Authenticated users can read sales data
create policy if not exists "auth read categories"
  on public.sales_categories for select to authenticated using (true);

create policy if not exists "auth read items"
  on public.sales_items for select to authenticated using (true);

create policy if not exists "auth read line items"
  on public.sales_line_items for select to authenticated using (true);

create policy if not exists "auth read sync log"
  on public.sync_log for select to authenticated using (true);

-- Users can manage their own saved views
create policy if not exists "users manage own views"
  on public.saved_views for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Helper function for safe SELECT queries (used by custom query builder)
create or replace function public.run_report_query(query text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  -- Only allow SELECT statements
  if not (lower(trim(query)) like 'select%') then
    raise exception 'Only SELECT queries are allowed';
  end if;
  execute 'select json_agg(t) from (' || query || ') t' into result;
  return coalesce(result, '[]'::json);
end;
$$;
