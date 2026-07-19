# Patient Documents & History — Design

**Date:** 2026-07-19
**Status:** Approved, ready for planning

## Goal

Add two capabilities to the patient record:

1. **Document attachments** — upload images (JPEG/PNG) and PDFs (≤10MB each) against a
   patient, stored in a Google Cloud Storage bucket, with a metadata index in Postgres.
2. **Patient history** — three parts:
   - **Medical background fields** (allergies, chronic conditions, current medications).
   - **Clinical notes / visits** — free-standing notes staff write per visit.
   - **Appointment history** — read-only timeline from the existing `appointments` table.

Both features hang off a new **patient detail page**.

## Context (existing system)

- Angular 22 (standalone, signals, Material 22) + Supabase (`@supabase/supabase-js`).
- Multi-tenant. RLS gates every domain table on
  `clinic_id = current_clinic_id() AND current_clinic_active()`.
- `set_clinic_id` BEFORE-INSERT trigger forces `clinic_id` on domain writes — client input never trusted.
- Existing edge functions (`add-members`, `create-clinic`, `set-subscription`, `expire-clinic`)
  follow a shared pattern: verify caller JWT, run privileged work with a service-role client.
  Current shared gate `requireSuperAdmin` only covers super-admins.
- `patients/:id` route currently reuses `PatientFormComponent` (edit). No real detail view exists.
- No storage bucket, no documents, no clinical notes today.

## Architecture Decisions

### GCS upload flow — signed-URL direct upload

- The browser never holds GCS credentials.
- A new edge function mints a **V4 signed PUT URL** scoped to a per-clinic/per-patient object path.
- The browser uploads bytes **directly to GCS**; bytes never pass through Supabase.
- Metadata is written to `patient_documents` via normal RLS **only after** the PUT succeeds.
- Download and delete also go through the edge function (signed GET URL / object delete).

Rejected: proxying bytes through the edge function (10MB payloads are slow/costly, hit limits);
public bucket with unguessable paths (insecure for medical files).

### Patient detail page — dedicated detail view

- `patients/:id` becomes `PatientDetailComponent` with three tabs: **Overview**, **History**, **Documents**.
- Edit form moves to `patients/:id/edit`. Create stays at `patients/new`.

Rejected: bolting sections beneath the existing form page (messier, mixes read/edit concerns).

## Data Model (new migration `0006`)

### Extend `patients`

Add nullable free-text medical background columns (1:1 with the patient, no separate table):

```sql
alter table public.patients
  add column allergies   text,
  add column conditions  text,
  add column medications text;
```

### New table `patient_clinical_notes`

```sql
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
```

- Free-standing — **not** linked to a specific appointment.
- Tenant RLS (`for all` on own active clinic) + `set_clinic_id` BEFORE-INSERT trigger, same as
  `patients` / `doctors` / `appointments`.
- `author_id` / `author_email` set from the caller at insert time (client-supplied, low stakes).
- Staff can add and delete notes. No edit in v1 (YAGNI).

### New table `patient_documents`

```sql
create table public.patient_documents (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  object_path  text not null,          -- GCS object key (see path scheme)
  file_name    text not null,          -- original display name
  content_type text not null,          -- image/jpeg | image/png | application/pdf
  size_bytes   bigint not null,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index patient_documents_patient_idx on public.patient_documents (patient_id);
```

- Metadata only — file bytes live in GCS.
- Tenant RLS + `set_clinic_id` trigger like the other domain tables.
- Object path scheme: `clinics/{clinicId}/patients/{patientId}/{uuid}.{ext}`.

Both new tables need `set_clinic_id` triggers and tenant RLS policies added in the same migration,
plus grants consistent with `0004`/`0005`.

## Edge Function `gcs-doc`

New shared gate `requireClinicMember(req)` (in `_shared/auth.ts` alongside `requireSuperAdmin`):
verify caller JWT, look up their `memberships` row + live subscription via the service-role client,
return `{ admin, userId, clinicId }` or an error tuple. Rejects blocked/inactive clinics.

Single function, action dispatched by request body `action`:

- **`sign-upload`** — input `{ patientId, fileName, contentType, sizeBytes }`.
  - Validate `contentType ∈ {image/jpeg, image/png, application/pdf}` and `sizeBytes ≤ 10*1024*1024`.
  - Verify `patientId` belongs to `clinicId` (service-role lookup).
  - Build `objectPath = clinics/{clinicId}/patients/{patientId}/{uuid}.{ext}`.
  - Return `{ uploadUrl, objectPath }` — a V4 signed PUT URL (short TTL, e.g. 5 min) with the
    content-type pinned.
- **`sign-download`** — input `{ documentId }`.
  - Verify the doc row is in `clinicId`. Return `{ downloadUrl }` — short-lived V4 signed GET URL.
- **`delete`** — input `{ documentId }`.
  - Verify the doc row is in `clinicId`. Delete the GCS object, then delete the metadata row.

Secrets (Deno env): `GCS_BUCKET`, `GCS_SA_KEY` (service-account JSON). V4 signing performed with
the SA private key (RSA-SHA256) — no bytes proxied. CORS handled via existing `_shared/cors.ts`.

Client re-inserts the `patient_documents` metadata row itself after a successful PUT (clinic_id
forced by trigger; `object_path`/`file_name`/`content_type`/`size_bytes` from the sign-upload
response echoed back). Insert happens only on PUT HTTP 200.

## Frontend

### Routing

```
patients
  ''          → PatientListComponent      (unchanged)
  'new'       → PatientFormComponent      (create, unchanged)
  ':id'       → PatientDetailComponent    (NEW — tabs)
  ':id/edit'  → PatientFormComponent      (edit; was ':id')
```

### `PatientDetailComponent`

Loads the patient by route `:id`. Material tab group:

- **Overview** — contact fields (read) + medical background (allergies / conditions / medications),
  inline-editable and saved to `patients`. "Edit" button routes to `:id/edit` for the core fields.
- **History** — appointment timeline (existing `appointments` filtered by `patient_id`, read-only:
  date, doctor, reason, status) + clinical-notes list with an "Add note" control (visit_date + body)
  and per-note delete.
- **Documents** — file picker / drag-drop upload, and a grid of documents. Image thumbnails render
  from a signed GET URL; PDFs open in a new tab via signed GET; each doc has a delete action.

### Stores (signal + `resource` pattern, mirroring `patient.store.ts`)

- `ClinicalNotesStore` — list notes for a patient, add, delete.
- `PatientDocumentsStore` — list docs for a patient; `upload(file)` orchestrates
  sign-upload → PUT → metadata insert; `download(doc)` / `delete(doc)` call the edge function.
- Medical background save can extend `patient.store` / `patient.model` (`toPatientWrite`).

### Upload orchestration (client)

1. Client-side pre-check: type ∈ allowed, size ≤10MB (re-checked server-side).
2. Call `gcs-doc` `sign-upload` → `{ uploadUrl, objectPath }`.
3. `PUT` the file to `uploadUrl` with the matching `Content-Type`.
4. On HTTP 200, insert the `patient_documents` row (RLS forces `clinic_id`).
5. Reload the documents resource.

## Error Handling & Edge Cases

- Oversize / wrong-type files rejected client-side **and** re-validated in the edge function.
- Failed GCS PUT → no metadata row written (insert is gated on PUT success).
- Orphaned GCS objects (row insert fails after a successful PUT) are out of scope for v1 — rare,
  low-impact; a future sweep job can reconcile.
- Delete removes the GCS object first, then the row.
- All edge-function actions reject callers whose clinic is blocked/inactive (subscription gate).

## Testing

- Unit (vitest), mirroring `patient.store.spec.ts` / `patient.mapper.spec.ts`:
  - clinical-notes mapper + store (add/delete/list).
  - patient-documents mapper + store (upload orchestration with mocked edge + PUT, delete).
  - medical-background write mapping.
- Playwright load-check the running app before claiming any UI works (per project memory:
  ng test/build miss blank-page bootstrap crashes).

## Out of Scope (v1)

- Editing clinical notes (add + delete only).
- Linking notes to specific appointments.
- Orphaned-object reconciliation / background cleanup.
- Document versioning, folders, or tags.
- Audit/change log of patient-record edits.
