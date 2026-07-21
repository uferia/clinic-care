import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { BillingSettings, toBillingSettings, toSettingsWrite } from './billing.model';

const DEFAULTS: BillingSettings = { clinicId: '', currency: 'PHP', taxRate: 0, taxLabel: 'Tax' };

@Service()
export class BillingSettingsStore {
  private supabase = inject(SUPABASE);

  private settingsResource = resource({
    params: () => ({}),
    loader: async () => {
      const { data, error } = await this.supabase
        .from('billing_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? toBillingSettings(data) : DEFAULTS;
    },
  });

  settings = computed<BillingSettings>(() => this.settingsResource.value() ?? DEFAULTS);
  taxRate = computed(() => this.settings().taxRate);
  currency = computed(() => this.settings().currency);
  readonly isLoading = computed(() => this.settingsResource.isLoading());
  readonly error = computed(() => this.settingsResource.error());

  reload() {
    this.settingsResource.reload();
  }

  async save(currency: string, taxRate: number, taxLabel: string): Promise<void> {
    const { error } = await this.supabase
      .from('billing_settings')
      .upsert(toSettingsWrite({ currency, taxRate, taxLabel }), { onConflict: 'clinic_id' });
    if (error) throw error;
    this.settingsResource.reload();
  }
}
