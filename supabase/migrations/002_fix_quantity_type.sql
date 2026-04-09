-- Fix quantity column: int truncates decimal weights (e.g. 0.900 lbs → 0)
-- Run in Supabase SQL Editor if 001 has already been applied
alter table public.sales_line_items
  alter column quantity type numeric(12,3) using quantity::numeric;
