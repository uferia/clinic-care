import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { CLINIC_NAME_MAX, clinicNameError } from '../../core/clinic-name';
import { RegistrationStore } from './registration.store';

@Component({
  selector: 'app-no-access',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">block</mat-icon>
        <h1 i18n="@@noAccess.title">No clinic access</h1>
        <p i18n="@@noAccess.body">Your account isn't linked to a clinic yet. Ask your clinic administrator to add your email, then sign in again.</p>
        <button mat-stroked-button (click)="auth.logout()">
          <mat-icon>logout</mat-icon>
          <ng-container i18n="@@action.signOut">Sign out</ng-container>
        </button>
      </mat-card>

      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark accent">add_business</mat-icon>
        <h2 i18n="@@signup.title">Starting a new clinic?</h2>
        <p i18n="@@signup.body">Register now and get a 30-day free trial. No approval needed.</p>
        <mat-form-field appearance="outline" class="wide">
          <mat-label i18n="@@signup.clinicName">Clinic name</mat-label>
          <input
            matInput
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            (keyup.enter)="create()"
            [attr.maxlength]="nameMax"
            i18n-placeholder="@@signup.clinicNameHint"
            placeholder="e.g. Sunrise Family Clinic" />
        </mat-form-field>
        <!--
          Plain text rather than <mat-error>: these fields are signal-bound, not form
          controls, so mat-form-field never enters the error state that would reveal a
          mat-error — the message would silently never appear. Only nag once they have
          typed something; an untouched field is not a mistake.
        -->
        @if (name() && nameError()) { <div class="err">{{ nameError() }}</div> }
        <button mat-flat-button (click)="create()" [disabled]="!!nameError() || busy()">
          <mat-icon>rocket_launch</mat-icon>
          @if (busy()) {
            <ng-container i18n="@@signup.creating">Creating…</ng-container>
          } @else {
            <ng-container i18n="@@signup.create">Create clinic</ng-container>
          }
        </button>
        @if (error()) { <div class="err">{{ error() }}</div> }
      </mat-card>
    </div>
  `,
  styles: `
    .wrap { min-height: 70vh; display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; justify-content: center; padding: 2rem 1rem; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 2.5rem; max-width: 28rem; text-align: center; }
    .wide { width: 100%; }
    .mark { color: var(--mat-sys-error); font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
    .mark.accent { color: var(--mat-sys-primary); }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-large); margin: 0; }
    p { color: var(--mat-sys-on-surface-variant); margin: 0; }
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); }
  `,
})
export class NoAccessComponent {
  protected auth = inject(AuthService);
  private registration = inject(RegistrationStore);
  private ctx = inject(ClinicContextService);
  private router = inject(Router);

  protected name = signal('');
  protected busy = signal(false);
  protected error = signal<string | null>(null);

  protected nameMax = CLINIC_NAME_MAX;
  protected nameError = computed(() => clinicNameError(this.name()));

  async create(): Promise<void> {
    const name = this.name().trim();
    if (this.nameError() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.registration.register(name);
      // Re-resolve membership + subscription so the access guard lets us through.
      await this.ctx.load();
      await this.router.navigate(['/dashboard']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : $localize`:@@signup.failed:Could not create the clinic.`);
    } finally {
      this.busy.set(false);
    }
  }
}
