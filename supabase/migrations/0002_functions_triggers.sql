-- Clinic the current user belongs to (via their bound membership). NULL if none.
create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinic_id from public.memberships where user_id = auth.uid() limit 1;
$$;

-- Is the current user's clinic subscription live right now?
create or replace function public.current_clinic_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.clinic_id = public.current_clinic_id()
      and (
        (s.status = 'trialing' and s.trial_ends_at > now())
        or (s.status = 'active' and s.active_until is not null and s.active_until > now())
      )
  );
$$;

-- Is the current user a platform super-admin?
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;

-- Force clinic_id on domain writes to the caller's clinic; never trust client input.
create or replace function public.set_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.clinic_id := public.current_clinic_id();
  if new.clinic_id is null then
    raise exception 'no clinic for current user';
  end if;
  return new;
end;
$$;

create trigger set_clinic_id_patients
  before insert on public.patients
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_doctors
  before insert on public.doctors
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_appointments
  before insert on public.appointments
  for each row execute function public.set_clinic_id();

-- On first login, bind the new auth user to any seeded membership / super_admin by email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.memberships
     set user_id = new.id
   where email = new.email and user_id is null;

  update public.super_admins
     set user_id = new.id
   where email = new.email and user_id is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
