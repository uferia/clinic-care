import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { RegistrationStore } from './registration.store';

@Component({
  selector: 'app-no-access',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark">block</mat-icon>
        <h1>No clinic access</h1>
        <p>Your account isn't linked to a clinic yet. Ask your clinic administrator to add your email, then sign in again.</p>
        <button mat-stroked-button (click)="auth.logout()">
          <mat-icon>logout</mat-icon>
          Sign out
        </button>
      </mat-card>

      <mat-card appearance="outlined" class="card">
        <mat-icon class="mark accent">add_business</mat-icon>
        <h2>Starting a new clinic?</h2>
        <p>Register now and get a 30-day free trial. No approval needed.</p>
        <mat-form-field appearance="outline" class="wide">
          <mat-label>Clinic name</mat-label>
          <input
            matInput
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            (keyup.enter)="create()"
            placeholder="e.g. Sunrise Family Clinic" />
        </mat-form-field>
        <button mat-flat-button (click)="create()" [disabled]="!name().trim() || busy()">
          <mat-icon>rocket_launch</mat-icon>
          {{ busy() ? 'Creating…' : 'Create clinic' }}
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

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.registration.register(name);
      // Re-resolve membership + subscription so the access guard lets us through.
      await this.ctx.load();
      await this.router.navigate(['/dashboard']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not create the clinic.');
    } finally {
      this.busy.set(false);
    }
  }
}
