-- 003_asset_life.sql
-- Asset-life Postgres function for the natures-understory /asset-life page.
-- Returns the top N SKU launches by first-30-day revenue, with the d31-60 and
-- d61-90 follow-on buckets and d1-30 margin. Defaults to top 10.
-- Generated as part of the asset-life-analytics workstream, 2026-06-03.

create or replace function public.asset_life_top_launches(p_limit int default 10)
returns table (
  variant_id text,
  name text,
  department text,
  first_sale_date date,
  rev_d1_30 numeric,
  rev_d31_60 numeric,
  rev_d61_90 numeric,
  prof_d1_30 numeric
)
language sql
stable
security definer
as $$
  with first_sale as (
    select variant_id, min(sale_date) as first_sale_date
    from thrive_sales_history
    group by variant_id
  ),
  launches as (
    select variant_id, first_sale_date
    from first_sale
    where first_sale_date >= '2024-12-01'
      and first_sale_date <= (current_date - interval '30 days')
  ),
  cohort as (
    select s.variant_id,
           l.first_sale_date,
           (s.sale_date - l.first_sale_date) as day_offset,
           s.revenue_cents,
           s.profit_cents
    from thrive_sales_history s
    join launches l using (variant_id)
    where s.sale_date between l.first_sale_date and l.first_sale_date + interval '90 days'
  ),
  agg as (
    select variant_id, first_sale_date,
      coalesce(sum(revenue_cents) filter (where day_offset between 0 and 29),0)  as rev_d1_30_c,
      coalesce(sum(revenue_cents) filter (where day_offset between 30 and 59),0) as rev_d31_60_c,
      coalesce(sum(revenue_cents) filter (where day_offset between 60 and 89),0) as rev_d61_90_c,
      coalesce(sum(profit_cents)  filter (where day_offset between 0 and 29),0)  as prof_d1_30_c
    from cohort
    group by variant_id, first_sale_date
  )
  select a.variant_id,
         pc.name,
         pc.department,
         a.first_sale_date,
         round(a.rev_d1_30_c / 100.0, 2)  as rev_d1_30,
         round(a.rev_d31_60_c / 100.0, 2) as rev_d31_60,
         round(a.rev_d61_90_c / 100.0, 2) as rev_d61_90,
         round(a.prof_d1_30_c / 100.0, 2) as prof_d1_30
  from agg a
  left join thrive_product_catalog pc on pc.thrive_variant_id = a.variant_id
  order by a.rev_d1_30_c desc nulls last
  limit p_limit;
$$;

grant execute on function public.asset_life_top_launches(int) to anon, authenticated;
