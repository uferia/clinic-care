import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { activationMailto, supportEmail } from '../../shared/support-contact';

@Component({
  selector: 'app-blocked',
  imports: [MatCardModule, MatIconModule, MatButtonModule],
  providers: [DatePipe],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">lock_clock</mat-icon>
        <h1>Subscription needed</h1>
        @if (access(); as a) {
          @if (a.status === 'trialing') {
            <p>Your free trial for <strong>{{ a.clinicName }}</strong> ended{{ endedOn() }}.
              Contact us to activate your subscription.</p>
          } @else {
            <p>The subscription for <strong>{{ a.clinicName }}</strong> has ended{{ endedOn() }}.
              Renew to restore access.</p>
          }
        } @else {
          <p>Your clinic's subscription is inactive. Contact us to restore access.</p>
        }

        <a mat-flat-button [href]="mailto()">
          <mat-icon>mail</mat-icon>
          Email us to activate
        </a>
        <p class="meta">Or write to {{ supportEmail }} — your data is safe and waiting.</p>

        <button mat-stroked-button (click)="auth.logout()">
          <mat-icon>logout</mat-icon>
          Sign out
        </button>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap { min-height: 70vh; display: grid; place-items: center; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 2.5rem; max-width: 30rem; text-align: center; }
    .mark { color: var(--mat-sys-error); font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    p { color: var(--mat-sys-on-surface-variant); margin: 0; }
    .meta { font: var(--mat-sys-body-small); }
  `,
})
export class BlockedComponent {
  protected auth = inject(AuthService);
  private ctx = inject(ClinicContextService);
  private dates = inject(DatePipe);
  protected access = computed(() => this.ctx.access());
  protected supportEmail = supportEmail;
  protected mailto = computed(() => activationMailto(this.access()?.clinicName ?? 'my clinic'));

  /**
   * " on 21 Jul 2026", or an empty string when we have no date. Built here rather
   * than with an inline @if so the sentence never ends " ." when the date is missing.
   */
  protected endedOn = computed(() => {
    const a = this.access();
    const date = a?.status === 'trialing' ? a.trialEndsAt : a?.activeUntil;
    if (!date) return '';
    return ` on ${this.dates.transform(date, 'mediumDate')}`;
  });
}
