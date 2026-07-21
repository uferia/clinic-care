import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { InvoiceStore } from './invoice.store';
import { ServiceStore } from './service.store';
import { BillingSettingsStore } from './billing-settings.store';
import { PatientStore } from '../patients/patient.store';
import {
  computeTotals,
  DISCOUNT_TYPES,
  DiscountType,
  CreateInvoiceItemDto,
  isTwoDpClean,
} from './billing.model';

interface DraftLine { serviceId: string | null; description: string; unitPrice: number; quantity: number; }

@Component({
  selector: 'app-invoice-form',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule, MatAutocompleteModule,
  ],
  providers: [InvoiceStore, ServiceStore, BillingSettingsStore, PatientStore],
  template: `
    <header class="toolbar">
      <a mat-icon-button routerLink="/billing"><mat-icon>arrow_back</mat-icon></a>
      <h1>New Invoice</h1>
    </header>

    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <mat-form-field appearance="outline">
          <mat-label>Patient</mat-label>
          <input matInput [ngModel]="patientQuery()" (ngModelChange)="onPatientSearch($event)"
                 [matAutocomplete]="auto" placeholder="Search patient" />
          <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pickPatient($event.option.value)">
            @for (p of patients.visiblePatients(); track p.id) {
              <mat-option [value]="p">{{ p.firstName }} {{ p.lastName }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        @if (patientId()) { <p class="chosen">Selected: {{ patientName() }}</p> }

        <mat-form-field appearance="outline">
          <mat-label>Issue date</mat-label>
          <input matInput type="date" [(ngModel)]="issueDate" />
        </mat-form-field>
      </mat-card-content>
    </mat-card>

    <mat-card appearance="outlined" class="card">
      <mat-card-content>
        <h2>Line items</h2>
        @if (services.error()) {
          <p class="error">
            Could not load the service catalog — you can still add custom lines by hand.
            <button mat-button (click)="services.reload()">Retry</button>
          </p>
        }
        @for (line of lines(); track $index) {
          <div class="line">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
              <mat-label>Service</mat-label>
              <mat-select [ngModel]="line.serviceId" (ngModelChange)="pickService($index, $event)">
                <mat-option [value]="null">Custom</mat-option>
                @for (s of services.activeServices(); track s.id) {
                  <mat-option [value]="s.id">{{ s.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
              <mat-label>Description</mat-label>
              <input matInput [ngModel]="line.description" (ngModelChange)="setLine($index, 'description', $event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
              <mat-label>Price</mat-label>
              <input matInput type="number" min="0" step="0.01" [ngModel]="line.unitPrice"
                     (ngModelChange)="setLine($index, 'unitPrice', $event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
              <mat-label>Qty</mat-label>
              <input matInput type="number" min="0" step="1" [ngModel]="line.quantity"
                     (ngModelChange)="setLine($index, 'quantity', $event)" />
            </mat-form-field>
            <button mat-icon-button (click)="removeLine($index)" aria-label="Remove line">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        <button mat-stroked-button (click)="addLine()"><mat-icon>add</mat-icon> Add line</button>
        @if (lineWarning()) { <p class="error">{{ lineWarning() }}</p> }
      </mat-card-content>
    </mat-card>

    <mat-card appearance="outlined" class="card">
      <mat-card-content class="col">
        <div class="discount-row">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
            <mat-label>Discount type</mat-label>
            <mat-select [(ngModel)]="discountType">
              <mat-option [value]="null">None</mat-option>
              @for (d of discountTypes; track d) { <mat-option [value]="d">{{ d }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
            <mat-label>Discount value</mat-label>
            <input matInput type="number" min="0" step="0.01" [(ngModel)]="discountValue" />
          </mat-form-field>
        </div>
        @if (discountWarning()) { <p class="error">{{ discountWarning() }}</p> }

        <dl class="totals">
          <dt>Subtotal</dt><dd>{{ totals().subtotal | number: '1.2-2' }}</dd>
          <dt>Discount</dt><dd>-{{ totals().discount | number: '1.2-2' }}</dd>
          <dt>{{ settings.settings().taxLabel }} ({{ settings.taxRate() }}%)</dt><dd>{{ totals().tax | number: '1.2-2' }}</dd>
          <dt class="grand">Total</dt><dd class="grand">{{ totals().total | number: '1.2-2' }}</dd>
        </dl>

        @if (err()) { <p class="error">{{ err() }}</p> }
        @if (saveBlockedReason()) {
          <p [class.error]="settings.error()" [class.muted]="!settings.error()">
            {{ saveBlockedReason() }}
            @if (settings.error()) {
              <button mat-button (click)="settings.reload()">Retry</button>
            }
          </p>
        }

        <div class="actions">
          <button mat-flat-button [disabled]="!canSave()" (click)="save()">
            <mat-icon>save</mat-icon> Create invoice
          </button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .card { margin-bottom: 1rem; max-width: 48rem; }
    .col { display: flex; flex-direction: column; gap: 0.5rem; }
    .line { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .grow { flex: 1 1 12rem; }
    .num { flex: 0 1 7rem; }
    .discount-row { display: flex; gap: 0.5rem; }
    .chosen { color: var(--mat-sys-on-surface-variant); margin: 0; }
    .totals { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 2rem; max-width: 20rem; margin-left: auto; }
    .totals dd { margin: 0; text-align: right; }
    .totals .grand { font: var(--mat-sys-title-medium); }
    .actions { display: flex; justify-content: flex-end; }
    .error { color: var(--mat-sys-error); }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class InvoiceFormComponent {
  private invoices = inject(InvoiceStore);
  services = inject(ServiceStore);
  settings = inject(BillingSettingsStore);
  patients = inject(PatientStore);
  private router = inject(Router);

  discountTypes = DISCOUNT_TYPES;
  issueDate = new Date().toISOString().slice(0, 10);
  discountType = signal<DiscountType | null>(null);
  discountValue = signal<number>(0);
  patientId = signal<string | null>(null);
  patientName = signal('');
  patientQuery = signal('');
  saving = signal(false);
  err = signal('');

  lines = signal<DraftLine[]>([{ serviceId: null, description: '', unitPrice: 0, quantity: 1 }]);

  // The single source of truth for which lines are real: a non-empty
  // description, a non-negative 2dp-clean price, and a 2dp-clean quantity of
  // at least one cent-equivalent (0.01) — the quantity check's shape
  // (`Number.isFinite(n) && Math.round(n * 100) >= 1`) deliberately mirrors
  // invoice-detail.component.ts's `canRecord` guard so the two cannot drift
  // conceptually. Everything that gets previewed, saved, or gates
  // save-ability must derive from this same set so the previewed total and
  // the saved invoice (after the DB's numeric(12,2) rounding) can never
  // disagree.
  savableLines = computed(() =>
    this.lines().filter(l =>
      l.description.trim() !== '' &&
      Number.isFinite(l.unitPrice) && l.unitPrice >= 0 && isTwoDpClean(l.unitPrice) &&
      Number.isFinite(l.quantity) && Math.round(l.quantity * 100) >= 1 && isTwoDpClean(l.quantity),
    ),
  );

  // Rows the user has clearly started (typed a description or entered a
  // price) but that don't qualify as savable — e.g. a description with
  // quantity left at 0, or sub-cent price/quantity input. These must not be
  // silently dropped: surface them.
  invalidLineNumbers = computed(() => {
    const savable = new Set(this.savableLines());
    const nums: number[] = [];
    this.lines().forEach((l, i) => {
      const started = l.description.trim() !== '' || l.unitPrice > 0;
      if (started && !savable.has(l)) nums.push(i + 1);
    });
    return nums;
  });

  lineWarning = computed(() => {
    const nums = this.invalidLineNumbers();
    if (!nums.length) return '';
    const label = nums.length === 1 ? `Line ${nums[0]}` : `Lines ${nums.join(', ')}`;
    const pronoun = nums.length === 1 ? 'it' : 'them';
    return `${label} will not be included on the invoice — add a description, a price of 0 or more, and a quantity of at least 0.01, both to 2 decimal places, to include ${pronoun}.`;
  });

  // The DB's `invoices_discount_percent_bounded` check constraint caps a
  // percent discount at 100 — a typed value above that (e.g. entering
  // "percent / 150" style input) would otherwise render a negative discount
  // and negative tax in the on-screen preview before the save fails with a
  // raw Postgres constraint error. Surfaced via `discountWarning` below
  // rather than rewritten here: the typed `discountValue` signal is left
  // alone so the user's input isn't silently changed out from under them;
  // only the *preview* computation clamps it.
  discountWarning = computed(() => {
    if (this.discountType() === 'percent' && (Number(this.discountValue()) || 0) > 100) {
      return 'Percent discount cannot exceed 100 — reduce the value to create this invoice.';
    }
    return '';
  });

  totals = computed(() => {
    const raw = Number(this.discountValue()) || 0;
    const discountValue = this.discountType() === 'percent' ? Math.min(raw, 100) : raw;
    return computeTotals(this.savableLines(), this.discountType(), discountValue, this.settings.taxRate());
  });

  // Billing settings must have actually resolved before an invoice can be
  // created — `BillingSettingsStore.taxRate()` silently falls back to
  // DEFAULTS (tax rate 0) whenever the settings resource lacks a value,
  // INCLUDING the error state. Without this gate, a transient settings-load
  // failure would produce an invoice permanently snapshotted at
  // `tax_rate = 0` — under-billed by the entire tax amount, with no
  // preview/DB mismatch to ever flag it (preview and DB would both agree on
  // the wrong, zero-tax number).
  canSave = computed(() =>
    !!this.patientId() && this.savableLines().length > 0 && !this.saving() &&
    this.settings.resolved() && !this.discountWarning(),
  );

  // Explains a disabled Create-invoice button when the block is the settings
  // load rather than missing patient/lines — so the user can tell why they
  // can't save instead of a mysteriously-disabled button.
  saveBlockedReason = computed(() => {
    if (this.settings.resolved()) return '';
    if (this.settings.error()) return 'Billing settings failed to load — tax rate cannot be determined safely, so invoices cannot be created right now.';
    return 'Loading billing settings…';
  });

  onPatientSearch(q: string) { this.patientQuery.set(q); this.patients.setSearch(q); }
  pickPatient(p: { id: string; firstName: string; lastName: string }) {
    this.patientId.set(p.id);
    this.patientName.set(`${p.firstName} ${p.lastName}`);
    this.patientQuery.set(`${p.firstName} ${p.lastName}`);
  }

  addLine() {
    this.lines.update(ls => [...ls, { serviceId: null, description: '', unitPrice: 0, quantity: 1 }]);
  }
  removeLine(i: number) { this.lines.update(ls => ls.filter((_, idx) => idx !== i)); }
  setLine(i: number, key: keyof DraftLine, value: unknown) {
    this.lines.update(ls => ls.map((l, idx) =>
      idx === i ? { ...l, [key]: key === 'unitPrice' || key === 'quantity' ? Number(value) || 0 : value } : l));
  }
  pickService(i: number, serviceId: string | null) {
    const svc = this.services.activeServices().find(s => s.id === serviceId);
    this.lines.update(ls => ls.map((l, idx) =>
      idx === i ? { ...l, serviceId, description: svc?.name ?? l.description, unitPrice: svc?.price ?? l.unitPrice } : l));
  }

  async save() {
    if (this.saving() || !this.canSave()) return;
    this.saving.set(true);
    this.err.set('');
    const items: CreateInvoiceItemDto[] = this.savableLines()
      .map(l => ({ serviceId: l.serviceId, description: l.description.trim(), unitPrice: l.unitPrice, quantity: l.quantity }));
    try {
      const id = await this.invoices.create(
        {
          patientId: this.patientId()!,
          appointmentId: null,
          issueDate: this.issueDate,
          discountType: this.discountType(),
          discountValue: Number(this.discountValue()) || 0,
          taxRate: this.settings.taxRate(),
          notes: '',
        },
        items,
      );
      await this.router.navigate(['/billing', id]);
    } catch (e) {
      // Leave the patient selection and all entered lines intact so the user
      // can retry without re-typing — `create()` is not transactional and a
      // rejection here does not mean nothing was entered wrong, just that we
      // must not navigate away or discard their work.
      this.err.set(e instanceof Error ? e.message : 'Could not create invoice.');
    } finally {
      this.saving.set(false);
    }
  }
}
