import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BillingSettingsStore } from './billing-settings.store';

@Component({
  selector: 'app-billing-settings',
  imports: [
    FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule,
  ],
  providers: [BillingSettingsStore],
  template: `
    <header class="toolbar"><h1>Billing Settings</h1></header>
    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <mat-form-field appearance="outline">
          <mat-label>Currency code</mat-label>
          <input matInput [(ngModel)]="currency" maxlength="3" placeholder="PHP" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Tax label</mat-label>
          <input matInput [(ngModel)]="taxLabel" placeholder="VAT" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Tax rate (%)</mat-label>
          <input matInput type="number" min="0" max="100" step="0.01" [(ngModel)]="taxRate" />
        </mat-form-field>

        @if (err()) { <p class="error">{{ err() }}</p> }
        @if (saved()) { <p class="success">Settings saved.</p> }

        <div class="actions">
          <button mat-flat-button [disabled]="saving()" (click)="save()">
            <mat-icon>save</mat-icon> Save
          </button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .card { max-width: 26rem; }
    .col { display: flex; flex-direction: column; gap: 0.5rem; }
    .actions { display: flex; justify-content: flex-end; }
    .error { color: var(--mat-sys-error); }
    .success { color: var(--mat-sys-primary); }
  `,
})
export class BillingSettingsComponent {
  store = inject(BillingSettingsStore);

  currency = signal('PHP');
  taxLabel = signal('Tax');
  taxRate = signal<number>(0);
  saving = signal(false);
  err = signal('');
  saved = signal(false);

  private seeded = false;

  constructor() {
    // Sync form fields from loaded settings once. Guarded by `seeded` so a
    // user who starts typing before the load completes doesn't get their
    // in-progress input clobbered by the resource's resolved value.
    effect(() => {
      const s = this.store.settings();
      if (!this.seeded && !this.store.isLoading()) {
        this.currency.set(s.currency);
        this.taxLabel.set(s.taxLabel);
        this.taxRate.set(s.taxRate);
        this.seeded = true;
      }
    });
  }

  async save() {
    this.saving.set(true);
    this.err.set('');
    this.saved.set(false);
    try {
      await this.store.save(
        this.currency().trim().toUpperCase(),
        Number(this.taxRate()) || 0,
        this.taxLabel().trim() || 'Tax',
      );
      this.saved.set(true);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      this.saving.set(false);
    }
  }
}
