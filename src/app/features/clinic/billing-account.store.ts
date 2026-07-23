import { inject, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';

/**
 * Subscription payment, via Xendit's hosted checkout. No card/GCash details ever reach this app —
 * checkout returns a Xendit URL and the browser goes there.
 */
@Service()
export class BillingAccountStore {
  private supabase = inject(SUPABASE);

  /** Start checkout for the caller's own clinic. The server decides which clinic that is. */
  async startCheckout(): Promise<string> {
    const { data, error } = await this.supabase.functions.invoke('create-xendit-session', { body: {} });
    if (error) throw await edgeError(error);
    const url = (data as { url?: string })?.url;
    if (!url) throw new Error('Xendit did not return a checkout URL.');
    return url;
  }

  /**
   * Cancel the caller's clinic's subscription. No confirmed Xendit customer portal exists, so
   * this calls our own API directly rather than returning a redirect URL. Access is not revoked
   * immediately — the clinic keeps it until the period already paid for runs out.
   */
  async cancel(): Promise<void> {
    const { error } = await this.supabase.functions.invoke('cancel-subscription', { body: {} });
    if (error) throw await edgeError(error);
  }
}
