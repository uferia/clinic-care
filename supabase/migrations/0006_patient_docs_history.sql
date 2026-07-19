-- Medical background: free-text, 1:1 with the patient.
alter table public.patients
  add column allergies   text,
  add column conditions  text,
  add column medications text;

-- Clinical notes / visits. Free-standing (not tied to an appointment).
create table public.patient_clinical_notes (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  author_id    uuid references auth.users (id) on delete set null,
  author_email citext,
  visit_date   date not null default current_date,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index patient_clinical_notes_patient_idx on public.patient_clinical_notes (patient_id);

-- Document metadata. Bytes live in GCS; this table is the index.
create table public.patient_documents (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  object_path  text not null,
  file_name    text not null,
  content_type text not null,
  size_bytes   bigint not null,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index patient_documents_patient_idx on public.patient_documents (patient_id);

-- Force clinic_id on insert (mirrors patients/doctors/appointments).
create trigger set_clinic_id_clinical_notes
  before insert on public.patient_clinical_notes
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_documents
  before insert on public.patient_documents
  for each row execute function public.set_clinic_id();

-- RLS.
alter table public.patient_clinical_notes enable row level security;
alter table public.patient_documents      enable row level security;

create policy clinical_notes_tenant on public.patient_clinical_notes
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy documents_tenant on public.patient_documents
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

-- Grants (RLS still restricts rows; these are the table-level gate).
grant select, insert, update, delete on public.patient_clinical_notes to authenticated;
grant select, insert, update, delete on public.patient_documents      to authenticated;
