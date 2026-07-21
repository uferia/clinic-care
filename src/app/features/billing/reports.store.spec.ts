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
});
