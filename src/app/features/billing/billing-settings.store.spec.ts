import { TestBed } from '@angular/core/testing';
import { BillingSettingsStore } from './billing-settings.store';
import { SUPABASE } from '../../core/supabase.client';
import { fakeSupabaseSelect } from '../../../testing/fake-supabase';

describe('BillingSettingsStore', () => {
  function setup(client: unknown) {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
    return TestBed.inject(BillingSettingsStore);
  }

  it('maps the settings row', async () => {
    const rows = [{ clinic_id: 'c1', currency: 'PHP', tax_rate: '12.00', tax_label: 'VAT', updated_at: 'x', updated_by: null }];
    const client = fakeSupabaseSelect(rows, 1);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(client.from).toHaveBeenCalledWith('billing_settings');
    expect(store.settings().taxRate).toBe(12);
    expect(store.settings().currency).toBe('PHP');
  });

  it('falls back to defaults when no row exists', async () => {
    const client = fakeSupabaseSelect([], 0);
    const store = setup(client);
    await new Promise(r => setTimeout(r));
    expect(store.settings().currency).toBe('PHP');
    expect(store.settings().taxRate).toBe(0);
  });
});
