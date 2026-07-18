import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-no-access',
  imports: [MatCardModule, MatIconModule, MatButtonModule],
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
    </div>
  `,
  styles: `
    .wrap { min-height: 70vh; display: grid; place-items: center; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 2.5rem; max-width: 28rem; text-align: center; }
    .mark { color: var(--mat-sys-error); font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    p { color: var(--mat-sys-on-surface-variant); margin: 0; }
  `,
})
export class NoAccessComponent {
  protected auth = inject(AuthService);
}
