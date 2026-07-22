import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { toIsoDate } from '../../core/date.util';
import { Payment, toPayment } from './billing.model';

export interface OutstandingRow { id: string; number: string; patientName: string; balance: number; }

/** A day-close payment carrying the invoice number an accountant reconciles against. */
export interface DayPayment extends Payment { invoiceNumber: string; }

@Service()
export class ReportsStore {
  private supabase = inject(SUPABASE);

  // Local calendar day, via `toIsoDate` — NOT `toISOString().slice(0, 10)`,
  // which resolves the day in UTC. East of Greenwich that returns yesterday
  // for the whole local morning (UTC+8: midnight to 08:00), so the reports
  // would open on the wrong day's cash close.
  private _day = signal<string>(toIsoDate(new Date()));
  private _from = signal<string>(toIsoDate(new Date()));
  private _to = signal<string>(toIsoDate(new Date()));

  setDay(iso: string) { this._day.set(iso); }
  setRange(from: string, to: string) { this._from.set(from); this._to.set(to); }

  // `paid_at` is `timestamptz`. A date-time string with no offset
  // (e.g. "2026-07-19T00:00:00") is parsed by Postgres/PostgREST in the DB
  // session's timezone — UTC by default for a Supabase project — NOT
  // wherever the clinic physically is. Sending that naive string straight
  // through would misfile the boundary: a clinic ahead of UTC (e.g. PHT,
  // UTC+8) would have its local 00:00-08:00 window counted under the
  // *previous* UTC day, and a clinic behind UTC would have late-evening
  // payments spill into the *next* UTC day's close — precisely the
  // "payment near midnight lands in the wrong day" failure a cash close
  // must not have.
  //
  // Fix: build the boundary via `new Date(...)`. For a date-time string
  // with no offset, JS parses it as *local* time — local to whatever
  // machine is running this code. This is a browser-only SPA with no SSR
  // target (see tsconfig.app.json / angular.json — no
  // `@angular/platform-server` build), run on-site by clinic staff, so the
  // browser's local timezone is a reasonable stand-in for the clinic's
  // timezone (known limitation: there is no clinic-timezone column in the
  // schema, so this breaks if clinic staff ever run this from a machine in
  // a different timezone than the clinic). `.toISOString()` then turns
  // that local instant into an unambiguous UTC timestamp that Postgres
  // interprets correctly regardless of session TZ.
  //
  // The range is HALF-OPEN: [start of day, start of the FOLLOWING day).
  // `payments.paid_at` is `timestamptz` with microsecond precision and
  // defaults to `now()` (see supabase/migrations/0007_billing.sql) — an
  // inclusive `<= 23:59:59.999` upper bound only excludes microseconds
  // *above* `.999000`. A payment recorded at, say, 23:59:59.999742 local
  // time would fail that day's upper bound AND the next day's `>=
  // 00:00:00.000` lower bound, vanishing from every report rather than
  // merely landing on the wrong day. `.lt('paid_at', nextStart)` has no
  // such gap.
  //
  // `nextStart` is computed via the DATE COMPONENT (`d + 1`), not by adding
  // 86_400_000 ms: the local-time `Date` constructor normalizes an
  // out-of-range day (e.g. day 32 of a 31-day month, or Dec 32) into the
  // correct following month/year, and it correctly accounts for a DST
  // transition landing on this particular day — a flat 24h millisecond
  // offset would land an hour off across a DST spring-forward/fall-back
  // boundary.
  private static dayBounds(day: string): { start: string; nextStart: string } {
    const [y, m, d] = day.split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const nextStart = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    return { start: start.toISOString(), nextStart: nextStart.toISOString() };
  }

  // Day close: payments whose paid_at falls on the selected local day.
  private dayResource = resource({
    params: () => ({ day: this._day() }),
    loader: async ({ params }) => {
      const { start, nextStart } = ReportsStore.dayBounds(params.day);
      // The invoice number is embedded for the CSV export; the on-screen figures
      // ignore it. Reconciling a bank deposit against payment UUIDs is useless.
      const { data, error } = await this.supabase
        .from('payments').select('*, invoices(number)').gte('paid_at', start).lt('paid_at', nextStart);
      if (error) throw error;
      return (data ?? []).map((r: any): DayPayment => ({
        ...toPayment(r),
        invoiceNumber: (Array.isArray(r.invoices) ? r.invoices[0]?.number : r.invoices?.number) ?? '',
      }));
    },
  });

  // Period revenue: net payments across [from, to] (same local-day boundary
  // reasoning as dayBounds above — start of `from`'s local day through the
  // start of the day AFTER `to`'s local day, half-open).
  private periodResource = resource({
    params: () => ({ from: this._from(), to: this._to() }),
    loader: async ({ params }) => {
      const { start } = ReportsStore.dayBounds(params.from);
      const { nextStart } = ReportsStore.dayBounds(params.to);
      const { data, error } = await this.supabase
        .from('payments').select('*').gte('paid_at', start).lt('paid_at', nextStart);
      if (error) throw error;
      return (data ?? []).map(toPayment);
    },
  });

  // Outstanding: unpaid/partial invoices with patient name resolved via FK embed.
  // This is the one operational, non-cash-basis view in this store.
  private outstandingResource = resource({
    params: () => ({}),
    loader: async () => {
      const { data, error } = await this.supabase
        .from('invoice_balances')
        .select('id, number, balance, status, patient:patients(first_name, last_name)')
        .in('status', ['unpaid', 'partial'])
        .gt('balance', 0);
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

  // `resource().value()` throws `ResourceValueError` once a resource settles
  // into the 'error' state (verified in @angular/core's ResourceImpl —
  // see InvoiceStore.invoices()/BillingSettingsStore.settings() for the
  // same note in this feature). `.value() ?? fallback` does NOT protect
  // against that: the throw happens evaluating `.value()` itself, before
  // `??` ever gets a chance to run. Every computed below gates its read
  // through `hasValue()` instead, which short-circuits on the error state
  // before ever touching `.value()`. With three independent resources in
  // this store, a failure in one (e.g. outstandingResource) must not take
  // down the computeds that depend on the other two.
  dayPayments = computed<DayPayment[]>(() =>
    this.dayResource.hasValue() ? this.dayResource.value() : []);
  dayNet = computed(() => this.net(this.dayPayments()));
  // `dayPayments().length` conflates payments and refunds into one count —
  // reported next to a NET figure, "N payment(s)" that actually includes
  // refunds would misrepresent what happened that day. Split them.
  dayPaymentCount = computed(() => this.dayPayments().filter(p => p.kind === 'payment').length);
  dayRefundCount = computed(() => this.dayPayments().filter(p => p.kind === 'refund').length);

  periodNet = computed(() =>
    this.net(this.periodResource.hasValue() ? this.periodResource.value() : []));

  outstanding = computed<OutstandingRow[]>(() =>
    this.outstandingResource.hasValue() ? this.outstandingResource.value() : []);
  outstandingTotal = computed(() => this.outstanding().reduce((s, o) => s + o.balance, 0));

  readonly isLoading = computed(() =>
    this.dayResource.isLoading() || this.periodResource.isLoading() || this.outstandingResource.isLoading());
  // `.error()` is a plain signal read of the resource's current error state —
  // unlike `.value()` it never throws, so this aggregate OR is safe as written
  // regardless of which of the three resources (if any) is in the error state.
  readonly error = computed(() =>
    this.dayResource.error() || this.periodResource.error() || this.outstandingResource.error());

  reload() {
    this.dayResource.reload();
    this.periodResource.reload();
    this.outstandingResource.reload();
  }
}
