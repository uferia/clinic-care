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

  it('leaves the total unrounded, matching the SQL view\'s bare `subtotal - discount + tax`', () => {
    // 10.03 * 1.25 + 5.01 * 1.33 = 12.5375 + 6.6633 = 19.2008 (raw, unrounded).
    // The view's final select computes `total` with no round() call, so with
    // no discount and no tax the total must carry the same unrounded 19.2008 —
    // not the rounded 19.20 a stray round2() wrapper would produce.
    const fractionalItems = [
      { unitPrice: 10.03, quantity: 1.25 },
      { unitPrice: 5.01, quantity: 1.33 },
    ];
    const result = computeTotals(fractionalItems, null, 0, 0);
    expect(result.total).toBeCloseTo(19.2008, 4);
  });
});

// ---- Independent parity check against the SQL view's rounding contract ----
//
// This does NOT call `round2` or `computeTotals`. It re-derives the same SQL
// expressions (`round(subtotal * discount_value / 100, 2)`,
// `round((subtotal - discount) * tax_rate / 100, 2)`) using a decimal-STRING
// half-up rounding algorithm that never multiplies-then-rounds the way
// `round2` does — so a regression in `round2`'s arithmetic approach (e.g.
// reverting to `Number.EPSILON`) cannot also be baked into this reference,
// which would make the test tautological.
//
// `refRoundHalfUp2` works off `toFixed(10)`'s fixed decimal string (accurate
// to well beyond the 3rd decimal place for money-sized magnitudes) and
// inspects the 3rd decimal digit directly to decide whether to carry — no
// float multiply-and-round step at all.
function refRoundHalfUp2(x: number): number {
  const negative = x < 0;
  const abs = Math.abs(x);
  const fixed = abs.toFixed(10);
  const dotIdx = fixed.indexOf('.');
  const intPart = fixed.slice(0, dotIdx);
  const frac = fixed.slice(dotIdx + 1);
  const firstTwo = frac.slice(0, 2);
  const thirdDigit = frac.charCodeAt(2) - 48;
  let cents = parseInt(intPart, 10) * 100 + parseInt(firstTwo, 10);
  if (thirdDigit >= 5) cents += 1;
  const result = cents / 100;
  return negative ? -result : result;
}

interface RefTotals { subtotal: number; discount: number; tax: number; total: number; }

function refComputeTotals(
  items: readonly { unitPrice: number; quantity: number }[],
  discountType: 'amount' | 'percent' | null,
  discountValue: number,
  taxRate: number,
): RefTotals {
  const subtotal = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  let discount = 0;
  if (discountType === 'amount') discount = Math.min(discountValue, subtotal);
  else if (discountType === 'percent') discount = refRoundHalfUp2((subtotal * discountValue) / 100);
  const tax = refRoundHalfUp2(((subtotal - discount) * taxRate) / 100);
  const total = subtotal - discount + tax;
  return { subtotal, discount, tax, total };
}

describe('computeTotals parity vs. independent reference implementation', () => {
  const subtotalCases = [21.35, 100, 33.33, 999.99, 0.5, 123.45, 7.77, 250.01, 1000];
  const discountConfigs: { type: 'amount' | 'percent' | null; value: number }[] = [
    { type: null, value: 0 },
    { type: 'amount', value: 5 },
    { type: 'percent', value: 10 },
  ];
  const taxRates = [5, 10, 15, 25];

  const matrix: [number, 'amount' | 'percent' | null, number, number][] = [];
  for (const subtotal of subtotalCases) {
    for (const disc of discountConfigs) {
      for (const rate of taxRates) {
        matrix.push([subtotal, disc.type, disc.value, rate]);
      }
    }
  }

  it.each(matrix)(
    'subtotal=%s discountType=%s discountValue=%s taxRate=%s matches independent reference',
    (subtotal, discountType, discountValue, taxRate) => {
      const items = [{ unitPrice: subtotal, quantity: 1 }];
      const expected = refComputeTotals(items, discountType, discountValue, taxRate);
      const actual = computeTotals(items, discountType, discountValue, taxRate);
      expect(actual.subtotal).toBe(expected.subtotal);
      expect(actual.discount).toBe(expected.discount);
      expect(actual.tax).toBe(expected.tax);
      expect(actual.total).toBe(expected.total);
    },
  );

  // The concrete failure case from the review: 21.35 @ 10% tax, no discount.
  // Raw tax = 21.35 * 10 / 100 = 2.135 exactly (a true half-cent). Postgres
  // `round(2.135, 2)` rounds half-up to 2.14. The old `Number.EPSILON`
  // implementation rounded this DOWN to 2.13 because float multiplication
  // puts `2.135 * 100` at `213.49999999999997` — a gap far larger than
  // `Number.EPSILON` (2.22e-16) can bridge.
  it('21.35 @ 10% tax rounds the half-cent UP to 2.14, matching Postgres round()', () => {
    const items = [{ unitPrice: 21.35, quantity: 1 }];
    const result = computeTotals(items, null, 0, 10);
    expect(result.tax).toBe(2.14);
    // `total` is deliberately left unrounded (parity with the view's bare
    // `subtotal - discount + tax`), so allow for ordinary binary-float noise.
    expect(result.total).toBeCloseTo(23.49, 6);
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
