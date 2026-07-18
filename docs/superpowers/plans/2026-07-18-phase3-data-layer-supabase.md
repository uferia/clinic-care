# Phase 3 — Data Layer Swap (stores → supabase-js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the json-server HTTP data layer (patients, doctors, appointments, dashboard) with `supabase-js` calls against the Phase 1 Postgres schema, so tenant isolation + subscription gating (RLS) apply to all data and json-server is retired.

**Architecture:** Each feature store injects the shared `SUPABASE` client (from Phase 2) and uses Angular's `resource()` with an async loader that runs a PostgREST query (pagination via `.range()`, count via `{count:'exact'}`, search via `.ilike()`/`.or()`, joins via FK embedding). Postgres rows are snake_case; per-entity mapper functions convert rows→camelCase models on read and DTOs→snake_case on write. Writes never send `clinic_id` (a DB trigger sets it) or `id`/`created_at` (DB defaults). RLS scopes every read, so stores never filter by clinic. After all features are migrated, json-server, `HttpClient`, `core/api.ts`, and `db.json` are removed.

**Tech Stack:** Angular 22 (standalone, signals, `resource()`, `@Service()`), `@supabase/supabase-js`, Angular Material, Vitest + jsdom.

## Global Constraints

- All data access goes through the injected `SUPABASE` client (`inject(SUPABASE)`), never `HttpClient`. `core/api.ts` and json-server are removed by the final task.
- Postgres columns are snake_case (`first_name`, `birth_date`, `patient_id`, `created_at`, …); domain models stay camelCase. Convert via per-entity mapper functions — never leak snake_case into components/templates.
- Writes (insert/update) MUST NOT include `clinic_id` (BEFORE-INSERT trigger sets it), `id`, or `created_at` (DB defaults). RLS rejects a write to another clinic.
- Reads MUST NOT filter by `clinic_id` — RLS scopes rows automatically. Adding a manual clinic filter is wrong (and impossible client-side without the id).
- Models gain a read-only `clinicId: string` populated from `clinic_id`.
- Preserve existing behaviors: patients paginate (pageSize 5) + search first/last/phone; doctors paginate (6) + search name/specialty + filter specialty + availableOnly; appointments paginate (8) + sort date,time + filter status + resolve patient/doctor names + per-row status change/delete/busy; dashboard aggregates across all rows.
- Angular 22 `resource({ params, loader })` returns `{ value, isLoading, error, reload }`. Tests run via `npx ng test --include="<spec>" --watch=false` (NOT raw `npx vitest run` — that errors "describe is not defined"). Full suite: `npx ng test --watch=false`. On this Windows machine, run `ng test` from **PowerShell**, not Git Bash.
- Commits carry NO `Co-Authored-By:` / Anthropic / Claude trailer — repo default author only.

---

### Task 1: Row types, mappers, and a fake-Supabase test helper

**Files:**
- Create: `src/app/core/db.types.ts`
- Modify: `src/app/features/patients/patient.model.ts`
- Modify: `src/app/features/doctors/doctor.model.ts`
- Modify: `src/app/features/appointments/appointment.model.ts`
- Create: `src/app/features/patients/patient.mapper.spec.ts`
- Create: `src/testing/fake-supabase.ts`

**Interfaces:**
- Consumes: nothing (pure functions + types).
- Produces:
  - Row types `PatientRow`, `DoctorRow`, `AppointmentRow` (snake_case) in `db.types.ts`.
  - `Patient` + `Doctor` + `Appointment` gain `clinicId: string`.
  - `toPatient(row): Patient`, `toPatientWrite(dto: CreatePatientDto): Record<string,unknown>`
  - `toDoctor(row): Doctor`, `toDoctorWrite(dto: CreateDoctorDto): Record<string,unknown>`
  - `toAppointment(row): Appointment`, `toAppointmentWrite(dto: CreateAppointmentDto): Record<string,unknown>`
  - `fakeSupabaseSelect(rows, count)` + `fakeSupabaseMutation()` test helpers returning a stub with the recorded query.

- [ ] **Step 1: Write the row types**

Create `src/app/core/db.types.ts`:

```ts
// Snake_case row shapes as stored in Postgres. Mappers convert to/from the
// camelCase domain models; these types never reach components or templates.

export interface PatientRow {
  id: string;
  clinic_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  blood_type: string | null;
  created_at: string;
}

export interface DoctorRow {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string | null;
  rating: number | null;
  available: boolean;
}

export interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  time: string;
  reason: string | null;
  status: string;
}

/** Appointment row with its embedded patient/doctor rows (PostgREST FK embed). */
export interface AppointmentRowEmbedded extends AppointmentRow {
  patient: PatientRow | null;
  doctor: DoctorRow | null;
}
```

- [ ] **Step 2: Write the failing patient mapper test**

Create `src/app/features/patients/patient.mapper.spec.ts`:

```ts
import { toPatient, toPatientWrite } from './patient.model';
import { PatientRow } from '../../core/db.types';

const row: PatientRow = {
  id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos',
  email: 'maria@mail.com', phone: '+639171234567', birth_date: '1990-05-14',
  blood_type: 'O+', created_at: '2025-01-10T08:00:00Z',
};

describe('patient mapper', () => {
  it('maps a row to a camelCase Patient', () => {
    expect(toPatient(row)).toEqual({
      id: 'p1', clinicId: 'c1', firstName: 'Maria', lastName: 'Santos',
      email: 'maria@mail.com', phone: '+639171234567', birthDate: '1990-05-14',
      bloodType: 'O+', createdAt: '2025-01-10T08:00:00Z',
    });
  });

  it('coerces null optional columns to empty strings', () => {
    const p = toPatient({ ...row, email: null, phone: null, birth_date: null, blood_type: null });
    expect(p.email).toBe('');
    expect(p.phone).toBe('');
    expect(p.birthDate).toBe('');
    expect(p.bloodType).toBe('O+');
  });

  it('builds a snake_case write payload with no id/clinic_id/created_at', () => {
    const payload = toPatientWrite({
      firstName: 'Jose', lastName: 'Reyes', email: 'j@x.com',
      phone: '+639181234567', birthDate: '1985-11-02', bloodType: 'A-',
    });
    expect(payload).toEqual({
      first_name: 'Jose', last_name: 'Reyes', email: 'j@x.com',
      phone: '+639181234567', birth_date: '1985-11-02', blood_type: 'A-',
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('clinic_id');
    expect(payload).not.toHaveProperty('created_at');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx ng test --include="src/app/features/patients/patient.mapper.spec.ts" --watch=false`
Expected: FAIL — `toPatient`/`toPatientWrite` not exported.

- [ ] **Step 4: Add `clinicId` + mappers to the patient model**

Edit `src/app/features/patients/patient.model.ts` — add `clinicId` to the interface and append the mappers:

```ts
export interface Patient {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO date, `YYYY-MM-DD`. */
  birthDate: string;
  bloodType: BloodType;
  createdAt: string;
}

export type CreatePatientDto = Omit<Patient, 'id' | 'clinicId' | 'createdAt'>;
```

Append to the same file:

```ts
import { PatientRow } from '../../core/db.types';

export function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? '',
    phone: row.phone ?? '',
    birthDate: row.birth_date ?? '',
    bloodType: (row.blood_type ?? 'O+') as BloodType,
    createdAt: row.created_at,
  };
}

export function toPatientWrite(dto: CreatePatientDto): Record<string, unknown> {
  return {
    first_name: dto.firstName,
    last_name: dto.lastName,
    email: dto.email,
    phone: dto.phone,
    birth_date: dto.birthDate,
    blood_type: dto.bloodType,
  };
}
```

- [ ] **Step 5: Run the patient mapper test to verify it passes**

Run: `npx ng test --include="src/app/features/patients/patient.mapper.spec.ts" --watch=false`
Expected: PASS (3 assertions).

- [ ] **Step 6: Add `clinicId` + mappers to the doctor model**

Edit `src/app/features/doctors/doctor.model.ts`:

```ts
export interface Doctor {
  id: string;
  clinicId: string;
  name: string;
  specialty: Specialty;
  rating: number;
  available: boolean;
}

export type CreateDoctorDto = Omit<Doctor, 'id' | 'clinicId'>;
```

Append:

```ts
import { DoctorRow } from '../../core/db.types';

export function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    specialty: (row.specialty ?? 'General Medicine') as Specialty,
    rating: row.rating ?? 0,
    available: row.available,
  };
}

export function toDoctorWrite(dto: CreateDoctorDto): Record<string, unknown> {
  return {
    name: dto.name,
    specialty: dto.specialty,
    rating: dto.rating,
    available: dto.available,
  };
}
```

- [ ] **Step 7: Add `clinicId` + mappers to the appointment model**

Edit `src/app/features/appointments/appointment.model.ts` — add `clinicId` and append mappers:

```ts
export interface Appointment {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24h clock, `HH:mm`. */
  time: string;
  reason: string;
  status: AppointmentStatus;
}

export type CreateAppointmentDto = Omit<Appointment, 'id' | 'clinicId'>;
```

Append:

```ts
import { AppointmentRow } from '../../core/db.types';

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    date: row.date,
    time: row.time,
    reason: row.reason ?? '',
    status: row.status as AppointmentStatus,
  };
}

export function toAppointmentWrite(dto: CreateAppointmentDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    doctor_id: dto.doctorId,
    date: dto.date,
    time: dto.time,
    reason: dto.reason,
    status: dto.status,
  };
}
```

Note: the DB `time` column is `text` (`HH:mm`), matching the model — no time-format conversion needed.

- [ ] **Step 8: Write the fake-Supabase test helper**

Create `src/testing/fake-supabase.ts`. It models the **select** chain the store list-queries use (`from().select(...).or().eq().order().range()` — every method returns the same thenable builder, and awaiting it yields `{data,count,error}`) and records the calls so tests can assert on the table, select string, and filters.

```ts
import { vi } from 'vitest';

export interface RecordedQuery {
  table: string;
  select?: string;
  filters: { method: string; args: unknown[] }[];
}

/** A select builder that resolves to {data,count,error} and records filter calls. */
export function fakeSupabaseSelect(rows: unknown[], count = rows.length, error: unknown = null) {
  const recorded: RecordedQuery = { table: '', filters: [] };
  const result = { data: rows, count, error };

  const builder: any = {
    // thenable so `await query` resolves to the result
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  for (const m of ['or', 'eq', 'ilike', 'order', 'range', 'gte', 'in']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      recorded.filters.push({ method: m, args });
      return builder;
    });
  }

  const client = {
    from: vi.fn((table: string) => {
      recorded.table = table;
      return {
        select: vi.fn((sel: string) => {
          recorded.select = sel;
          return builder;
        }),
      };
    }),
    recorded,
  };
  return client;
}
```

- [ ] **Step 9: Run the full suite (nothing else should break)**

Run: `npx ng test --watch=false`
Expected: PASS. Only the new patient mapper spec was added; models gained fields + functions (existing code still compiles — `CreatePatientDto`/`CreateDoctorDto`/`CreateAppointmentDto` now also omit `clinicId`, which no current caller sets).

- [ ] **Step 10: Commit**

```bash
git add src/app/core/db.types.ts src/app/features/patients/patient.model.ts src/app/features/patients/patient.mapper.spec.ts src/app/features/doctors/doctor.model.ts src/app/features/appointments/appointment.model.ts src/testing/fake-supabase.ts
git commit -m "feat(data): row types, model mappers, and supabase test helper"
```

---

### Task 2: PatientStore → supabase

**Files:**
- Rewrite: `src/app/features/patients/patient.store.ts`
- Create: `src/app/features/patients/patient.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE` token, `toPatient` (Task 1), `toPhoneSearchTerm` (existing `phone.util`).
- Produces: `PatientStore` with unchanged public surface — `page`, `searchInput`, `setSearch(q)`, `setPage(p)`, `pageSize`, `visiblePatients`, `total`, `remove(id)` — now backed by supabase.

- [ ] **Step 1: Write the failing store test**

Create `src/app/features/patients/patient.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { PatientStore } from './patient.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos', email: 'm@x.com', phone: '+639171234567', birth_date: '1990-05-14', blood_type: 'O+', created_at: '2025-01-10T08:00:00Z' },
];

describe('PatientStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(PatientStore);
  }

  it('queries the patients table with pagination and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    // resource loaders are async; allow the microtask queue to flush
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('patients');
    // range(0,4) for page 1, pageSize 5
    expect(client.recorded.filters.find(f => f.method === 'range')?.args).toEqual([0, 4]);
    expect(store.total()).toBe(1);
    expect(store.visiblePatients()[0].firstName).toBe('Maria');
  });

  it('adds an ilike OR filter when searching', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setSearch('mar');
    // debounce is 300ms
    await new Promise(r => setTimeout(r, 350));
    const or = client.recorded.filters.find(f => f.method === 'or');
    expect(String(or?.args[0])).toContain('first_name.ilike.%mar%');
    expect(String(or?.args[0])).toContain('last_name.ilike.%mar%');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/features/patients/patient.store.spec.ts" --watch=false`
Expected: FAIL — the current store injects `HttpClient` and uses `httpResource`, so `from`/`recorded` are never touched.

- [ ] **Step 3: Rewrite the store**

Replace `src/app/features/patients/patient.store.ts`:

```ts
import { computed, inject, resource, Service, signal } from '@angular/core';
import { Patient, toPatient } from './patient.model';
import { toPhoneSearchTerm } from './phone.util';
import { SUPABASE } from '../../core/supabase.client';

/** Escape PostgREST `or()` separators so a typed comma/paren can't break the filter. */
function escapeIlike(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

@Service()
export class PatientStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 5;

  private _page = signal(1);
  private _searchInput = signal('');
  private _search = signal('');

  page = this._page.asReadonly();
  searchInput = this._searchInput.asReadonly();

  private debounceTimer?: ReturnType<typeof setTimeout>;
  setSearch(q: string) {
    this._searchInput.set(q);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._search.set(q);
      this._page.set(1);
    }, 300);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private patientsResource = resource({
    params: () => ({ page: this._page(), search: this._search().trim() }),
    loader: async ({ params }) => {
      let query = this.supabase.from('patients').select('*', { count: 'exact' });

      if (params.search) {
        const q = escapeIlike(params.search);
        const ors = [`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`];
        const phone = toPhoneSearchTerm(params.search);
        if (phone) ors.push(`phone.ilike.%${phone}%`);
        query = query.or(ors.join(','));
      }

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []).map(toPatient), total: count ?? 0 };
    },
  });

  patients = computed<Patient[]>(() => this.patientsResource.value()?.rows ?? []);
  total = computed(() => this.patientsResource.value()?.total ?? 0);

  private _deleted = signal<Set<string>>(new Set());
  visiblePatients = computed(() =>
    this.patients().filter(p => !this._deleted().has(p.id)),
  );

  remove(id: string) {
    this._deleted.update(s => new Set(s).add(id));
    this.supabase
      .from('patients')
      .delete()
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (error) {
          this._deleted.update(s => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        } else {
          this.patientsResource.reload();
        }
      });
  }
}
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx ng test --include="src/app/features/patients/patient.store.spec.ts" --watch=false`
Expected: PASS (2 tests). If the resource loader hasn't run when the first assertion fires, the `await new Promise(r => setTimeout(r))` in the test is what lets it settle — keep it.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/patients/patient.store.ts src/app/features/patients/patient.store.spec.ts
git commit -m "feat(patients): back PatientStore with supabase"
```

---

### Task 3: Patient form → supabase

**Files:**
- Modify: `src/app/features/patients/patient-form.component.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toPatient`, `toPatientWrite` (Task 1).
- Produces: patient create/edit persisted via supabase (no HttpClient).

- [ ] **Step 1: Replace the data calls in the form component**

In `src/app/features/patients/patient-form.component.ts`:

Remove the `HttpClient` import and the `API` import. Add:

```ts
import { SUPABASE } from '../../core/supabase.client';
import { toPatient, toPatientWrite } from './patient.model';
```

Replace `private http = inject(HttpClient);` with:

```ts
private supabase = inject(SUPABASE);
```

Replace the edit-mode `effect` (the `this.http.get<Patient>(...)` block) with:

```ts
effect(() => {
  const id = this.id();
  if (!id) return;
  this.supabase
    .from('patients')
    .select('*')
    .eq('id', id)
    .single()
    .then(({ data, error }: { data: unknown; error: unknown }) => {
      if (error || !data) return;
      const p = toPatient(data as any);
      this.model.set({
        firstName: p.firstName, lastName: p.lastName, email: p.email,
        phone: p.phone, birthDate: fromIsoDate(p.birthDate), bloodType: p.bloodType,
      });
    });
});
```

Replace the `save()` body's request block (`const req$ = ...; req$.subscribe(...)`) with:

```ts
const write = toPatientWrite(dto);
const id = this.id();
const op = id
  ? this.supabase.from('patients').update(write).eq('id', id)
  : this.supabase.from('patients').insert(write);
op.then(({ error }: { error: unknown }) => {
  if (error) {
    this.saving.set(false);
    this.saveError.set("Couldn't save. Please try again.");
  } else {
    this.router.navigate(['/patients']);
  }
});
```

The `dto` construction stays the same (it already builds `CreatePatientDto` with `toE164(model.phone)` and `toIsoDate(model.birthDate)`); `toPatientWrite` converts it to snake_case. `clinic_id` is set by the DB trigger; `created_at` defaults — neither is sent.

- [ ] **Step 2: Verify the suite still compiles + passes**

Run: `npx ng test --watch=false`
Expected: PASS. No new spec here (the form is exercised in the manual E2E of Task 6); the change must not break existing specs or typecheck.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/patients/patient-form.component.ts
git commit -m "feat(patients): persist patient form via supabase"
```

---

### Task 4: DoctorStore + doctor form → supabase

**Files:**
- Rewrite: `src/app/features/doctors/doctor.store.ts`
- Create: `src/app/features/doctors/doctor.store.spec.ts`
- Modify: `src/app/features/doctors/doctor-form.component.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toDoctor`, `toDoctorWrite` (Task 1).
- Produces: `DoctorStore` with unchanged surface (`page`, `searchInput`, `specialty`, `availableOnly`, `setSearch`, `setSpecialty`, `setAvailableOnly`, `setPage`, `pageSize`, `visibleDoctors`, `total`, `remove`) backed by supabase; doctor form persisted via supabase.

- [ ] **Step 1: Write the failing store test**

Create `src/app/features/doctors/doctor.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { DoctorStore } from './doctor.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 'd1', clinic_id: 'c1', name: 'Dr. Ana Cruz', specialty: 'Cardiology', rating: 4.5, available: true },
];

describe('DoctorStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(DoctorStore);
  }

  it('queries doctors with pagination and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('doctors');
    expect(client.recorded.filters.find(f => f.method === 'range')?.args).toEqual([0, 5]);
    expect(store.visibleDoctors()[0].name).toBe('Dr. Ana Cruz');
  });

  it('applies specialty and availableOnly filters', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setSpecialty('Cardiology');
    store.setAvailableOnly(true);
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['specialty', 'Cardiology'] });
    expect(eqs).toContainEqual({ method: 'eq', args: ['available', true] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/features/doctors/doctor.store.spec.ts" --watch=false`
Expected: FAIL — current store uses `httpResource`/`HttpClient`.

- [ ] **Step 3: Rewrite the store**

Replace `src/app/features/doctors/doctor.store.ts`:

```ts
import { computed, inject, resource, Service, signal } from '@angular/core';
import { Doctor, toDoctor } from './doctor.model';
import { SUPABASE } from '../../core/supabase.client';

function escapeIlike(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

@Service()
export class DoctorStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 6;

  private _page = signal(1);
  private _searchInput = signal('');
  private _search = signal('');
  private _specialty = signal<string>('');
  private _availableOnly = signal(false);

  page = this._page.asReadonly();
  searchInput = this._searchInput.asReadonly();
  specialty = this._specialty.asReadonly();
  availableOnly = this._availableOnly.asReadonly();

  private debounceTimer?: ReturnType<typeof setTimeout>;
  setSearch(q: string) {
    this._searchInput.set(q);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._search.set(q);
      this._page.set(1);
    }, 300);
  }

  setSpecialty(s: string) {
    this._specialty.set(s);
    this._page.set(1);
  }

  setAvailableOnly(v: boolean) {
    this._availableOnly.set(v);
    this._page.set(1);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private doctorsResource = resource({
    params: () => ({
      page: this._page(),
      search: this._search().trim(),
      specialty: this._specialty(),
      availableOnly: this._availableOnly(),
    }),
    loader: async ({ params }) => {
      let query = this.supabase.from('doctors').select('*', { count: 'exact' });

      if (params.search) {
        const q = escapeIlike(params.search);
        query = query.or(`name.ilike.%${q}%,specialty.ilike.%${q}%`);
      }
      if (params.specialty) query = query.eq('specialty', params.specialty);
      if (params.availableOnly) query = query.eq('available', true);

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []).map(toDoctor), total: count ?? 0 };
    },
  });

  doctors = computed<Doctor[]>(() => this.doctorsResource.value()?.rows ?? []);
  total = computed(() => this.doctorsResource.value()?.total ?? 0);

  private _deleted = signal<Set<string>>(new Set());
  visibleDoctors = computed(() =>
    this.doctors().filter(d => !this._deleted().has(d.id)),
  );

  remove(id: string) {
    this._deleted.update(s => new Set(s).add(id));
    this.supabase
      .from('doctors')
      .delete()
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        this._deleted.update(s => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        if (!error) this.doctorsResource.reload();
      });
  }
}
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx ng test --include="src/app/features/doctors/doctor.store.spec.ts" --watch=false`
Expected: PASS (2 tests).

- [ ] **Step 5: Port the doctor form**

Open `src/app/features/doctors/doctor-form.component.ts`. It follows the same pattern as the patient form. Apply the equivalent edits:
- Remove the `HttpClient` and `API` imports; add `import { SUPABASE } from '../../core/supabase.client';` and `import { toDoctor, toDoctorWrite } from './doctor.model';`.
- Replace `private http = inject(HttpClient);` with `private supabase = inject(SUPABASE);`.
- Replace the edit-mode load (`this.http.get<Doctor>(\`${API}/doctors/${id}\`).subscribe(...)`) with:

```ts
this.supabase
  .from('doctors')
  .select('*')
  .eq('id', id)
  .single()
  .then(({ data, error }: { data: unknown; error: unknown }) => {
    if (error || !data) return;
    const d = toDoctor(data as any);
    this.model.set({ name: d.name, specialty: d.specialty, rating: d.rating, available: d.available });
  });
```

(Match the exact fields the form's model signal uses — read them from the existing file; the doctor model fields are `name`, `specialty`, `rating`, `available`.)

- Replace the `save()` request block with:

```ts
const write = toDoctorWrite(dto);
const id = this.id();
const op = id
  ? this.supabase.from('doctors').update(write).eq('id', id)
  : this.supabase.from('doctors').insert(write);
op.then(({ error }: { error: unknown }) => {
  if (error) {
    this.saving.set(false);
    this.saveError.set("Couldn't save. Please try again.");
  } else {
    this.router.navigate(['/doctors']);
  }
});
```

Keep the existing `dto: CreateDoctorDto` construction; `toDoctorWrite` converts it.

- [ ] **Step 6: Run the full suite**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/doctors/doctor.store.ts src/app/features/doctors/doctor.store.spec.ts src/app/features/doctors/doctor-form.component.ts
git commit -m "feat(doctors): back DoctorStore and form with supabase"
```

---

### Task 5: AppointmentStore + appointment form → supabase

**Files:**
- Rewrite: `src/app/features/appointments/appointment.store.ts`
- Create: `src/app/features/appointments/appointment.store.spec.ts`
- Modify: `src/app/features/appointments/appointment-form.component.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toPatient`, `toDoctor`, `AppointmentRowEmbedded` (Task 1).
- Produces: `AppointmentStore` with unchanged surface (`page`, `status`, `setStatus`, `setPage`, `pageSize`, `appointments` (`AppointmentView[]`), `total`, `busy`, `setStatusOf`, `remove`) backed by supabase with FK-embedded patient/doctor; appointment form persisted via supabase.

- [ ] **Step 1: Write the failing store test**

Create `src/app/features/appointments/appointment.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { AppointmentStore } from './appointment.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  {
    id: 'a1', clinic_id: 'c1', patient_id: 'p1', doctor_id: 'd1',
    date: '2026-07-20', time: '09:00', reason: 'Checkup', status: 'confirmed',
    patient: { id: 'p1', clinic_id: 'c1', first_name: 'Maria', last_name: 'Santos', email: null, phone: null, birth_date: null, blood_type: null, created_at: '2025-01-10T08:00:00Z' },
    doctor: { id: 'd1', clinic_id: 'c1', name: 'Dr. Ana Cruz', specialty: 'Cardiology', rating: 4.5, available: true },
  },
];

describe('AppointmentStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(AppointmentStore);
  }

  it('embeds patient/doctor and resolves display names', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('appointments');
    expect(client.recorded.select).toContain('patient:patients');
    expect(client.recorded.select).toContain('doctor:doctors');
    const view = store.appointments()[0];
    expect(view.patientName).toBe('Santos, Maria');
    expect(view.doctorName).toBe('Dr. Ana Cruz');
    expect(view.when instanceof Date).toBe(true);
  });

  it('filters by status when set', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setStatus('confirmed');
    await new Promise(r => setTimeout(r));
    expect(client.recorded.filters).toContainEqual({ method: 'eq', args: ['status', 'confirmed'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/features/appointments/appointment.store.spec.ts" --watch=false`
Expected: FAIL — current store uses `httpResource`.

- [ ] **Step 3: Rewrite the store**

Replace `src/app/features/appointments/appointment.store.ts`:

```ts
import { computed, inject, resource, Service, signal } from '@angular/core';
import { AppointmentStatus, AppointmentView } from './appointment.model';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { SUPABASE } from '../../core/supabase.client';

const EMBED = '*, patient:patients(*), doctor:doctors(*)';

function toDate(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Service()
export class AppointmentStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 8;

  private _page = signal(1);
  private _status = signal<string>('');

  page = this._page.asReadonly();
  status = this._status.asReadonly();

  setStatus(s: string) {
    this._status.set(s);
    this._page.set(1);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private appointmentsResource = resource({
    params: () => ({ page: this._page(), status: this._status() }),
    loader: async ({ params }) => {
      let query = this.supabase
        .from('appointments')
        .select(EMBED, { count: 'exact' })
        .order('date')
        .order('time');

      if (params.status) query = query.eq('status', params.status);

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as AppointmentRowEmbedded[], total: count ?? 0 };
    },
  });

  private rows = computed(() => this.appointmentsResource.value()?.rows ?? []);
  total = computed(() => this.appointmentsResource.value()?.total ?? 0);

  appointments = computed<AppointmentView[]>(() =>
    this.rows().map(a => ({
      id: a.id,
      clinicId: a.clinic_id,
      patientId: a.patient_id,
      doctorId: a.doctor_id,
      date: a.date,
      time: a.time,
      reason: a.reason ?? '',
      status: a.status as AppointmentStatus,
      patientName: a.patient
        ? `${a.patient.last_name}, ${a.patient.first_name}`
        : '— removed —',
      doctorName: a.doctor?.name ?? '— removed —',
      when: toDate(a.date, a.time),
    })),
  );

  private _busy = signal<Set<string>>(new Set());
  busy = this._busy.asReadonly();

  private markBusy(id: string, on: boolean) {
    this._busy.update(s => {
      const next = new Set(s);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  setStatusOf(id: string, status: AppointmentStatus) {
    this.markBusy(id, true);
    this.supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (!error) this.appointmentsResource.reload();
        this.markBusy(id, false);
      });
  }

  remove(id: string) {
    this.markBusy(id, true);
    this.supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (!error) this.appointmentsResource.reload();
        this.markBusy(id, false);
      });
  }
}
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx ng test --include="src/app/features/appointments/appointment.store.spec.ts" --watch=false`
Expected: PASS (2 tests).

- [ ] **Step 5: Port the appointment form**

`src/app/features/appointments/appointment-form.component.ts` loads two reference lists (patients + doctors for the dropdowns, currently via `httpResource` exposed as the `patients`/`doctors` computeds) and does get/create/update. Note the dropdown lists are computeds over resources — NOT writable signals — so they must stay resource-backed, not `.set()`.

Edit the imports:
- Change the `@angular/core` import to include `resource`: `import { Component, signal, computed, effect, inject, input, resource } from '@angular/core';`
- Remove `import { HttpClient, httpResource } from '@angular/common/http';` and `import { API } from '../../core/api';`.
- Add: `import { SUPABASE } from '../../core/supabase.client';`, `import { toPatient } from '../patients/patient.model';`, `import { toDoctor } from '../doctors/doctor.model';`, and add `toAppointment, toAppointmentWrite` to the existing appointment.model import.

Replace `private http = inject(HttpClient);` with `private supabase = inject(SUPABASE);`.

Replace the two `httpResource` reference sources + their `patients`/`doctors` computeds (the block from `private patientsResource = httpResource...` through the end of the `doctors = computed(...)` block) with:

```ts
  private patientsResource = resource({
    loader: async () => {
      const { data } = await this.supabase.from('patients').select('*').order('last_name');
      return ((data as any[]) ?? []).map(toPatient);
    },
  });
  private doctorsResource = resource({
    loader: async () => {
      const { data } = await this.supabase.from('doctors').select('*').order('name');
      return ((data as any[]) ?? []).map(toDoctor);
    },
  });

  patients = computed(() => this.patientsResource.value() ?? []);
  doctors = computed(() => this.doctorsResource.value() ?? []);
```

Replace the edit-mode `effect` (the `this.http.get<Appointment>(...).subscribe(...)` block) with:

```ts
effect(() => {
  const id = this.id();
  if (!id) return;
  this.supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .single()
    .then(({ data, error }: { data: unknown; error: unknown }) => {
      if (error || !data) return;
      const a = toAppointment(data as any);
      this.model.set({
        patientId: a.patientId,
        doctorId: a.doctorId,
        date: fromIsoDate(a.date),
        time: fromHm(a.time),
        reason: a.reason,
        status: a.status,
      });
    });
});
```

Replace the `save()` request block (`const req$ = ...; req$.subscribe(...)`) with:

```ts
const write = toAppointmentWrite(dto);
const id = this.id();
const op = id
  ? this.supabase.from('appointments').update(write).eq('id', id)
  : this.supabase.from('appointments').insert(write);
op.then(({ error }: { error: unknown }) => {
  if (error) {
    this.saving.set(false);
    this.saveError.set("Couldn't save. Please try again.");
  } else {
    this.router.navigate(['/appointments']);
  }
});
```

The existing `dto: CreateAppointmentDto` construction (`{ ...model, date: toIsoDate(...), time: toHm(...) }`) stays as-is; `model` is `BookingFormModel` (no `id`/`clinicId`), so `dto` is a clean `CreateAppointmentDto` and `toAppointmentWrite` converts it to snake_case.

- [ ] **Step 6: Run the full suite**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/appointments/appointment.store.ts src/app/features/appointments/appointment.store.spec.ts src/app/features/appointments/appointment-form.component.ts
git commit -m "feat(appointments): back AppointmentStore and form with supabase"
```

---

### Task 6: DashboardStore → supabase + retire json-server

**Files:**
- Rewrite: `src/app/features/dashboard/dashboard.store.ts`
- Create: `src/app/features/dashboard/dashboard.store.spec.ts`
- Modify: `src/app/app.config.ts` (remove `provideHttpClient`)
- Delete: `src/app/core/api.ts`
- Delete: `db.json`
- Modify: `package.json` (remove the `api` script + `json-server` devDependency)
- Modify: `README.md` (drop the `npm run api` instructions)

**Interfaces:**
- Consumes: `SUPABASE`, `toPatient`, `toDoctor` (Task 1), `AppointmentRowEmbedded`.
- Produces: `DashboardStore` with unchanged surface (`isLoading`, `error`, `reload`, `patients`, `doctors`, `appointments`, `patientCount`, `doctorCount`, `doctorsAvailable`, `upcoming`, `upcomingCount`, `cancelledCount`, `byStatus`, `byDay`, `todayCount`, `nextUp`) backed by supabase; json-server fully removed.

- [ ] **Step 1: Write the failing store test**

Create `src/app/features/dashboard/dashboard.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { DashboardStore } from './dashboard.store';
import { SUPABASE } from '../../core/supabase.client';
import { vi } from 'vitest';

function client() {
  const patients = [{ id: 'p1', clinic_id: 'c1', first_name: 'A', last_name: 'B', email: null, phone: null, birth_date: null, blood_type: null, created_at: '2025-01-01T00:00:00Z' }];
  const doctors = [{ id: 'd1', clinic_id: 'c1', name: 'Dr X', specialty: 'Cardiology', rating: 4, available: true }];
  const appts = [{ id: 'a1', clinic_id: 'c1', patient_id: 'p1', doctor_id: 'd1', date: '2999-01-01', time: '09:00', reason: '', status: 'confirmed', patient: patients[0], doctor: doctors[0] }];
  const table = (rows: unknown[]) => ({ select: vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) })) });
  return {
    from: vi.fn((t: string) => t === 'patients' ? table(patients) : t === 'doctors' ? table(doctors) : table(appts)),
  };
}

describe('DashboardStore', () => {
  it('aggregates counts from supabase rows', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client() }] });
    const store = TestBed.inject(DashboardStore);
    await new Promise(r => setTimeout(r));
    expect(store.patientCount()).toBe(1);
    expect(store.doctorCount()).toBe(1);
    expect(store.doctorsAvailable()).toBe(1);
    expect(store.upcomingCount()).toBe(1);
    expect(store.nextUp()?.doctorName).toBe('Dr X');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --include="src/app/features/dashboard/dashboard.store.spec.ts" --watch=false`
Expected: FAIL — current store uses `httpResource`.

- [ ] **Step 3: Rewrite the store**

Replace the resource/data parts of `src/app/features/dashboard/dashboard.store.ts`. Keep every aggregate computed (`byStatus`, `byDay`, `upcoming`, etc.) UNCHANGED — only the three data sources and the row-shape they emit change. Replace the top of the file (imports + the three `httpResource` fields + `patients`/`doctors`/`appointments` computeds) with:

```ts
import { computed, inject, resource, Service } from '@angular/core';
import { AppointmentStatus } from '../appointments/appointment.model';
import { Patient, toPatient } from '../patients/patient.model';
import { Doctor, toDoctor } from '../doctors/doctor.model';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { SUPABASE } from '../../core/supabase.client';

export interface StatusDatum { status: AppointmentStatus; count: number; }
export interface DayDatum { date: string; count: number; }
export interface UpcomingRow {
  id: string; when: Date; patientName: string; doctorName: string; status: AppointmentStatus;
}

/** Local `YYYY-MM-DD`. Avoids toISOString(), which shifts across the date line. */
function toIsoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

@Service()
export class DashboardStore {
  private supabase = inject(SUPABASE);

  private patientsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase.from('patients').select('*');
      if (error) throw error;
      return (data ?? []).map(toPatient);
    },
  });
  private doctorsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase.from('doctors').select('*');
      if (error) throw error;
      return (data ?? []).map(toDoctor);
    },
  });
  private appointmentsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase
        .from('appointments')
        .select('*, patient:patients(*), doctor:doctors(*)');
      if (error) throw error;
      return (data ?? []) as AppointmentRowEmbedded[];
    },
  });

  isLoading = computed(() =>
    this.patientsResource.isLoading() ||
    this.doctorsResource.isLoading() ||
    this.appointmentsResource.isLoading(),
  );

  error = computed(() =>
    this.patientsResource.error() ??
    this.doctorsResource.error() ??
    this.appointmentsResource.error(),
  );

  reload() {
    this.patientsResource.reload();
    this.doctorsResource.reload();
    this.appointmentsResource.reload();
  }

  patients = computed<Patient[]>(() => this.patientsResource.value() ?? []);
  doctors = computed<Doctor[]>(() => this.doctorsResource.value() ?? []);
  private apptRows = computed<AppointmentRowEmbedded[]>(() => this.appointmentsResource.value() ?? []);
```

Then update the aggregate computeds that previously read `this.appointments()` (the embedded rows) to read `this.apptRows()` and the snake_case embed fields. Replace the `appointments`/`upcoming`/`byStatus`/`byDay`/`todayCount` section with:

```ts
  patientCount = computed(() => this.patients().length);
  doctorCount = computed(() => this.doctors().length);
  doctorsAvailable = computed(() => this.doctors().filter(d => d.available).length);

  private now = new Date();

  upcoming = computed<UpcomingRow[]>(() =>
    this.apptRows()
      .map(a => ({
        id: a.id,
        when: new Date(`${a.date}T${a.time}`),
        patientName: a.patient
          ? `${a.patient.last_name}, ${a.patient.first_name}`
          : '— removed —',
        doctorName: a.doctor?.name ?? '— removed —',
        status: a.status as AppointmentStatus,
      }))
      .filter(r =>
        !Number.isNaN(r.when.getTime()) &&
        r.when.getTime() >= this.now.getTime() &&
        r.status !== 'cancelled',
      )
      .sort((a, b) => a.when.getTime() - b.when.getTime()),
  );

  upcomingCount = computed(() => this.upcoming().length);

  cancelledCount = computed(() =>
    this.apptRows().filter(a => a.status === 'cancelled').length,
  );

  byStatus = computed<StatusDatum[]>(() => {
    const rows = this.apptRows();
    const order: AppointmentStatus[] = ['confirmed', 'pending', 'completed', 'cancelled'];
    return order.map(status => ({
      status,
      count: rows.filter(a => a.status === status).length,
    }));
  });

  byDay = computed<DayDatum[]>(() => {
    const counts = new Map<string, number>();
    for (const a of this.apptRows()) {
      if (a.status === 'cancelled' || !a.date) continue;
      counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
    }
    if (!counts.size) return [];
    const days = [...counts.keys()].sort();
    const out: DayDatum[] = [];
    const cursor = new Date(`${days[0]}T00:00:00`);
    const last = new Date(`${days[days.length - 1]}T00:00:00`);
    while (cursor <= last) {
      const iso = toIsoDate(cursor);
      out.push({ date: iso, count: counts.get(iso) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  });

  todayCount = computed(() => {
    const today = toIsoDate(new Date());
    return this.apptRows().filter(a => a.date === today).length;
  });

  nextUp = computed<UpcomingRow | null>(() => this.upcoming()[0] ?? null);
}
```

Confirm the dashboard COMPONENT (`dashboard.component.ts`) still consumes only these public members — it does not reference the removed `appointments()` computed directly for row shapes (it uses `upcoming`, `byStatus`, `byDay`, counts). If it references `store.appointments()`, keep a compatibility computed `appointments = computed(() => this.apptRows())`; otherwise drop it.

- [ ] **Step 4: Run the dashboard store test to verify it passes**

Run: `npx ng test --include="src/app/features/dashboard/dashboard.store.spec.ts" --watch=false`
Expected: PASS.

- [ ] **Step 5: Remove `provideHttpClient` and delete `core/api.ts`**

In `src/app/app.config.ts`, remove the `provideHttpClient` import and its provider line (nothing uses `HttpClient` anymore). Then:

```bash
git rm src/app/core/api.ts
```

Grep to confirm no remaining references:

Run: `grep -rn "core/api\|HttpClient\|httpResource\|json-server\|localhost:3000" src/`
Expected: no matches (the data layer is fully on supabase).

- [ ] **Step 6: Remove json-server**

- Delete `db.json`: `git rm db.json`
- In `package.json`, remove the `"api": "json-server db.json --port 3000"` script and the `json-server` devDependency, then run `npm install` to update the lockfile.
- In `README.md`, remove the `npm run api` line from the Google sign-in / dev instructions.

- [ ] **Step 7: Run the full suite**

Run: `npx ng test --watch=false`
Expected: PASS — all store specs (patients, doctors, appointments, dashboard), mapper spec, auth specs, and app spec green. No json-server, no HttpClient.

- [ ] **Step 8: Manual end-to-end verification**

Start only the app (`npm start`) — json-server is gone. With local Supabase running and signed in via Google (Phase 2):
- Patients list loads from Supabase, paginates, and search filters by name/phone.
- Create a patient → it appears; edit it → changes persist; delete it → it disappears. Verify the new row in Supabase Studio has your `clinic_id` set (the trigger).
- Doctors list + specialty/available filters work; create/edit/delete persist.
- Appointments list shows patient + doctor names, sorts by date/time, status filter works; change a status + delete work; create/edit persist.
- Dashboard tiles + charts populate from Supabase.

Record pass/fail per screen in the task report.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(dashboard): back DashboardStore with supabase and retire json-server"
```

---

## Phase 3 Done — Definition of Done

- `npx ng test --watch=false` passes: mapper + four store specs + auth + app specs.
- No source references to `HttpClient`, `httpResource`, `core/api.ts`, `db.json`, `json-server`, or `localhost:3000`.
- Manual E2E: every feature reads/writes through Supabase under RLS; created rows carry the caller's `clinic_id` (trigger).
- json-server, `db.json`, the `api` script, and the `json-server` devDependency are removed.

## Notes for Later Phases (do NOT build here)

- The No-access / Subscription-blocked screens and the access guard (membership + `current_clinic_active()` routing) are Phase 4. This phase leaves the auth guard as a bare session check; an expired clinic currently gets empty lists (RLS returns zero rows) rather than a friendly blocked screen — Phase 4 adds that UX.
- The super-admin area + Edge Functions (create clinic, bulk-add members, activate/renew) are Phase 5.
- A production `environment.ts` (hosted project URL + anon key) is deferred to deployment.
