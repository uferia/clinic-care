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

  it('counts payments and refunds separately rather than lumping them into one figure', async () => {
    const rows = [
      { id: 'a', clinic_id: 'c1', invoice_id: 'i1', kind: 'payment', amount: '100', paid_at: '2026-07-19T09:00:00Z', note: null, created_by: null, created_at: 'x' },
      { id: 'b', clinic_id: 'c1', invoice_id: 'i1', kind: 'refund', amount: '30', paid_at: '2026-07-19T10:00:00Z', note: null, created_by: null, created_at: 'x' },
      { id: 'c', clinic_id: 'c1', invoice_id: 'i2', kind: 'payment', amount: '50', paid_at: '2026-07-19T11:00:00Z', note: null, created_by: null, created_at: 'x' },
    ];
    const client = fakeSupabaseSelect(rows, 3);
    const store = setup(client);
    store.setDay('2026-07-19');
    await new Promise(r => setTimeout(r));
    expect(store.dayPaymentCount()).toBe(2);
    expect(store.dayRefundCount()).toBe(1);
    // The raw row count must not be reported as "payments" — that would
    // silently count a refund as a payment.
    expect(store.dayPayments().length).toBe(3);
  });

  it('nets period revenue across a date range', async () => {
    const rows = [
      { id: 'a', clinic_id: 'c1', invoice_id: 'i1', kind: 'payment', amount: '200', paid_at: '2026-07-01T09:00:00Z', note: null, created_by: null, created_at: 'x' },
      { id: 'b', clinic_id: 'c1', invoice_id: 'i1', kind: 'payment', amount: '150', paid_at: '2026-07-15T09:00:00Z', note: null, created_by: null, created_at: 'x' },
      { id: 'c', clinic_id: 'c1', invoice_id: 'i2', kind: 'refund', amount: '50', paid_at: '2026-07-20T09:00:00Z', note: null, created_by: null, created_at: 'x' },
    ];
    const client = fakeSupabaseSelect(rows, 3);
    const store = setup(client);
    store.setRange('2026-07-01', '2026-07-31');
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('payments');
    expect(store.periodNet()).toBe(300);
  });

  it('maps outstanding invoice_balances rows with resolved patient name and a total that agrees with the rows', async () => {
    const rows = [
      { id: 'inv1', number: 'INV-0001', balance: '120.50', status: 'partial', patient: { first_name: 'Ana', last_name: 'Cruz' } },
      { id: 'inv2', number: 'INV-0002', balance: '80', status: 'unpaid', patient: { first_name: 'Ben', last_name: 'Reyes' } },
    ];
    const client = fakeSupabaseSelect(rows, 2);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(store.outstanding()).toEqual([
      { id: 'inv1', number: 'INV-0001', patientName: 'Ana Cruz', balance: 120.5 },
      { id: 'inv2', number: 'INV-0002', patientName: 'Ben Reyes', balance: 80 },
    ]);
    expect(store.outstandingTotal()).toBe(200.5);
  });

  it('does not throw and reports zeroed figures when a resource errors', async () => {
    const client = fakeSupabaseSelect([], 0, { message: 'boom' });
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(store.error()).toBeTruthy();
    expect(() => store.dayNet()).not.toThrow();
    expect(() => store.periodNet()).not.toThrow();
    expect(() => store.outstanding()).not.toThrow();
    expect(store.dayNet()).toBe(0);
    expect(store.outstanding()).toEqual([]);
  });

  // These pin the half-open date-boundary logic itself (gte/lt filter
  // arguments actually sent to Supabase), not just the netted totals — the
  // existing specs above only assert `client.from` was called with
  // 'payments' and would keep passing even if the boundary math regressed
  // back to the inclusive `.lte(..., '23:59:59.999')` form (which drops any
  // payment whose paid_at microseconds exceed .999000 from every report).
  //
  // Expected values are computed independently here via `new Date(y, m, d)`
  // component construction — the SAME conversion the store's private
  // `dayBounds` uses (local calendar day -> UTC instant) — but without
  // calling that helper itself, so a regression in the store's logic can't
  // silently satisfy its own test. Because both the store and this spec
  // resolve "local time" via the machine actually running the code, these
  // assertions hold whether the suite runs in UTC (CI) or UTC+8 (a
  // developer machine) or anywhere else.
  describe('date boundaries (half-open range)', () => {
    it('single day: gte is local start-of-day, lt is local start of the FOLLOWING day', async () => {
      const client = fakeSupabaseSelect([], 0);
      const store = setup(client);
      store.setDay('2026-07-19');
      await new Promise(r => setTimeout(r));

      const expectedStart = new Date(2026, 6, 19, 0, 0, 0, 0).toISOString();
      const expectedNextStart = new Date(2026, 6, 20, 0, 0, 0, 0).toISOString();

      expect(client.recorded.filters).toContainEqual({ method: 'gte', args: ['paid_at', expectedStart] });
      expect(client.recorded.filters).toContainEqual({ method: 'lt', args: ['paid_at', expectedNextStart] });

      // Pin the RELATIONSHIP, not just the two literals: the upper bound
      // must be exactly one calendar day after the lower bound.
      expect(new Date(expectedNextStart).getTime() - new Date(expectedStart).getTime())
        .toBe(24 * 60 * 60 * 1000);
    });

    it('never uses lte for the payments upper bound (regression guard against the inclusive .999 form)', async () => {
      const client = fakeSupabaseSelect([], 0);
      const store = setup(client);
      store.setDay('2026-07-19');
      await new Promise(r => setTimeout(r));

      const paidAtFilters = client.recorded.filters.filter(f => f.args[0] === 'paid_at');
      expect(paidAtFilters.some(f => f.method === 'lte')).toBe(false);
      expect(paidAtFilters.some(f => f.method === 'lt')).toBe(true);
    });

    it('year-end rollover: Dec 31 next-day bound lands on Jan 1 of the FOLLOWING year, not an invalid date', async () => {
      const client = fakeSupabaseSelect([], 0);
      const store = setup(client);
      store.setDay('2026-12-31');
      await new Promise(r => setTimeout(r));

      const expectedStart = new Date(2026, 11, 31, 0, 0, 0, 0).toISOString();
      // Built the same way the store builds it: day-component `31 + 1 = 32`
      // on a month indexed to December — `Date` normalizes that into
      // January 1 of the next year rather than producing an invalid date
      // or wrapping within December.
      const expectedNextStart = new Date(2026, 11, 32, 0, 0, 0, 0).toISOString();

      expect(client.recorded.filters).toContainEqual({ method: 'gte', args: ['paid_at', expectedStart] });
      expect(client.recorded.filters).toContainEqual({ method: 'lt', args: ['paid_at', expectedNextStart] });

      const nextStartLocal = new Date(expectedNextStart);
      expect(nextStartLocal.getFullYear()).toBe(2027);
      expect(nextStartLocal.getMonth()).toBe(0); // January
      expect(nextStartLocal.getDate()).toBe(1);
    });

    it('period report: gte comes from `from`, lt comes from the day AFTER `to` (half-open across the whole range, including a month rollover)', async () => {
      const client = fakeSupabaseSelect([], 0);
      const store = setup(client);
      store.setRange('2026-07-01', '2026-07-31');
      await new Promise(r => setTimeout(r));

      const expectedStart = new Date(2026, 6, 1, 0, 0, 0, 0).toISOString();
      // Day after July 31 => August 1, via the same day-component add.
      const expectedNextStart = new Date(2026, 6, 32, 0, 0, 0, 0).toISOString();

      expect(client.recorded.filters).toContainEqual({ method: 'gte', args: ['paid_at', expectedStart] });
      expect(client.recorded.filters).toContainEqual({ method: 'lt', args: ['paid_at', expectedNextStart] });

      const nextStartLocal = new Date(expectedNextStart);
      expect(nextStartLocal.getMonth()).toBe(7); // August (0-indexed)
      expect(nextStartLocal.getDate()).toBe(1);
    });
  });
});
