-- Audit trail for privileged actions: who registered a clinic, who changed a role, who removed
-- whom, who activated a subscription. Membership changes are access control, and until now they
-- left no trace — a clinic could see that someone is gone but not who removed them or when.
--
-- Append-only by construction: no client write policy exists, and the only writer is
-- log_audit(), which is granted to service_role alone.
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  -- Null only for platform-level actions with no clinic yet.
  clinic_id     uuid references public.clinics (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Denormalised on purpose: the trail must still name the actor after the account is deleted.
  actor_email   citext,
  action        text not null,
  target        text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_log_clinic_created_idx on public.audit_log (clinic_id, created_at desc);

-- Read-only for clients, and only the rows the policy below allows. The GRANT is the
-- table-level gate Postgres checks BEFORE RLS — a policy without it denies everyone
-- (see 0004_grants.sql for the same pairing on the other tables). No insert/update/delete
-- is granted to anyone but service_role: the trail is append-only, written by log_audit().
grant select on public.audit_log to authenticated;

create or replace function public.log_audit(
  p_clinic_id uuid,
  p_actor     uuid,
  p_action    text,
  p_target    text default null,
  p_details   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (clinic_id, actor_user_id, actor_email, action, target, details)
  values (
    p_clinic_id,
    p_actor,
    (select email from auth.users where id = p_actor),
    p_action,
    p_target,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.log_audit(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.log_audit(uuid, uuid, text, text, jsonb) to service_role;

-- Readable by a clinic_admin of that clinic, and by super-admins. Staff are deliberately excluded:
-- the trail records who holds access, which is an owner's concern, not general clinic data.
alter table public.audit_log enable row level security;

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships m
       where m.user_id = auth.uid()
         and m.clinic_id = audit_log.clinic_id
         and m.role = 'clinic_admin'
    )
  );

-- Instrument the existing privileged functions. Each logs inside its own transaction, so an
-- action that rolls back leaves no audit row claiming it happened.
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

create or replace function public.manage_member(
  p_actor_user_id uuid,
  p_member_id     uuid,
  p_action        text,
  p_role          text default null
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super  boolean;
  v_actor     public.memberships;
  v_target    public.memberships;
  v_admins    integer;
begin
  if p_action not in ('set_role', 'remove') then
    raise exception 'invalid action';
  end if;
  if p_action = 'set_role' and (p_role is null or p_role not in ('clinic_admin', 'staff')) then
    raise exception 'invalid role';
  end if;

  select exists (select 1 from public.super_admins where user_id = p_actor_user_id) into v_is_super;

  select * into v_target from public.memberships where id = p_member_id for update;
  if v_target.id is null then
    raise exception 'member not found';
  end if;

  if not v_is_super then
    select * into v_actor from public.memberships where user_id = p_actor_user_id;
    if v_actor.id is null or v_actor.role <> 'clinic_admin' then
      raise exception 'forbidden';
    end if;
    if v_actor.clinic_id <> v_target.clinic_id then
      raise exception 'forbidden';
    end if;
  end if;

  if v_target.role = 'clinic_admin' and (p_action = 'remove' or p_role = 'staff') then
    select count(*) into v_admins
      from public.memberships
     where clinic_id = v_target.clinic_id and role = 'clinic_admin';
    if v_admins <= 1 then
      raise exception 'last admin';
    end if;
  end if;

  if p_action = 'remove' then
    delete from public.memberships where id = p_member_id;
    perform public.log_audit(
      v_target.clinic_id, p_actor_user_id, 'member.remove', v_target.email::text,
      jsonb_build_object('role', v_target.role)
    );
    return v_target;
  end if;

  update public.memberships set role = p_role where id = p_member_id returning * into v_target;
  perform public.log_audit(
    v_target.clinic_id, p_actor_user_id, 'member.role_change', v_target.email::text,
    jsonb_build_object('role', p_role)
  );
  return v_target;
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
    -- A rename is the change worth being able to explain later.
    jsonb_build_object('previous_name', v_previous)
  );

  return v_clinic;
end;
$$;
