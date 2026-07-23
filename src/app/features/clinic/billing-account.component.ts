import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { BillingAccountStore } from './billing-account.store';
import { SubscribeButtonComponent } from './subscribe-button.component';

@Component({
  selector: 'app-billing-account',
  imports: [DatePipe, MatCardModule, MatButtonModule, MatIconModule, SubscribeButtonComponent],
  template: `
    <mat-card appearance="outlined" class="section">
      <h2 i18n="@@billing.planTitle">Plan</h2>

      @if (access(); as a) {
        <p class="status">
          @if (a.status === 'trialing') {
            <ng-container i18n="@@billing.onTrial">Free trial — {{ daysLeft() }} days left.</ng-container>
          } @else if (a.status === 'active') {
            <ng-container i18n="@@billing.active">Active until {{ a.activeUntil | date: 'mediumDate' }}.</ng-container>
          } @else {
            <ng-container i18n="@@billing.inactive">No active subscription.</ng-container>
          }
        </p>

        @if (a.status === 'active') {
          <p class="meta" i18n="@@billing.renews">
            Renews automatically. Cancel any time — access runs to the end of the paid period.
          </p>
        } @else {
          <p class="meta" i18n="@@billing.trialCredit">
            Days left on your trial are added on top of your first paid month, so subscribing early
            costs you nothing.
          </p>
        }

        <div class="actions">
          @if (a.status !== 'active') {
            <app-subscribe-button />
          } @else if (cancelled()) {
            <p class="ok" i18n="@@billing.cancelled">
              Cancelled. Your access continues until the date above, then will not renew.
            </p>
          } @else if (confirming()) {
            <button mat-flat-button class="danger" [disabled]="busy()" (click)="cancel()">
              <mat-icon>block</mat-icon>
              <ng-container i18n="@@billing.confirmCancel">Confirm cancel</ng-container>
            </button>
            <button mat-button [disabled]="busy()" (click)="confirming.set(false)">
              <ng-container i18n="@@billing.keepSubscription">Keep subscription</ng-container>
            </button>
          } @else {
            <button mat-stroked-button [disabled]="busy()" (click)="confirming.set(true)">
              <mat-icon>cancel</mat-icon>
              <ng-container i18n="@@billing.cancelSubscription">Cancel subscription</ng-container>
            </button>
          }
        </div>

        @if (error(); as message) { <p class="err">{{ message }}</p> }
      }
    </mat-card>
  `,
  styles: `
    .section { padding: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.5rem; }
    .status { font: var(--mat-sys-body-large); margin: 0 0 0.25rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); margin: 0 0 0.75rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    .danger { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .ok { color: var(--mat-sys-primary); font: var(--mat-sys-body-small); margin: 0; }
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); margin: 0; }
  `,
})
export class BillingAccountComponent {
  private ctx = inject(ClinicContextService);
  private store = inject(BillingAccountStore);

  protected access = computed(() => this.ctx.access());
  protected daysLeft = computed(() => this.ctx.daysLeft() ?? 0);
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected confirming = signal(false);
  protected cancelled = signal(false);

  async cancel(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.cancel();
      this.confirming.set(false);
      this.cancelled.set(true);
      await this.ctx.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : $localize`:@@billing.cancelFailed:Could not cancel the subscription.`);
    } finally {
      this.busy.set(false);
    }
  }
}
