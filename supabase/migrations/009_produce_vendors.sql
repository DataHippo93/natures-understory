-- Produce vendor master + schedule.
--
-- Replaces the hardcoded "Albert's = Mon/Thu, Kent's = Wed" map that
-- lives in app code. Now the Mon/Thu produce-buying cron + the new
-- /vendors/produce UI both read from this table.
--
-- Notes on shape:
--   * `display_name` is the canonical operator-facing label (not
--     `thrive_vendors.name`, because some local vendors aren't in
--     Thrive at all).
--   * `thrive_vendor_id` is optional. When present, joins enrich the
--     row with phone/email/website if the produce_vendors row doesn't
--     supply them.
--   * `order_days` and `delivery_days` are arrays of lowercase weekday
--     names ('monday'..'sunday') for portable schedule queries
--     ("select where 'monday' = ANY(order_days)").

create table if not exists public.produce_vendors (
  id                       uuid primary key default gen_random_uuid(),
  thrive_vendor_id         text,
  display_name             text not null unique,
  active                   boolean not null default true,

  -- Contact (fallback to thrive_vendors via join when null)
  contact_name             text,
  contact_phone            text,
  contact_email            text,
  gmail_label              text,

  -- Schedule
  order_days               text[] not null default '{}'::text[],
  order_cutoff_time_et     text,
  delivery_days            text[] not null default '{}'::text[],
  delivery_offset_days     integer not null default 1,

  -- Carries what
  categories               text[] not null default '{}'::text[],
  seasonal_months          integer[] not null default '{}'::int[],

  -- Operator notes / quality flags
  notes                    text,
  manual_only              boolean not null default false,
  notes_internal           text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists produce_vendors_active_idx
  on public.produce_vendors (active) where active = true;

create index if not exists produce_vendors_thrive_idx
  on public.produce_vendors (thrive_vendor_id) where thrive_vendor_id is not null;

-- Auto-touch updated_at
create or replace function public.produce_vendors_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists produce_vendors_touch_trg on public.produce_vendors;
create trigger produce_vendors_touch_trg
  before update on public.produce_vendors
  for each row execute function public.produce_vendors_touch();

-- Seed: the 11 known local + regional produce vendors. Idempotent via
-- the unique constraint on display_name.
insert into public.produce_vendors
  (display_name, contact_name, contact_email, gmail_label,
   order_days, order_cutoff_time_et, delivery_days, delivery_offset_days,
   categories, seasonal_months, notes)
values
  ('Albert''s',         'Jasmia / Sarah', null, 'Produce/Jasmia/Sarah',
   '{monday,thursday}'::text[], '06:50', '{tuesday,friday}'::text[], 1,
   '{Produce,Grocery,"Body Care"}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Email order via Gmail. Pricelist arrives Sun + Wed evenings.'),

  ('Kent''s',           'Kent',           null, 'Produce/Kents',
   '{tuesday}'::text[], '18:00', '{wednesday}'::text[], 1,
   '{Produce,Local}'::text[], '{6,7,8,9,10}'::int[],
   'Texts preferred. Seasonal Jun–Oct.'),

  ('Birdsfoot',         'Sarah',          null, 'Produce/Sarah',
   '{thursday}'::text[], '14:00', '{friday}'::text[], 1,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Call Sarah by Thu 14:00. Year-round root + leaf.'),

  ('Martin''s Farmstand', null,           null, 'Produce/Martin''s Farmstand',
   '{}'::text[], null, '{saturday}'::text[], 0,
   '{Produce,Local}'::text[], '{7,8,9,10}'::int[],
   'Pickup arrangement. Jul–Oct stone fruit + corn.'),

  ('House of Greens',   null,             null, 'Produce/House of Greens',
   '{wednesday}'::text[], '12:00', '{thursday}'::text[], 1,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Microgreens + lettuce, year-round.'),

  ('Canton Apples',     null,             null, 'Produce/Canton Apples',
   '{}'::text[], null, '{saturday}'::text[], 0,
   '{Produce,Local}'::text[], '{8,9,10,11,12,1,2,3,4}'::int[],
   'Aug–Apr apples + cider.'),

  ('Ferris Ridge',      null,             null, 'Produce/Ferris Ridge',
   '{}'::text[], null, '{}'::text[], 0,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Eggs + small-batch greens.'),

  ('Brandy-View',       null,             null, 'Produce/Brandy-View',
   '{sunday}'::text[], '14:00', '{tuesday}'::text[], 2,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Email order Sun by 14:00 for Tue delivery.'),

  ('Deep Root Farm',    null,             null, 'Produce/Deep Root',
   '{thursday}'::text[], '09:00', '{thursday}'::text[], 0,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Cooperative; multi-grower.'),

  ('Holton Farms',      null,             null, 'Produce/Holton',
   '{wednesday}'::text[], '12:00', '{friday}'::text[], 2,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'NH/VT cross-border + organic.'),

  ('Farm at Bakers - Rodney', 'Rodney',   null, 'Produce/Farm at Bakers - Rodney',
   '{}'::text[], null, '{}'::text[], 0,
   '{Produce,Local}'::text[], '{1,2,3,4,5,6,7,8,9,10,11,12}'::int[],
   'Small CSA-style; eggs + dairy.')
on conflict (display_name) do nothing;

-- Best-effort thrive_vendor_id backfill (matches by lowercase name)
update public.produce_vendors p
   set thrive_vendor_id = tv.thrive_vendor_id
  from public.thrive_vendors tv
 where lower(replace(tv.name,'''','')) = lower(replace(p.display_name,'''',''))
   and p.thrive_vendor_id is null;
