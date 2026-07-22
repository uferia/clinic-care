import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BillingAccountStore } from './billing-account.store';
import { SUPABASE } from '../../core/supabase.client';

function setup(invoke: ReturnType<typeof vi.fn>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { functions: { invoke } } }],
  });
  return TestBed.inject(BillingAccountStore);
}

describe('BillingAccountStore', () => {
  it('sends no clinic_id — the server resolves the caller\'s own clinic', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://checkout.stripe.com/x' }, error: null });
    const url = await setup(invoke).startCheckout();
    expect(invoke).toHaveBeenCalledWith('create-checkout-session', { body: {} });
    expect(url).toBe('https://checkout.stripe.com/x');
  });

  it('opens the billing portal through its own function', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://billing.stripe.com/y' }, error: null });
    const url = await setup(invoke).openPortal();
    expect(invoke).toHaveBeenCalledWith('create-portal-session', { body: {} });
    expect(url).toBe('https://billing.stripe.com/y');
  });

  it('throws rather than navigating nowhere when Stripe returns no URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(setup(invoke).startCheckout()).rejects.toThrow('did not return a checkout URL');
  });

  it('surfaces the edge function error body', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'no billing account yet' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).openPortal()).rejects.toThrow('no billing account yet');
  });
});
