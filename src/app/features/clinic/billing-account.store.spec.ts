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
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://checkout.xendit.co/x' }, error: null });
    const url = await setup(invoke).startCheckout();
    expect(invoke).toHaveBeenCalledWith('create-xendit-session', { body: {} });
    expect(url).toBe('https://checkout.xendit.co/x');
  });

  it('throws rather than navigating nowhere when Xendit returns no URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(setup(invoke).startCheckout()).rejects.toThrow('did not return a checkout URL');
  });

  it('cancels through its own function and does not return a URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { cancelled: true }, error: null });
    await expect(setup(invoke).cancel()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('cancel-subscription', { body: {} });
  });

  it('surfaces the edge function error body on cancel', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'no billing account yet' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).cancel()).rejects.toThrow('no billing account yet');
  });

  it('surfaces the edge function error body on checkout', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'XENDIT_SECRET_KEY is not set' }), { status: 500 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).startCheckout()).rejects.toThrow('XENDIT_SECRET_KEY is not set');
  });
});
