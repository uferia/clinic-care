import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-wrap">
      <mat-card appearance="outlined" class="login-card">
        <mat-icon class="brand-mark">local_hospital</mat-icon>
        <h1>ClinicCare</h1>
        <p class="sub">Sign in to continue</p>
        <div #gbtn class="gbtn"></div>
        @if (!auth.ready()) {
          <div class="loading">
            <mat-spinner diameter="24" />
            <span>Loading sign-in…</span>
          </div>
        }
      </mat-card>
    </div>
  `,
  styles: `
    .login-wrap {
      min-height: 70vh;
      display: grid;
      place-items: center;
    }

    .login-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem 2.5rem;
      text-align: center;
    }

    .brand-mark {
      color: var(--mat-sys-primary);
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0.25rem 0 0;
    }

    .sub {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.5rem;
    }

    .gbtn {
      min-height: 44px;
      display: flex;
      justify-content: center;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class LoginComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private buttonHost = viewChild<ElementRef<HTMLElement>>('gbtn');

  constructor() {
    // Render the Google button once the GIS client is ready and the host exists.
    effect(() => {
      const host = this.buttonHost();
      if (this.auth.ready() && host) {
        this.auth.renderButton(host.nativeElement);
      }
    });
    // Leave for the requested page the moment a session appears.
    effect(() => {
      if (this.auth.user()) {
        const returnUrl =
          this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(returnUrl);
      }
    });
    this.auth.initialize();
  }
}
