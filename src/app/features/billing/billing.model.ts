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

// ---- Money helpers ---------------------------------------------------------

/** Round half-up to 2 decimals (matches Postgres `round(x, 2)`). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---- Invoice ---------------------------------------------------------------

export interface Invoice {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  number: string;
  /** ISO date, `YYYY-MM-DD`. */
  issueDate: string;
  discountType: DiscountType | null;
  discountValue: number;
  taxRate: number;
  notes: string;
  voided: boolean;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  serviceId: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  kind: PaymentKind;
  amount: number;
  paidAt: string;
  note: string;
}

export interface InvoiceBalance extends Invoice {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
}

export interface BillingSettings {
  clinicId: string;
  currency: string;
  taxRate: number;
  taxLabel: string;
}

// DTOs
export interface CreateInvoiceItemDto {
  serviceId: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
}

export interface CreateInvoiceDto {
  patientId: string;
  appointmentId: string | null;
  issueDate: string;
  discountType: DiscountType | null;
  discountValue: number;
  taxRate: number;
  notes: string;
}

export interface CreatePaymentDto {
  invoiceId: string;
  kind: PaymentKind;
  amount: number;
  note: string;
}

// Mappers (read)
// NOTE: the parameter is `Omit<InvoiceRow, 'created_by'>`, not `InvoiceRow`.
// `toInvoice` never reads `created_by`, and `toInvoiceBalance` passes it an
// `InvoiceBalanceRow` — which models the view, and the view does not select
// `created_by`. Widening the parameter to the columns actually read lets both
// call sites typecheck honestly. Do not narrow it back to `InvoiceRow`.
export function toInvoice(row: Omit<InvoiceRow, 'created_by'>): Invoice {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    number: row.number ?? '',
    issueDate: row.issue_date,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    taxRate: Number(row.tax_rate),
    notes: row.notes ?? '',
    voided: row.voided,
    createdAt: row.created_at,
  };
}

export function toInvoiceItem(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    serviceId: row.service_id,
    description: row.description,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
  };
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    kind: row.kind,
    amount: Number(row.amount),
    paidAt: row.paid_at,
    note: row.note ?? '',
  };
}

export function toInvoiceBalance(row: InvoiceBalanceRow): InvoiceBalance {
  return {
    ...toInvoice(row),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    total: Number(row.total),
    paid: Number(row.paid),
    balance: Number(row.balance),
    status: row.status,
  };
}

export function toBillingSettings(row: BillingSettingsRow): BillingSettings {
  return {
    clinicId: row.clinic_id,
    currency: row.currency,
    taxRate: Number(row.tax_rate),
    taxLabel: row.tax_label,
  };
}

// Mappers (write)
export function toInvoiceWrite(dto: CreateInvoiceDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    appointment_id: dto.appointmentId,
    issue_date: dto.issueDate,
    discount_type: dto.discountType,
    discount_value: dto.discountValue,
    tax_rate: dto.taxRate,
    notes: dto.notes,
  };
}

export function toItemWrite(
  invoiceId: string,
  dto: CreateInvoiceItemDto,
): Record<string, unknown> {
  return {
    invoice_id: invoiceId,
    service_id: dto.serviceId,
    description: dto.description,
    unit_price: dto.unitPrice,
    quantity: dto.quantity,
  };
}

export function toPaymentWrite(dto: CreatePaymentDto): Record<string, unknown> {
  return {
    invoice_id: dto.invoiceId,
    kind: dto.kind,
    amount: dto.amount,
    note: dto.note,
  };
}

export function toSettingsWrite(
  s: Pick<BillingSettings, 'currency' | 'taxRate' | 'taxLabel'>,
): Record<string, unknown> {
  return { currency: s.currency, tax_rate: s.taxRate, tax_label: s.taxLabel };
}

// ---- Totals (must match view invoice_balances) -----------------------------

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export function computeTotals(
  items: readonly { unitPrice: number; quantity: number }[],
  discountType: DiscountType | null,
  discountValue: number,
  taxRate: number,
): Totals {
  const subtotal = round2(
    items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
  );
  let discount = 0;
  if (discountType === 'amount') discount = Math.min(discountValue, subtotal);
  else if (discountType === 'percent') discount = round2((subtotal * discountValue) / 100);
  const tax = round2(((subtotal - discount) * taxRate) / 100);
  const total = round2(subtotal - discount + tax);
  return { subtotal, discount, tax, total };
}
