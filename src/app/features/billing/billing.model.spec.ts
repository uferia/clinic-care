import { describe, it, expect } from 'vitest';
import { toService, toServiceWrite, computeTotals, toInvoiceBalance, toPayment } from './billing.model';
import { ServiceRow, InvoiceBalanceRow, PaymentRow } from '../../core/db.types';

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

  it('fractional quantities keep the subtotal unrounded, matching the SQL view', () => {
    // 10.03 * 1.25 + 5.01 * 1.33 = 12.5375 + 6.6633 = 19.2008 (raw, unrounded).
    // The view's item_tot CTE never rounds this sum, so an 'amount' discount
    // just under the raw subtotal must cap to its own unrounded value, not to
    // a pre-rounded 19.20.
    const fractionalItems = [
      { unitPrice: 10.03, quantity: 1.25 },
      { unitPrice: 5.01, quantity: 1.33 },
    ];
    const result = computeTotals(fractionalItems, 'amount', 19.2005, 0);
    expect(result.subtotal).toBeCloseTo(19.2008, 4);
    expect(result.discount).toBeCloseTo(19.2005, 4);
  });

  it('rounds a half-cent tax up, matching Postgres round(numeric, 2)', () => {
    // subtotal 50, taxRate 1.01 -> raw tax = 50 * 1.01 / 100 = 0.505 exactly,
    // which must round up to 0.51 (round-half-up), not down to 0.50.
    const flatItems = [{ unitPrice: 50, quantity: 1 }];
    const result = computeTotals(flatItems, null, 0, 1.01);
    expect(result.tax).toBeCloseTo(0.51, 4);
    expect(result.total).toBeCloseTo(50.51, 4);
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
