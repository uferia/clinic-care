import { TestBed } from '@angular/core/testing';
import { InvoiceStore } from './invoice.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect, fakeSupabaseMutate } from '../../../testing/fake-supabase';
import { CreateInvoiceDto, CreateInvoiceItemDto, CreatePaymentDto } from './billing.model';

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

  it('loadOne(id) fetches the invoice, its items, and its payments', async () => {
    // fakeSupabaseSelect serves one shared row array to every `.from()` call
    // on a client instance, so this fixture carries fields for all three
    // mappers (invoice, item, payment) to keep each assertion meaningful
    // rather than asserting on NaN/undefined fields from a mismatched shape.
    const combinedRow = {
      id: 'i1', clinic_id: 'c1', patient_id: 'p1', appointment_id: null,
      number: 'INV-000001', issue_date: '2026-07-19', discount_type: null,
      discount_value: '0', tax_rate: '12', notes: null, voided: false,
      created_at: '2026-07-19T00:00:00Z',
      invoice_id: 'i1', service_id: 's1', description: 'Consult',
      unit_price: '500', quantity: '2',
      kind: 'payment', amount: '500', paid_at: '2026-07-19T00:00:00Z',
    };
    const client = fakeSupabaseSelect([combinedRow], 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const result = await store.loadOne('i1');

    expect(client.from).toHaveBeenCalledWith('invoices');
    expect(client.from).toHaveBeenCalledWith('invoice_items');
    expect(client.from).toHaveBeenCalledWith('payments');
    expect(result?.invoice.id).toBe('i1');
    expect(result?.items[0].unitPrice).toBe(500);
    expect(result?.items[0].quantity).toBe(2);
    expect(result?.payments[0].amount).toBe(500);
    expect(result?.payments[0].kind).toBe('payment');
  });

  it('loadOne(id) returns null when the invoice does not exist', async () => {
    const client = fakeSupabaseSelect([], 0);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const result = await store.loadOne('missing');
    expect(result).toBeNull();
  });

  it('create(dto, items) inserts the invoice then its line items, without a client-supplied clinic_id or number', async () => {
    const client = fakeSupabaseMutate([], { data: { id: 'new-inv' }, error: null });
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const dto: CreateInvoiceDto = {
      patientId: 'p1', appointmentId: null, issueDate: '2026-07-19',
      discountType: null, discountValue: 0, taxRate: 12, notes: '',
    };
    const items: CreateInvoiceItemDto[] = [
      { serviceId: 's1', description: 'Consult', unitPrice: 500, quantity: 2 },
    ];

    const id = await store.create(dto, items);

    expect(id).toBe('new-inv');
    expect(client.recorded.mutations.length).toBe(2);

    const invMutation = client.recorded.mutations[0];
    expect(invMutation.table).toBe('invoices');
    expect(invMutation.operation).toBe('insert');
    const invKeys = Object.keys(invMutation.payload as object);
    expect(invKeys).not.toContain('clinic_id');
    expect(invKeys).not.toContain('number');
    expect(invKeys).not.toContain('id');

    const itemMutation = client.recorded.mutations[1];
    expect(itemMutation.table).toBe('invoice_items');
    expect(itemMutation.operation).toBe('insert');
    expect(itemMutation.payload).toEqual([
      { invoice_id: 'new-inv', service_id: 's1', description: 'Consult', unit_price: 500, quantity: 2 },
    ]);
  });

  it('create(dto, []) skips the item insert when there are no line items', async () => {
    const client = fakeSupabaseMutate([], { data: { id: 'new-inv' }, error: null });
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const dto: CreateInvoiceDto = {
      patientId: 'p1', appointmentId: null, issueDate: '2026-07-19',
      discountType: null, discountValue: 0, taxRate: 12, notes: '',
    };

    const id = await store.create(dto, []);

    expect(id).toBe('new-inv');
    expect(client.recorded.mutations.length).toBe(1);
    expect(client.recorded.mutations[0].table).toBe('invoices');
  });

  it('addPayment(dto) inserts into payments without a client-supplied clinic_id', async () => {
    const client = fakeSupabaseMutate([]);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    const dto: CreatePaymentDto = { invoiceId: 'i1', kind: 'payment', amount: 500, note: 'cash' };
    await store.addPayment(dto);

    expect(client.recorded.mutations.length).toBe(1);
    const mutation = client.recorded.mutations[0];
    expect(mutation.table).toBe('payments');
    expect(mutation.operation).toBe('insert');
    expect(mutation.payload).toEqual({ invoice_id: 'i1', kind: 'payment', amount: 500, note: 'cash' });
  });

  it('void(id) marks the invoice voided, filtered by id', async () => {
    const client = fakeSupabaseMutate([]);
    const store = setup(client);
    await new Promise(r => setTimeout(r));

    await store.void('i1');

    expect(client.recorded.mutations.length).toBe(1);
    const mutation = client.recorded.mutations[0];
    expect(mutation.table).toBe('invoices');
    expect(mutation.operation).toBe('update');
    expect(mutation.payload).toEqual({ voided: true });
    expect(mutation.filters).toContainEqual({ method: 'eq', args: ['id', 'i1'] });
  });
});
