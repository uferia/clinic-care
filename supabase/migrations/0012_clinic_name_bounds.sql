-- Clinic names were bounded only by "not empty after trim", which allowed both ends of a bad
-- range: a single stray keystroke created a permanent clinic (and since memberships.email is
-- globally unique, that account could never register another), and an unbounded name flowed
-- straight into the toolbar, the invoice letterhead, and the blocked-screen mailto subject.
--
-- 2 rejects typos without rejecting legitimately short names — clinics do trade under initials.
-- 100 comfortably fits a letterhead line and is far above any real clinic name.
alter table public.clinics
  add constraint clinics_name_length check (char_length(name) between 2 and 100);

-- The constraint is the real boundary; the functions below check the same bounds first so the
-- caller gets 'name too short' / 'name too long' rather than a raw constraint violation.
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
  if char_length(v_name) < 2 then
    raise exception 'name too short';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'name too long';
  end if;

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

  perform public.log_audit(
    v_clinic.id, p_user_id, 'clinic.register', p_email::text,
    jsonb_build_object('name', v_name)
  );

  return v_clinic;
end;
$$;

create or replace function public.update_clinic_profile(
  p_actor_user_id uuid,
  p_clinic_id     uuid,
  p_name          text,
  p_address       text,
  p_phone         text,
  p_email         text,
  p_tax_id        text
)
returns public.clinics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super boolean;
  v_actor    public.memberships;
  v_name     text := trim(coalesce(p_name, ''));
  v_previous text;
  v_clinic   public.clinics;
begin
  if v_name = '' then
    raise exception 'name required';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'name too short';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'name too long';
  end if;

  select exists (select 1 from public.super_admins where user_id = p_actor_user_id) into v_is_super;

  if not v_is_super then
    select * into v_actor from public.memberships where user_id = p_actor_user_id;
    if v_actor.id is null or v_actor.role <> 'clinic_admin' or v_actor.clinic_id <> p_clinic_id then
      raise exception 'forbidden';
    end if;
  end if;

  select name into v_previous from public.clinics where id = p_clinic_id;

  update public.clinics
     set name    = v_name,
         address = nullif(trim(coalesce(p_address, '')), ''),
         phone   = nullif(trim(coalesce(p_phone,   '')), ''),
         email   = nullif(trim(coalesce(p_email,   '')), ''),
         tax_id  = nullif(trim(coalesce(p_tax_id,  '')), '')
   where id = p_clinic_id
  returning * into v_clinic;

  if v_clinic.id is null then
    raise exception 'clinic not found';
  end if;

  perform public.log_audit(
    p_clinic_id, p_actor_user_id, 'clinic.update', v_name,
    jsonb_build_object('previous_name', v_previous)
  );

  return v_clinic;
end;
$$;
