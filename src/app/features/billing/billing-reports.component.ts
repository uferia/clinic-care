import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { toIsoDate } from '../../core/date.util';
import { downloadCsv, toCsv } from '../../core/csv';
import { ReportsStore } from './reports.store';

@Component({
  selector: 'app-billing-reports',
  imports: [
    RouterLink, FormsModule, DecimalPipe, MatCardModule, MatDatepickerModule,
    MatFormFieldModule, MatInputModule, MatProgressBarModule, MatTableModule,
    MatButtonModule, MatIconModule,
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
            <input
              matInput
              [matDatepicker]="dayPicker"
              [max]="today"
              [ngModel]="day()"
              (ngModelChange)="onDay($event)" />
            <mat-datepicker-toggle matIconSuffix [for]="dayPicker" />
            <mat-datepicker #dayPicker />
          </mat-form-field>
          <p class="figure">{{ store.dayNet() | number: '1.2-2' }}</p>
          <p class="muted">
            {{ store.dayPaymentCount() }} payment(s)
            @if (store.dayRefundCount()) { &middot; {{ store.dayRefundCount() }} refund(s) }
          </p>
          <button
            mat-stroked-button
            [disabled]="!store.dayPayments().length"
            (click)="exportDay()">
            <mat-icon>download</mat-icon>
            Export CSV
          </button>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Revenue by period</h2>
          <div class="range">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>From</mat-label>
              <input
                matInput
                [matDatepicker]="fromPicker"
                [max]="to() ?? today"
                [ngModel]="from()"
                (ngModelChange)="onFrom($event)" />
              <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
              <mat-datepicker #fromPicker />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>To</mat-label>
              <input
                matInput
                [matDatepicker]="toPicker"
                [min]="from()"
                [max]="today"
                [ngModel]="to()"
                (ngModelChange)="onTo($event)" />
              <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
              <mat-datepicker #toPicker />
            </mat-form-field>
          </div>
          <p class="figure">{{ store.periodNet() | number: '1.2-2' }}</p>
        </mat-card-content>
      </mat-card>
    </div>

    <mat-card appearance="outlined" class="card">
      <mat-card-content>
        <div class="section-head">
          <h2>Outstanding balances — {{ store.outstandingTotal() | number: '1.2-2' }}</h2>
          <button
            mat-stroked-button
            [disabled]="!store.outstanding().length"
            (click)="exportOutstanding()">
            <mat-icon>download</mat-icon>
            Export CSV
          </button>
        </div>
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
    .section-head { display: flex; align-items: baseline; gap: 1rem; }
    .section-head h2 { flex: 1; }
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

  // Cash basis: these report money already received, so a future date is not a
  // question that can have an answer — it would silently render 0.00, reading
  // as "we took nothing" rather than "that range is meaningless". Capped here,
  // and From/To additionally bound each other so the range can never invert.
  readonly today = new Date();

  day = signal<Date | null>(new Date());
  from = signal<Date | null>(new Date());
  to = signal<Date | null>(new Date());

  // Same load-error convention as BillingSettingsComponent: a plain computed
  // paragraph, no MatSnackBar (unused anywhere in this repo).
  loadError = computed(() => {
    const e = this.store.error();
    if (!e) return '';
    return e instanceof Error ? e.message : 'Could not load reports.';
  });

  // The datepicker deals in `Date`; the store deals in `YYYY-MM-DD`. `toIsoDate`
  // formats from local date components — `toISOString()` would resolve the day
  // in UTC and hand the store yesterday for anyone east of Greenwich.
  onDay(d: Date | null) {
    if (!d) return;
    this.day.set(d);
    this.store.setDay(toIsoDate(d));
  }

  onFrom(d: Date | null) {
    if (!d) return;
    this.from.set(d);
    this.pushRange();
  }

  onTo(d: Date | null) {
    if (!d) return;
    this.to.set(d);
    this.pushRange();
  }

  private pushRange() {
    const from = this.from();
    const to = this.to();
    if (!from || !to) return;
    this.store.setRange(toIsoDate(from), toIsoDate(to));
  }

  /**
   * Amounts are written unformatted (no thousands separator, plain minus for a
   * refund) so a spreadsheet reads them as numbers rather than text.
   */
  exportDay() {
    const day = this.day();
    if (!day) return;
    const rows = this.store.dayPayments().map(p => [
      p.paidAt,
      p.invoiceNumber,
      p.kind,
      p.kind === 'refund' ? -p.amount : p.amount,
      p.note,
    ]);
    downloadCsv(
      `cash-close-${toIsoDate(day)}.csv`,
      toCsv(['Paid at', 'Invoice', 'Kind', 'Amount', 'Note'], rows),
    );
  }

  exportOutstanding() {
    const rows = this.store.outstanding().map(o => [o.number, o.patientName, o.balance]);
    downloadCsv(
      `outstanding-${toIsoDate(new Date())}.csv`,
      toCsv(['Invoice', 'Patient', 'Balance'], rows),
    );
  }
}
