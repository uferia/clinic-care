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
  created_at     timestamptz not null default now(),
  constraint invoices_discount_value_nonneg check (discount_value >= 0),
  constraint invoices_discount_percent_bounded
    check (discount_type <> 'percent' or discount_value <= 100)
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

-- Payments are the cash-basis record; an invoice with payments must be voided, never deleted
-- (payments.invoice_id is on delete cascade, and authenticated can delete invoices under the
-- tenant policy below, so without this guard a hard delete silently destroys cash-received rows).
create or replace function public.invoices_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.payments where invoice_id = old.id) then
    raise exception 'cannot delete invoice %: it has payment records; void it instead', old.id;
  end if;
  return old;
end;
$$;

create trigger invoices_before_delete_trg
  before delete on public.invoices
  for each row execute function public.invoices_before_delete();

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
-- payments is the cash-basis record: intentionally NOT update/delete. Nothing
-- in the app updates or deletes a payment row (void is the sanctioned
-- reversal — verified by grep across src/app/features/billing), and
-- `invoices_before_delete_trg` above only protects the *invoice* row from a
-- hard delete when it has payments. Without this restriction, `DELETE
-- /payments?invoice_id=eq.X` followed by deleting the invoice would bypass
-- that trigger entirely, and `update` would let `amount`/`paid_at` be
-- rewritten after the fact with no audit trail. select+insert is everything
-- the app needs (list/detail/reports read; record payment/refund inserts).
grant select, insert on public.payments to authenticated;
grant select on public.invoice_balances to authenticated;
