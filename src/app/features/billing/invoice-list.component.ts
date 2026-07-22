import { Component, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { InvoiceStore } from './invoice.store';
import { INVOICE_STATUSES } from './billing.model';

@Component({
  selector: 'app-invoice-list',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatFormFieldModule, MatSelectModule,
    MatInputModule, MatButtonModule, MatIconModule, MatTableModule,
    MatPaginatorModule, MatProgressBarModule,
  ],
  providers: [InvoiceStore],
  template: `
    <header class="toolbar">
      <h1>Invoices</h1>
      <span class="spacer"></span>
      <a mat-flat-button routerLink="new"><mat-icon>add</mat-icon> New Invoice</a>
    </header>

    <div class="filters">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="status">
        <mat-label>Status</mat-label>
        <mat-select [ngModel]="store.status()" (ngModelChange)="store.setStatus($event)">
          <mat-option value="">All</mat-option>
          @for (s of statuses; track s) {
            <mat-option [value]="s">{{ s }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>From</mat-label>
        <input matInput type="date" [ngModel]="fromDate" (ngModelChange)="onFrom($event)" />
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>To</mat-label>
        <input matInput type="date" [ngModel]="toDate" (ngModelChange)="onTo($event)" />
      </mat-form-field>
    </div>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load invoices.</p>
        <button mat-stroked-button (click)="store.reload()">Retry</button>
      </div>
    } @else if (store.invoices().length) {
      <table mat-table [dataSource]="store.invoices()">
        <ng-container matColumnDef="number">
          <th mat-header-cell *matHeaderCellDef>Invoice</th>
          <td mat-cell *matCellDef="let i"><a [routerLink]="[i.id]">{{ i.number }}</a></td>
        </ng-container>
        <ng-container matColumnDef="patient">
          <th mat-header-cell *matHeaderCellDef>Patient</th>
          <td mat-cell *matCellDef="let i">{{ i.patientName }}</td>
        </ng-container>
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Date</th>
          <td mat-cell *matCellDef="let i">{{ i.issueDate }}</td>
        </ng-container>
        <ng-container matColumnDef="total">
          <th mat-header-cell *matHeaderCellDef>Total</th>
          <td mat-cell *matCellDef="let i">{{ i.total | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="balance">
          <th mat-header-cell *matHeaderCellDef>Balance</th>
          <td mat-cell *matCellDef="let i">{{ i.balance | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let i">
            <span class="badge" [attr.data-status]="i.status">{{ i.status }}</span>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>

      <mat-paginator
        [length]="store.total()"
        [pageSize]="store.pageSize"
        [pageIndex]="store.page() - 1"
        [hidePageSize]="true"
        (page)="onPage($event)" />
    } @else {
      <div class="state"><p class="muted">No invoices found.</p></div>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .filters { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .status { flex: 0 1 10rem; }
    table { width: 100%; }
    .badge { padding: 0.125rem 0.5rem; border-radius: 1rem; font: var(--mat-sys-label-small);
             background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .badge[data-status='paid'] { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .badge[data-status='void'] { text-decoration: line-through; }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class InvoiceListComponent {
  store = inject(InvoiceStore);
  statuses = INVOICE_STATUSES;
  cols = ['number', 'patient', 'date', 'total', 'balance', 'status'];
  fromDate = '';
  toDate = '';

  constructor() {
    // `InvoiceStore` mutations (void, addPayment, create) call `reload()` against
    // whatever page is currently set, so a filter change or a mutation that
    // shrinks the result set below the current page leaves `page()` pointing
    // past the end — the table would render empty with no way back short of a
    // manual paginator click. Snap back to the last valid page whenever the
    // current page no longer fits the loaded `total()`.
    effect(() => {
      const total = this.store.total();
      const page = this.store.page();
      if (this.store.isLoading()) return;
      const lastPage = Math.max(1, Math.ceil(total / this.store.pageSize));
      if (page > lastPage) this.store.setPage(lastPage);
    });
  }

  onFrom(v: string) { this.fromDate = v; this.store.setDateRange(v, this.toDate); }
  onTo(v: string) { this.toDate = v; this.store.setDateRange(this.fromDate, v); }
  onPage(e: PageEvent) { this.store.setPage(e.pageIndex + 1); }
}
