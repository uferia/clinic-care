-- Clinic-admin member management: change a member's role, or remove them.
--
-- Both actions are access control, so they run in one transaction with their guards: a clinic must
-- never be left without a clinic_admin (nobody could invite or manage anyone again), and a caller
-- must never touch another clinic's membership.
--
-- Like register_clinic(), the actor arrives as an argument because the edge function calls this
-- with the service-role key. The edge function checks the caller is a clinic_admin or super-admin
-- first; the re-check here is defense in depth and — for the last-admin rule — the only place the
-- check is race-free.
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

  -- Lock the target so two concurrent demotions cannot both see a second admin.
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

  -- A clinic always keeps at least one admin, whether the last one is demoted or removed.
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
    return v_target;
  end if;

  update public.memberships set role = p_role where id = p_member_id returning * into v_target;
  return v_target;
end;
$$;

revoke execute on function public.manage_member(uuid, uuid, text, text) from public, anon, authenticated;
grant  execute on function public.manage_member(uuid, uuid, text, text) to service_role;
