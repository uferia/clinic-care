# Cash-Basis Billing — Design

**Status:** Approved (2026-07-19)
**Scope:** First billing slice for the multi-tenant clinic app. Service catalog + invoices + payments, cash basis (income recognized when money received).

## Goals

- Let a clinic maintain a reusable price list (service catalog).
- Build an invoice for a patient (optionally tied to one appointment), with line items, an invoice-level discount, and a clinic tax rate.
- Record one or more cash payments against an invoice; support partial payments and refunds.
- Derive invoice totals and payment status — no denormalized/stored totals.
- Provide operational reports: invoice list with filters, daily cash close, revenue by period, outstanding balances.
- View/print receipts on screen (no PDF pipeline in v1).

## Non-Goals (explicitly out of v1)

- PDF receipt/invoice generation.
- Per-line tax or per-line discount (invoice-level only).
- Multi-currency conversion (single currency per clinic).
- Insurance / claims / third-party payers.
- Accrual accounting and A/R aging (outstanding-balances view is operational only, not cash-basis income).
- Role-based permission gating (admin-only settings) — deferred; needs a new role helper. v1 keeps the uniform `for all` tenant policy so both `staff` and `clinic_admin` manage everything.

## Decisions

| Topic | Decision |
|-------|----------|
| Scope | Full: catalog + invoice + payment |
| Invoice ↔ appointment | Invoice belongs to a patient; optional reference to one appointment |
| Payments | Multiple per invoice (partial/paid); refunds supported |
| Payment method | Cash only — no method field in v1 |
| Discount | Invoice-level, amount or percent, applied before tax |
| Tax | Single clinic tax rate, snapshotted onto each invoice at creation |
| Receipts | On-screen / browser print only |
| Reports | Invoice list + filters, daily cash close, revenue by period, outstanding balances |
| Totals/status | Derived via Postgres view (Approach A) — items + payments are the source of truth |
| Currency | Single per clinic, stored in `billing_settings`, no conversion |
| Roles | Uniform `for all` tenant RLS (both roles); admin-only settings deferred |

## Data Model

New migration: `supabase/migrations/0007_billing.sql`. Follows existing conventions: `clinic_id` on every table, `set_clinic_id` before-insert trigger, `for all` tenant RLS using `current_clinic_id()` and `current_clinic_active()`, grants to `authenticated`.

### `billing_settings` (1 row per clinic)

```
clinic_id   uuid primary key references clinics on delete cascade
currency    text not null default 'PHP'
tax_rate    numeric(5,2) not null default 0     -- percent, e.g. 12.00
tax_label   text not null default 'Tax'
updated_at  timestamptz not null default now()
updated_by  uuid references auth.users on delete set null
```

Row is lazily created (upsert) the first time settings are saved; reads tolerate absence (defaults: rate 0, currency 'PHP').

### `services` (catalog / price list)

```
id          uuid primary key default gen_random_uuid()
clinic_id   uuid not null references clinics on delete cascade
name        text not null
description text
price       numeric(12,2) not null default 0
active      boolean not null default true
created_at  timestamptz not null default now()
```

Index: `services_clinic_id_idx`.

### `invoices`

```
id             uuid primary key default gen_random_uuid()
clinic_id      uuid not null references clinics on delete cascade
patient_id     uuid not null references patients on delete restrict
appointment_id uuid references appointments on delete set null   -- optional
number         text                                              -- assigned by trigger, e.g. INV-000123
issue_date     date not null default current_date
discount_type  text check (discount_type in ('amount','percent'))
discount_value numeric(12,2) not null default 0
tax_rate       numeric(5,2) not null default 0                   -- snapshot of clinic rate at creation
notes          text
voided         boolean not null default false
created_by     uuid references auth.users on delete set null
created_at     timestamptz not null default now()
```

Indexes: `invoices_clinic_id_idx`, `invoices_patient_id_idx`.
`patient_id` uses `on delete restrict` — a patient with invoices cannot be silently removed.

### `invoice_items`

```
id          uuid primary key default gen_random_uuid()
clinic_id   uuid not null references clinics on delete cascade
invoice_id  uuid not null references invoices on delete cascade
service_id  uuid references services on delete set null   -- snapshot origin only
description text not null                                  -- copied from service or free-text
unit_price  numeric(12,2) not null
quantity    numeric(12,2) not null default 1
```

Line total is derived (`unit_price * quantity`), never stored. Index: `invoice_items_invoice_id_idx`.

### `payments`

```
id         uuid primary key default gen_random_uuid()
clinic_id  uuid not null references clinics on delete cascade
invoice_id uuid not null references invoices on delete cascade
kind       text not null default 'payment' check (kind in ('payment','refund'))
amount     numeric(12,2) not null check (amount > 0)   -- always positive; sign comes from kind
paid_at    timestamptz not null default now()          -- the cash-basis date (money received)
note       text
created_by uuid references auth.users on delete set null
created_at timestamptz not null default now()
```

Index: `payments_invoice_id_idx`, `payments_clinic_paid_at_idx` (for daily/period reports).

### `billing_counters` (per-clinic invoice sequence)

```
clinic_id       uuid primary key references clinics on delete cascade
next_invoice_no integer not null default 1
```

A before-insert trigger on `invoices` upserts/reads this row, formats `number` as `INV-` + zero-padded (`format('INV-%s', lpad(n::text, 6, '0'))`), and increments. Runs `security definer` so RLS on the counter doesn't block. Concurrency: `insert ... on conflict do update ... returning` provides row-level locking of the counter.

### View `invoice_balances`

```
create view public.invoice_balances with (security_invoker = true) as
  select
    i.id, i.clinic_id, i.patient_id, i.appointment_id, i.number,
    i.issue_date, i.voided, i.discount_type, i.discount_value, i.tax_rate,
    coalesce(it.subtotal, 0)                                    as subtotal,
    case i.discount_type
      when 'amount'  then least(i.discount_value, coalesce(it.subtotal,0))
      when 'percent' then round(coalesce(it.subtotal,0) * i.discount_value / 100, 2)
      else 0
    end                                                          as discount,
    -- taxable_base = subtotal - discount
    -- tax = round(taxable_base * tax_rate / 100, 2)
    -- total = taxable_base + tax
    coalesce(p.net_paid, 0)                                      as paid,
    -- balance = total - paid
    -- status derived below
  from public.invoices i
  left join (select invoice_id, sum(unit_price * quantity) subtotal
             from public.invoice_items group by invoice_id) it on it.invoice_id = i.id
  left join (select invoice_id,
                    sum(case when kind='payment' then amount else -amount end) net_paid
             from public.payments group by invoice_id) p on p.invoice_id = i.id;
```

`status` = `void` when `voided`; else `unpaid` when `paid <= 0`; `paid` when `paid >= total`; else `partial`. (Final SQL expresses `discount`, `tax`, `total`, `balance`, `status` fully; the block above shows the shape.)

`security_invoker = true` (Postgres 15+/Supabase) makes the view run under the querying user's RLS, so base-table tenant policies enforce isolation — no separate policy on the view.

## Frontend

New feature folder `src/app/features/billing/`, matching the model + store + component + snake→camel mapper pattern used by patients/appointments.

- **`billing.model.ts`** — domain types `Service`, `Invoice`, `InvoiceItem`, `Payment`, `InvoiceBalance`, `BillingSettings`; status/enum consts (`PAYMENT_KINDS`, `DISCOUNT_TYPES`, invoice status union); mappers to/from row types. Row shapes (`ServiceRow`, `InvoiceRow`, `InvoiceItemRow`, `PaymentRow`, `InvoiceBalanceRow`, `BillingSettingsRow`) added to `src/app/core/db.types.ts`.
- **Catalog** — `service.store.ts`, `service-list.component.ts` with an inline add/edit form. CRUD over `services`.
- **Invoices**
  - `invoice.store.ts` — list (from `invoice_balances` embedding patient name), load one with items + payments, create invoice + items, add payment/refund, void.
  - `invoice-list.component.ts` — table with filters (status, date range, patient) + totals; links to detail.
  - `invoice-form.component.ts` — select patient, optional appointment, add line items (pick from active catalog or free-text with price/qty), set invoice-level discount; snapshots current clinic `tax_rate` on create.
  - `invoice-detail.component.ts` — header, line items, computed subtotal/discount/tax/total, payments list, record-payment and record-refund dialogs, void action, browser print (print-friendly CSS).
- **Reports** — `reports.store.ts` + `billing-reports.component.ts`:
  - Daily cash close — payments for a chosen day grouped by `kind`, net total (query `payments` by `paid_at::date`).
  - Revenue by period — net collected (`payment - refund`) over a date range.
  - Outstanding balances — invoices where `status in ('unpaid','partial')` from `invoice_balances`, with per-patient owed amounts.
- **Settings** — `billing-settings.component.ts` — edit currency + tax rate (upsert `billing_settings`).
- **Routing** — routes under `/billing`: list, `new`, `:id` (detail), `catalog`, `reports`, `settings`. Guarded by existing auth/access guards.
- Money rendered with Angular `currency` pipe using the clinic's `currency`.

## Error Handling

- Stores expose an `error` signal and reuse `src/app/core/form-errors.ts` for surfacing failures.
- CORS-safe error path mirroring the recent patients fix (don't assume a JSON body on non-2xx).
- Void is preferred over hard delete for issued invoices (audit trail). Hard delete allowed only when an invoice has no payments; cascade removes its items.

## Testing

- vitest mapper specs for `billing.model.ts` (row ↔ domain round-trips, discount/tax edge cases where computed client-side for the form preview).
- Store specs against `src/testing/fake-supabase.ts` (create invoice + items, add payment moves status partial→paid, refund, void).
- Verify `/billing` routes render in a running app via Playwright before sign-off (per project memory — build/test miss bootstrap crashes).

## Build Order (for the implementation plan)

1. Migration `0007_billing.sql` (tables, triggers, view, RLS, grants) + seed a couple of demo services.
2. `db.types.ts` row types + `billing.model.ts` + mappers (+ specs).
3. Service catalog store + component.
4. Billing settings store + component.
5. Invoice store + list + form.
6. Invoice detail + payment/refund dialogs + void + print.
7. Reports store + component.
8. Routes wired; Playwright render check.
