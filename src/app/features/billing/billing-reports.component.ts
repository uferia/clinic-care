import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { ReportsStore } from './reports.store';

@Component({
  selector: 'app-billing-reports',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatCardModule, MatFormFieldModule,
    MatInputModule, MatProgressBarModule, MatTableModule,
  ],
  providers: [ReportsStore],
  template: `
    <header class="toolbar"><h1>Billing Reports</h1></header>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
    @if (loadError()) { <p class="error">{{ loadError() }}</p> }

    <div class="cards">
      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Daily cash close</h2>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Day</mat-label>
            <input matInput type="date" [ngModel]="day" (ngModelChange)="onDay($event)" />
          </mat-form-field>
          <p class="figure">{{ store.dayNet() | number: '1.2-2' }}</p>
          <p class="muted">
            {{ store.dayPaymentCount() }} payment(s)
            @if (store.dayRefundCount()) { &middot; {{ store.dayRefundCount() }} refund(s) }
          </p>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Revenue by period</h2>
          <div class="range">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>From</mat-label>
              <input matInput type="date" [ngModel]="from" (ngModelChange)="onFrom($event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>To</mat-label>
              <input matInput type="date" [ngModel]="to" (ngModelChange)="onTo($event)" />
            </mat-form-field>
          </div>
          <p class="figure">{{ store.periodNet() | number: '1.2-2' }}</p>
        </mat-card-content>
      </mat-card>
    </div>

    <mat-card appearance="outlined" class="card">
      <mat-card-content>
        <h2>Outstanding balances — {{ store.outstandingTotal() | number: '1.2-2' }}</h2>
        @if (store.outstanding().length) {
          <table mat-table [dataSource]="store.outstanding()">
            <ng-container matColumnDef="number">
              <th mat-header-cell *matHeaderCellDef>Invoice</th>
              <td mat-cell *matCellDef="let o"><a [routerLink]="['/billing', o.id]">{{ o.number }}</a></td>
            </ng-container>
            <ng-container matColumnDef="patient">
              <th mat-header-cell *matHeaderCellDef>Patient</th>
              <td mat-cell *matCellDef="let o">{{ o.patientName }}</td>
            </ng-container>
            <ng-container matColumnDef="balance">
              <th mat-header-cell *matHeaderCellDef>Balance</th>
              <td mat-cell *matCellDef="let o">{{ o.balance | number: '1.2-2' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="cols"></tr>
            <tr mat-row *matRowDef="let row; columns: cols"></tr>
          </table>
        } @else { <p class="muted">Nothing outstanding.</p> }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .toolbar { margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-small); margin: 0 0 0.5rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .card { max-width: 48rem; }
    .range { display: flex; gap: 0.5rem; }
    .figure { font: var(--mat-sys-headline-medium); margin: 0.5rem 0 0; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    table { width: 100%; }
  `,
})
export class BillingReportsComponent {
  store = inject(ReportsStore);
  cols = ['number', 'patient', 'balance'];
  day = new Date().toISOString().slice(0, 10);
  from = this.day;
  to = this.day;

  // Same load-error convention as BillingSettingsComponent: a plain computed
  // paragraph, no MatSnackBar (unused anywhere in this repo).
  loadError = computed(() => {
    const e = this.store.error();
    if (!e) return '';
    return e instanceof Error ? e.message : 'Could not load reports.';
  });

  onDay(v: string) { this.day = v; this.store.setDay(v); }
  onFrom(v: string) { this.from = v; this.store.setRange(v, this.to); }
  onTo(v: string) { this.to = v; this.store.setRange(this.from, v); }
}
