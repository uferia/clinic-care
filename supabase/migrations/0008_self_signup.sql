-- Self-service clinic registration.
--
-- A signed-in Google account with no membership creates its own clinic and starts a 30-day trial,
-- with no super-admin approval. The three inserts (clinic + subscription + owner membership) run
-- in one transaction so a failure never leaves an orphan clinic.
--
-- Caller identity arrives as arguments because the `register-clinic` edge function invokes this
-- with the service-role key, where auth.uid() is null. The edge function verifies the caller's JWT
-- first; execute is granted to service_role only, so there is no client path in.
create or replace function public.register_clinic(
  p_user_id uuid,
  p_email   citext,
  p_name    text
)
returns public.clinics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_clinic public.clinics;
begin
  if p_user_id is null then
    raise exception 'user required';
  end if;
  if p_email is null or trim(p_email::text) = '' then
    raise exception 'email required';
  end if;
  if v_name = '' then
    raise exception 'name required';
  end if;

  -- One person, one clinic. The unique index on memberships.email is what actually wins a race;
  -- this check exists to return a clean message on the common path.
  if exists (
    select 1 from public.memberships
     where email = p_email or (user_id is not null and user_id = p_user_id)
  ) then
    raise exception 'already a member';
  end if;

  insert into public.clinics (name) values (v_name) returning * into v_clinic;

  insert into public.subscriptions (clinic_id, status, trial_ends_at)
  values (v_clinic.id, 'trialing', now() + interval '30 days');

  insert into public.memberships (clinic_id, email, role, user_id)
  values (v_clinic.id, p_email, 'clinic_admin', p_user_id);

  return v_clinic;
end;
$$;

revoke execute on function public.register_clinic(uuid, citext, text) from public, anon, authenticated;
grant  execute on function public.register_clinic(uuid, citext, text) to service_role;
