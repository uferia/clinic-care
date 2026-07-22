import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ClinicContextService } from '../core/clinic/clinic-context.service';
import { activationMailto } from './support-contact';
import { SubscribeButtonComponent } from '../features/clinic/subscribe-button.component';

/** Days of trial left at which we start warning. Earlier is noise; later is a surprise. */
const WARN_FROM = 7;

/**
 * A trial that simply stops one morning reads as a broken app. Warn inside the
 * last week, while there is still time to arrange activation.
 */
@Component({
  selector: 'app-trial-banner',
  imports: [MatIconModule, MatButtonModule, SubscribeButtonComponent],
  template: `
    @if (show()) {
      <aside class="banner no-print" role="status">
        <mat-icon>schedule</mat-icon>
        <span>
          @if (daysLeft() === 0) {
            <ng-container i18n="@@trial.endsToday">Your free trial ends today.</ng-container>
          } @else if (daysLeft() === 1) {
            <ng-container i18n="@@trial.endsTomorrow">Your free trial ends tomorrow.</ng-container>
          } @else {
            <ng-container i18n="@@trial.endsInDays">Your free trial ends in {{ daysLeft() }} days.</ng-container>
          }
          <ng-container i18n="@@trial.keepAccess">Activate to keep access — your data stays either way.</ng-container>
        </span>
        @if (canSubscribe()) {
          <app-subscribe-button [label]="subscribeLabel" />
        } @else {
          <a mat-button [href]="mailto()" i18n="@@trial.activate">Activate</a>
        }
      </aside>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 1rem;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font: var(--mat-sys-body-medium);
    }
    .banner mat-icon { flex: none; }
    .banner span { flex: 1; }
    @media print { .banner { display: none; } }
  `,
})
export class TrialBannerComponent {
  private ctx = inject(ClinicContextService);

  protected daysLeft = computed(() => this.ctx.daysLeft() ?? 0);

  protected show = computed(() => {
    const access = this.ctx.access();
    if (!access || access.status !== 'trialing' || !this.ctx.isActive()) return false;
    const days = this.ctx.daysLeft();
    return days !== null && days <= WARN_FROM;
  });

  protected mailto = computed(() => activationMailto(this.ctx.access()?.clinicName ?? 'my clinic'));

  // Staff see the banner but cannot pay; they get the email route instead.
  protected canSubscribe = computed(() => this.ctx.isClinicAdmin());
  protected subscribeLabel = $localize`:@@trial.subscribe:Subscribe`;
}
