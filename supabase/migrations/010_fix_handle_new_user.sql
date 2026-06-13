-- Fix the handle_new_user trigger so it works when fired by the
-- supabase_auth_admin role inside GoTrue's INSERT pipeline.
--
-- Symptom before fix: any call to /auth/v1/invite (and /auth/v1/signup,
-- /auth/v1/admin/users) returns HTTP 500 "Database error saving new
-- user" because the unqualified `user_role` and `user_profiles`
-- references can't be resolved — supabase_auth_admin's default
-- search_path doesn't include `public`, and the SECURITY DEFINER
-- function inherits the caller's search_path when proconfig is null.
--
-- Fix: pin search_path on the function + schema-qualify all references.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
begin
  insert into public.user_profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'store_associate'::public.user_role)
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
exception when others then
  -- Don't block GoTrue's auth.users insert if profile creation fails;
  -- the app's /api/admin/invite route does its own upsert anyway. Log
  -- and continue so a malformed role string (legacy clients, bad
  -- metadata) can't lock out new sign-ups entirely.
  raise warning 'handle_new_user trigger: % (sqlstate %)', sqlerrm, sqlstate;
  return new;
end;
$function$;
