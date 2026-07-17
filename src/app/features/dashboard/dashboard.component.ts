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
      <div class="title-block">
        <h1>Dashboard</h1>
        <p class="today">{{ today | date: 'EEEE d MMMM' }}</p>
      </div>
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
      <!-- Headline numbers are stat tiles, not one-bar charts. Each tile is one
           link target rather than repeating a "View all" affordance. -->
      <section class="kpis" aria-label="Key figures">
        <a class="kpi" routerLink="/appointments">
          <span class="kpi-label">Today</span>
          <span class="kpi-value">{{ store.todayCount() }}</span>
          <span class="kpi-sub">
            @if (store.nextUp(); as next) {
              Next {{ next.when | date: 'EEE h:mm a' }}
            } @else {
              Nothing scheduled
            }
          </span>
          <mat-icon class="kpi-go">chevron_right</mat-icon>
        </a>

        <a class="kpi" routerLink="/appointments">
          <span class="kpi-label">Upcoming</span>
          <span class="kpi-value">{{ store.upcomingCount() }}</span>
          <span class="kpi-sub">{{ store.cancelledCount() }} cancelled</span>
          <mat-icon class="kpi-go">chevron_right</mat-icon>
        </a>

        <a class="kpi" routerLink="/doctors">
          <span class="kpi-label">Doctors on duty</span>
          <span class="kpi-value">
            {{ store.doctorsAvailable() }}<span class="kpi-of">/{{ store.doctorCount() }}</span>
          </span>
          <span class="kpi-sub">{{ store.doctorCount() - store.doctorsAvailable() }} unavailable</span>
          <mat-icon class="kpi-go">chevron_right</mat-icon>
        </a>

        <a class="kpi" routerLink="/patients">
          <span class="kpi-label">Patients</span>
          <span class="kpi-value">{{ store.patientCount() }}</span>
          <span class="kpi-sub">On register</span>
          <mat-icon class="kpi-go">chevron_right</mat-icon>
        </a>
      </section>

      <div class="charts">
        <!-- Magnitude across four named states. Status hues are reserved and
             every row is directly labeled, so hue never carries meaning alone. -->
        <mat-card appearance="outlined" class="chart-card">
          <mat-card-content>
            <div class="chart-head">
              <div>
                <h2>Appointments by status</h2>
                <p class="chart-sub">{{ store.appointments().length }} total</p>
              </div>
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
            } @else if (!store.appointments().length) {
              <div class="chart-empty">
                <p class="muted">No appointments yet.</p>
                <a mat-flat-button routerLink="/appointments/new">Book the first one</a>
              </div>
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
                           [style.width.%]="statusMax() ? d.count / statusMax() * 100 : 0"></div>
                    </div>
                    <span class="hbar-value">{{ d.count }}</span>
                  </div>
                }
              </div>
            }
          </mat-card-content>
        </mat-card>

        <!-- Trend over time, single series -> one hue, no legend (the title
             names it). Validated teal; passes all checks in both modes. -->
        <mat-card appearance="outlined" class="chart-card">
          <mat-card-content>
            <div class="chart-head">
              <div>
                <h2>Bookings per day</h2>
                <p class="chart-sub">Excludes cancelled</p>
              </div>
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
              <div class="chart-empty">
                <p class="muted">No bookings yet.</p>
                <a mat-flat-button routerLink="/appointments/new">Book the first one</a>
              </div>
            } @else {
              <div class="plot" role="img"
                   [attr.aria-label]="'Bookings per day. ' + dayAria()">
                <!-- Y scale: without it a bar's height is unreadable without hovering. -->
                <div class="y-axis" aria-hidden="true">
                  @for (t of yTicks(); track t) {
                    <span class="y-tick" [style.bottom.%]="t / axisMax() * 100">{{ t }}</span>
                  }
                </div>

                <div class="grid-lines" aria-hidden="true">
                  @for (t of yTicks(); track t) {
                    <span class="grid-line" [style.bottom.%]="t / axisMax() * 100"></span>
                  }
                </div>

                <div class="columns">
                  @for (d of store.byDay(); track d.date) {
                    <div class="col-wrap"
                         [class.is-today]="isToday(d.date)"
                         (mouseenter)="hoverDay.set(d.date)"
                         (mouseleave)="hoverDay.set(null)">
                      <div class="col-track">
                        <span class="col-value" [class.show]="hoverDay() === d.date">{{ d.count }}</span>
                        <div class="col-fill"
                             [class.dim]="hoverDay() && hoverDay() !== d.date"
                             [class.zero]="d.count === 0"
                             [style.height.%]="d.count / axisMax() * 100"></div>
                      </div>
                      <span class="col-label">{{ d.date | date: 'd MMM' }}</span>
                    </div>
                  }
                </div>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </div>

      <mat-card appearance="outlined" class="upcoming-card">
        <mat-card-content>
          <div class="chart-head">
            <div>
              <h2>Next appointments</h2>
              <p class="chart-sub">Soonest first</p>
            </div>
            <a mat-button routerLink="/appointments">See all</a>
          </div>

          @if (store.upcoming().length) {
            <ul class="upcoming">
              @for (r of store.upcoming().slice(0, 6); track r.id) {
                <li>
                  <span class="up-when">
                    {{ r.when | date: 'EEE d MMM, h:mm a' }}
                    <span class="up-rel">{{ relative(r.when) }}</span>
                  </span>
                  <span class="up-who">{{ r.patientName }}</span>
                  <span class="up-doc muted">{{ r.doctorName }}</span>
                  <span class="status-chip" [attr.data-status]="r.status">
                    {{ r.status | titlecase }}
                  </span>
                </li>
              }
            </ul>
          } @else {
            <div class="chart-empty">
              <p class="muted">Nothing scheduled ahead.</p>
              <a mat-flat-button routerLink="/appointments/new">Book an appointment</a>
            </div>
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }

    .today {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0.125rem 0 0;
    }

    h2 {
      font: var(--mat-sys-title-small);
      margin: 0;
    }

    .chart-sub {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0.125rem 0 0;
    }

    .spacer {
      flex: 1 1 auto;
    }

    /* --- KPI row: the whole tile is the link --- */
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .kpi {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding: 1rem 2rem 1rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface);
      color: inherit;
      text-decoration: none;
      transition: border-color 120ms ease, background 120ms ease;
    }

    .kpi:hover {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-low);
    }

    .kpi:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    .kpi-label {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    /* Hero figure: large, sans, text token — never a series color. */
    .kpi-value {
      font-size: 2.25rem;
      line-height: 1.15;
      color: var(--mat-sys-on-surface);
      font-variant-numeric: tabular-nums;
    }

    .kpi-of {
      font-size: 1.125rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .kpi-sub {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .kpi-go {
      position: absolute;
      top: 50%;
      right: 0.5rem;
      transform: translateY(-50%);
      color: var(--mat-sys-outline);
      transition: color 120ms ease, transform 120ms ease;
    }

    .kpi:hover .kpi-go {
      color: var(--mat-sys-primary);
      transform: translateY(-50%) translateX(2px);
    }

    /* --- charts --- */
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    /* Both cards share a row; equal heights keep the row reading as one band.
       Content stays top-aligned — centring left the bars floating. */
    .chart-card mat-card-content {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .chart-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    .chart-empty {
      display: grid;
      justify-items: center;
      gap: 0.75rem;
      padding: 2rem 0;
    }

    .chart-empty p {
      margin: 0;
    }

    /* Horizontal bars. The row gap is set so four bars fill the height the
       column chart sets for this row, without stretching or floating. */
    .hbars {
      display: flex;
      flex-direction: column;
      gap: 1.375rem;
      width: 100%;
    }

    .hbar-row {
      display: grid;
      grid-template-columns: 6.5rem 1fr 1.75rem;
      align-items: center;
      gap: 0.75rem;
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
      height: 0.625rem;
      border-radius: 0.3125rem;
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

    .hbar-fill.dim { opacity: 0.35; }

    .hbar-value {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* --- column plot with a real y scale --- */
    .plot {
      position: relative;
      padding-left: 1.5rem;
    }

    .y-axis {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 1.25rem;
      width: 1.5rem;
    }

    .y-tick {
      position: absolute;
      right: 0.375rem;
      transform: translateY(50%);
      font: var(--mat-sys-label-small);
      font-size: 0.625rem;
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
    }

    .grid-lines {
      position: absolute;
      left: 1.5rem;
      right: 0;
      top: 0;
      bottom: 1.25rem;
      pointer-events: none;
    }

    /* Recessive grid: present enough to read a value, quiet enough to ignore. */
    .grid-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--mat-sys-outline-variant);
      opacity: 0.6;
    }

    .columns {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 0.375rem;
      height: 9rem;
    }

    .col-wrap {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
      height: 100%;
      cursor: default;
      min-width: 0;
    }

    .col-track {
      position: relative;
      flex: 1 1 auto;
      width: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .col-value {
      position: absolute;
      bottom: 100%;
      margin-bottom: 0.25rem;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface);
      opacity: 0;
      transition: opacity 120ms ease;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }

    .col-value.show { opacity: 1; }

    .col-fill {
      width: 100%;
      max-width: 2.25rem;
      background: var(--chart-teal);
      border-radius: 0.25rem 0.25rem 0 0;
      transition: opacity 120ms ease;
    }

    /* A zero day is a real observation, not missing data — show the baseline. */
    .col-fill.zero {
      height: 2px !important;
      background: var(--mat-sys-outline-variant);
      border-radius: 1px;
    }

    .col-fill.dim { opacity: 0.35; }

    .col-label {
      font: var(--mat-sys-label-small);
      font-size: 0.625rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .col-wrap.is-today .col-label {
      color: var(--mat-sys-primary);
      font-weight: 600;
    }

    /* --- upcoming: one grid so columns line up across rows --- */
    /* Name columns size to their content rather than splitting the row in
       half, which stranded the doctor name mid-row and made the eye travel. */
    .upcoming {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: auto max-content minmax(8rem, max-content) 1fr;
      column-gap: 2rem;
    }

    /* Each row previously carried its own grid, so an 'auto' status column
       sized to its own chip and shifted every other column per row. Subgrid
       makes all rows share one set of column tracks. */
    .upcoming li {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .upcoming li:last-child { border-bottom: none; }

    .up-when {
      font: var(--mat-sys-label-medium);
      display: flex;
      flex-direction: column;
    }

    .up-rel {
      font: var(--mat-sys-label-small);
      font-size: 0.625rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .up-who { font-weight: 500; }

    .up-doc,
    .up-who {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The chip sits in the trailing column, pinned to the right edge; the
       global .status-chip keeps it start-aligned for every other use. */
    .upcoming .status-chip {
      justify-self: end;
    }

    @media (max-width: 37.5rem) {
      .upcoming {
        grid-template-columns: 1fr auto;
        column-gap: 0.75rem;
      }

      .upcoming li {
        row-gap: 0.125rem;
        padding: 0.75rem 0;
      }

      /* Stacked: time on its own line, then name + status side by side, then
         the doctor. Explicit placement — auto-flow pushed the chip onto a
         fourth row of its own. */
      .up-when {
        grid-column: 1 / -1;
        grid-row: 1;
        color: var(--mat-sys-on-surface-variant);
        flex-direction: row;
        gap: 0.375rem;
        align-items: baseline;
      }

      .up-who {
        grid-column: 1;
        grid-row: 2;
      }

      .upcoming .status-chip {
        grid-column: 2;
        grid-row: 2;
      }

      .up-doc {
        grid-column: 1 / -1;
        grid-row: 3;
      }

      .hbar-row {
        grid-template-columns: 5.5rem 1fr 1.5rem;
      }
    }
  `,
})
export class DashboardComponent {
  store = inject(DashboardStore);

  today = new Date();

  showStatusTable = signal(false);
  showDayTable = signal(false);
  hoverStatus = signal<string | null>(null);
  hoverDay = signal<string | null>(null);

  statusMax = computed(() => Math.max(0, ...this.store.byStatus().map(d => d.count)));

  /**
   * Axis ceiling, one step above the tallest bar. Scaling straight to the max
   * pins the tallest bars to the ceiling, which reads as "full" rather than
   * as a value.
   */
  axisMax = computed(() => {
    const max = Math.max(1, ...this.store.byDay().map(d => d.count));
    return max <= 4 ? max + 1 : Math.ceil((max * 1.15) / 5) * 5;
  });

  /** Baseline plus evenly spaced ticks up to the ceiling; integers only. */
  yTicks = computed(() => {
    const max = this.axisMax();
    const step = Math.max(1, Math.round(max / 3));
    const ticks: number[] = [];
    for (let t = 0; t <= max; t += step) ticks.push(t);
    return ticks;
  });

  dayAria = computed(() =>
    this.store.byDay().map(d => `${d.date}: ${d.count}`).join(', '),
  );

  isToday(iso: string): boolean {
    const d = this.today;
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return iso === `${d.getFullYear()}-${m}-${day}`;
  }

  /** Short human distance, e.g. "in 3 days". Today and tomorrow read better named. */
  relative(when: Date): string {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round(
      (startOfDay(when).getTime() - startOfDay(this.today).getTime()) / 86_400_000,
    );
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `In ${days} days`;
    if (days < 14) return 'Next week';
    return `In ${Math.round(days / 7)} weeks`;
  }
}
