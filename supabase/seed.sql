-- Platform owner. user_id binds when this Google account first logs in.
insert into public.super_admins (email) values ('ulysses.feria@gmail.com')
on conflict (email) do nothing;

-- One demo clinic on an active trial, with a seeded staff email.
with c as (
  insert into public.clinics (name) values ('Demo Clinic')
  returning id
)
insert into public.subscriptions (clinic_id, status, trial_ends_at)
select id, 'trialing', now() + interval '14 days' from c;

insert into public.memberships (clinic_id, email, role)
select id, 'ulysses.feria@gmail.com', 'clinic_admin'
from public.clinics where name = 'Demo Clinic';
