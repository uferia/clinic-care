import { TestBed } from '@angular/core/testing';
import { ServiceStore } from './service.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect, fakeSupabaseMutate } from '../../../testing/fake-supabase';
import { CreateServiceDto } from './billing.model';

const rows = [
  { id: 's1', clinic_id: 'c1', name: 'Consultation', description: '', price: '500.00', active: true, created_at: '2026-07-19T00:00:00Z' },
];

const mixedRows = [
  { id: 's1', clinic_id: 'c1', name: 'Consultation', description: '', price: '500.00', active: true, created_at: '2026-07-19T00:00:00Z' },
  { id: 's2', clinic_id: 'c1', name: 'Old service', description: '', price: '100.00', active: false, created_at: '2026-07-19T00:00:00Z' },
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
    expect(client.recorded.filters).toContainEqual({ method: 'order', args: ['name', { ascending: true }] });
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs.some(f => f.args[0] === 'active')).toBe(false);
  });

  it('applies active-only filter', async () => {
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    store.setActiveOnly(true);
    await new Promise(r => setTimeout(r));
    const eqs = client.recorded.filters.filter(f => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['active', true] });
  });

  it('activeServices() returns only active rows from a mixed set', async () => {
    const client = fakeSupabaseSelect(mixedRows, mixedRows.length);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(store.services().length).toBe(2);
    expect(store.activeServices().map(s => s.id)).toEqual(['s1']);
    expect(store.activeServices().every(s => s.active)).toBe(true);
  });

  it('add(dto) inserts into services without a client-supplied clinic_id', async () => {
    const client = fakeSupabaseMutate([]);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const dto: CreateServiceDto = { name: 'X-ray', description: 'Chest', price: 250, active: true };
    await store.add(dto);

    expect(client.recorded.mutations.length).toBe(1);
    const mutation = client.recorded.mutations[0];
    expect(mutation.table).toBe('services');
    expect(mutation.operation).toBe('insert');
    expect(mutation.payload).toEqual({ name: 'X-ray', description: 'Chest', price: 250, active: true });
    expect(Object.keys(mutation.payload as object)).not.toContain('clinic_id');
  });

  it('update(id, dto) updates services filtered by id, without a client-supplied clinic_id', async () => {
    const client = fakeSupabaseMutate([]);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const dto: CreateServiceDto = { name: 'X-ray', description: 'Chest', price: 300, active: false };
    await store.update('s1', dto);

    expect(client.recorded.mutations.length).toBe(1);
    const mutation = client.recorded.mutations[0];
    expect(mutation.table).toBe('services');
    expect(mutation.operation).toBe('update');
    expect(mutation.payload).toEqual({ name: 'X-ray', description: 'Chest', price: 300, active: false });
    expect(Object.keys(mutation.payload as object)).not.toContain('clinic_id');
    expect(mutation.filters).toContainEqual({ method: 'eq', args: ['id', 's1'] });
  });

  it('remove(id) deletes from services filtered by id', async () => {
    const client = fakeSupabaseMutate([]);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    await store.remove('s1');

    expect(client.recorded.mutations.length).toBe(1);
    const mutation = client.recorded.mutations[0];
    expect(mutation.table).toBe('services');
    expect(mutation.operation).toBe('delete');
    expect(mutation.filters).toContainEqual({ method: 'eq', args: ['id', 's1'] });
  });
});
