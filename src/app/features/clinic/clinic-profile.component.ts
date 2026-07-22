import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { CLINIC_NAME_MAX, clinicNameError } from '../../core/clinic-name';
import { ClinicProfileStore } from './clinic-profile.store';

@Component({
  selector: 'app-clinic-profile',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-card appearance="outlined" class="section">
      <h2>Clinic details</h2>
      <p class="meta">These appear on every invoice you print.</p>

      <mat-form-field appearance="outline" class="wide">
        <mat-label>Clinic name</mat-label>
        <input
          matInput
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          [attr.maxlength]="nameMax" />
      </mat-form-field>
      <!-- Plain text, not <mat-error>: signal-bound fields never put mat-form-field into
           the error state that would reveal one. -->
      @if (nameError()) { <div class="err field-err">{{ nameError() }}</div> }

      <mat-form-field appearance="outline" class="wide">
        <mat-label>Address</mat-label>
        <textarea matInput rows="2" [value]="address()" (input)="address.set($any($event.target).value)"></textarea>
      </mat-form-field>

      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>Phone</mat-label>
          <input matInput [value]="phone()" (input)="phone.set($any($event.target).value)" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Email</mat-label>
          <input matInput type="email" [value]="email()" (input)="email.set($any($event.target).value)" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tax ID</mat-label>
          <input matInput [value]="taxId()" (input)="taxId.set($any($event.target).value)" />
        </mat-form-field>
      </div>

      <div class="actions">
        <button mat-flat-button [disabled]="!dirty() || !!nameError() || busy()" (click)="save()">
          <mat-icon>save</mat-icon>
          {{ busy() ? 'Saving…' : 'Save' }}
        </button>
        @if (saved()) { <span class="ok">Saved.</span> }
        @if (error()) { <span class="err">{{ error() }}</span> }
      </div>
    </mat-card>
  `,
  styles: `
    .section { padding: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.25rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); margin: 0 0 1rem; }
    .wide { width: 100%; }
    .row { display: flex; flex-wrap: wrap; gap: 1rem; }
    .row mat-form-field { flex: 1 1 12rem; }
    .actions { display: flex; align-items: center; gap: 0.75rem; }
    .ok { color: var(--mat-sys-primary); font: var(--mat-sys-body-small); }
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); }
    .field-err { margin: -0.5rem 0 0.75rem; }
  `,
})
export class ClinicProfileComponent {
  private ctx = inject(ClinicContextService);
  private store = inject(ClinicProfileStore);

  protected name = signal('');
  protected address = signal('');
  protected phone = signal('');
  protected email = signal('');
  protected taxId = signal('');

  protected busy = signal(false);
  protected saved = signal(false);
  protected error = signal<string | null>(null);

  protected nameMax = CLINIC_NAME_MAX;
  protected nameError = computed(() => clinicNameError(this.name()));

  private loaded = computed(() => {
    const a = this.ctx.access();
    return {
      name: a?.clinicName ?? '',
      address: a?.address ?? '',
      phone: a?.phone ?? '',
      email: a?.email ?? '',
      taxId: a?.taxId ?? '',
    };
  });

  protected dirty = computed(() => {
    const l = this.loaded();
    return this.name() !== l.name || this.address() !== l.address || this.phone() !== l.phone
      || this.email() !== l.email || this.taxId() !== l.taxId;
  });

  constructor() {
    // Seed the fields from context, and re-seed after a save reloads it. Typed input is
    // only clobbered when the stored values actually change, not on every context read.
    effect(() => {
      const l = this.loaded();
      this.name.set(l.name);
      this.address.set(l.address);
      this.phone.set(l.phone);
      this.email.set(l.email);
      this.taxId.set(l.taxId);
    });
  }

  async save(): Promise<void> {
    if (this.busy() || this.nameError()) return;
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      await this.store.save({
        name: this.name(),
        address: this.address(),
        phone: this.phone(),
        email: this.email(),
        taxId: this.taxId(),
      });
      this.saved.set(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not save the clinic details.');
    } finally {
      this.busy.set(false);
    }
  }
}
