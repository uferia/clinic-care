import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

@Component({
  selector: 'app-blocked',
  imports: [DatePipe, MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">lock_clock</mat-icon>
        <h1>Subscription needed</h1>
        @if (access(); as a) {
          @if (a.status === 'trialing') {
            <p>Your free trial for <strong>{{ a.clinicName }}</strong> ended
              @if (a.trialEndsAt) { on {{ a.trialEndsAt | date: 'mediumDate' }} }.
              Contact us to activate your subscription.</p>
          } @else {
            <p>The subscription for <strong>{{ a.clinicName }}</strong> has ended
              @if (a.activeUntil) { (expired {{ a.activeUntil | date: 'mediumDate' }}) }.
              Renew to restore access.</p>
          }
        } @else {
          <p>Your clinic's subscription is inactive. Contact us to restore access.</p>
        }
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
  `,
})
export class BlockedComponent {
  protected auth = inject(AuthService);
  private ctx = inject(ClinicContextService);
  protected access = computed(() => this.ctx.access());
}
