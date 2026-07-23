import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { ClinicProfileComponent } from './clinic-profile.component';
import { ActivityComponent } from './activity.component';
import { BillingAccountComponent } from './billing-account.component';
import { TeamComponent } from '../team/team.component';

/** How long to keep re-checking for the webhook after Xendit sends the clinic back. */
const CONFIRM_ATTEMPTS = 6;
const CONFIRM_DELAY_MS = 1500;

/** One home for the things a clinic owner administers: who they are, who works there, what they pay. */
@Component({
  selector: 'app-clinic-settings',
  imports: [
    MatTabsModule, MatIconModule, ClinicProfileComponent, BillingAccountComponent,
    TeamComponent, ActivityComponent,
  ],
  template: `
    <header class="head">
      <h1>{{ clinicName() }}</h1>
    </header>

    @if (confirming()) {
      <div class="notice" role="status">
        <mat-icon>hourglass_top</mat-icon>
        <span i18n="@@billing.confirming">Confirming your payment with Xendit…</span>
      </div>
    } @else if (confirmed()) {
      <div class="notice ok" role="status">
        <mat-icon>check_circle</mat-icon>
        <span i18n="@@billing.confirmed">Payment received — your subscription is active.</span>
      </div>
    } @else if (confirmSlow()) {
      <div class="notice" role="status">
        <mat-icon>schedule</mat-icon>
        <span i18n="@@billing.confirmSlow">
          Xendit took your payment; we are still waiting for confirmation. This usually lands within
          a minute — refresh, or contact us if it does not.
        </span>
      </div>
    }

    <mat-tab-group [selectedIndex]="initialTab">
      <mat-tab label="Profile">
        <div class="tab-body"><app-clinic-profile /></div>
      </mat-tab>
      <mat-tab label="Billing">
        <div class="tab-body"><app-billing-account /></div>
      </mat-tab>
      <mat-tab label="Team">
        <div class="tab-body"><app-team /></div>
      </mat-tab>
      <mat-tab label="Activity">
        <div class="tab-body"><app-activity /></div>
      </mat-tab>
    </mat-tab-group>
  `,
  styles: `
    .head h1 { font: var(--mat-sys-headline-small); margin: 0 0 1rem; }
    .tab-body { padding-top: 1rem; }
    .notice { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1rem; margin-bottom: 1rem;
      border-radius: var(--mat-sys-corner-small); font: var(--mat-sys-body-medium);
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .notice.ok { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
  `,
})
export class ClinicSettingsComponent {
  private ctx = inject(ClinicContextService);
  private route = inject(ActivatedRoute);

  protected clinicName = computed(() => this.ctx.access()?.clinicName ?? 'Clinic');

  protected confirming = signal(false);
  protected confirmed = signal(false);
  protected confirmSlow = signal(false);

  /** Land on Billing when Xendit sends them back, wherever they started. */
  protected initialTab = this.route.snapshot.queryParamMap.get('checkout') ? 1 : 0;

  constructor() {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      void this.awaitWebhook();
    }
  }

  /**
   * Xendit redirects the browser back the instant checkout completes, which usually beats the
   * webhook that actually grants access. Poll our own context for a few seconds rather than
   * showing a paying clinic a screen that still says "no subscription".
   */
  private async awaitWebhook(): Promise<void> {
    this.confirming.set(true);
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      await this.ctx.load();
      if (this.ctx.access()?.status === 'active') {
        this.confirming.set(false);
        this.confirmed.set(true);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, CONFIRM_DELAY_MS));
    }
    // Never claim failure: the money left their account. Say what we know.
    this.confirming.set(false);
    this.confirmSlow.set(true);
  }
}
