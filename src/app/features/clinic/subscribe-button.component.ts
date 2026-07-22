import { Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BillingAccountStore } from './billing-account.store';

/**
 * Sends the clinic to Stripe Checkout. Used from the blocked screen, the trial banner, and the
 * billing tab, so the "what if Stripe is misconfigured" handling lives in exactly one place.
 */
@Component({
  selector: 'app-subscribe-button',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <button
      mat-flat-button
      [disabled]="busy()"
      (click)="subscribe()">
      <mat-icon>credit_card</mat-icon>
      @if (busy()) {
        <ng-container i18n="@@billing.opening">Opening Stripe…</ng-container>
      } @else {
        {{ label() }}
      }
    </button>
    @if (error(); as message) {
      <p class="err">
        <ng-container i18n="@@billing.checkoutFailed">Could not open checkout.</ng-container>
        {{ message }}
      </p>
    }
  `,
  styles: `
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); margin: 0.5rem 0 0; }
  `,
})
export class SubscribeButtonComponent {
  private store = inject(BillingAccountStore);

  readonly label = input($localize`:@@billing.subscribe:Subscribe`);
  /** Emitted before navigating away, so a host can close a menu or stop a poll. */
  readonly leaving = output<void>();

  protected busy = signal(false);
  protected error = signal<string | null>(null);

  async subscribe(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const url = await this.store.startCheckout();
      this.leaving.emit();
      window.location.href = url;
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : '');
      this.busy.set(false);
    }
    // Deliberately not clearing `busy` on success: the tab is navigating to Stripe, and a button
    // that springs back to life invites a second checkout session.
  }
}
