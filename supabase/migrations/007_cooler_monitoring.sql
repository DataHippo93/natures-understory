-- Cooler temperature monitoring (Home Assistant → Understory)
-- Applied to production 2026-06-11 as migration `cooler_monitoring_tables`.
-- Readings pulled every 5 min by /api/cron/pull-coolers.

create table if not exists public.cooler_config (
  entity_id     text primary key,           -- HA entity, e.g. sensor.walk_in_cooler_temperature
  display_name  text not null,
  min_f         numeric(6,2) not null,      -- acceptable range, °F
  max_f         numeric(6,2) not null,
  sort_order    int default 0,
  active        boolean default true,
  auto_discovered boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint cooler_range_valid check (min_f < max_f)
);

create table if not exists public.cooler_readings (
  id           bigint generated always as identity primary key,
  entity_id    text not null references public.cooler_config(entity_id) on delete cascade,
  temp_f       numeric(6,2) not null,
  in_range     boolean not null,
  recorded_at  timestamptz not null default now()
);

create index if not exists idx_cooler_readings_entity_time
  on public.cooler_readings(entity_id, recorded_at desc);

-- RLS: default deny, allow authenticated reads (writes happen via service role)
alter table public.cooler_config enable row level security;
alter table public.cooler_readings enable row level security;

create policy "auth read cooler_config" on public.cooler_config
  for select to authenticated using (true);
create policy "auth read cooler_readings" on public.cooler_readings
  for select to authenticated using (true);
