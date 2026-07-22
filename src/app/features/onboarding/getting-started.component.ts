import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { OnboardingStore } from './onboarding.store';

/** Per-clinic, so dismissing on one account does not silence another clinic. */
function dismissKey(clinicId: string): string {
  return `cc-setup-dismissed-${clinicId}`;
}

/**
 * A fresh clinic lands on a dashboard of zeros with no idea that doctors and a
 * price list come before appointments and invoices. This says so, in order, and
 * disappears for good once the work is done.
 */
@Component({
  selector: 'app-getting-started',
  imports: [RouterLink, MatCardModule, MatIconModule, MatButtonModule, MatProgressBarModule],
  template: `
    @if (show()) {
      <mat-card appearance="outlined" class="setup">
        <header class="head">
          <div>
            <h2>Finish setting up {{ clinicName() }}</h2>
            <p class="meta">{{ store.doneCount() }} of {{ store.total() }} done</p>
          </div>
          <button mat-button (click)="dismiss()">Hide</button>
        </header>

        <mat-progress-bar mode="determinate" [value]="percent()" />

        <ol class="steps">
          @for (step of store.steps(); track step.key) {
            <li class="step" [class.done]="step.done">
              <mat-icon class="tick">{{ step.done ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
              <span class="text">
                <span class="label">{{ step.label }}</span>
                <span class="hint">{{ step.hint }}</span>
              </span>
              @if (!step.done) {
                <a mat-stroked-button [routerLink]="step.route">Do it</a>
              }
            </li>
          }
        </ol>
      </mat-card>
    }
  `,
  styles: `
    .setup { padding: 1rem; margin-bottom: 1rem; }
    .head { display: flex; align-items: flex-start; gap: 1rem; }
    .head h2 { font: var(--mat-sys-title-medium); margin: 0; }
    .head > div { flex: 1; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); margin: 0.15rem 0 0.6rem; }
    .steps { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .step { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .step:last-child { border-bottom: none; }
    .step .tick { color: var(--mat-sys-outline); flex: none; }
    .step.done .tick { color: var(--mat-sys-primary); }
    .step .text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .step .label { font: var(--mat-sys-body-medium); }
    .step.done .label { color: var(--mat-sys-on-surface-variant); text-decoration: line-through; }
    .step .hint { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    @media print { .setup { display: none; } }
  `,
})
export class GettingStartedComponent {
  protected store = inject(OnboardingStore);
  private ctx = inject(ClinicContextService);

  private dismissed = signal(false);

  protected clinicName = computed(() => this.ctx.access()?.clinicName ?? 'your clinic');

  protected percent = computed(() =>
    this.store.total() === 0 ? 0 : (this.store.doneCount() / this.store.total()) * 100,
  );

  protected show = computed(() => {
    if (this.dismissed() || this.store.complete() || this.store.total() === 0) return false;
    const clinicId = this.ctx.access()?.clinicId;
    return !!clinicId && localStorage.getItem(dismissKey(clinicId)) === null;
  });

  protected dismiss(): void {
    const clinicId = this.ctx.access()?.clinicId;
    if (clinicId) localStorage.setItem(dismissKey(clinicId), '1');
    this.dismissed.set(true);
  }
}
