import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AppointmentCalendarStore } from './appointment-calendar.store';
import { SUPABASE } from '../../core/supabase.client';
import { toIsoDate } from '../../core/date.util';

/** Captures the date range the store asked for, and replays fixed rows. */
function makeClient(rows: unknown[] = []) {
  const asked = { from: '', to: '' };
  const client = {
    auth: {},
    from: vi.fn(() => {
      const q: any = {
        select: () => q,
        gte: (_c: string, v: string) => { asked.from = v; return q; },
        lte: (_c: string, v: string) => { asked.to = v; return q; },
        order: () => q,
        then: (resolve: (r: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return q;
    }),
  };
  return { client, asked };
}

function row(date: string, time: string, over: Record<string, unknown> = {}) {
  return {
    id: `${date}-${time}`, clinic_id: 'c1', patient_id: 'p1', doctor_id: 'd1',
    date, time, reason: '', status: 'pending',
    patient: { first_name: 'Maria', last_name: 'Santos' },
    doctor: { name: 'Dr. Cruz' },
    ...over,
  };
}

async function setup(rows: unknown[] = []) {
  const { client, asked } = makeClient(rows);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  const store = TestBed.inject(AppointmentCalendarStore);
  await new Promise(r => setTimeout(r));
  return { store, asked };
}

describe('AppointmentCalendarStore', () => {
  it('always renders six whole weeks, so the grid height never jumps', async () => {
    const { store } = await setup();
    expect(store.days().length).toBe(42);
    expect(store.days()[0].date.getDay()).toBe(0);
  });

  it('fetches the whole visible span, not just the month', async () => {
    const { store, asked } = await setup();
    const days = store.days();
    expect(asked.from).toBe(days[0].iso);
    expect(asked.to).toBe(days[41].iso);
  });

  it('marks leading and trailing days as outside the month', async () => {
    const { store } = await setup();
    store.setMonth(new Date(2026, 6, 15)); // July 2026 starts on a Wednesday
    await new Promise(r => setTimeout(r));
    const days = store.days();
    expect(days[0].inMonth).toBe(false);
    expect(days.filter(d => d.inMonth).length).toBe(31);
  });

  it('buckets appointments onto their own day', async () => {
    const { store } = await setup([row('2026-07-15', '09:00'), row('2026-07-15', '10:30'), row('2026-07-20', '08:00')]);
    store.setMonth(new Date(2026, 6, 1));
    await new Promise(r => setTimeout(r));
    const byIso = new Map(store.days().map(d => [d.iso, d]));
    expect(byIso.get('2026-07-15')!.appointments.map(a => a.time)).toEqual(['09:00', '10:30']);
    expect(byIso.get('2026-07-20')!.appointments.length).toBe(1);
    expect(byIso.get('2026-07-16')!.appointments).toEqual([]);
  });

  it('resolves patient and doctor names for the chips', async () => {
    const { store } = await setup([row('2026-07-15', '09:00')]);
    store.setMonth(new Date(2026, 6, 1));
    await new Promise(r => setTimeout(r));
    const a = store.days().find(d => d.iso === '2026-07-15')!.appointments[0];
    expect(a.patientName).toBe('Maria Santos');
    expect(a.doctorName).toBe('Dr. Cruz');
  });

  it('counts only appointments inside the month, not the spill days', async () => {
    // 2026-06-30 falls in July's leading week; it must not be counted for July.
    const { store } = await setup([row('2026-06-30', '09:00'), row('2026-07-15', '09:00')]);
    store.setMonth(new Date(2026, 6, 1));
    await new Promise(r => setTimeout(r));
    expect(store.monthTotal()).toBe(1);
  });

  it('steps between months and back to today', async () => {
    const { store } = await setup();
    store.setMonth(new Date(2026, 11, 10));
    store.next();
    expect(store.month().getFullYear()).toBe(2027);
    expect(store.month().getMonth()).toBe(0);
    store.previous();
    expect(store.month().getMonth()).toBe(11);
    store.today();
    expect(toIsoDate(store.month())).toBe(toIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  });
});
