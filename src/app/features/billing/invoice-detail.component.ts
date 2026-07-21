import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, SlicePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { InvoiceStore } from './invoice.store';
import { BillingSettingsStore } from './billing-settings.store';
import { computeTotals, Invoice, InvoiceItem, Payment, PaymentKind } from './billing.model';

@Component({
  selector: 'app-invoice-detail',
  imports: [
    RouterLink, FormsModule, DecimalPipe, SlicePipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule,
  ],
  providers: [InvoiceStore, BillingSettingsStore],
  template: `
    @if (loadError()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Could not load this invoice.</p>
        <button mat-stroked-button (click)="reload()">Retry</button>
      </div>
    } @else if (invoice(); as inv) {
      <header class="toolbar no-print">
        <a mat-icon-button routerLink="/billing"><mat-icon>arrow_back</mat-icon></a>
        <h1>{{ inv.number }}</h1>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="print()"><mat-icon>print</mat-icon> Print</button>
        @if (!inv.voided) {
          <button mat-stroked-button color="warn" [disabled]="busy()" (click)="voidInvoice(inv.id)">
            <mat-icon>block</mat-icon> Void
          </button>
        }
      </header>

      @if (err()) { <p class="error no-print">{{ err() }}</p> }

      <mat-card appearance="outlined" class="card">
        <mat-card-content>
          @if (inv.voided) { <p class="voided-banner">VOIDED</p> }
          <p><strong>Issue date:</strong> {{ inv.issueDate }}</p>

          <table mat-table [dataSource]="items()" class="lines">
            <ng-container matColumnDef="description">
              <th mat-header-cell *matHeaderCellDef>Description</th>
              <td mat-cell *matCellDef="let it">{{ it.description }}</td>
            </ng-container>
            <ng-container matColumnDef="qty">
              <th mat-header-cell *matHeaderCellDef>Qty</th>
              <td mat-cell *matCellDef="let it">{{ it.quantity }}</td>
            </ng-container>
            <ng-container matColumnDef="price">
              <th mat-header-cell *matHeaderCellDef>Price</th>
              <td mat-cell *matCellDef="let it">{{ it.unitPrice | number: '1.2-2' }}</td>
            </ng-container>
            <ng-container matColumnDef="lineTotal">
              <th mat-header-cell *matHeaderCellDef>Total</th>
              <td mat-cell *matCellDef="let it">{{ it.unitPrice * it.quantity | number: '1.2-2' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="itemCols"></tr>
            <tr mat-row *matRowDef="let row; columns: itemCols"></tr>
          </table>

          <dl class="totals">
            <dt>Subtotal</dt><dd>{{ totals().subtotal | number: '1.2-2' }}</dd>
            <dt>Discount</dt><dd>-{{ totals().discount | number: '1.2-2' }}</dd>
            <dt>{{ settings.settings().taxLabel }} ({{ inv.taxRate }}%)</dt><dd>{{ totals().tax | number: '1.2-2' }}</dd>
            <dt class="grand">Total</dt><dd class="grand">{{ totals().total | number: '1.2-2' }}</dd>
            <dt>Paid</dt><dd>{{ paid() | number: '1.2-2' }}</dd>
            <dt class="grand">Balance</dt><dd class="grand">{{ totals().total - paid() | number: '1.2-2' }}</dd>
          </dl>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined" class="card">
        <mat-card-content>
          <h2>Payments</h2>
          @for (p of payments(); track p.id) {
            <div class="pay-row">
              <span>{{ p.paidAt | slice: 0:10 }}</span>
              <span>{{ p.kind }}</span>
              <span>{{ (p.kind === 'refund' ? -p.amount : p.amount) | number: '1.2-2' }}</span>
              <span class="muted">{{ p.note }}</span>
            </div>
          } @empty { <p class="muted">No payments yet.</p> }

          @if (!inv.voided) {
            <div class="add-pay no-print">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
                <mat-label>Amount</mat-label>
                <input matInput type="number" min="0" step="0.01" [(ngModel)]="payAmount" />
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                <mat-label>Note</mat-label>
                <input matInput [(ngModel)]="payNote" />
              </mat-form-field>
              <button mat-flat-button [disabled]="!canRecord() || busy()" (click)="record('payment')">
                <mat-icon>payments</mat-icon> Record payment
              </button>
              <button mat-stroked-button [disabled]="!canRecord() || busy()" (click)="record('refund')">
                <mat-icon>undo</mat-icon> Refund
              </button>
            </div>
          }
        </mat-card-content>
      </mat-card>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .spacer { flex: 1 1 auto; }
    .card { margin-bottom: 1rem; max-width: 48rem; }
    .lines { width: 100%; margin-bottom: 1rem; }
    .totals { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 2rem; max-width: 22rem; margin-left: auto; }
    .totals dd { margin: 0; text-align: right; }
    .totals .grand { font: var(--mat-sys-title-medium); }
    .pay-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr; gap: 0.5rem; padding: 0.25rem 0; }
    .add-pay { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 1rem; }
    .num { flex: 0 1 9rem; } .grow { flex: 1 1 12rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    .voided-banner { color: var(--mat-sys-error); font: var(--mat-sys-title-medium); }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    @media print { .no-print { display: none !important; } }
  `,
})
export class InvoiceDetailComponent {
  private store = inject(InvoiceStore);
  settings = inject(BillingSettingsStore);
  private route = inject(ActivatedRoute);

  itemCols = ['description', 'qty', 'price', 'lineTotal'];
  invoice = signal<Invoice | null>(null);
  items = signal<InvoiceItem[]>([]);
  payments = signal<Payment[]>([]);
  loadError = signal(false);
  busy = signal(false);
  payAmount = signal<number>(0);
  payNote = signal('');
  err = signal('');

  totals = computed(() => {
    const inv = this.invoice();
    if (!inv) return { subtotal: 0, discount: 0, tax: 0, total: 0 };
    return computeTotals(this.items(), inv.discountType, inv.discountValue, inv.taxRate);
  });
  paid = computed(() =>
    this.payments().reduce((s, p) => s + (p.kind === 'payment' ? p.amount : -p.amount), 0),
  );

  // Guards against blank/NaN/zero/negative/sub-cent input from the
  // `type="number"` field — `step` isn't enforced against direct keyboard
  // entry, so e.g. `0.001` would otherwise pass a plain `n > 0` check, reach
  // the store, get coerced to 0.00 by the `numeric(12,2)` column, and trip
  // the DB's `check (amount > 0)` as a raw Postgres error instead of just
  // staying disabled.
  canRecord = computed(() => {
    const n = Number(this.payAmount());
    return Number.isFinite(n) && Math.round(n * 100) >= 1;
  });

  constructor() {
    this.reload();
  }

  async reload() {
    this.loadError.set(false);
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loadError.set(true); return; }
    try {
      const res = await this.store.loadOne(id);
      if (!res) { this.loadError.set(true); return; }
      this.invoice.set(res.invoice);
      this.items.set(res.items);
      this.payments.set(res.payments);
    } catch {
      this.loadError.set(true);
    }
  }

  async record(kind: PaymentKind) {
    const inv = this.invoice();
    if (!inv || !this.canRecord()) return;
    this.busy.set(true);
    this.err.set('');
    try {
      await this.store.addPayment({
        invoiceId: inv.id,
        kind,
        amount: Number(this.payAmount()),
        note: this.payNote().trim(),
      });
      this.payAmount.set(0);
      this.payNote.set('');
      await this.reload();
    } catch (e) {
      // Leave the entered amount/note intact so the user can retry without
      // re-typing — a thrown addPayment must not look like a success.
      this.err.set(e instanceof Error ? e.message : `Could not record ${kind}.`);
    } finally {
      this.busy.set(false);
    }
  }

  async voidInvoice(id: string) {
    this.busy.set(true);
    this.err.set('');
    try {
      await this.store.void(id);
      await this.reload();
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Could not void invoice.');
    } finally {
      this.busy.set(false);
    }
  }

  print() { window.print(); }
}
