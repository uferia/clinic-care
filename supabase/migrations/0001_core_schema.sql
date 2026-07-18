-- Case-insensitive email type.
create extension if not exists citext;

-- Who the platform owner(s) are. Seeded by email; user_id binds on first login.
create table public.super_admins (
  user_id uuid references auth.users (id) on delete set null,
  email   citext primary key
);

create table public.clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  clinic_id     uuid primary key references public.clinics (id) on delete cascade,
  status        text not null default 'trialing'
                  check (status in ('trialing', 'active', 'expired')),
  trial_ends_at timestamptz not null,
  active_until  timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  email      citext not null unique,
  role       text not null default 'staff' check (role in ('clinic_admin', 'staff')),
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index memberships_clinic_id_idx on public.memberships (clinic_id);
create index memberships_user_id_idx   on public.memberships (user_id);

-- Domain tables. Fresh schema (db.json is throwaway demo data).
create table public.patients (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  first_name text not null,
  last_name  text not null,
  email      text,
  phone      text,
  birth_date date,
  blood_type text,
  created_at timestamptz not null default now()
);

create table public.doctors (
  id        uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name      text not null,
  specialty text,
  rating    numeric(2,1),
  available boolean not null default true
);

create table public.appointments (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  doctor_id  uuid not null references public.doctors (id) on delete cascade,
  date       date not null,
  time       text not null,
  reason     text,
  status     text not null default 'pending'
               check (status in ('pending', 'confirmed', 'cancelled', 'completed'))
);

create index patients_clinic_id_idx     on public.patients (clinic_id);
create index doctors_clinic_id_idx      on public.doctors (clinic_id);
create index appointments_clinic_id_idx on public.appointments (clinic_id);
