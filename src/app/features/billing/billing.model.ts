import {
  ServiceRow,
  InvoiceRow,
  InvoiceItemRow,
  PaymentRow,
  InvoiceBalanceRow,
  BillingSettingsRow,
} from '../../core/db.types';

// ---- Enums -----------------------------------------------------------------

export const DISCOUNT_TYPES = ['amount', 'percent'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ---- Service (catalog) -----------------------------------------------------

export interface Service {
  id: string;
  clinicId: string;
  name: string;
  description: string;
  price: number;
  active: boolean;
  createdAt: string;
}

export type CreateServiceDto = Omit<Service, 'id' | 'clinicId' | 'createdAt'>;

export function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    active: row.active,
    createdAt: row.created_at,
  };
}

export function toServiceWrite(dto: CreateServiceDto): Record<string, unknown> {
  return {
    name: dto.name,
    description: dto.description,
    price: dto.price,
    active: dto.active,
  };
}

// ---- Invoice / items / payments / settings mappers are added in Task 3 -----
