import { describe, it, expect } from 'vitest';
import { toService, toServiceWrite } from './billing.model';
import { ServiceRow } from '../../core/db.types';

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
