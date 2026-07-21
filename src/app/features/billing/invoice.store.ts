import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import {
  Invoice, InvoiceBalance, InvoiceItem, Payment, InvoiceStatus,
  CreateInvoiceDto, CreateInvoiceItemDto, CreatePaymentDto,
  toInvoice, toInvoiceItem, toPayment, toInvoiceBalance,
  toInvoiceWrite, toItemWrite, toPaymentWrite,
} from './billing.model';

/** A balance row with the patient's display name resolved via FK embed. */
export interface InvoiceListRow extends InvoiceBalance {
  patientName: string;
}

@Service()
export class InvoiceStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 10;
  private _page = signal(1);
  private _status = signal<InvoiceStatus | ''>('');
  private _patientId = signal<string | ''>('');
  private _from = signal<string>('');
  private _to = signal<string>('');

  page = this._page.asReadonly();
  status = this._status.asReadonly();

  setPage(p: number) { this._page.set(p); }
  setStatus(s: InvoiceStatus | '') { this._status.set(s); this._page.set(1); }
  setPatient(id: string) { this._patientId.set(id); this._page.set(1); }
  setDateRange(from: string, to: string) { this._from.set(from); this._to.set(to); this._page.set(1); }

  private listResource = resource({
    params: () => ({
      page: this._page(), status: this._status(),
      patientId: this._patientId(), from: this._from(), to: this._to(),
    }),
    loader: async ({ params }) => {
      let query = this.supabase
        .from('invoice_balances')
        .select('*, patient:patients(first_name, last_name)', { count: 'exact' });

      if (params.status) query = query.eq('status', params.status);
      if (params.patientId) query = query.eq('patient_id', params.patientId);
      if (params.from) query = query.gte('issue_date', params.from);
      if (params.to) query = query.lte('issue_date', params.to);

      query = query.order('created_at', { ascending: false });
      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      const rows: InvoiceListRow[] = (data ?? []).map((r: any) => ({
        ...toInvoiceBalance(r),
        patientName: r.patient ? `${r.patient.first_name} ${r.patient.last_name}` : '',
      }));
      return { rows, total: count ?? 0 };
    },
  });

  // `resource().value()` throws `ResourceValueError` once the resource settles
  // into the 'error' state — `?.rows ?? []` would NOT protect against that
  // (the throw happens evaluating the left operand, before `?.` short-circuits).
  // `invoices()`/`total()` are read by list/detail consumers that may not always
  // wrap every read in an `@if (store.error())` guard, so use `hasValue()` as an
  // explicit type-guard instead of relying on optional chaining.
  invoices = computed<InvoiceListRow[]>(() =>
    this.listResource.hasValue() ? this.listResource.value().rows : [],
  );
  total = computed(() => (this.listResource.hasValue() ? this.listResource.value().total : 0));
  readonly isLoading = computed(() => this.listResource.isLoading());
  readonly error = computed(() => this.listResource.error());
  reload() { this.listResource.reload(); }

  async loadOne(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[]; payments: Payment[] } | null> {
    const { data: inv, error: e1 } = await this.supabase
      .from('invoices').select('*').eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!inv) return null;

    const { data: items, error: e2 } = await this.supabase
      .from('invoice_items').select('*').eq('invoice_id', id);
    if (e2) throw e2;

    const { data: pays, error: e3 } = await this.supabase
      .from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: true });
    if (e3) throw e3;

    return {
      invoice: toInvoice(inv),
      items: (items ?? []).map(toInvoiceItem),
      payments: (pays ?? []).map(toPayment),
    };
  }

  /** Insert the invoice then its line items; returns the new invoice id. */
  async create(dto: CreateInvoiceDto, items: CreateInvoiceItemDto[]): Promise<string> {
    const { data, error } = await this.supabase
      .from('invoices').insert(toInvoiceWrite(dto)).select('id').single();
    if (error) throw error;
    const id: string = data.id;
    if (items.length) {
      const { error: e2 } = await this.supabase
        .from('invoice_items').insert(items.map(it => toItemWrite(id, it)));
      if (e2) throw e2;
    }
    this.listResource.reload();
    return id;
  }

  async addPayment(dto: CreatePaymentDto): Promise<void> {
    const { error } = await this.supabase.from('payments').insert(toPaymentWrite(dto));
    if (error) throw error;
    this.listResource.reload();
  }

  async void(id: string): Promise<void> {
    const { error } = await this.supabase.from('invoices').update({ voided: true }).eq('id', id);
    if (error) throw error;
    this.listResource.reload();
  }
}
