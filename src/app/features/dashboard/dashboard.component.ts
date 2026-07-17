import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardStore } from './dashboard.store';

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    DatePipe,
    TitleCasePipe,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  template: `
    <header class="toolbar">
      <h1>Dashboard</h1>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="store.reload()">
        <mat-icon>refresh</mat-icon>
        Refresh
      </button>
    </header>

    @if (store.isLoading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load dashboard data.</p>
        <button mat-stroked-button (click)="store.reload()">
          <mat-icon>refresh</mat-icon>
          Retry
        </button>
      </div>
    } @else {
      <!-- Headline numbers are stat tiles, not one-bar charts. -->
      <section class="kpis" aria-label="Key figures">
        <mat-card appearance="outlined" class="kpi">
          <mat-card-content>
            <span class="kpi-label">Patients</span>
            <span class="kpi-value">{{ store.patientCount() }}</span>
            <a class="kpi-link" routerLink="/patients">View all</a>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="kpi">
          <mat-card-content>
            <span class="kpi-label">Doctors available</span>
            <span class="kpi-value">
              {{ store.doctorsAvailable() }}<span class="kpi-of">/{{ store.doctorCount() }}</span>
            </span>
            <a class="kpi-link" routerLink="/doctors">View all</a>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="kpi">
          <mat-card-content>
            <span class="kpi-label">Upcoming</span>
            <span class="kpi-value">{{ store.upcomingCount() }}</span>
            <a class="kpi-link" routerLink="/appointments">View all</a>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="kpi">
          <mat-card-content>
            <span class="kpi-label">Cancelled</span>
            <span class="kpi-value">{{ store.cancelledCount() }}</span>
            <span class="kpi-link muted">of {{ store.appointments().length }} total</span>
          </mat-card-content>
        </mat-card>
      </section>

      <div class="charts">
        <!-- Chart 1: magnitude across four named states. Status hues are
             reserved and every bar is directly labeled, so hue never carries
             meaning alone. -->
        <mat-card appearance="outlined" class="chart-card">
          <mat-card-content>
            <div class="chart-head">
              <h2>Appointments by status</h2>
              <button mat-icon-button class="table-toggle"
                      [attr.aria-label]="showStatusTable() ? 'Show chart' : 'Show as table'"
                      [matTooltip]="showStatusTable() ? 'Show chart' : 'Show as table'"
                      (click)="showStatusTable.set(!showStatusTable())">
                <mat-icon>{{ showStatusTable() ? 'bar_chart' : 'table_rows' }}</mat-icon>
              </button>
            </div>

            @if (showStatusTable()) {
              <table class="data-table">
                <thead><tr><th>Status</th><th>Appointments</th></tr></thead>
                <tbody>
                  @for (d of store.byStatus(); track d.status) {
                    <tr><td>{{ d.status | titlecase }}</td><td>{{ d.count }}</td></tr>
                  }
                </tbody>
              </table>
            } @else if (statusMax() === 0) {
              <p class="muted empty">No appointments yet.</p>
            } @else {
              <div class="hbars">
                @for (d of store.byStatus(); track d.status) {
                  <div class="hbar-row"
                       (mouseenter)="hoverStatus.set(d.status)"
                       (mouseleave)="hoverStatus.set(null)">
                    <span class="hbar-label">
                      <span class="dot" [attr.data-status]="d.status"></span>
                      {{ d.status | titlecase }}
                    </span>
                    <div class="hbar-track">
                      <div class="hbar-fill"
                           [attr.data-status]="d.status"
                           [class.dim]="hoverStatus() && hoverStatus() !== d.status"
                           [style.width.%]="d.count / statusMax() * 100"></div>
                    </div>
                    <span class="hbar-value">{{ d.count }}</span>
                  </div>
                }
              </div>
            }
          </mat-card-content>
        </mat-card>

        <!-- Chart 2: trend over time, single series -> one hue, no legend
             (the title names it). Validated teal, passes all gates both modes. -->
        <mat-card appearance="outlined" class="chart-card">
          <mat-card-content>
            <div class="chart-head">
              <h2>Bookings per day</h2>
              <button mat-icon-button class="table-toggle"
                      [attr.aria-label]="showDayTable() ? 'Show chart' : 'Show as table'"
                      [matTooltip]="showDayTable() ? 'Show chart' : 'Show as table'"
                      (click)="showDayTable.set(!showDayTable())">
                <mat-icon>{{ showDayTable() ? 'bar_chart' : 'table_rows' }}</mat-icon>
              </button>
            </div>

            @if (showDayTable()) {
              <table class="data-table">
                <thead><tr><th>Date</th><th>Bookings</th></tr></thead>
                <tbody>
                  @for (d of store.byDay(); track d.date) {
                    <tr><td>{{ d.date | date: 'EEE d MMM' }}</td><td>{{ d.count }}</td></tr>
                  }
                </tbody>
              </table>
            } @else if (!store.byDay().length) {
              <p class="muted empty">No bookings yet.</p>
            } @else {
              <div class="columns" role="img"
                   [attr.aria-label]="'Bookings per day: ' + dayAria()">
                @for (d of store.byDay(); track d.date) {
                  <div class="col-wrap"
                       (mouseenter)="hoverDay.set(d.date)"
                       (mouseleave)="hoverDay.set(null)">
                    <span class="col-value" [class.show]="hoverDay() === d.date">{{ d.count }}</span>
                    <div class="col-track">
                      <div class="col-fill"
                           [class.dim]="hoverDay() && hoverDay() !== d.date"
                           [style.height.%]="d.count / dayMax() * 100"></div>
                    </div>
                    <span class="col-label">{{ d.date | date: 'd MMM' }}</span>
                  </div>
                }
              </div>
            }
          </mat-card-content>
        </mat-card>
      </div>

      <mat-card appearance="outlined" class="upcoming-card">
        <mat-card-content>
          <div class="chart-head">
            <h2>Next appointments</h2>
            <a mat-button routerLink="/appointments">See all</a>
          </div>

          @if (store.upcoming().length) {
            <ul class="upcoming">
              @for (r of store.upcoming().slice(0, 6); track r.id) {
                <li>
                  <span class="up-when">{{ r.when | date: 'EEE d MMM, h:mm a' }}</span>
                  <span class="up-who">{{ r.patientName }}</span>
                  <span class="up-doc muted">{{ r.doctorName }}</span>
                  <span class="status-chip" [attr.data-status]="r.status">
                    {{ r.status | titlecase }}
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="muted empty">Nothing scheduled ahead.</p>
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }

    h2 {
      font: var(--mat-sys-title-small);
      margin: 0;
    }

    .spacer {
      flex: 1 1 auto;
    }

    /* --- KPI row --- */
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .kpi mat-card-content {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .kpi-label {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    /* Hero figure: large, sans, text token — never a series color. */
    .kpi-value {
      font-size: 2.25rem;
      line-height: 1.15;
      font-weight: 400;
      color: var(--mat-sys-on-surface);
      font-variant-numeric: tabular-nums;
    }

    .kpi-of {
      font-size: 1.125rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .kpi-link {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-primary);
      text-decoration: none;
      width: fit-content;
      margin-top: 0.25rem;
    }

    .kpi-link:hover {
      text-decoration: underline;
    }

    .kpi-link.muted {
      color: var(--mat-sys-on-surface-variant);
    }

    /* --- charts --- */
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .chart-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .empty {
      padding: 2rem 0;
      text-align: center;
      margin: 0;
    }

    /* Horizontal bars: thin marks, rounded data-end, recessive track. */
    .hbars {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
    }

    .hbar-row {
      display: grid;
      grid-template-columns: 7rem 1fr 2rem;
      align-items: center;
      gap: 0.625rem;
      cursor: default;
    }

    .hbar-label {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface);
    }

    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--mat-sys-outline);
      flex: none;
    }

    /* 'completed' has no reserved status hue — it is a terminal state, not an
       alert — so it stays neutral rather than borrowing the chart series hue. */
    .dot[data-status='confirmed'] { background: var(--status-good); }
    .dot[data-status='pending'] { background: var(--status-warning); }
    .dot[data-status='cancelled'] { background: var(--status-critical); }

    .hbar-track {
      height: 0.75rem;
      border-radius: 0.375rem;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }

    .hbar-fill {
      height: 100%;
      border-radius: 0.25rem;
      background: var(--mat-sys-outline);
      transition: opacity 120ms ease;
      min-width: 0.25rem;
    }

    .hbar-fill[data-status='confirmed'] { background: var(--status-good); }
    .hbar-fill[data-status='pending'] { background: var(--status-warning); }
    .hbar-fill[data-status='cancelled'] { background: var(--status-critical); }

    .hbar-fill.dim {
      opacity: 0.35;
    }

    .hbar-value {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Columns: single hue, baseline-anchored, 2px gap between marks. */
    .columns {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      height: 11rem;
    }

    .col-wrap {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      height: 100%;
      cursor: default;
      min-width: 0;
    }

    .col-value {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface);
      opacity: 0;
      transition: opacity 120ms ease;
      font-variant-numeric: tabular-nums;
    }

    .col-value.show {
      opacity: 1;
    }

    .col-track {
      flex: 1 1 auto;
      width: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .col-fill {
      width: 100%;
      max-width: 2.5rem;
      background: var(--chart-teal);
      border-radius: 0.25rem 0.25rem 0 0;
      transition: opacity 120ms ease;
      min-height: 0.125rem;
    }

    .col-fill.dim {
      opacity: 0.35;
    }

    .col-label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      font-size: 0.625rem;
    }

    /* --- table view --- */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-small);
    }

    .data-table th,
    .data-table td {
      text-align: left;
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .data-table th {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 500;
    }

    .data-table td:last-child,
    .data-table th:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* --- upcoming --- */
    .upcoming {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .upcoming li {
      display: grid;
      grid-template-columns: 11rem 1fr 1fr auto;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .upcoming li:last-child {
      border-bottom: none;
    }

    .up-when {
      font: var(--mat-sys-label-medium);
    }

    .up-who {
      font-weight: 500;
    }

    .up-doc,
    .up-who {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 37.5rem) {
      .upcoming li {
        grid-template-columns: 1fr auto;
        row-gap: 0.125rem;
      }

      .up-when {
        grid-column: 1 / -1;
        color: var(--mat-sys-on-surface-variant);
      }

      .up-doc {
        grid-column: 1 / -1;
      }

      .hbar-row {
        grid-template-columns: 5.5rem 1fr 1.75rem;
      }
    }
  `,
})
export class DashboardComponent {
  store = inject(DashboardStore);

  showStatusTable = signal(false);
  showDayTable = signal(false);
  hoverStatus = signal<string | null>(null);
  hoverDay = signal<string | null>(null);

  statusMax = computed(() =>
    Math.max(0, ...this.store.byStatus().map(d => d.count)),
  );

  dayMax = computed(() => Math.max(1, ...this.store.byDay().map(d => d.count)));

  dayAria = computed(() =>
    this.store.byDay().map(d => `${d.date}: ${d.count}`).join(', '),
  );
}
