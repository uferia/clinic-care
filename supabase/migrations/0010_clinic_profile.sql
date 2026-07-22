-- Clinic identity. A printed invoice is a document a patient keeps, and until now it carried no
-- clinic name, address, or tax id — only the invoice number. These columns back the letterhead.
--
-- All optional: a clinic registers with a name alone and fills the rest in when it starts issuing
-- invoices for real.
alter table public.clinics
  add column address text,
  add column phone   text,
  add column email   text,
  add column tax_id  text;

-- Clinic profile edits go through the update-clinic edge function (service role), like every other
-- write to clinics/subscriptions/memberships. No client-side UPDATE policy is added here.
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

  return v_clinic;
end;
$$;

revoke execute on function public.update_clinic_profile(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_clinic_profile(uuid, uuid, text, text, text, text, text)
  to service_role;
