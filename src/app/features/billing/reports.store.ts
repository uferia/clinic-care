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
  // timezone. `.toISOString()` then turns that local instant into an
  // unambiguous UTC timestamp that Postgres interprets correctly
  // regardless of session TZ.
  private static dayBounds(day: string): { start: string; end: string } {
    return {
      start: new Date(`${day}T00:00:00`).toISOString(),
      end: new Date(`${day}T23:59:59.999`).toISOString(),
    };
  }

  // Day close: payments whose paid_at falls on the selected local day.
  private dayResource = resource({
    params: () => ({ day: this._day() }),
    loader: async ({ params }) => {
      const { start, end } = ReportsStore.dayBounds(params.day);
      const { data, error } = await this.supabase
        .from('payments').select('*').gte('paid_at', start).lte('paid_at', end);
      if (error) throw error;
      return (data ?? []).map(toPayment);
    },
  });

  // Period revenue: net payments across [from, to] (same local-day boundary
  // reasoning as dayBounds above — start of `from`'s local day through the
  // end of `to`'s local day).
  private periodResource = resource({
    params: () => ({ from: this._from(), to: this._to() }),
    loader: async ({ params }) => {
      const { start } = ReportsStore.dayBounds(params.from);
      const { end } = ReportsStore.dayBounds(params.to);
      const { data, error } = await this.supabase
        .from('payments').select('*').gte('paid_at', start).lte('paid_at', end);
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
  dayPayments = computed<Payment[]>(() =>
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
