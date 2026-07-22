import { inject, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';

/**
 * Subscription payment, via Stripe-hosted pages. No card details ever reach this app — both
 * methods return a Stripe URL and the browser goes there.
 */
@Service()
export class BillingAccountStore {
  private supabase = inject(SUPABASE);

  /** Start checkout for the caller's own clinic. The server decides which clinic that is. */
  async startCheckout(): Promise<string> {
    return this.urlFrom('create-checkout-session');
  }

  /** Open Stripe's billing portal to change the card, read invoices, or cancel. */
  async openPortal(): Promise<string> {
    return this.urlFrom('create-portal-session');
  }

  private async urlFrom(fn: string): Promise<string> {
    const { data, error } = await this.supabase.functions.invoke(fn, { body: {} });
    if (error) throw await edgeError(error);
    const url = (data as { url?: string })?.url;
    if (!url) throw new Error('Stripe did not return a checkout URL.');
    return url;
  }
}
