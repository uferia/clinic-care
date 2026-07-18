import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <div class="login-wrap">
      <mat-card appearance="outlined" class="login-card">
        <mat-icon class="brand-mark">local_hospital</mat-icon>
        <h1>ClinicCare</h1>
        <p class="sub">Sign in to continue</p>
        <button mat-flat-button class="google-signin" (click)="signIn()">
          <mat-icon>login</mat-icon>
          Sign in with Google
        </button>
      </mat-card>
    </div>
  `,
  styles: `
    .login-wrap { min-height: 70vh; display: grid; place-items: center; }
    .login-card {
      display: flex; flex-direction: column; align-items: center;
      gap: 0.5rem; padding: 2rem 2.5rem; text-align: center;
    }
    .brand-mark {
      color: var(--mat-sys-primary);
      font-size: 2.5rem; width: 2.5rem; height: 2.5rem;
    }
    h1 { font: var(--mat-sys-headline-small); margin: 0.25rem 0 0; }
    .sub { color: var(--mat-sys-on-surface-variant); margin: 0 0 0.75rem; }
    .google-signin { margin-top: 0.25rem; }
  `,
})
export class LoginComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  constructor() {
    // Once a session exists (either already, or after the OAuth redirect
    // returns), leave for the requested page.
    effect(() => {
      if (this.auth.user()) {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(returnUrl);
      }
    });
  }

  signIn(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
    this.auth.signIn(returnUrl);
  }
}
