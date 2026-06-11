-- Fix: TRIM() only strips spaces, not newlines — SQL built from JS template
-- literals starts with "\n" and was rejected by the SELECT-only guard, which
-- broke the dashboard KPIs, /labor, /reports/*, and the compute-features cron.
-- Applied to the live database 2026-06-11; kept here so the repo matches.
create or replace function public.run_report_query(query_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  result JSONB;
  cleaned TEXT;
BEGIN
  cleaned := lower(regexp_replace(query_sql, '^\s+', ''));
  IF cleaned NOT LIKE 'select%' AND cleaned NOT LIKE 'with %' THEN
    RAISE EXCEPTION 'Only SELECT queries are permitted';
  END IF;
  IF cleaned LIKE '%pg_catalog%' OR cleaned LIKE '%information_schema%'
     OR cleaned LIKE '%pg_class%' OR cleaned LIKE '%pg_tables%' THEN
    RAISE EXCEPTION 'System table access is not permitted';
  END IF;
  BEGIN
    EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', query_sql) INTO result;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Query error: %', SQLERRM;
  END;
  RETURN result;
END;
$$;
