# Patient Documents & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-patient document attachments (images/PDF in Google Cloud Storage) and a patient history view (medical background fields, clinical notes, appointment timeline), hung off a new patient detail page.

**Architecture:** New Postgres migration adds medical-background columns to `patients` plus `patient_clinical_notes` and `patient_documents` tables (metadata only), all under the existing tenant RLS + `set_clinic_id` trigger pattern. A new `gcs-doc` edge function mints V4 signed GCS URLs for upload/download and deletes objects, gated by a new `requireClinicMember` helper. The Angular frontend replaces the `patients/:id` edit route with a tabbed `PatientDetailComponent` (Overview / History / Documents); the edit form moves to `patients/:id/edit`.

**Tech Stack:** Angular 22 (standalone, signals, Material 22), `@supabase/supabase-js`, Supabase Edge Functions (Deno), Google Cloud Storage (V4 signed URLs, Web Crypto RSA-SHA256), vitest, Playwright.

## Global Constraints

- Angular 22, standalone components only, signals + `resource()` for async state. No NgModules.
- Stores use the `@Service()` decorator imported from `@angular/core` (existing pattern).
- Row types (snake_case) live in `src/app/core/db.types.ts`; mappers convert to camelCase domain models. Row types never reach components/templates.
- Every domain table is gated by tenant RLS `clinic_id = public.current_clinic_id() and public.current_clinic_active()` and gets a `set_clinic_id` BEFORE-INSERT trigger. Never trust client-supplied `clinic_id`.
- Edge functions use `_shared/cors.ts` (`handleCors`, `json`) and a gate from `_shared/auth.ts`. Service-role client for privileged reads/writes.
- Allowed document types: `image/jpeg`, `image/png`, `application/pdf`. Max size: `10 * 1024 * 1024` bytes. Enforced client-side AND re-checked in the edge function.
- GCS object path scheme: `clinics/{clinicId}/patients/{patientId}/{uuid}.{ext}`.
- Commits authored as the user only — do NOT add a Claude Co-Authored-By trailer.
- Migrations are additive; new migration file is `supabase/migrations/0006_patient_docs_history.sql`.

---

### Task 1: Migration — schema for medical background, clinical notes, documents

**Files:**
- Create: `supabase/migrations/0006_patient_docs_history.sql`

**Interfaces:**
- Consumes: existing `public.set_clinic_id()`, `public.current_clinic_id()`, `public.current_clinic_active()` (from `0002`).
- Produces: `patients.allergies/conditions/medications` columns; tables `public.patient_clinical_notes`, `public.patient_documents`; their triggers, RLS policies, and grants.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_patient_docs_history.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to a local DB and verify it succeeds**

Run: `npx supabase db reset`
Expected: reset completes with no error and lists `0006_patient_docs_history.sql` among applied migrations. (If the local Supabase stack is not running, start it with `npx supabase start` first.)

- [ ] **Step 3: Verify the new objects exist**

Run: `npx supabase db diff --schema public`
Expected: empty diff (migration is the source of truth; DB matches).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_patient_docs_history.sql
git commit -m "feat(db): patient medical fields, clinical notes, document metadata"
```

---

### Task 2: Row types + patient medical-background mapping

**Files:**
- Modify: `src/app/core/db.types.ts`
- Modify: `src/app/features/patients/patient.model.ts`
- Test: `src/app/features/patients/patient.mapper.spec.ts`

**Interfaces:**
- Consumes: existing `PatientRow`, `toPatient`, `toPatientWrite`.
- Produces:
  - `PatientRow` gains `allergies: string | null; conditions: string | null; medications: string | null`.
  - New row types `ClinicalNoteRow`, `PatientDocumentRow`.
  - `Patient` gains `allergies: string; conditions: string; medications: string`.
  - `toPatientWrite` includes the three medical fields.
  - New `MedicalBackground` type `{ allergies: string; conditions: string; medications: string }` and `toMedicalWrite(m: MedicalBackground): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/features/patients/patient.mapper.spec.ts` (create the file if it does not exist, importing from `./patient.model`):

```ts
import { describe, it, expect } from 'vitest';
import { toPatient, toPatientWrite, toMedicalWrite } from './patient.model';
import { PatientRow } from '../../core/db.types';

const row: PatientRow = {
  id: 'p1', clinic_id: 'c1', first_name: 'A', last_name: 'B',
  email: null, phone: null, birth_date: null, blood_type: null,
  allergies: 'penicillin', conditions: 'asthma', medications: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('patient medical mapping', () => {
  it('maps medical background from row, null -> empty string', () => {
    const p = toPatient(row);
    expect(p.allergies).toBe('penicillin');
    expect(p.conditions).toBe('asthma');
    expect(p.medications).toBe('');
  });

  it('toPatientWrite includes medical fields', () => {
    const w = toPatientWrite({
      firstName: 'A', lastName: 'B', email: '', phone: '', birthDate: '', bloodType: 'O+',
      allergies: 'x', conditions: 'y', medications: 'z',
    });
    expect(w).toMatchObject({ allergies: 'x', conditions: 'y', medications: 'z' });
  });

  it('toMedicalWrite maps only medical fields', () => {
    expect(toMedicalWrite({ allergies: 'a', conditions: 'c', medications: 'm' }))
      .toEqual({ allergies: 'a', conditions: 'c', medications: 'm' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/patients/patient.mapper.spec.ts`
Expected: FAIL — `toMedicalWrite` is not exported / `allergies` missing on type.

- [ ] **Step 3: Update the row type**

In `src/app/core/db.types.ts`, add to `PatientRow` (after `blood_type`):

```ts
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
```

Also append the two new row types at the end of the file:

```ts
export interface ClinicalNoteRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  author_id: string | null;
  author_email: string | null;
  visit_date: string;
  body: string;
  created_at: string;
}

export interface PatientDocumentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  object_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Update the patient model**

In `src/app/features/patients/patient.model.ts`:

Add to the `Patient` interface (after `bloodType`):

```ts
  allergies: string;
  conditions: string;
  medications: string;
```

In `toPatient`, add to the returned object (before `createdAt`):

```ts
    allergies: row.allergies ?? '',
    conditions: row.conditions ?? '',
    medications: row.medications ?? '',
```

In `toPatientWrite`, add before the closing brace of the returned object:

```ts
    allergies: dto.allergies,
    conditions: dto.conditions,
    medications: dto.medications,
```

Append at the end of the file:

```ts
export interface MedicalBackground {
  allergies: string;
  conditions: string;
  medications: string;
}

export function toMedicalWrite(m: MedicalBackground): Record<string, unknown> {
  return { allergies: m.allergies, conditions: m.conditions, medications: m.medications };
}
```

Note: `CreatePatientDto = Omit<Patient, 'id' | 'clinicId' | 'createdAt'>` now automatically includes the three medical fields — the patient form (Task 10) must supply them (default `''`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/features/patients/patient.mapper.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/core/db.types.ts src/app/features/patients/patient.model.ts src/app/features/patients/patient.mapper.spec.ts
git commit -m "feat(patients): medical background fields on patient model"
```

---

### Task 3: Clinical note model + mapper

**Files:**
- Create: `src/app/features/patients/clinical-note.model.ts`
- Test: `src/app/features/patients/clinical-note.model.spec.ts`

**Interfaces:**
- Consumes: `ClinicalNoteRow` from `db.types.ts`.
- Produces:
  - `interface ClinicalNote { id; clinicId; patientId; authorEmail: string; visitDate: string; body: string; createdAt: string }`
  - `interface CreateNoteDto { patientId: string; visitDate: string; body: string; authorEmail: string }`
  - `toClinicalNote(row: ClinicalNoteRow): ClinicalNote`
  - `toNoteWrite(dto: CreateNoteDto): Record<string, unknown>` — maps to snake_case `{ patient_id, visit_date, body, author_email }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/patients/clinical-note.model.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toClinicalNote, toNoteWrite } from './clinical-note.model';
import { ClinicalNoteRow } from '../../core/db.types';

const row: ClinicalNoteRow = {
  id: 'n1', clinic_id: 'c1', patient_id: 'p1',
  author_id: 'u1', author_email: 'doc@x.com',
  visit_date: '2026-07-10', body: 'BP normal', created_at: '2026-07-10T09:00:00Z',
};

describe('clinical note mapping', () => {
  it('maps a row to a domain note', () => {
    const n = toClinicalNote(row);
    expect(n).toEqual({
      id: 'n1', clinicId: 'c1', patientId: 'p1',
      authorEmail: 'doc@x.com', visitDate: '2026-07-10',
      body: 'BP normal', createdAt: '2026-07-10T09:00:00Z',
    });
  });

  it('toNoteWrite maps to snake_case insert shape', () => {
    expect(toNoteWrite({ patientId: 'p1', visitDate: '2026-07-10', body: 'x', authorEmail: 'd@x.com' }))
      .toEqual({ patient_id: 'p1', visit_date: '2026-07-10', body: 'x', author_email: 'd@x.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/patients/clinical-note.model.spec.ts`
Expected: FAIL — module `./clinical-note.model` not found.

- [ ] **Step 3: Write the model**

Create `src/app/features/patients/clinical-note.model.ts`:

```ts
import { ClinicalNoteRow } from '../../core/db.types';

export interface ClinicalNote {
  id: string;
  clinicId: string;
  patientId: string;
  authorEmail: string;
  /** ISO date, `YYYY-MM-DD`. */
  visitDate: string;
  body: string;
  createdAt: string;
}

export interface CreateNoteDto {
  patientId: string;
  visitDate: string;
  body: string;
  authorEmail: string;
}

export function toClinicalNote(row: ClinicalNoteRow): ClinicalNote {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    authorEmail: row.author_email ?? '',
    visitDate: row.visit_date,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function toNoteWrite(dto: CreateNoteDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    visit_date: dto.visitDate,
    body: dto.body,
    author_email: dto.authorEmail,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/patients/clinical-note.model.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/patients/clinical-note.model.ts src/app/features/patients/clinical-note.model.spec.ts
git commit -m "feat(patients): clinical note model + mapper"
```

---

### Task 4: Clinical notes store

**Files:**
- Create: `src/app/features/patients/clinical-note.store.ts`
- Test: `src/app/features/patients/clinical-note.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE` token; `toClinicalNote`, `toNoteWrite`, `ClinicalNote`, `CreateNoteDto`.
- Produces: `ClinicalNotesStore` with:
  - `setPatient(id: string): void` — sets which patient's notes to load.
  - `notes: Signal<ClinicalNote[]>`, `isLoading: Signal<boolean>`, `error: Signal<unknown>`.
  - `add(dto: CreateNoteDto): Promise<void>` — inserts, then reloads.
  - `remove(id: string): Promise<void>` — deletes, then reloads.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/patients/clinical-note.store.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ClinicalNotesStore } from './clinical-note.store';
import { SUPABASE } from '../../core/supabase.client';

const rows = [
  { id: 'n1', clinic_id: 'c1', patient_id: 'p1', author_id: 'u1', author_email: 'd@x.com',
    visit_date: '2026-07-10', body: 'note', created_at: '2026-07-10T09:00:00Z' },
];

function fakeClient() {
  const selectBuilder: any = {
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const del: any = { eq: vi.fn(() => Promise.resolve({ error: null })) };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectBuilder),
      insert,
      delete: vi.fn(() => del),
    })),
    _insert: insert,
    _delEq: del.eq,
  };
  return client;
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(ClinicalNotesStore);
}

describe('ClinicalNotesStore', () => {
  it('loads notes for the set patient, newest first', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patient_clinical_notes');
    expect(store.notes()[0].body).toBe('note');
  });

  it('add() inserts snake_case row', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await store.add({ patientId: 'p1', visitDate: '2026-07-10', body: 'x', authorEmail: 'd@x.com' });
    expect(client._insert).toHaveBeenCalledWith({
      patient_id: 'p1', visit_date: '2026-07-10', body: 'x', author_email: 'd@x.com',
    });
  });

  it('remove() deletes by id', async () => {
    const client = fakeClient();
    const store = setup(client);
    store.setPatient('p1');
    await store.remove('n1');
    expect(client._delEq).toHaveBeenCalledWith('id', 'n1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/patients/clinical-note.store.spec.ts`
Expected: FAIL — module `./clinical-note.store` not found.

- [ ] **Step 3: Write the store**

Create `src/app/features/patients/clinical-note.store.ts`:

```ts
import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicalNote, CreateNoteDto, toClinicalNote, toNoteWrite } from './clinical-note.model';

@Service()
export class ClinicalNotesStore {
  private supabase = inject(SUPABASE);
  private _patientId = signal<string | null>(null);

  setPatient(id: string) {
    this._patientId.set(id);
  }

  private notesResource = resource({
    params: () => ({ patientId: this._patientId() }),
    loader: async ({ params }) => {
      if (!params.patientId) return [] as ClinicalNote[];
      const { data, error } = await this.supabase
        .from('patient_clinical_notes')
        .select('*')
        .eq('patient_id', params.patientId)
        .order('visit_date', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toClinicalNote);
    },
  });

  notes = computed<ClinicalNote[]>(() => this.notesResource.value() ?? []);
  readonly isLoading = computed(() => this.notesResource.isLoading());
  readonly error = computed(() => this.notesResource.error());

  async add(dto: CreateNoteDto): Promise<void> {
    const { error } = await this.supabase.from('patient_clinical_notes').insert(toNoteWrite(dto));
    if (error) throw error;
    this.notesResource.reload();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('patient_clinical_notes').delete().eq('id', id);
    if (error) throw error;
    this.notesResource.reload();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/patients/clinical-note.store.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/patients/clinical-note.store.ts src/app/features/patients/clinical-note.store.spec.ts
git commit -m "feat(patients): clinical notes store"
```

---

### Task 5: Patient document model + mapper

**Files:**
- Create: `src/app/features/patients/patient-document.model.ts`
- Test: `src/app/features/patients/patient-document.model.spec.ts`

**Interfaces:**
- Consumes: `PatientDocumentRow`.
- Produces:
  - `interface PatientDocument { id; clinicId; patientId; objectPath; fileName; contentType; sizeBytes; createdAt; isImage: boolean }`
  - `toPatientDocument(row: PatientDocumentRow): PatientDocument` (sets `isImage = contentType startsWith 'image/'`).
  - `ALLOWED_DOC_TYPES: readonly string[]` = `['image/jpeg','image/png','application/pdf']`.
  - `MAX_DOC_BYTES = 10 * 1024 * 1024`.
  - `validateFile(file: { type: string; size: number }): string | null` — returns an error message or `null` if ok.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/patients/patient-document.model.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toPatientDocument, validateFile, MAX_DOC_BYTES } from './patient-document.model';
import { PatientDocumentRow } from '../../core/db.types';

const row: PatientDocumentRow = {
  id: 'd1', clinic_id: 'c1', patient_id: 'p1',
  object_path: 'clinics/c1/patients/p1/abc.png', file_name: 'scan.png',
  content_type: 'image/png', size_bytes: 1234, uploaded_by: 'u1',
  created_at: '2026-07-10T09:00:00Z',
};

describe('patient document mapping', () => {
  it('maps a row and flags images', () => {
    const d = toPatientDocument(row);
    expect(d.fileName).toBe('scan.png');
    expect(d.isImage).toBe(true);
  });

  it('flags pdf as non-image', () => {
    expect(toPatientDocument({ ...row, content_type: 'application/pdf' }).isImage).toBe(false);
  });

  it('validateFile rejects wrong type', () => {
    expect(validateFile({ type: 'text/plain', size: 10 })).toMatch(/type/i);
  });

  it('validateFile rejects oversize', () => {
    expect(validateFile({ type: 'image/png', size: MAX_DOC_BYTES + 1 })).toMatch(/10 ?MB/i);
  });

  it('validateFile accepts a valid file', () => {
    expect(validateFile({ type: 'application/pdf', size: 100 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/patients/patient-document.model.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the model**

Create `src/app/features/patients/patient-document.model.ts`:

```ts
import { PatientDocumentRow } from '../../core/db.types';

export const ALLOWED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface PatientDocument {
  id: string;
  clinicId: string;
  patientId: string;
  objectPath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  isImage: boolean;
}

export function toPatientDocument(row: PatientDocumentRow): PatientDocument {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    objectPath: row.object_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    isImage: row.content_type.startsWith('image/'),
  };
}

/** Returns a human error message, or null when the file is acceptable. */
export function validateFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_DOC_TYPES.includes(file.type as (typeof ALLOWED_DOC_TYPES)[number])) {
    return 'Unsupported file type. Use JPEG, PNG, or PDF.';
  }
  if (file.size > MAX_DOC_BYTES) {
    return 'File too large. Max 10MB.';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/patients/patient-document.model.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/patients/patient-document.model.ts src/app/features/patients/patient-document.model.spec.ts
git commit -m "feat(patients): patient document model + validation"
```

---

### Task 6: Patient documents store (upload orchestration)

**Files:**
- Create: `src/app/features/patients/patient-document.store.ts`
- Test: `src/app/features/patients/patient-document.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`; `toPatientDocument`, `validateFile`, `PatientDocument`; edge function `gcs-doc` (Task 9) actions `sign-upload`, `sign-download`, `delete`.
- Produces: `PatientDocumentsStore` with:
  - `setPatient(id: string): void`
  - `documents: Signal<PatientDocument[]>`, `isLoading`, `error`.
  - `upload(file: File): Promise<void>` — validates, calls `sign-upload`, PUTs bytes to GCS, inserts metadata, reloads. Throws with a message on validation/HTTP failure.
  - `downloadUrl(doc: PatientDocument): Promise<string>` — calls `sign-download`, returns the URL.
  - `remove(doc: PatientDocument): Promise<void>` — calls `delete`, reloads.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/patients/patient-document.store.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PatientDocumentsStore } from './patient-document.store';
import { SUPABASE } from '../../core/supabase.client';

const rows = [
  { id: 'd1', clinic_id: 'c1', patient_id: 'p1', object_path: 'clinics/c1/patients/p1/a.png',
    file_name: 'a.png', content_type: 'image/png', size_bytes: 10, uploaded_by: 'u1',
    created_at: '2026-07-10T09:00:00Z' },
];

function fakeClient(invokeImpl: any) {
  const selectBuilder: any = {
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  return {
    from: vi.fn(() => ({ select: vi.fn(() => selectBuilder), insert })),
    functions: { invoke: vi.fn(invokeImpl) },
    _insert: insert,
  };
}

function setup(client: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(PatientDocumentsStore);
}

describe('PatientDocumentsStore', () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads documents for the patient', async () => {
    const client = fakeClient(() => Promise.resolve({ data: {}, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patient_documents');
    expect(store.documents()[0].fileName).toBe('a.png');
  });

  it('upload(): signs, PUTs to GCS, inserts metadata', async () => {
    const client = fakeClient((name: string, opts: any) => {
      expect(name).toBe('gcs-doc');
      if (opts.body.action === 'sign-upload') {
        return Promise.resolve({ data: { uploadUrl: 'https://gcs/put', objectPath: 'clinics/c1/patients/p1/x.png' }, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });
    const store = setup(client);
    store.setPatient('p1');
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
    await store.upload(file);
    expect((globalThis as any).fetch).toHaveBeenCalledWith('https://gcs/put', expect.objectContaining({ method: 'PUT' }));
    expect(client._insert).toHaveBeenCalledWith(expect.objectContaining({
      object_path: 'clinics/c1/patients/p1/x.png', file_name: 'x.png',
      content_type: 'image/png', size_bytes: 3, patient_id: 'p1',
    }));
  });

  it('upload(): rejects invalid type before signing', async () => {
    const client = fakeClient(() => Promise.resolve({ data: {}, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    const bad = new File(['x'], 'x.txt', { type: 'text/plain' });
    await expect(store.upload(bad)).rejects.toThrow(/type/i);
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it('upload(): no metadata insert when GCS PUT fails', async () => {
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 }));
    const client = fakeClient((_n: string, opts: any) =>
      Promise.resolve({ data: { uploadUrl: 'https://gcs/put', objectPath: 'p' }, error: null }));
    const store = setup(client);
    store.setPatient('p1');
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    await expect(store.upload(file)).rejects.toThrow(/upload/i);
    expect(client._insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/patients/patient-document.store.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

Create `src/app/features/patients/patient-document.store.ts`:

```ts
import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { PatientDocument, toPatientDocument, validateFile } from './patient-document.model';

interface SignUploadResponse {
  uploadUrl: string;
  objectPath: string;
}

@Service()
export class PatientDocumentsStore {
  private supabase = inject(SUPABASE);
  private _patientId = signal<string | null>(null);

  setPatient(id: string) {
    this._patientId.set(id);
  }

  private docsResource = resource({
    params: () => ({ patientId: this._patientId() }),
    loader: async ({ params }) => {
      if (!params.patientId) return [] as PatientDocument[];
      const { data, error } = await this.supabase
        .from('patient_documents')
        .select('*')
        .eq('patient_id', params.patientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toPatientDocument);
    },
  });

  documents = computed<PatientDocument[]>(() => this.docsResource.value() ?? []);
  readonly isLoading = computed(() => this.docsResource.isLoading());
  readonly error = computed(() => this.docsResource.error());

  async upload(file: File): Promise<void> {
    const patientId = this._patientId();
    if (!patientId) throw new Error('No patient selected.');

    const invalid = validateFile(file);
    if (invalid) throw new Error(invalid);

    // 1. Ask the edge function for a signed PUT URL.
    const { data, error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'sign-upload', patientId, fileName: file.name, contentType: file.type, sizeBytes: file.size },
    });
    if (error) throw error;
    const { uploadUrl, objectPath } = data as SignUploadResponse;

    // 2. Upload bytes directly to GCS. The signed URL pins the content type.
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

    // 3. Only after a successful PUT, record metadata (clinic_id forced by trigger).
    const { error: insErr } = await this.supabase.from('patient_documents').insert({
      patient_id: patientId,
      object_path: objectPath,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
    });
    if (insErr) throw insErr;

    this.docsResource.reload();
  }

  async downloadUrl(doc: PatientDocument): Promise<string> {
    const { data, error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'sign-download', documentId: doc.id },
    });
    if (error) throw error;
    return (data as { downloadUrl: string }).downloadUrl;
  }

  async remove(doc: PatientDocument): Promise<void> {
    const { error } = await this.supabase.functions.invoke('gcs-doc', {
      body: { action: 'delete', documentId: doc.id },
    });
    if (error) throw error;
    this.docsResource.reload();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/patients/patient-document.store.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/patients/patient-document.store.ts src/app/features/patients/patient-document.store.spec.ts
git commit -m "feat(patients): patient documents store with GCS upload orchestration"
```

---

### Task 7: Edge shared gate — `requireClinicMember`

**Files:**
- Modify: `supabase/functions/_shared/auth.ts`

**Interfaces:**
- Consumes: env `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; tables `memberships`, `subscriptions`.
- Produces: `requireClinicMember(req): Promise<ClinicGate | { error; status }>` where `ClinicGate = { admin: SupabaseClient; userId: string; email: string; clinicId: string }`. Rejects when the caller has no membership (403) or the clinic subscription is not live (403 `inactive`).

- [ ] **Step 1: Add the helper**

Append to `supabase/functions/_shared/auth.ts`:

```ts
export interface ClinicGate {
  admin: SupabaseClient;
  userId: string;
  email: string;
  clinicId: string;
}

/**
 * Verify the caller's JWT and confirm they are a member of a clinic with a
 * live subscription. Returns a service-role client + their clinic context.
 */
export async function requireClinicMember(
  req: Request,
): Promise<ClinicGate | { error: string; status: number }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: 'unauthorized', status: 401 };

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return { error: 'unauthorized', status: 401 };

  const admin = createClient(url, service);

  const { data: membership } = await admin
    .from('memberships')
    .select('clinic_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return { error: 'forbidden', status: 403 };
  const clinicId = membership.clinic_id as string;

  // Subscription must be live (mirrors current_clinic_active()).
  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_ends_at, active_until')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  const now = Date.now();
  const live = !!sub && (
    (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > now) ||
    (sub.status === 'active' && sub.active_until && new Date(sub.active_until).getTime() > now)
  );
  if (!live) return { error: 'inactive', status: 403 };

  return { admin, userId: user.id, email: user.email ?? '', clinicId };
}
```

- [ ] **Step 2: Type-check the function**

Run: `npx supabase functions serve --no-verify-jwt` then stop it with Ctrl+C after it reports the functions loaded (this compiles the Deno code). Alternatively, if `deno` is installed: `deno check supabase/functions/_shared/auth.ts`
Expected: no TypeScript/Deno compile errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/auth.ts
git commit -m "feat(edge): requireClinicMember gate for clinic-scoped functions"
```

---

### Task 8: Edge shared GCS V4 signer

**Files:**
- Create: `supabase/functions/_shared/gcs.ts`

**Interfaces:**
- Consumes: env `GCS_BUCKET`, `GCS_SA_KEY` (service-account JSON string with `client_email` + `private_key`).
- Produces:
  - `signedUrl(method: 'PUT' | 'GET', objectPath: string, expiresSec: number, contentType?: string): Promise<string>` — a V4 signed URL (`GOOG4-RSA-SHA256`).
  - `deleteObject(objectPath: string): Promise<void>` — signs a DELETE URL and calls it.
  - `bucket(): string` — returns the configured bucket name.

- [ ] **Step 1: Write the signer**

Create `supabase/functions/_shared/gcs.ts`:

```ts
interface SaKey {
  client_email: string;
  private_key: string;
}

function sa(): SaKey {
  return JSON.parse(Deno.env.get('GCS_SA_KEY')!);
}

export function bucket(): string {
  return Deno.env.get('GCS_BUCKET')!;
}

const HOST = 'storage.googleapis.com';

/** RFC3986 encode. When `path` is true, '/' is preserved (path segments). */
function enc(s: string, path = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(path ? /%2F/g : /(?!)/g, '/');
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return hex(buf);
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

async function rsaSignHex(privateKeyPem: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  return hex(sig);
}

/**
 * Build a V4 signed URL for the given method/object. `contentType` (upload)
 * is added to the signed headers so the client's PUT must send that exact type.
 */
export async function signedUrl(
  method: 'PUT' | 'GET' | 'DELETE',
  objectPath: string,
  expiresSec: number,
  contentType?: string,
): Promise<string> {
  const { client_email, private_key } = sa();

  const now = new Date();
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const datestamp = stamp.slice(0, 8);
  const scope = `${datestamp}/auto/storage/goog4_request`;
  const credential = `${client_email}/${scope}`;

  const canonicalUri = `/${bucket()}/${enc(objectPath, true)}`;

  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const canonicalHeaders = (contentType ? `content-type:${contentType}\n` : '') + `host:${HOST}\n`;

  const queryParams: Record<string, string> = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': credential,
    'X-Goog-Date': stamp,
    'X-Goog-Expires': String(expiresSec),
    'X-Goog-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map(k => `${enc(k)}=${enc(queryParams[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = await rsaSignHex(private_key, stringToSign);
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

export async function deleteObject(objectPath: string): Promise<void> {
  const url = await signedUrl('DELETE', objectPath, 300);
  const res = await fetch(url, { method: 'DELETE' });
  // 404 is fine — object already gone; anything else is an error.
  if (!res.ok && res.status !== 404) {
    throw new Error(`GCS delete failed (${res.status}).`);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/_shared/gcs.ts` (or `npx supabase functions serve` and confirm it loads with no compile error, then Ctrl+C)
Expected: no compile errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/gcs.ts
git commit -m "feat(edge): GCS V4 signed-URL helper"
```

---

### Task 9: Edge function `gcs-doc`

**Files:**
- Create: `supabase/functions/gcs-doc/index.ts`

**Interfaces:**
- Consumes: `handleCors`, `json` (`_shared/cors.ts`); `requireClinicMember` (Task 7); `signedUrl`, `deleteObject` (Task 8); tables `patients`, `patient_documents`.
- Produces: HTTP endpoint dispatching on `body.action`:
  - `sign-upload` → `{ uploadUrl, objectPath }`
  - `sign-download` → `{ downloadUrl }`
  - `delete` → `{ ok: true }`

- [ ] **Step 1: Write the function**

Create `supabase/functions/gcs-doc/index.ts`:

```ts
import { handleCors, json } from '../_shared/cors.ts';
import { requireClinicMember } from '../_shared/auth.ts';
import { signedUrl, deleteObject } from '../_shared/gcs.ts';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const gate = await requireClinicMember(req);
  if ('error' in gate) return json({ error: gate.error }, gate.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const action = body.action;

  if (action === 'sign-upload') {
    const patientId = String(body.patientId ?? '');
    const contentType = String(body.contentType ?? '');
    const sizeBytes = Number(body.sizeBytes ?? 0);
    if (!patientId) return json({ error: 'patientId required' }, 400);
    if (!ALLOWED.has(contentType)) return json({ error: 'unsupported type' }, 400);
    if (!(sizeBytes > 0) || sizeBytes > MAX_BYTES) return json({ error: 'invalid size' }, 400);

    // Patient must belong to the caller's clinic.
    const { data: patient } = await gate.admin
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!patient) return json({ error: 'patient not found' }, 404);

    const objectPath = `clinics/${gate.clinicId}/patients/${patientId}/${crypto.randomUUID()}.${EXT[contentType]}`;
    const uploadUrl = await signedUrl('PUT', objectPath, 300, contentType);
    return json({ uploadUrl, objectPath }, 200);
  }

  if (action === 'sign-download') {
    const documentId = String(body.documentId ?? '');
    if (!documentId) return json({ error: 'documentId required' }, 400);
    const { data: doc } = await gate.admin
      .from('patient_documents')
      .select('object_path')
      .eq('id', documentId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!doc) return json({ error: 'not found' }, 404);
    const downloadUrl = await signedUrl('GET', doc.object_path, 300);
    return json({ downloadUrl }, 200);
  }

  if (action === 'delete') {
    const documentId = String(body.documentId ?? '');
    if (!documentId) return json({ error: 'documentId required' }, 400);
    const { data: doc } = await gate.admin
      .from('patient_documents')
      .select('object_path')
      .eq('id', documentId)
      .eq('clinic_id', gate.clinicId)
      .maybeSingle();
    if (!doc) return json({ error: 'not found' }, 404);

    await deleteObject(doc.object_path);
    const { error } = await gate.admin.from('patient_documents').delete().eq('id', documentId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true }, 200);
  }

  return json({ error: 'unknown action' }, 400);
});
```

- [ ] **Step 2: Type-check the function**

Run: `npx supabase functions serve gcs-doc --no-verify-jwt`
Expected: loads with no compile error (it will wait for requests). Stop with Ctrl+C.

- [ ] **Step 3: Document required secrets**

Confirm these are set for deployment (do not commit values): `GCS_BUCKET`, `GCS_SA_KEY`. Add a note to `docs/` if a secrets doc exists; otherwise record in the commit body. Deploy command (run later, not part of this task's verification): `npx supabase functions deploy gcs-doc`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gcs-doc/index.ts
git commit -m "feat(edge): gcs-doc signed upload/download/delete"
```

---

### Task 10: Routing + PatientDetailComponent shell with Overview tab

**Files:**
- Modify: `src/app/app.routes.ts`
- Create: `src/app/features/patients/patient-detail.component.ts`
- Modify: `src/app/features/patients/patient.store.ts`
- Modify: `src/app/features/patients/patient-form.component.ts` (default the 3 new medical fields so create still works)

**Interfaces:**
- Consumes: `PatientStore`, `Patient`, `MedicalBackground`, `toMedicalWrite`, `toPatient`.
- Produces:
  - Route `patients/:id` → `PatientDetailComponent`; `patients/:id/edit` → `PatientFormComponent`.
  - `PatientStore.getById(id: string): Promise<Patient | null>`.
  - `PatientStore.saveMedical(id: string, m: MedicalBackground): Promise<void>`.
  - `PatientDetailComponent` renders a Material tab group; the Overview tab shows contact info (read) and editable medical background.

- [ ] **Step 1: Add store methods (write the failing test first)**

Add to `src/app/features/patients/patient.store.spec.ts`:

```ts
it('getById selects a single patient by id', async () => {
  const single = { data: rows[0], error: null };
  const client: any = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(single) }) }) }),
  };
  const store = setup(client);
  const p = await store.getById('p1');
  expect(p?.firstName).toBe('Maria');
});

it('saveMedical updates the three medical columns', async () => {
  const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
  const client: any = { from: vi.fn(() => ({ update })) };
  const store = setup(client);
  await store.saveMedical('p1', { allergies: 'a', conditions: 'c', medications: 'm' });
  expect(update).toHaveBeenCalledWith({ allergies: 'a', conditions: 'c', medications: 'm' });
});
```

(Ensure `vi` is imported at the top of the spec: `import { vi } from 'vitest';` — add it if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/features/patients/patient.store.spec.ts`
Expected: FAIL — `getById` / `saveMedical` are not functions.

- [ ] **Step 3: Implement the store methods**

Add to `PatientStore` (in `patient.store.ts`), importing `toMedicalWrite`, `MedicalBackground` from `./patient.model`:

```ts
  async getById(id: string): Promise<Patient | null> {
    const { data, error } = await this.supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? toPatient(data) : null;
  }

  async saveMedical(id: string, m: MedicalBackground): Promise<void> {
    const { error } = await this.supabase.from('patients').update(toMedicalWrite(m)).eq('id', id);
    if (error) throw error;
  }
```

Update the import line to: `import { Patient, toPatient, MedicalBackground, toMedicalWrite } from './patient.model';`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/features/patients/patient.store.spec.ts`
Expected: PASS (all tests including the 2 new).

- [ ] **Step 5: Fix the patient form for the new required DTO fields**

In `src/app/features/patients/patient-form.component.ts`, the `save()` builds a `CreatePatientDto`. Add the three medical fields so the type compiles. Find where the DTO is assembled (the object passed to `toPatientWrite` / insert) and add:

```ts
      allergies: '',
      conditions: '',
      medications: '',
```

If the edit path loads an existing patient into the form model, preserve existing medical values instead of blanking them: when populating from a loaded `Patient`, carry `allergies`, `conditions`, `medications` through unchanged (the Overview tab is the primary editor for these; the form must not wipe them). If the form does not load medical fields into its model, pass the loaded patient's values straight into the DTO at save time.

- [ ] **Step 6: Update routes**

In `src/app/app.routes.ts`, replace the patients children with:

```ts
    children: [
      { path: '', loadComponent: () => import('./features/patients/patient-list.component').then(m => m.PatientListComponent) },
      { path: 'new', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id/edit', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-detail.component').then(m => m.PatientDetailComponent) },
    ],
```

(Order matters: `:id/edit` before `:id`.)

- [ ] **Step 7: Create the detail component (Overview tab)**

Create `src/app/features/patients/patient-detail.component.ts`:

```ts
import { Component, inject, input, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PatientStore } from './patient.store';
import { Patient } from './patient.model';
import { PatientHistoryComponent } from './patient-history.component';
import { PatientDocumentsComponent } from './patient-documents.component';

@Component({
  selector: 'app-patient-detail',
  imports: [
    RouterLink, FormsModule, MatTabsModule, MatCardModule, MatButtonModule,
    MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule,
    PatientHistoryComponent, PatientDocumentsComponent,
  ],
  template: `
    <header class="head">
      <a mat-icon-button routerLink="/patients" aria-label="Back to patients">
        <mat-icon>arrow_back</mat-icon>
      </a>
      @if (patient(); as p) {
        <h1>{{ p.firstName }} {{ p.lastName }}</h1>
        <span class="spacer"></span>
        <a mat-stroked-button [routerLink]="['/patients', p.id, 'edit']">
          <mat-icon>edit</mat-icon> Edit
        </a>
      }
    </header>

    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }

    @if (patient(); as p) {
      <mat-tab-group>
        <mat-tab label="Overview">
          <div class="tab">
            <mat-card appearance="outlined">
              <mat-card-content class="contact">
                <div><span class="k">Email</span> {{ p.email || '—' }}</div>
                <div><span class="k">Phone</span> {{ p.phone || '—' }}</div>
                <div><span class="k">Birth date</span> {{ p.birthDate || '—' }}</div>
                <div><span class="k">Blood type</span> {{ p.bloodType }}</div>
              </mat-card-content>
            </mat-card>

            <mat-card appearance="outlined">
              <mat-card-content>
                <h2>Medical background</h2>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Allergies</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="allergies"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Conditions</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="conditions"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Medications</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="medications"></textarea>
                </mat-form-field>
                <button mat-flat-button [disabled]="saving()" (click)="saveMedical(p.id)">
                  <mat-icon>save</mat-icon> Save
                </button>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <mat-tab label="History">
          <div class="tab"><app-patient-history [patientId]="p.id" /></div>
        </mat-tab>

        <mat-tab label="Documents">
          <div class="tab"><app-patient-documents [patientId]="p.id" /></div>
        </mat-tab>
      </mat-tab-group>
    } @else if (!loading()) {
      <p class="muted">Patient not found.</p>
    }
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .head h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .tab { padding: 1rem 0; display: flex; flex-direction: column; gap: 1rem; }
    .contact { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .contact .k { display: block; font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
    h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.75rem; }
    .full { width: 100%; }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class PatientDetailComponent {
  private store = inject(PatientStore);
  id = input.required<string>();

  patient = signal<Patient | null>(null);
  loading = signal(true);
  saving = signal(false);

  allergies = '';
  conditions = '';
  medications = '';

  constructor() {
    effect(() => {
      const id = this.id();
      this.loading.set(true);
      this.store.getById(id).then(p => {
        this.patient.set(p);
        this.allergies = p?.allergies ?? '';
        this.conditions = p?.conditions ?? '';
        this.medications = p?.medications ?? '';
        this.loading.set(false);
      });
    });
  }

  async saveMedical(id: string) {
    this.saving.set(true);
    try {
      await this.store.saveMedical(id, {
        allergies: this.allergies, conditions: this.conditions, medications: this.medications,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
```

Note: this imports `PatientHistoryComponent` (Task 11) and `PatientDocumentsComponent` (Task 12). Create placeholder empty components first if implementing strictly in order, OR implement Tasks 11 and 12 before running the build in Step 8. The build verification below assumes 11 and 12 exist.

- [ ] **Step 8: Verify the build after Tasks 11 & 12 exist**

Run: `npx ng build`
Expected: build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/app.routes.ts src/app/features/patients/patient-detail.component.ts src/app/features/patients/patient.store.ts src/app/features/patients/patient.store.spec.ts src/app/features/patients/patient-form.component.ts
git commit -m "feat(patients): patient detail page with overview + medical background"
```

---

### Task 11: History tab component (appointments + clinical notes)

**Files:**
- Create: `src/app/features/patients/patient-history.component.ts`

**Interfaces:**
- Consumes: `SUPABASE`; `ClinicalNotesStore` (Task 4); `AppointmentRowEmbedded` (existing).
- Produces: `PatientHistoryComponent` with input `patientId: string` (required). Renders an appointment timeline (read-only) and a clinical-notes list with add/delete. The note author is the signed-in staff user, resolved from the Supabase session — NOT the patient. Provides `ClinicalNotesStore` at the component level.

- [ ] **Step 1: Create the component**

Create `src/app/features/patients/patient-history.component.ts`:

```ts
import { Component, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatListModule } from '@angular/material/list';
import { SUPABASE } from '../../core/supabase.client';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { ClinicalNotesStore } from './clinical-note.store';
import { toIsoDate } from '../../core/date.util';

interface ApptView {
  id: string;
  date: string;
  time: string;
  doctor: string;
  reason: string;
  status: string;
}

@Component({
  selector: 'app-patient-history',
  providers: [ClinicalNotesStore],
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatDatepickerModule, MatListModule,
  ],
  template: `
    <section>
      <h2>Appointments</h2>
      @if (appointments().length) {
        <mat-list>
          @for (a of appointments(); track a.id) {
            <mat-list-item>
              <span matListItemTitle>{{ a.date }} {{ a.time }} — {{ a.doctor }}</span>
              <span matListItemLine class="muted">{{ a.reason || 'No reason' }} · {{ a.status }}</span>
            </mat-list-item>
          }
        </mat-list>
      } @else {
        <p class="muted">No appointments.</p>
      }
    </section>

    <section>
      <h2>Clinical notes</h2>
      <mat-card appearance="outlined">
        <mat-card-content class="note-form">
          <mat-form-field appearance="outline">
            <mat-label>Visit date</mat-label>
            <input matInput [matDatepicker]="dp" [(ngModel)]="visitDate" />
            <mat-datepicker-toggle matIconSuffix [for]="dp" />
            <mat-datepicker #dp />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Note</mat-label>
            <textarea matInput rows="2" [(ngModel)]="body"></textarea>
          </mat-form-field>
          <button mat-flat-button [disabled]="!body.trim()" (click)="addNote()">
            <mat-icon>add</mat-icon> Add
          </button>
        </mat-card-content>
      </mat-card>

      @for (n of notes.notes(); track n.id) {
        <mat-card appearance="outlined" class="note">
          <mat-card-content>
            <div class="note-head">
              <strong>{{ n.visitDate }}</strong>
              <span class="muted">{{ n.authorEmail }}</span>
              <span class="spacer"></span>
              <button mat-icon-button aria-label="Delete note" (click)="notes.remove(n.id)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
            <p class="body">{{ n.body }}</p>
          </mat-card-content>
        </mat-card>
      }
    </section>
  `,
  styles: `
    section { margin-bottom: 1.5rem; }
    h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.5rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .note-form { display: flex; gap: 0.75rem; align-items: flex-start; flex-wrap: wrap; }
    .note-form .grow { flex: 1 1 16rem; }
    .note { margin-bottom: 0.5rem; }
    .note-head { display: flex; align-items: center; gap: 0.5rem; }
    .note-head .spacer { flex: 1 1 auto; }
    .body { margin: 0.25rem 0 0; white-space: pre-wrap; }
  `,
})
export class PatientHistoryComponent {
  private supabase = inject(SUPABASE);
  notes = inject(ClinicalNotesStore);

  patientId = input.required<string>();

  appointments = signal<ApptView[]>([]);
  visitDate: Date | null = new Date();
  body = '';

  constructor() {
    effect(() => {
      const id = this.patientId();
      this.notes.setPatient(id);
      this.loadAppointments(id);
    });
  }

  private async loadAppointments(patientId: string) {
    const { data } = await this.supabase
      .from('appointments')
      .select('*, doctor:doctors(name)')
      .eq('patient_id', patientId)
      .order('date', { ascending: false });
    const rows = (data as (AppointmentRowEmbedded & { doctor: { name: string } | null })[]) ?? [];
    this.appointments.set(rows.map(r => ({
      id: r.id, date: r.date, time: r.time,
      doctor: r.doctor?.name ?? '—', reason: r.reason ?? '', status: r.status,
    })));
  }

  async addNote() {
    const body = this.body.trim();
    if (!body) return;
    // Author is the signed-in staff user, resolved from the session — not the patient.
    const { data: { user } } = await this.supabase.auth.getUser();
    await this.notes.add({
      patientId: this.patientId(),
      visitDate: this.visitDate ? toIsoDate(this.visitDate) : new Date().toISOString().slice(0, 10),
      body,
      authorEmail: user?.email ?? '',
    });
    this.body = '';
  }
}
```

- [ ] **Step 2: Verify `toIsoDate` exists**

Run: `grep -n "export function toIsoDate" src/app/core/date.util.ts`
Expected: one match. (If the signature differs, adapt the call. If `date.util.ts` lacks it, format inline with `d.toISOString().slice(0,10)`.)

- [ ] **Step 3: Verify the build**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/patients/patient-history.component.ts
git commit -m "feat(patients): history tab — appointment timeline + clinical notes"
```

---

### Task 12: Documents tab component

**Files:**
- Create: `src/app/features/patients/patient-documents.component.ts`

**Interfaces:**
- Consumes: `PatientDocumentsStore` (Task 6), `PatientDocument`.
- Produces: `PatientDocumentsComponent` with input `patientId: string` (required). Upload control (file picker), a grid of documents, image thumbnails via signed URL, PDF open-in-new-tab, delete. Provides `PatientDocumentsStore` at component level.

- [ ] **Step 1: Create the component**

Create `src/app/features/patients/patient-documents.component.ts`:

```ts
import { Component, inject, input, signal, effect } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PatientDocumentsStore } from './patient-document.store';
import { PatientDocument } from './patient-document.model';

@Component({
  selector: 'app-patient-documents',
  providers: [PatientDocumentsStore],
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="bar">
      <button mat-flat-button [disabled]="busy()" (click)="picker.click()">
        <mat-icon>upload_file</mat-icon> Upload
      </button>
      <input #picker type="file" hidden accept="image/jpeg,image/png,application/pdf"
             (change)="onPick($event)" />
      @if (busy()) { <span class="muted">Uploading…</span> }
    </div>

    @if (err()) { <p class="error">{{ err() }}</p> }

    @if (store.documents().length) {
      <div class="grid">
        @for (d of store.documents(); track d.id) {
          <mat-card appearance="outlined" class="doc">
            <button class="open" (click)="open(d)" [attr.aria-label]="'Open ' + d.fileName">
              @if (d.isImage && thumbs()[d.id]) {
                <img [src]="thumbs()[d.id]" [alt]="d.fileName" />
              } @else {
                <mat-icon class="ficon">{{ d.isImage ? 'image' : 'picture_as_pdf' }}</mat-icon>
              }
            </button>
            <div class="meta">
              <span class="name" [title]="d.fileName">{{ d.fileName }}</span>
              <button mat-icon-button aria-label="Delete document" (click)="remove(d)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          </mat-card>
        }
      </div>
    } @else {
      <p class="muted">No documents.</p>
    }
  `,
  styles: `
    .bar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; }
    .doc { padding: 0; overflow: hidden; }
    .open { display: block; width: 100%; height: 7rem; border: 0; padding: 0; cursor: pointer;
            background: var(--mat-sys-surface-container); }
    .open img { width: 100%; height: 100%; object-fit: cover; }
    .ficon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: var(--mat-sys-on-surface-variant);
             display: flex; align-items: center; justify-content: center; margin: auto; }
    .meta { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.25rem 0.25rem 0.5rem; }
    .name { flex: 1 1 auto; font: var(--mat-sys-label-small); overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class PatientDocumentsComponent {
  store = inject(PatientDocumentsStore);
  patientId = input.required<string>();

  busy = signal(false);
  err = signal('');
  thumbs = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      this.store.setPatient(this.patientId());
    });
    // Load thumbnails for image documents whenever the list changes.
    effect(() => {
      const docs = this.store.documents();
      for (const d of docs) {
        if (d.isImage && !this.thumbs()[d.id]) {
          this.store.downloadUrl(d).then(url =>
            this.thumbs.update(t => ({ ...t, [d.id]: url })));
        }
      }
    });
  }

  async onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.err.set('');
    this.busy.set(true);
    try {
      await this.store.upload(file);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      this.busy.set(false);
    }
  }

  async open(d: PatientDocument) {
    try {
      const url = await this.store.downloadUrl(d);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Could not open document.');
    }
  }

  async remove(d: PatientDocument) {
    this.err.set('');
    try {
      await this.store.remove(d);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Delete failed.');
    }
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `npx ng build`
Expected: build succeeds (Task 10 detail component now resolves both child imports).

- [ ] **Step 3: Commit**

```bash
git add src/app/features/patients/patient-documents.component.ts
git commit -m "feat(patients): documents tab — upload, thumbnails, open, delete"
```

---

### Task 13: Full test suite + Playwright render check

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: green test suite, a build, and a confirmed-rendering detail page.

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all specs PASS (patient mapper, clinical note model/store, document model/store, patient store).

- [ ] **Step 2: Production build**

Run: `npx ng build`
Expected: succeeds, no errors.

- [ ] **Step 3: Playwright render check (per project memory — ng test/build miss blank-page bootstrap crashes)**

Start the app: `npx ng serve` (background). Then, using the Playwright MCP browser tools, navigate to `http://localhost:4200/patients`, sign in if required, open a patient, and confirm:
- The detail page renders with three tabs (Overview / History / Documents) — no blank page, no console errors.
- Overview shows contact + medical background fields.
- History and Documents tabs render their empty states.

Expected: page renders, tabs switch, no red console errors. Capture a screenshot for the record.

- [ ] **Step 4: Commit any fixes surfaced by the render check**

If the render check surfaced fixes, commit them:

```bash
git add -A
git commit -m "fix(patients): resolve issues found in detail-page render check"
```

---

## Deployment Notes (outside plan verification)

- Set edge secrets before deploying: `npx supabase secrets set GCS_BUCKET=... GCS_SA_KEY="$(cat sa.json)"`.
- Deploy the function: `npx supabase functions deploy gcs-doc`.
- GCS bucket CORS must allow browser `PUT`/`GET` from the app origin (Content-Type header, methods PUT/GET). Configure with `gsutil cors set cors.json gs://<bucket>` where `cors.json` allows the app origin, methods `["GET","PUT"]`, and headers `["Content-Type"]`.
- Apply the migration to the hosted DB: `npx supabase db push`.
