import { computed, inject, resource, Service as Injectable, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { Service, CreateServiceDto, toService, toServiceWrite } from './billing.model';

@Injectable()
export class ServiceStore {
  private supabase = inject(SUPABASE);
  private _activeOnly = signal(false);
  activeOnly = this._activeOnly.asReadonly();

  setActiveOnly(b: boolean) {
    this._activeOnly.set(b);
  }

  private servicesResource = resource({
    params: () => ({ activeOnly: this._activeOnly() }),
    loader: async ({ params }) => {
      let query = this.supabase.from('services').select('*');
      if (params.activeOnly) query = query.eq('active', true);
      query = query.order('name', { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(toService);
    },
  });

  // `resource().value()` throws `ResourceValueError` once the resource has
  // settled into the 'error' state (see @angular/core's ResourceImpl) —
  // `?? []` does NOT protect against that, since the throw happens
  // evaluating `.value()` itself, before `??` ever runs. `hasValue()` is
  // safe to call in that state (it short-circuits on `isError()` before ever
  // touching `.value()`). `BillingSettingsStore`, `InvoiceStore`, and
  // `ReportsStore` all guard this way; mirror it here.
  services = computed<Service[]>(() =>
    this.servicesResource.hasValue() ? this.servicesResource.value() : [],
  );
  activeServices = computed<Service[]>(() => this.services().filter(s => s.active));
  readonly isLoading = computed(() => this.servicesResource.isLoading());
  readonly error = computed(() => this.servicesResource.error());

  reload() {
    this.servicesResource.reload();
  }

  async add(dto: CreateServiceDto): Promise<void> {
    const { error } = await this.supabase.from('services').insert(toServiceWrite(dto));
    if (error) throw error;
    this.servicesResource.reload();
  }

  async update(id: string, dto: CreateServiceDto): Promise<void> {
    const { error } = await this.supabase.from('services').update(toServiceWrite(dto)).eq('id', id);
    if (error) throw error;
    this.servicesResource.reload();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('services').delete().eq('id', id);
    if (error) throw error;
    this.servicesResource.reload();
  }
}
