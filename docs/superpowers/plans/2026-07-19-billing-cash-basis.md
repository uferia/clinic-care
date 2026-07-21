# Cash-Basis Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cash-basis billing feature — service catalog, invoices with line items/discount/tax, cash payments and refunds, derived totals, and operational reports — to the multi-tenant clinic app.

**Architecture:** New `0007_billing.sql` migration adds five tables (`billing_settings`, `services`, `invoices`, `invoice_items`, `payments`), a per-clinic invoice-number counter, and a `security_invoker` view `invoice_balances` that derives subtotal/discount/tax/total/paid/balance/status. Items + payments are the only source of truth; nothing denormalized. Frontend adds a `src/app/features/billing/` feature folder following the existing model + store + component + snake→camel mapper pattern (signals + Angular `resource()` + Material).

**Tech Stack:** Angular 22 (standalone components, signals, `@Service()`, `resource()`), Angular Material, Supabase (Postgres + PostgREST + RLS), vitest, Playwright.

## Global Constraints

- Every domain table carries `clinic_id uuid not null references clinics on delete cascade`; a before-insert trigger forces it to `current_clinic_id()`. Never trust a client-supplied `clinic_id`.
- RLS on every table: `for all to authenticated using (clinic_id = public.current_clinic_id() and public.current_clinic_active()) with check (...)`, mirroring `0003_rls_policies.sql` / `0006_patient_docs_history.sql`.
- Row types live in `src/app/core/db.types.ts` (snake_case), never reach components; feature models expose camelCase + mappers.
- Stores are `@Service()` (imported from `@angular/core`), inject `SUPABASE`, use `resource()` for reads, expose `isLoading`/`error` signals and a `reload()`.
- Money columns are `numeric(12,2)`; percentages `numeric(5,2)`. PostgREST may serialize numeric as string — mappers coerce with `Number(...)`.
- Commits: author as the user only. Do NOT add a `Co-Authored-By: Claude` trailer (per project convention). Conventional Commit prefixes (`feat`/`test`/`chore`).
- Rounding rule (must match between SQL view and the TS preview helper): `round(x, 2)` half-up per component: discount% and tax each rounded to 2dp independently, then `total = subtotal - discount + tax`.

---

### Task 1: Billing database migration

**Files:**
- Create: `supabase/migrations/0007_billing.sql`

**Interfaces:**
- Produces (relied on by every later task): tables `services`, `invoices`, `invoice_items`, `payments`, `billing_settings`, `billing_counters`; view `invoice_balances` with columns `id, clinic_id, patient_id, appointment_id, number, issue_date, voided, discount_type, discount_value, tax_rate, notes, created_at, subtotal, discount, tax, total, paid, balance, status`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_billing.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Cash-basis billing: catalog, invoices, line items, payments, settings.
-- Totals + status are DERIVED (view invoice_balances); nothing denormalized.
-- ---------------------------------------------------------------------------

-- Per-clinic billing configuration (currency + single tax rate).
create table public.billing_settings (
  clinic_id  uuid primary key references public.clinics (id) on delete cascade,
  currency   text not null default 'PHP',
  tax_rate   numeric(5,2) not null default 0,        -- percent, e.g. 12.00
  tax_label  text not null default 'Tax',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- Service catalog / price list.
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  name        text not null,
  description text,
  price       numeric(12,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index services_clinic_id_idx on public.services (clinic_id);

-- Per-clinic invoice number sequence.
create table public.billing_counters (
  clinic_id       uuid primary key references public.clinics (id) on delete cascade,
  next_invoice_no integer not null default 1
);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics (id) on delete cascade,
  patient_id     uuid not null references public.patients (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete set null,
  number         text,                                  -- assigned by trigger
  issue_date     date not null default current_date,
  discount_type  text check (discount_type in ('amount', 'percent')),
  discount_value numeric(12,2) not null default 0,
  tax_rate       numeric(5,2) not null default 0,       -- snapshot at creation
  notes          text,
  voided         boolean not null default false,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index invoices_clinic_id_idx  on public.invoices (clinic_id);
create index invoices_patient_id_idx on public.invoices (patient_id);

create table public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  service_id  uuid references public.services (id) on delete set null,
  description text not null,
  unit_price  numeric(12,2) not null,
  quantity    numeric(12,2) not null default 1
);
create index invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind       text not null default 'payment' check (kind in ('payment', 'refund')),
  amount     numeric(12,2) not null check (amount > 0),
  paid_at    timestamptz not null default now(),        -- cash-basis date
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_invoice_id_idx     on public.payments (invoice_id);
create index payments_clinic_paid_at_idx on public.payments (clinic_id, paid_at);

-- clinic_id auto-set (reuse shared trigger fn) for the simple tables.
create trigger set_clinic_id_billing_settings
  before insert on public.billing_settings
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_services
  before insert on public.services
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_invoice_items
  before insert on public.invoice_items
  for each row execute function public.set_clinic_id();

create trigger set_clinic_id_payments
  before insert on public.payments
  for each row execute function public.set_clinic_id();

-- Invoices need clinic_id AND a per-clinic number in one shot; dedicated trigger.
create or replace function public.invoices_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  new.clinic_id := public.current_clinic_id();
  if new.clinic_id is null then
    raise exception 'no clinic for current user';
  end if;

  insert into public.billing_counters (clinic_id, next_invoice_no)
       values (new.clinic_id, 2)
  on conflict (clinic_id)
       do update set next_invoice_no = public.billing_counters.next_invoice_no + 1
    returning next_invoice_no - 1 into n;

  new.number := 'INV-' || lpad(n::text, 6, '0');
  return new;
end;
$$;

create trigger invoices_before_insert_trg
  before insert on public.invoices
  for each row execute function public.invoices_before_insert();

-- Derived balances/status. security_invoker => base-table RLS applies.
create view public.invoice_balances with (security_invoker = true) as
with item_tot as (
  select invoice_id, sum(unit_price * quantity) as subtotal
  from public.invoice_items group by invoice_id
),
pay_tot as (
  select invoice_id,
         sum(case when kind = 'payment' then amount else -amount end) as net_paid
  from public.payments group by invoice_id
),
base as (
  select i.*,
         coalesce(it.subtotal, 0) as subtotal,
         coalesce(p.net_paid, 0)  as paid
  from public.invoices i
  left join item_tot it on it.invoice_id = i.id
  left join pay_tot  p  on p.invoice_id  = i.id
),
disc as (
  select b.*,
         case b.discount_type
           when 'amount'  then least(b.discount_value, b.subtotal)
           when 'percent' then round(b.subtotal * b.discount_value / 100, 2)
           else 0
         end as discount
  from base b
),
taxed as (
  select d.*,
         round((d.subtotal - d.discount) * d.tax_rate / 100, 2) as tax
  from disc d
)
select
  t.id, t.clinic_id, t.patient_id, t.appointment_id, t.number,
  t.issue_date, t.voided, t.discount_type, t.discount_value, t.tax_rate,
  t.notes, t.created_at,
  t.subtotal, t.discount, t.tax,
  (t.subtotal - t.discount + t.tax)          as total,
  t.paid,
  (t.subtotal - t.discount + t.tax) - t.paid as balance,
  case
    when t.voided                                          then 'void'
    when t.paid <= 0                                       then 'unpaid'
    when t.paid >= (t.subtotal - t.discount + t.tax)       then 'paid'
    else 'partial'
  end as status
from taxed t;

-- RLS.
alter table public.billing_settings enable row level security;
alter table public.services         enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_items    enable row level security;
alter table public.payments         enable row level security;
alter table public.billing_counters enable row level security;   -- no policy: trigger-only

create policy billing_settings_tenant on public.billing_settings
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy services_tenant on public.services
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy invoices_tenant on public.invoices
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy invoice_items_tenant on public.invoice_items
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

create policy payments_tenant on public.payments
  for all to authenticated
  using (clinic_id = public.current_clinic_id() and public.current_clinic_active())
  with check (clinic_id = public.current_clinic_id() and public.current_clinic_active());

-- Grants (RLS still restricts rows).
grant select, insert, update, delete on public.billing_settings to authenticated;
grant select, insert, update, delete on public.services         to authenticated;
grant select, insert, update, delete on public.invoices         to authenticated;
grant select, insert, update, delete on public.invoice_items    to authenticated;
grant select, insert, update, delete on public.payments         to authenticated;
grant select on public.invoice_balances to authenticated;
```

- [ ] **Step 2: Apply the migration and verify it loads**

Run: `npx supabase db reset`
Expected: reset completes without error; the log lists `0007_billing.sql` applied. (If local Supabase is not running, `npx supabase start` first.)

- [ ] **Step 3: Smoke-test that the view exists**

Get the local DB URL: `npx supabase status` (look for `DB URL`, typically `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from public.invoice_balances;"
```
Expected: `0` — the view exists and is queryable (empty, since no invoices seeded). If `psql` is unavailable on PATH, run the same query through Supabase Studio's SQL editor at the Studio URL from `npx supabase status`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0007_billing.sql
git commit -m "feat(billing): schema — catalog, invoices, items, payments, balances view"
```

---

### Task 2: Row types + service model + mapper

**Files:**
- Modify: `src/app/core/db.types.ts`
- Create: `src/app/features/billing/billing.model.ts`
- Test: `src/app/features/billing/billing.model.spec.ts`

**Interfaces:**
- Produces: row interfaces `ServiceRow, InvoiceRow, InvoiceItemRow, PaymentRow, InvoiceBalanceRow, BillingSettingsRow`; domain `Service`, `CreateServiceDto`; `toService(row)`, `toServiceWrite(dto)`.

- [ ] **Step 1: Add row types to `db.types.ts`**

Append to `src/app/core/db.types.ts`:

```typescript
export interface ServiceRow {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  price: number | string;
  active: boolean;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  number: string | null;
  issue_date: string;
  discount_type: 'amount' | 'percent' | null;
  discount_value: number | string;
  tax_rate: number | string;
  notes: string | null;
  voided: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceItemRow {
  id: string;
  clinic_id: string;
  invoice_id: string;
  service_id: string | null;
  description: string;
  unit_price: number | string;
  quantity: number | string;
}

export interface PaymentRow {
  id: string;
  clinic_id: string;
  invoice_id: string;
  kind: 'payment' | 'refund';
  amount: number | string;
  paid_at: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceBalanceRow extends InvoiceRow {
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  paid: number | string;
  balance: number | string;
  status: 'unpaid' | 'partial' | 'paid' | 'void';
}

export interface BillingSettingsRow {
  clinic_id: string;
  currency: string;
  tax_rate: number | string;
  tax_label: string;
  updated_at: string;
  updated_by: string | null;
}
```

Note: `InvoiceBalanceRow extends InvoiceRow` but the view omits `created_by`; that is fine (the mapper never reads `created_by` off a balance row).

- [ ] **Step 2: Write the failing test**

Create `src/app/features/billing/billing.model.spec.ts`:


```typescript
import { describe, it, expect } from 'vitest';
import { toService, toServiceWrite } from './billing.model';
import { ServiceRow } from '../../core/db.types';

const row: ServiceRow = {
  id: 's1', clinic_id: 'c1', name: 'Consultation',
  description: 'General visit', price: '500.00', active: true,
  created_at: '2026-07-19T09:00:00Z',
};

describe('service mapping', () => {
  it('maps a row to a domain service (coercing numeric price)', () => {
    expect(toService(row)).toEqual({
      id: 's1', clinicId: 'c1', name: 'Consultation',
      description: 'General visit', price: 500, active: true,
      createdAt: '2026-07-19T09:00:00Z',
    });
  });

  it('toServiceWrite maps to snake_case insert shape', () => {
    expect(
      toServiceWrite({ name: 'X-Ray', description: '', price: 1200, active: true }),
    ).toEqual({ name: 'X-Ray', description: '', price: 1200, active: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/billing.model.spec.ts`
Expected: FAIL — cannot find module `./billing.model`.

- [ ] **Step 4: Write the model**

Create `src/app/features/billing/billing.model.ts`:

```typescript
import {
  ServiceRow,
  InvoiceRow,
  InvoiceItemRow,
  PaymentRow,
  InvoiceBalanceRow,
  BillingSettingsRow,
} from '../../core/db.types';

// ---- Enums -----------------------------------------------------------------

export const DISCOUNT_TYPES = ['amount', 'percent'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ---- Service (catalog) -----------------------------------------------------

export interface Service {
  id: string;
  clinicId: string;
  name: string;
  description: string;
  price: number;
  active: boolean;
  createdAt: string;
}

export type CreateServiceDto = Omit<Service, 'id' | 'clinicId' | 'createdAt'>;

export function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    active: row.active,
    createdAt: row.created_at,
  };
}

export function toServiceWrite(dto: CreateServiceDto): Record<string, unknown> {
  return {
    name: dto.name,
    description: dto.description,
    price: dto.price,
    active: dto.active,
  };
}

// ---- Invoice / items / payments / settings mappers are added in Task 3 -----
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/billing.model.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/core/db.types.ts src/app/features/billing/billing.model.ts src/app/features/billing/billing.model.spec.ts
git commit -m "feat(billing): row types + service model/mapper"
```

---

### Task 3: Invoice / item / payment / settings models + totals helper

**Files:**
- Modify: `src/app/features/billing/billing.model.ts`
- Modify: `src/app/features/billing/billing.model.spec.ts`

**Interfaces:**
- Produces:
  - `Invoice { id, clinicId, patientId, appointmentId: string|null, number, issueDate, discountType: DiscountType|null, discountValue, taxRate, notes, voided, createdAt }`
  - `InvoiceItem { id, invoiceId, serviceId: string|null, description, unitPrice, quantity }`
  - `Payment { id, invoiceId, kind: PaymentKind, amount, paidAt, note }`
  - `InvoiceBalance` = `Invoice & { subtotal, discount, tax, total, paid, balance, status: InvoiceStatus }`
  - `BillingSettings { clinicId, currency, taxRate, taxLabel }`
  - DTOs: `CreateInvoiceDto`, `CreateInvoiceItemDto`, `CreatePaymentDto`
  - mappers: `toInvoice`, `toInvoiceItem`, `toPayment`, `toInvoiceBalance`, `toBillingSettings`, `toInvoiceWrite`, `toItemWrite`, `toPaymentWrite`, `toSettingsWrite`
  - `computeTotals(items, discountType, discountValue, taxRate) => { subtotal, discount, tax, total }` — MUST match the SQL view.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/features/billing/billing.model.spec.ts`:

```typescript
import { computeTotals, toInvoiceBalance, toPayment } from './billing.model';
import { InvoiceBalanceRow, PaymentRow } from '../../core/db.types';

describe('computeTotals', () => {
  const items = [
    { description: 'Consult', unitPrice: 500, quantity: 1 },
    { description: 'Lab', unitPrice: 250, quantity: 2 },
  ];

  it('no discount, 12% tax', () => {
    expect(computeTotals(items, null, 0, 12)).toEqual({
      subtotal: 1000, discount: 0, tax: 120, total: 1120,
    });
  });

  it('percent discount applied before tax, each rounded to 2dp', () => {
    expect(computeTotals(items, 'percent', 10, 12)).toEqual({
      subtotal: 1000, discount: 100, tax: 108, total: 1008,
    });
  });

  it('amount discount is capped at subtotal', () => {
    expect(computeTotals(items, 'amount', 5000, 0)).toEqual({
      subtotal: 1000, discount: 1000, tax: 0, total: 0,
    });
  });
});

describe('balance + payment mapping', () => {
  it('maps a balance row and coerces numerics', () => {
    const row = {
      id: 'i1', clinic_id: 'c1', patient_id: 'p1', appointment_id: null,
      number: 'INV-000001', issue_date: '2026-07-19', discount_type: null,
      discount_value: '0', tax_rate: '12.00', notes: null, voided: false,
      created_by: null, created_at: '2026-07-19T00:00:00Z',
      subtotal: '1000', discount: '0', tax: '120', total: '1120',
      paid: '120', balance: '1000', status: 'partial',
    } as InvoiceBalanceRow;
    const b = toInvoiceBalance(row);
    expect(b.total).toBe(1120);
    expect(b.paid).toBe(120);
    expect(b.balance).toBe(1000);
    expect(b.status).toBe('partial');
  });

  it('maps a payment row', () => {
    const row: PaymentRow = {
      id: 'pay1', clinic_id: 'c1', invoice_id: 'i1', kind: 'refund',
      amount: '50.00', paid_at: '2026-07-19T10:00:00Z', note: null,
      created_by: null, created_at: '2026-07-19T10:00:00Z',
    };
    expect(toPayment(row)).toEqual({
      id: 'pay1', invoiceId: 'i1', kind: 'refund', amount: 50,
      paidAt: '2026-07-19T10:00:00Z', note: '',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/billing.model.spec.ts`
Expected: FAIL — `computeTotals` / `toInvoiceBalance` / `toPayment` not exported.

- [ ] **Step 3: Append the models + helper**

Append to `src/app/features/billing/billing.model.ts`:

```typescript
// ---- Money helpers ---------------------------------------------------------

/** Round half-up to 2 decimals (matches Postgres `round(x, 2)`). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---- Invoice ---------------------------------------------------------------

export interface Invoice {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  number: string;
  /** ISO date, `YYYY-MM-DD`. */
  issueDate: string;
  discountType: DiscountType | null;
  discountValue: number;
  taxRate: number;
  notes: string;
  voided: boolean;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  serviceId: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  kind: PaymentKind;
  amount: number;
  paidAt: string;
  note: string;
}

export interface InvoiceBalance extends Invoice {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
}

export interface BillingSettings {
  clinicId: string;
  currency: string;
  taxRate: number;
  taxLabel: string;
}

// DTOs
export interface CreateInvoiceItemDto {
  serviceId: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
}

export interface CreateInvoiceDto {
  patientId: string;
  appointmentId: string | null;
  issueDate: string;
  discountType: DiscountType | null;
  discountValue: number;
  taxRate: number;
  notes: string;
}

export interface CreatePaymentDto {
  invoiceId: string;
  kind: PaymentKind;
  amount: number;
  note: string;
}

// Mappers (read)
export function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    number: row.number ?? '',
    issueDate: row.issue_date,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    taxRate: Number(row.tax_rate),
    notes: row.notes ?? '',
    voided: row.voided,
    createdAt: row.created_at,
  };
}

export function toInvoiceItem(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    serviceId: row.service_id,
    description: row.description,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
  };
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    kind: row.kind,
    amount: Number(row.amount),
    paidAt: row.paid_at,
    note: row.note ?? '',
  };
}

export function toInvoiceBalance(row: InvoiceBalanceRow): InvoiceBalance {
  return {
    ...toInvoice(row),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    total: Number(row.total),
    paid: Number(row.paid),
    balance: Number(row.balance),
    status: row.status,
  };
}

export function toBillingSettings(row: BillingSettingsRow): BillingSettings {
  return {
    clinicId: row.clinic_id,
    currency: row.currency,
    taxRate: Number(row.tax_rate),
    taxLabel: row.tax_label,
  };
}

// Mappers (write)
export function toInvoiceWrite(dto: CreateInvoiceDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    appointment_id: dto.appointmentId,
    issue_date: dto.issueDate,
    discount_type: dto.discountType,
    discount_value: dto.discountValue,
    tax_rate: dto.taxRate,
    notes: dto.notes,
  };
}

export function toItemWrite(
  invoiceId: string,
  dto: CreateInvoiceItemDto,
): Record<string, unknown> {
  return {
    invoice_id: invoiceId,
    service_id: dto.serviceId,
    description: dto.description,
    unit_price: dto.unitPrice,
    quantity: dto.quantity,
  };
}

export function toPaymentWrite(dto: CreatePaymentDto): Record<string, unknown> {
  return {
    invoice_id: dto.invoiceId,
    kind: dto.kind,
    amount: dto.amount,
    note: dto.note,
  };
}

export function toSettingsWrite(
  s: Pick<BillingSettings, 'currency' | 'taxRate' | 'taxLabel'>,
): Record<string, unknown> {
  return { currency: s.currency, tax_rate: s.taxRate, tax_label: s.taxLabel };
}

// ---- Totals (must match view invoice_balances) -----------------------------

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export function computeTotals(
  items: readonly { unitPrice: number; quantity: number }[],
  discountType: DiscountType | null,
  discountValue: number,
  taxRate: number,
): Totals {
  const subtotal = round2(
    items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
  );
  let discount = 0;
  if (discountType === 'amount') discount = Math.min(discountValue, subtotal);
  else if (discountType === 'percent') discount = round2((subtotal * discountValue) / 100);
  const tax = round2(((subtotal - discount) * taxRate) / 100);
  const total = round2(subtotal - discount + tax);
  return { subtotal, discount, tax, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/billing.model.spec.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/billing/billing.model.ts src/app/features/billing/billing.model.spec.ts
git commit -m "feat(billing): invoice/item/payment/settings models + totals helper"
```

---

### Task 4: Service catalog store

**Files:**
- Create: `src/app/features/billing/service.store.ts`
- Test: `src/app/features/billing/service.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toService`, `toServiceWrite`, `CreateServiceDto`, `Service`.
- Produces: `ServiceStore` with `services()`, `isLoading()`, `error()`, `reload()`, `setActiveOnly(b)`, `add(dto)`, `update(id, dto)`, `remove(id)`, `activeServices()`.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/billing/service.store.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { ServiceStore } from './service.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  { id: 's1', clinic_id: 'c1', name: 'Consultation', description: '', price: '500.00', active: true, created_at: '2026-07-19T00:00:00Z' },
];

describe('ServiceStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(ServiceStore);
  }

  it('queries services ordered by name and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('services');
    expect(store.services()[0].price).toBe(500);
  });

  it('applies active-only filter', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setActiveOnly(true);
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['active', true] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/service.store.spec.ts`
Expected: FAIL — cannot find module `./service.store`.

- [ ] **Step 3: Write the store**

Create `src/app/features/billing/service.store.ts`:

```typescript
import { computed, inject, resource, Service as Injectable, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { Service, CreateServiceDto, toService, toServiceWrite } from './billing.model';

@Injectable()
export class ServiceStore {
  private supabase = inject(SUPABASE);
  private _activeOnly = signal(false);
  activeOnly = this._activeOnly.asReadonly();

  setActiveOnly(b: boolean) {
    this._activeOnly.set(b);
  }

  private servicesResource = resource({
    params: () => ({ activeOnly: this._activeOnly() }),
    loader: async ({ params }) => {
      let query = this.supabase.from('services').select('*');
      if (params.activeOnly) query = query.eq('active', true);
      query = query.order('name', { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(toService);
    },
  });

  services = computed<Service[]>(() => this.servicesResource.value() ?? []);
  activeServices = computed<Service[]>(() => this.services().filter(s => s.active));
  readonly isLoading = computed(() => this.servicesResource.isLoading());
  readonly error = computed(() => this.servicesResource.error());

  reload() {
    this.servicesResource.reload();
  }

  async add(dto: CreateServiceDto): Promise<void> {
    const { error } = await this.supabase.from('services').insert(toServiceWrite(dto));
    if (error) throw error;
    this.servicesResource.reload();
  }

  async update(id: string, dto: CreateServiceDto): Promise<void> {
    const { error } = await this.supabase.from('services').update(toServiceWrite(dto)).eq('id', id);
    if (error) throw error;
    this.servicesResource.reload();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('services').delete().eq('id', id);
    if (error) throw error;
    this.servicesResource.reload();
  }
}
```

Note: `Service` from `@angular/core` is the DI decorator; it is aliased to `Injectable` here only because this file also imports the `Service` domain type. Other stores that don't import a `Service` type keep `@Service()` directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/service.store.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/billing/service.store.ts src/app/features/billing/service.store.spec.ts
git commit -m "feat(billing): service catalog store"
```

---

### Task 5: Service catalog component

**Files:**
- Create: `src/app/features/billing/service-list.component.ts`

**Interfaces:**
- Consumes: `ServiceStore`, `Service`, `CreateServiceDto`.

- [ ] **Step 1: Write the component**

Create `src/app/features/billing/service-list.component.ts`:

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { ServiceStore } from './service.store';
import { Service } from './billing.model';

@Component({
  selector: 'app-service-list',
  imports: [
    FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatSlideToggleModule, MatProgressBarModule,
    MatTableModule,
  ],
  providers: [ServiceStore],
  template: `
    <header class="toolbar">
      <h1>Service Catalog</h1>
      <span class="spacer"></span>
      <mat-slide-toggle
        [ngModel]="store.activeOnly()"
        (ngModelChange)="store.setActiveOnly($event)">
        Active only
      </mat-slide-toggle>
    </header>

    <mat-card appearance="outlined" class="form-card">
      <mat-card-content class="row">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="draftName" placeholder="Consultation" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="price">
          <mat-label>Price</mat-label>
          <input matInput type="number" min="0" step="0.01" [(ngModel)]="draftPrice" />
        </mat-form-field>
        <button mat-flat-button [disabled]="!draftName().trim() || saving()" (click)="save()">
          <mat-icon>{{ editingId() ? 'save' : 'add' }}</mat-icon>
          {{ editingId() ? 'Update' : 'Add' }}
        </button>
        @if (editingId()) {
          <button mat-button (click)="resetDraft()">Cancel</button>
        }
      </mat-card-content>
    </mat-card>

    @if (store.isLoading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load services.</p>
        <button mat-stroked-button (click)="store.reload()">Retry</button>
      </div>
    } @else if (store.services().length) {
      <table mat-table [dataSource]="store.services()" class="mat-elevation-z0">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let s">{{ s.name }}</td>
        </ng-container>
        <ng-container matColumnDef="price">
          <th mat-header-cell *matHeaderCellDef>Price</th>
          <td mat-cell *matCellDef="let s">{{ s.price | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="active">
          <th mat-header-cell *matHeaderCellDef>Active</th>
          <td mat-cell *matCellDef="let s">{{ s.active ? 'Yes' : 'No' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let s" class="actions">
            <button mat-icon-button (click)="edit(s)" aria-label="Edit service">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button (click)="store.remove(s.id)" aria-label="Delete service">
              <mat-icon>delete_outline</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    } @else {
      <div class="state"><p class="muted">No services yet.</p></div>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .form-card { margin-bottom: 1.25rem; }
    .row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .grow { flex: 1 1 16rem; }
    .price { flex: 0 1 9rem; }
    table { width: 100%; }
    .actions { text-align: right; white-space: nowrap; }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class ServiceListComponent {
  store = inject(ServiceStore);
  cols = ['name', 'price', 'active', 'actions'];

  draftName = signal('');
  draftPrice = signal<number>(0);
  editingId = signal<string | null>(null);
  saving = signal(false);

  edit(s: Service) {
    this.editingId.set(s.id);
    this.draftName.set(s.name);
    this.draftPrice.set(s.price);
  }

  resetDraft() {
    this.editingId.set(null);
    this.draftName.set('');
    this.draftPrice.set(0);
  }

  async save() {
    this.saving.set(true);
    const dto = {
      name: this.draftName().trim(),
      description: '',
      price: Number(this.draftPrice()) || 0,
      active: true,
    };
    try {
      const id = this.editingId();
      if (id) await this.store.update(id, dto);
      else await this.store.add(dto);
      this.resetDraft();
    } finally {
      this.saving.set(false);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds (no template/type errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/features/billing/service-list.component.ts
git commit -m "feat(billing): service catalog component"
```

---

### Task 6: Billing settings store + component

**Files:**
- Create: `src/app/features/billing/billing-settings.store.ts`
- Create: `src/app/features/billing/billing-settings.component.ts`
- Test: `src/app/features/billing/billing-settings.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toBillingSettings`, `toSettingsWrite`, `BillingSettings`.
- Produces: `BillingSettingsStore` with `settings()` (defaults when absent), `isLoading()`, `error()`, `reload()`, `save(currency, taxRate, taxLabel)`, `taxRate()` (convenience computed).

- [ ] **Step 1: Write the failing test**

Create `src/app/features/billing/billing-settings.store.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { BillingSettingsStore } from './billing-settings.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

describe('BillingSettingsStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(BillingSettingsStore);
  }

  it('maps the settings row', async () => {
    const rows = [{ clinic_id: 'c1', currency: 'PHP', tax_rate: '12.00', tax_label: 'VAT', updated_at: 'x', updated_by: null }];
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('billing_settings');
    expect(store.settings().taxRate).toBe(12);
    expect(store.settings().currency).toBe('PHP');
  });

  it('falls back to defaults when no row exists', async () => {
    const client = fakeSupabaseSelect([], 0);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(store.settings().currency).toBe('PHP');
    expect(store.settings().taxRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/billing-settings.store.spec.ts`
Expected: FAIL — cannot find module `./billing-settings.store`.

- [ ] **Step 3: Write the store**

Create `src/app/features/billing/billing-settings.store.ts`:

```typescript
import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { BillingSettings, toBillingSettings, toSettingsWrite } from './billing.model';

const DEFAULTS: BillingSettings = { clinicId: '', currency: 'PHP', taxRate: 0, taxLabel: 'Tax' };

@Service()
export class BillingSettingsStore {
  private supabase = inject(SUPABASE);

  private settingsResource = resource({
    params: () => ({}),
    loader: async () => {
      const { data, error } = await this.supabase
        .from('billing_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? toBillingSettings(data) : DEFAULTS;
    },
  });

  settings = computed<BillingSettings>(() => this.settingsResource.value() ?? DEFAULTS);
  taxRate = computed(() => this.settings().taxRate);
  currency = computed(() => this.settings().currency);
  readonly isLoading = computed(() => this.settingsResource.isLoading());
  readonly error = computed(() => this.settingsResource.error());

  reload() {
    this.settingsResource.reload();
  }

  async save(currency: string, taxRate: number, taxLabel: string): Promise<void> {
    const { error } = await this.supabase
      .from('billing_settings')
      .upsert(toSettingsWrite({ currency, taxRate, taxLabel }), { onConflict: 'clinic_id' });
    if (error) throw error;
    this.settingsResource.reload();
  }
}
```

- [ ] **Step 4: Extend the test fake with `maybeSingle` / `single`**

`fakeSupabaseSelect` only exposes a fixed set of filter methods plus a thenable. Two gaps: it has no `lte` (needed by the invoice date filter and the reports store in Task 11) and no single-row terminators (`maybeSingle` used here, `single` used by `InvoiceStore.create`).

Modify `src/testing/fake-supabase.ts`:

1. Add `'lte'` to the filter-method list:

```typescript
  for (const m of ['or', 'eq', 'ilike', 'order', 'range', 'gte', 'lte', 'in']) {
```

2. Immediately after that `for` loop, add the single-row terminators:

```typescript
  const singleResult = (allowEmpty: boolean) => ({
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rows[0] ?? (allowEmpty ? null : undefined), count, error }),
  });
  builder.maybeSingle = vi.fn(() => singleResult(true));
  builder.single = vi.fn(() => singleResult(false));
```

Existing specs are untouched — they never call these methods. Tasks 7 and 11 depend on this edit; it is made once, here.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/billing-settings.store.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the settings component**

Create `src/app/features/billing/billing-settings.component.ts`:

```typescript
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BillingSettingsStore } from './billing-settings.store';

@Component({
  selector: 'app-billing-settings',
  imports: [
    FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule,
  ],
  providers: [BillingSettingsStore],
  template: `
    <header class="toolbar"><h1>Billing Settings</h1></header>
    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <mat-form-field appearance="outline">
          <mat-label>Currency code</mat-label>
          <input matInput [(ngModel)]="currency" maxlength="3" placeholder="PHP" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Tax label</mat-label>
          <input matInput [(ngModel)]="taxLabel" placeholder="VAT" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Tax rate (%)</mat-label>
          <input matInput type="number" min="0" max="100" step="0.01" [(ngModel)]="taxRate" />
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button [disabled]="saving()" (click)="save()">
            <mat-icon>save</mat-icon> Save
          </button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .card { max-width: 26rem; }
    .col { display: flex; flex-direction: column; gap: 0.5rem; }
    .actions { display: flex; justify-content: flex-end; }
  `,
})
export class BillingSettingsComponent {
  store = inject(BillingSettingsStore);
  private snack = inject(MatSnackBar);

  currency = signal('PHP');
  taxLabel = signal('Tax');
  taxRate = signal<number>(0);
  saving = signal(false);

  constructor() {
    // Sync form fields from loaded settings once.
    let seeded = false;
    effect(() => {
      const s = this.store.settings();
      if (!seeded && !this.store.isLoading()) {
        this.currency.set(s.currency);
        this.taxLabel.set(s.taxLabel);
        this.taxRate.set(s.taxRate);
        seeded = true;
      }
    });
  }

  async save() {
    this.saving.set(true);
    try {
      await this.store.save(this.currency().trim().toUpperCase(), Number(this.taxRate()) || 0, this.taxLabel().trim() || 'Tax');
      this.snack.open('Settings saved', 'OK', { duration: 2500 });
    } catch {
      this.snack.open('Could not save settings', 'Dismiss', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }
}
```

- [ ] **Step 7: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/features/billing/billing-settings.store.ts src/app/features/billing/billing-settings.component.ts src/app/features/billing/billing-settings.store.spec.ts src/testing/fake-supabase.ts
git commit -m "feat(billing): billing settings store + component"
```

---

### Task 7: Invoice store

**Files:**
- Create: `src/app/features/billing/invoice.store.ts`
- Test: `src/app/features/billing/invoice.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`; models `toInvoiceBalance`, `toInvoice`, `toInvoiceItem`, `toPayment`, `toInvoiceWrite`, `toItemWrite`, `toPaymentWrite`; DTOs `CreateInvoiceDto`, `CreateInvoiceItemDto`, `CreatePaymentDto`; `InvoiceStatus`.
- Produces: `InvoiceStore` with list state (`invoices()`, `total()`, `isLoading()`, `error()`, `reload()`, `setStatus(s)`, `setPatient(id)`, `setDateRange(from,to)`, `setPage(p)`, `pageSize`, `page()`), and methods `loadOne(id) => Promise<{ invoice, items, payments } | null>`, `create(dto, items) => Promise<string>` (returns new invoice id), `addPayment(dto)`, `void(id)`.

The list reads the `invoice_balances` view and embeds the patient name via PostgREST FK embed on `patient_id`.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/billing/invoice.store.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { InvoiceStore } from './invoice.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

const rows = [
  {
    id: 'i1', clinic_id: 'c1', patient_id: 'p1', appointment_id: null,
    number: 'INV-000001', issue_date: '2026-07-19', discount_type: null,
    discount_value: '0', tax_rate: '12', notes: null, voided: false,
    created_at: '2026-07-19T00:00:00Z',
    subtotal: '1000', discount: '0', tax: '120', total: '1120',
    paid: '0', balance: '1120', status: 'unpaid',
    patient: { first_name: 'Jane', last_name: 'Doe' },
  },
];

describe('InvoiceStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(InvoiceStore);
  }

  it('queries invoice_balances with pagination and maps rows', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('invoice_balances');
    expect(store.invoices()[0].total).toBe(1120);
    expect(store.invoices()[0].patientName).toBe('Jane Doe');
  });

  it('applies a status filter', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setStatus('unpaid');
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['status', 'unpaid'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/invoice.store.spec.ts`
Expected: FAIL — cannot find module `./invoice.store`.

- [ ] **Step 3: Write the store**

Create `src/app/features/billing/invoice.store.ts`:

```typescript
import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import {
  Invoice, InvoiceBalance, InvoiceItem, Payment, InvoiceStatus,
  CreateInvoiceDto, CreateInvoiceItemDto, CreatePaymentDto,
  toInvoice, toInvoiceItem, toPayment, toInvoiceBalance,
  toInvoiceWrite, toItemWrite, toPaymentWrite,
} from './billing.model';

/** A balance row with the patient's display name resolved via FK embed. */
export interface InvoiceListRow extends InvoiceBalance {
  patientName: string;
}

@Service()
export class InvoiceStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 10;
  private _page = signal(1);
  private _status = signal<InvoiceStatus | ''>('');
  private _patientId = signal<string | ''>('');
  private _from = signal<string>('');
  private _to = signal<string>('');

  page = this._page.asReadonly();
  status = this._status.asReadonly();

  setPage(p: number) { this._page.set(p); }
  setStatus(s: InvoiceStatus | '') { this._status.set(s); this._page.set(1); }
  setPatient(id: string) { this._patientId.set(id); this._page.set(1); }
  setDateRange(from: string, to: string) { this._from.set(from); this._to.set(to); this._page.set(1); }

  private listResource = resource({
    params: () => ({
      page: this._page(), status: this._status(),
      patientId: this._patientId(), from: this._from(), to: this._to(),
    }),
    loader: async ({ params }) => {
      let query = this.supabase
        .from('invoice_balances')
        .select('*, patient:patients(first_name, last_name)', { count: 'exact' });

      if (params.status) query = query.eq('status', params.status);
      if (params.patientId) query = query.eq('patient_id', params.patientId);
      if (params.from) query = query.gte('issue_date', params.from);
      if (params.to) query = query.lte('issue_date', params.to);

      query = query.order('created_at', { ascending: false });
      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      const rows: InvoiceListRow[] = (data ?? []).map((r: any) => ({
        ...toInvoiceBalance(r),
        patientName: r.patient ? `${r.patient.first_name} ${r.patient.last_name}` : '',
      }));
      return { rows, total: count ?? 0 };
    },
  });

  invoices = computed<InvoiceListRow[]>(() => this.listResource.value()?.rows ?? []);
  total = computed(() => this.listResource.value()?.total ?? 0);
  readonly isLoading = computed(() => this.listResource.isLoading());
  readonly error = computed(() => this.listResource.error());
  reload() { this.listResource.reload(); }

  async loadOne(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[]; payments: Payment[] } | null> {
    const { data: inv, error: e1 } = await this.supabase
      .from('invoices').select('*').eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!inv) return null;

    const { data: items, error: e2 } = await this.supabase
      .from('invoice_items').select('*').eq('invoice_id', id);
    if (e2) throw e2;

    const { data: pays, error: e3 } = await this.supabase
      .from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: true });
    if (e3) throw e3;

    return {
      invoice: toInvoice(inv),
      items: (items ?? []).map(toInvoiceItem),
      payments: (pays ?? []).map(toPayment),
    };
  }

  /** Insert the invoice then its line items; returns the new invoice id. */
  async create(dto: CreateInvoiceDto, items: CreateInvoiceItemDto[]): Promise<string> {
    const { data, error } = await this.supabase
      .from('invoices').insert(toInvoiceWrite(dto)).select('id').single();
    if (error) throw error;
    const id: string = data.id;
    if (items.length) {
      const { error: e2 } = await this.supabase
        .from('invoice_items').insert(items.map(it => toItemWrite(id, it)));
      if (e2) throw e2;
    }
    this.listResource.reload();
    return id;
  }

  async addPayment(dto: CreatePaymentDto): Promise<void> {
    const { error } = await this.supabase.from('payments').insert(toPaymentWrite(dto));
    if (error) throw error;
    this.listResource.reload();
  }

  async void(id: string): Promise<void> {
    const { error } = await this.supabase.from('invoices').update({ voided: true }).eq('id', id);
    if (error) throw error;
    this.listResource.reload();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/invoice.store.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/billing/invoice.store.ts src/app/features/billing/invoice.store.spec.ts
git commit -m "feat(billing): invoice store — list view, load, create, payment, void"
```

---

### Task 8: Invoice list component

**Files:**
- Create: `src/app/features/billing/invoice-list.component.ts`

**Interfaces:**
- Consumes: `InvoiceStore` (`invoices()`, `total()`, `page()`, `pageSize`, `status()`, `setStatus`, `setDateRange`, `setPage`, `reload`), `InvoiceListRow`, `INVOICE_STATUSES`.

- [ ] **Step 1: Write the component**

Create `src/app/features/billing/invoice-list.component.ts`:

```typescript
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { InvoiceStore } from './invoice.store';
import { INVOICE_STATUSES } from './billing.model';

@Component({
  selector: 'app-invoice-list',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatFormFieldModule, MatSelectModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule, MatChipsModule,
    MatPaginatorModule, MatProgressBarModule,
  ],
  providers: [InvoiceStore],
  template: `
    <header class="toolbar">
      <h1>Invoices</h1>
      <span class="spacer"></span>
      <a mat-flat-button routerLink="new"><mat-icon>add</mat-icon> New Invoice</a>
    </header>

    <div class="filters">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="status">
        <mat-label>Status</mat-label>
        <mat-select [ngModel]="store.status()" (ngModelChange)="store.setStatus($event)">
          <mat-option value="">All</mat-option>
          @for (s of statuses; track s) {
            <mat-option [value]="s">{{ s }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>From</mat-label>
        <input matInput type="date" [ngModel]="fromDate" (ngModelChange)="onFrom($event)" />
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>To</mat-label>
        <input matInput type="date" [ngModel]="toDate" (ngModelChange)="onTo($event)" />
      </mat-form-field>
    </div>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load invoices.</p>
        <button mat-stroked-button (click)="store.reload()">Retry</button>
      </div>
    } @else if (store.invoices().length) {
      <table mat-table [dataSource]="store.invoices()">
        <ng-container matColumnDef="number">
          <th mat-header-cell *matHeaderCellDef>Invoice</th>
          <td mat-cell *matCellDef="let i"><a [routerLink]="[i.id]">{{ i.number }}</a></td>
        </ng-container>
        <ng-container matColumnDef="patient">
          <th mat-header-cell *matHeaderCellDef>Patient</th>
          <td mat-cell *matCellDef="let i">{{ i.patientName }}</td>
        </ng-container>
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Date</th>
          <td mat-cell *matCellDef="let i">{{ i.issueDate }}</td>
        </ng-container>
        <ng-container matColumnDef="total">
          <th mat-header-cell *matHeaderCellDef>Total</th>
          <td mat-cell *matCellDef="let i">{{ i.total | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="balance">
          <th mat-header-cell *matHeaderCellDef>Balance</th>
          <td mat-cell *matCellDef="let i">{{ i.balance | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let i">
            <span class="badge" [attr.data-status]="i.status">{{ i.status }}</span>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>

      <mat-paginator
        [length]="store.total()"
        [pageSize]="store.pageSize"
        [pageIndex]="store.page() - 1"
        [hidePageSize]="true"
        (page)="onPage($event)" />
    } @else {
      <div class="state"><p class="muted">No invoices found.</p></div>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .filters { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .status { flex: 0 1 10rem; }
    table { width: 100%; }
    .badge { padding: 0.125rem 0.5rem; border-radius: 1rem; font: var(--mat-sys-label-small);
             background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .badge[data-status='paid'] { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .badge[data-status='void'] { text-decoration: line-through; }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class InvoiceListComponent {
  store = inject(InvoiceStore);
  statuses = INVOICE_STATUSES;
  cols = ['number', 'patient', 'date', 'total', 'balance', 'status'];
  fromDate = '';
  toDate = '';

  onFrom(v: string) { this.fromDate = v; this.store.setDateRange(v, this.toDate); }
  onTo(v: string) { this.toDate = v; this.store.setDateRange(this.fromDate, v); }
  onPage(e: PageEvent) { this.store.setPage(e.pageIndex + 1); }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/billing/invoice-list.component.ts
git commit -m "feat(billing): invoice list with status/date filters"
```

---

### Task 9: Invoice form component (create)

**Files:**
- Create: `src/app/features/billing/invoice-form.component.ts`

**Interfaces:**
- Consumes: `InvoiceStore.create`, `ServiceStore.activeServices`, `BillingSettingsStore.taxRate`, `PatientStore.getById`/patient search, `computeTotals`, `DISCOUNT_TYPES`.
- Patient selection: reuse `PatientStore` list. To keep this task self-contained, load patients via a lightweight direct query in the component's own small resource is avoided — instead inject `PatientStore` and use its `visiblePatients()` + `setSearch()`.

- [ ] **Step 1: Write the component**

Create `src/app/features/billing/invoice-form.component.ts`:

```typescript
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InvoiceStore } from './invoice.store';
import { ServiceStore } from './service.store';
import { BillingSettingsStore } from './billing-settings.store';
import { PatientStore } from '../patients/patient.store';
import { computeTotals, DISCOUNT_TYPES, DiscountType, CreateInvoiceItemDto } from './billing.model';

interface DraftLine { serviceId: string | null; description: string; unitPrice: number; quantity: number; }

@Component({
  selector: 'app-invoice-form',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule, MatAutocompleteModule,
  ],
  providers: [InvoiceStore, ServiceStore, BillingSettingsStore, PatientStore],
  template: `
    <header class="toolbar">
      <a mat-icon-button routerLink="/billing"><mat-icon>arrow_back</mat-icon></a>
      <h1>New Invoice</h1>
    </header>

    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <mat-form-field appearance="outline">
          <mat-label>Patient</mat-label>
          <input matInput [ngModel]="patientQuery()" (ngModelChange)="onPatientSearch($event)"
                 [matAutocomplete]="auto" placeholder="Search patient" />
          <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pickPatient($event.option.value)">
            @for (p of patients.visiblePatients(); track p.id) {
              <mat-option [value]="p">{{ p.firstName }} {{ p.lastName }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        @if (patientId()) { <p class="chosen">Selected: {{ patientName() }}</p> }

        <mat-form-field appearance="outline">
          <mat-label>Issue date</mat-label>
          <input matInput type="date" [(ngModel)]="issueDate" />
        </mat-form-field>
      </mat-card-content>
    </mat-card>

    <mat-card appearance="outlined" class="card">
      <mat-card-content>
        <h2>Line items</h2>
        @for (line of lines(); track $index) {
          <div class="line">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
              <mat-label>Service</mat-label>
              <mat-select [ngModel]="line.serviceId" (ngModelChange)="pickService($index, $event)">
                <mat-option [value]="null">Custom</mat-option>
                @for (s of services.activeServices(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
              <mat-label>Description</mat-label>
              <input matInput [ngModel]="line.description" (ngModelChange)="setLine($index, 'description', $event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
              <mat-label>Price</mat-label>
              <input matInput type="number" min="0" step="0.01" [ngModel]="line.unitPrice"
                     (ngModelChange)="setLine($index, 'unitPrice', $event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
              <mat-label>Qty</mat-label>
              <input matInput type="number" min="0" step="1" [ngModel]="line.quantity"
                     (ngModelChange)="setLine($index, 'quantity', $event)" />
            </mat-form-field>
            <button mat-icon-button (click)="removeLine($index)" aria-label="Remove line">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        <button mat-stroked-button (click)="addLine()"><mat-icon>add</mat-icon> Add line</button>
      </mat-card-content>
    </mat-card>

    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <div class="discount-row">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
            <mat-label>Discount type</mat-label>
            <mat-select [(ngModel)]="discountType">
              <mat-option [value]="null">None</mat-option>
              @for (d of discountTypes; track d) { <mat-option [value]="d">{{ d }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
            <mat-label>Discount value</mat-label>
            <input matInput type="number" min="0" step="0.01" [(ngModel)]="discountValue" />
          </mat-form-field>
        </div>

        <dl class="totals">
          <dt>Subtotal</dt><dd>{{ totals().subtotal | number: '1.2-2' }}</dd>
          <dt>Discount</dt><dd>-{{ totals().discount | number: '1.2-2' }}</dd>
          <dt>Tax ({{ settings.taxRate() }}%)</dt><dd>{{ totals().tax | number: '1.2-2' }}</dd>
          <dt class="grand">Total</dt><dd class="grand">{{ totals().total | number: '1.2-2' }}</dd>
        </dl>

        <div class="actions">
          <button mat-flat-button [disabled]="!canSave() || saving()" (click)="save()">
            <mat-icon>save</mat-icon> Create invoice
          </button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .card { margin-bottom: 1rem; max-width: 48rem; }
    .col { display: flex; flex-direction: column; gap: 0.5rem; }
    .line { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .grow { flex: 1 1 12rem; }
    .num { flex: 0 1 7rem; }
    .discount-row { display: flex; gap: 0.5rem; }
    .chosen { color: var(--mat-sys-on-surface-variant); margin: 0; }
    .totals { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 2rem; max-width: 20rem; margin-left: auto; }
    .totals dd { margin: 0; text-align: right; }
    .totals .grand { font: var(--mat-sys-title-medium); }
    .actions { display: flex; justify-content: flex-end; }
  `,
})
export class InvoiceFormComponent {
  private invoices = inject(InvoiceStore);
  services = inject(ServiceStore);
  settings = inject(BillingSettingsStore);
  patients = inject(PatientStore);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  discountTypes = DISCOUNT_TYPES;
  issueDate = new Date().toISOString().slice(0, 10);
  discountType = signal<DiscountType | null>(null);
  discountValue = signal<number>(0);
  patientId = signal<string | null>(null);
  patientName = signal('');
  patientQuery = signal('');
  saving = signal(false);

  lines = signal<DraftLine[]>([{ serviceId: null, description: '', unitPrice: 0, quantity: 1 }]);

  totals = computed(() =>
    computeTotals(this.lines(), this.discountType(), Number(this.discountValue()) || 0, this.settings.taxRate()),
  );

  canSave = computed(() =>
    !!this.patientId() && this.lines().some(l => l.description.trim() && l.unitPrice > 0),
  );

  onPatientSearch(q: string) { this.patientQuery.set(q); this.patients.setSearch(q); }
  pickPatient(p: { id: string; firstName: string; lastName: string }) {
    this.patientId.set(p.id);
    this.patientName.set(`${p.firstName} ${p.lastName}`);
    this.patientQuery.set(`${p.firstName} ${p.lastName}`);
  }

  addLine() {
    this.lines.update(ls => [...ls, { serviceId: null, description: '', unitPrice: 0, quantity: 1 }]);
  }
  removeLine(i: number) { this.lines.update(ls => ls.filter((_, idx) => idx !== i)); }
  setLine(i: number, key: keyof DraftLine, value: unknown) {
    this.lines.update(ls => ls.map((l, idx) =>
      idx === i ? { ...l, [key]: key === 'unitPrice' || key === 'quantity' ? Number(value) || 0 : value } : l));
  }
  pickService(i: number, serviceId: string | null) {
    const svc = this.services.activeServices().find(s => s.id === serviceId);
    this.lines.update(ls => ls.map((l, idx) =>
      idx === i ? { ...l, serviceId, description: svc?.name ?? l.description, unitPrice: svc?.price ?? l.unitPrice } : l));
  }

  async save() {
    this.saving.set(true);
    const items: CreateInvoiceItemDto[] = this.lines()
      .filter(l => l.description.trim() && l.unitPrice > 0)
      .map(l => ({ serviceId: l.serviceId, description: l.description.trim(), unitPrice: l.unitPrice, quantity: l.quantity || 1 }));
    try {
      const id = await this.invoices.create(
        {
          patientId: this.patientId()!,
          appointmentId: null,
          issueDate: this.issueDate,
          discountType: this.discountType(),
          discountValue: Number(this.discountValue()) || 0,
          taxRate: this.settings.taxRate(),
          notes: '',
        },
        items,
      );
      await this.router.navigate(['/billing', id]);
    } catch {
      this.snack.open('Could not create invoice', 'Dismiss', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/billing/invoice-form.component.ts
git commit -m "feat(billing): invoice create form with live totals"
```

---

### Task 10: Invoice detail component (payments, refund, void, print)

**Files:**
- Create: `src/app/features/billing/invoice-detail.component.ts`

**Interfaces:**
- Consumes: `InvoiceStore.loadOne/addPayment/void`, `computeTotals`, `BillingSettingsStore` (currency + tax label), `PaymentKind`.

- [ ] **Step 1: Write the component**

Create `src/app/features/billing/invoice-detail.component.ts`:

```typescript
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, SlicePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InvoiceStore } from './invoice.store';
import { BillingSettingsStore } from './billing-settings.store';
import { computeTotals, Invoice, InvoiceItem, Payment, PaymentKind } from './billing.model';

@Component({
  selector: 'app-invoice-detail',
  imports: [
    RouterLink, FormsModule, DecimalPipe, SlicePipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule,
  ],
  providers: [InvoiceStore, BillingSettingsStore],
  template: `
    @if (loadError()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Could not load this invoice.</p>
        <button mat-stroked-button (click)="reload()">Retry</button>
      </div>
    } @else if (invoice(); as inv) {
      <header class="toolbar no-print">
        <a mat-icon-button routerLink="/billing"><mat-icon>arrow_back</mat-icon></a>
        <h1>{{ inv.number }}</h1>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="print()"><mat-icon>print</mat-icon> Print</button>
        @if (!inv.voided) {
          <button mat-stroked-button color="warn" (click)="voidInvoice(inv.id)">
            <mat-icon>block</mat-icon> Void
          </button>
        }
      </header>

      <mat-card appearance="outlined" class="card">
        <mat-card-content>
          @if (inv.voided) { <p class="voided-banner">VOIDED</p> }
          <p><strong>Issue date:</strong> {{ inv.issueDate }}</p>

          <table mat-table [dataSource]="items()" class="lines">
            <ng-container matColumnDef="description">
              <th mat-header-cell *matHeaderCellDef>Description</th>
              <td mat-cell *matCellDef="let it">{{ it.description }}</td>
            </ng-container>
            <ng-container matColumnDef="qty">
              <th mat-header-cell *matHeaderCellDef>Qty</th>
              <td mat-cell *matCellDef="let it">{{ it.quantity }}</td>
            </ng-container>
            <ng-container matColumnDef="price">
              <th mat-header-cell *matHeaderCellDef>Price</th>
              <td mat-cell *matCellDef="let it">{{ it.unitPrice | number: '1.2-2' }}</td>
            </ng-container>
            <ng-container matColumnDef="lineTotal">
              <th mat-header-cell *matHeaderCellDef>Total</th>
              <td mat-cell *matCellDef="let it">{{ it.unitPrice * it.quantity | number: '1.2-2' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="itemCols"></tr>
            <tr mat-row *matRowDef="let row; columns: itemCols"></tr>
          </table>

          <dl class="totals">
            <dt>Subtotal</dt><dd>{{ totals().subtotal | number: '1.2-2' }}</dd>
            <dt>Discount</dt><dd>-{{ totals().discount | number: '1.2-2' }}</dd>
            <dt>{{ settings.settings().taxLabel }} ({{ inv.taxRate }}%)</dt><dd>{{ totals().tax | number: '1.2-2' }}</dd>
            <dt class="grand">Total</dt><dd class="grand">{{ totals().total | number: '1.2-2' }}</dd>
            <dt>Paid</dt><dd>{{ paid() | number: '1.2-2' }}</dd>
            <dt class="grand">Balance</dt><dd class="grand">{{ totals().total - paid() | number: '1.2-2' }}</dd>
          </dl>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined" class="card no-print">
        <mat-card-content>
          <h2>Payments</h2>
          @for (p of payments(); track p.id) {
            <div class="pay-row">
              <span>{{ p.paidAt | slice: 0:10 }}</span>
              <span>{{ p.kind }}</span>
              <span>{{ (p.kind === 'refund' ? -p.amount : p.amount) | number: '1.2-2' }}</span>
              <span class="muted">{{ p.note }}</span>
            </div>
          } @empty { <p class="muted">No payments yet.</p> }

          @if (!inv.voided) {
            <div class="add-pay">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
                <mat-label>Amount</mat-label>
                <input matInput type="number" min="0" step="0.01" [(ngModel)]="payAmount" />
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                <mat-label>Note</mat-label>
                <input matInput [(ngModel)]="payNote" />
              </mat-form-field>
              <button mat-flat-button [disabled]="payAmount() <= 0 || busy()" (click)="record('payment')">
                <mat-icon>payments</mat-icon> Record payment
              </button>
              <button mat-stroked-button [disabled]="payAmount() <= 0 || busy()" (click)="record('refund')">
                <mat-icon>undo</mat-icon> Refund
              </button>
            </div>
          }
        </mat-card-content>
      </mat-card>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .spacer { flex: 1 1 auto; }
    .card { margin-bottom: 1rem; max-width: 48rem; }
    .lines { width: 100%; margin-bottom: 1rem; }
    .totals { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 2rem; max-width: 22rem; margin-left: auto; }
    .totals dd { margin: 0; text-align: right; }
    .totals .grand { font: var(--mat-sys-title-medium); }
    .pay-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr; gap: 0.5rem; padding: 0.25rem 0; }
    .add-pay { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 1rem; }
    .num { flex: 0 1 9rem; } .grow { flex: 1 1 12rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .voided-banner { color: var(--mat-sys-error); font: var(--mat-sys-title-medium); }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    @media print { .no-print { display: none !important; } }
  `,
})
export class InvoiceDetailComponent {
  private store = inject(InvoiceStore);
  settings = inject(BillingSettingsStore);
  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);

  itemCols = ['description', 'qty', 'price', 'lineTotal'];
  invoice = signal<Invoice | null>(null);
  items = signal<InvoiceItem[]>([]);
  payments = signal<Payment[]>([]);
  loadError = signal(false);
  busy = signal(false);
  payAmount = signal<number>(0);
  payNote = signal('');

  totals = computed(() => {
    const inv = this.invoice();
    if (!inv) return { subtotal: 0, discount: 0, tax: 0, total: 0 };
    return computeTotals(this.items(), inv.discountType, inv.discountValue, inv.taxRate);
  });
  paid = computed(() =>
    this.payments().reduce((s, p) => s + (p.kind === 'payment' ? p.amount : -p.amount), 0),
  );

  constructor() {
    this.reload();
  }

  async reload() {
    this.loadError.set(false);
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loadError.set(true); return; }
    try {
      const res = await this.store.loadOne(id);
      if (!res) { this.loadError.set(true); return; }
      this.invoice.set(res.invoice);
      this.items.set(res.items);
      this.payments.set(res.payments);
    } catch {
      this.loadError.set(true);
    }
  }

  async record(kind: PaymentKind) {
    const inv = this.invoice();
    if (!inv) return;
    this.busy.set(true);
    try {
      await this.store.addPayment({ invoiceId: inv.id, kind, amount: Number(this.payAmount()), note: this.payNote().trim() });
      this.payAmount.set(0);
      this.payNote.set('');
      await this.reload();
    } catch {
      this.snack.open('Could not record payment', 'Dismiss', { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }

  async voidInvoice(id: string) {
    this.busy.set(true);
    try {
      await this.store.void(id);
      await this.reload();
    } finally {
      this.busy.set(false);
    }
  }

  print() { window.print(); }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/billing/invoice-detail.component.ts
git commit -m "feat(billing): invoice detail — payments, refund, void, print"
```

---

### Task 11: Reports store + component

**Files:**
- Create: `src/app/features/billing/reports.store.ts`
- Create: `src/app/features/billing/billing-reports.component.ts`
- Test: `src/app/features/billing/reports.store.spec.ts`

**Interfaces:**
- Consumes: `SUPABASE`, `toPayment`. Requires the `lte` support added to `src/testing/fake-supabase.ts` in Task 6 Step 4 — if that edit is missing, this task's spec fails with `lte is not a function`.
- Produces: `ReportsStore` with `setDay(iso)`, `setRange(from,to)`, computed `dayNet()`, `dayPayments()`, `periodNet()`, `outstanding()` (list of `OutstandingRow { id, number, patientName, balance }`), `outstandingTotal()`, `isLoading()`, `error()`, `reload()`.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/billing/reports.store.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { ReportsStore } from './reports.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

describe('ReportsStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(ReportsStore);
  }

  it('nets day payments (payments minus refunds)', async () => {
    const rows = [
      { id: 'a', clinic_id: 'c1', invoice_id: 'i1', kind: 'payment', amount: '100', paid_at: '2026-07-19T09:00:00Z', note: null, created_by: null, created_at: 'x' },
      { id: 'b', clinic_id: 'c1', invoice_id: 'i1', kind: 'refund', amount: '30', paid_at: '2026-07-19T10:00:00Z', note: null, created_by: null, created_at: 'x' },
    ];
    const client = fakeSupabaseSelect(rows, 2);
    const store = setup(client);
    store.setDay('2026-07-19');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('payments');
    expect(store.dayNet()).toBe(70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/features/billing/reports.store.spec.ts`
Expected: FAIL — cannot find module `./reports.store`.

- [ ] **Step 3: Write the store**

Create `src/app/features/billing/reports.store.ts`:

```typescript
import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { Payment, toPayment } from './billing.model';

export interface OutstandingRow { id: string; number: string; patientName: string; balance: number; }

@Service()
export class ReportsStore {
  private supabase = inject(SUPABASE);

  private _day = signal<string>(new Date().toISOString().slice(0, 10));
  private _from = signal<string>(new Date().toISOString().slice(0, 10));
  private _to = signal<string>(new Date().toISOString().slice(0, 10));

  setDay(iso: string) { this._day.set(iso); }
  setRange(from: string, to: string) { this._from.set(from); this._to.set(to); }

  // Day close: payments whose paid_at falls on the selected day.
  private dayResource = resource({
    params: () => ({ day: this._day() }),
    loader: async ({ params }) => {
      const start = `${params.day}T00:00:00`;
      const end = `${params.day}T23:59:59.999`;
      const { data, error } = await this.supabase
        .from('payments').select('*').gte('paid_at', start).lte('paid_at', end);
      if (error) throw error;
      return (data ?? []).map(toPayment);
    },
  });

  // Period revenue: net payments across [from, to].
  private periodResource = resource({
    params: () => ({ from: this._from(), to: this._to() }),
    loader: async ({ params }) => {
      const { data, error } = await this.supabase
        .from('payments').select('*')
        .gte('paid_at', `${params.from}T00:00:00`)
        .lte('paid_at', `${params.to}T23:59:59.999`);
      if (error) throw error;
      return (data ?? []).map(toPayment);
    },
  });

  // Outstanding: unpaid/partial invoices with patient name.
  private outstandingResource = resource({
    params: () => ({}),
    loader: async () => {
      const { data, error } = await this.supabase
        .from('invoice_balances')
        .select('id, number, balance, status, patient:patients(first_name, last_name)')
        .in('status', ['unpaid', 'partial']);
      if (error) throw error;
      return (data ?? []).map((r: any): OutstandingRow => ({
        id: r.id,
        number: r.number ?? '',
        patientName: r.patient ? `${r.patient.first_name} ${r.patient.last_name}` : '',
        balance: Number(r.balance),
      }));
    },
  });

  private net(pays: Payment[]): number {
    return pays.reduce((s, p) => s + (p.kind === 'payment' ? p.amount : -p.amount), 0);
  }

  dayPayments = computed<Payment[]>(() => this.dayResource.value() ?? []);
  dayNet = computed(() => this.net(this.dayPayments()));
  periodNet = computed(() => this.net(this.periodResource.value() ?? []));
  outstanding = computed<OutstandingRow[]>(() => this.outstandingResource.value() ?? []);
  outstandingTotal = computed(() => this.outstanding().reduce((s, o) => s + o.balance, 0));

  readonly isLoading = computed(() =>
    this.dayResource.isLoading() || this.periodResource.isLoading() || this.outstandingResource.isLoading());
  readonly error = computed(() =>
    this.dayResource.error() || this.periodResource.error() || this.outstandingResource.error());

  reload() {
    this.dayResource.reload();
    this.periodResource.reload();
    this.outstandingResource.reload();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/features/billing/reports.store.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the reports component**

Create `src/app/features/billing/billing-reports.component.ts`:

```typescript
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { ReportsStore } from './reports.store';

@Component({
  selector: 'app-billing-reports',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule,
  ],
  providers: [ReportsStore],
  template: `
    <header class="toolbar"><h1>Billing Reports</h1></header>

    <div class="cards">
      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Daily cash close</h2>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Day</mat-label>
            <input matInput type="date" [ngModel]="day" (ngModelChange)="onDay($event)" />
          </mat-form-field>
          <p class="figure">{{ store.dayNet() | number: '1.2-2' }}</p>
          <p class="muted">{{ store.dayPayments().length }} payment(s)</p>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Revenue by period</h2>
          <div class="range">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>From</mat-label>
              <input matInput type="date" [ngModel]="from" (ngModelChange)="onFrom($event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>To</mat-label>
              <input matInput type="date" [ngModel]="to" (ngModelChange)="onTo($event)" />
            </mat-form-field>
          </div>
          <p class="figure">{{ store.periodNet() | number: '1.2-2' }}</p>
        </mat-card-content>
      </mat-card>
    </div>

    <mat-card appearance="outlined" class="card">
      <mat-card-content>
        <h2>Outstanding balances — {{ store.outstandingTotal() | number: '1.2-2' }}</h2>
        @if (store.outstanding().length) {
          <table mat-table [dataSource]="store.outstanding()">
            <ng-container matColumnDef="number">
              <th mat-header-cell *matHeaderCellDef>Invoice</th>
              <td mat-cell *matCellDef="let o"><a [routerLink]="['/billing', o.id]">{{ o.number }}</a></td>
            </ng-container>
            <ng-container matColumnDef="patient">
              <th mat-header-cell *matHeaderCellDef>Patient</th>
              <td mat-cell *matCellDef="let o">{{ o.patientName }}</td>
            </ng-container>
            <ng-container matColumnDef="balance">
              <th mat-header-cell *matHeaderCellDef>Balance</th>
              <td mat-cell *matCellDef="let o">{{ o.balance | number: '1.2-2' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="cols"></tr>
            <tr mat-row *matRowDef="let row; columns: cols"></tr>
          </table>
        } @else { <p class="muted">Nothing outstanding.</p> }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .card { max-width: 48rem; }
    .range { display: flex; gap: 0.5rem; }
    .figure { font: var(--mat-sys-headline-medium); margin: 0.5rem 0 0; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    table { width: 100%; }
  `,
})
export class BillingReportsComponent {
  store = inject(ReportsStore);
  cols = ['number', 'patient', 'balance'];
  day = new Date().toISOString().slice(0, 10);
  from = this.day;
  to = this.day;

  onDay(v: string) { this.day = v; this.store.setDay(v); }
  onFrom(v: string) { this.from = v; this.store.setRange(v, this.to); }
  onTo(v: string) { this.to = v; this.store.setRange(this.from, v); }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx ng build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/billing/reports.store.ts src/app/features/billing/billing-reports.component.ts src/app/features/billing/reports.store.spec.ts
git commit -m "feat(billing): reports — daily close, period revenue, outstanding"
```

---

### Task 12: Routes + navigation + render verification

**Files:**
- Modify: `src/app/app.routes.ts`
- Modify: `src/app/app.ts`

**Interfaces:**
- Consumes: all billing components.

- [ ] **Step 1: Add billing routes**

In `src/app/app.routes.ts`, add this route block after the `appointments` block (before `admin`):

```typescript
  {
    path: 'billing',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/billing/invoice-list.component').then(m => m.InvoiceListComponent) },
      { path: 'new', loadComponent: () => import('./features/billing/invoice-form.component').then(m => m.InvoiceFormComponent) },
      { path: 'catalog', loadComponent: () => import('./features/billing/service-list.component').then(m => m.ServiceListComponent) },
      { path: 'reports', loadComponent: () => import('./features/billing/billing-reports.component').then(m => m.BillingReportsComponent) },
      { path: 'settings', loadComponent: () => import('./features/billing/billing-settings.component').then(m => m.BillingSettingsComponent) },
      { path: ':id', loadComponent: () => import('./features/billing/invoice-detail.component').then(m => m.InvoiceDetailComponent) },
    ],
  },
```

Note: `:id` is last so it does not shadow `new`/`catalog`/`reports`/`settings`.

- [ ] **Step 2: Add the nav link**

In `src/app/app.ts`, add to the `links` array (after appointments):

```typescript
    { path: '/billing', label: 'Billing', icon: 'receipt_long' },
```

- [ ] **Step 3: Verify build + full test suite**

Run: `npx ng build && npx vitest run`
Expected: build succeeds; all vitest specs pass (including the new billing specs).

- [ ] **Step 4: Verify the app renders (Playwright)**

Start the app: `npm start` (serves on `http://localhost:4200`).
Then, using the Playwright MCP browser, log in and navigate to `/billing`, `/billing/catalog`, `/billing/settings`, `/billing/reports`, and `/billing/new`. On each, take a snapshot and confirm the page renders (no blank page / bootstrap crash) and there are no console errors.

Expected: each billing route renders its heading and controls; console is clean. (Per project memory: `ng build` + unit tests do not catch bootstrap crashes — this browser check is required before sign-off.)

- [ ] **Step 5: Commit**

```bash
git add src/app/app.routes.ts src/app/app.ts
git commit -m "feat(billing): wire routes + nav link"
```

---

## Self-Review Notes

- **Spec coverage:** catalog (Tasks 4–5), invoices + optional appointment link + discount + tax snapshot (Tasks 7, 9), multiple payments + refunds (Tasks 7, 10), derived view/status (Task 1, 3), reports — invoice list+filters (8), daily close + period revenue + outstanding (11), on-screen/print receipt (10), settings currency+tax (6), roles = uniform tenant RLS (Task 1). All spec sections map to a task.
- **Out of scope (unbuilt, per spec):** PDF, per-line tax/discount, multi-currency conversion, insurance, accrual A/R aging, admin-only gating.
- **Type consistency:** `computeTotals` signature identical in Task 3 (definition) and Tasks 9/10 (use). `toInvoiceBalance`, `toInvoice`, `toPayment`, `InvoiceListRow`, `OutstandingRow` names consistent across store/component tasks. Store method names (`create`, `addPayment`, `void`, `loadOne`, `setStatus`, `setDateRange`) match between Task 7 definition and Tasks 8–10 usage.
- **Appointment link:** schema + write mapper support `appointment_id`; the v1 form passes `null` (a follow-up can add an appointment picker). Documented, not a gap.
- **Shared test-fake edit:** `src/testing/fake-supabase.ts` gains `lte` + `maybeSingle`/`single` once, in Task 6 Step 4. Tasks 7 and 11 rely on it; no other task edits that file.
- **Rounding parity:** `computeTotals` (TS) and the `invoice_balances` view (SQL) apply the same order of operations — discount rounded, then tax rounded on `subtotal - discount`, then `total = subtotal - discount + tax`. Task 3's tests pin this; a change to one must change the other.
```
