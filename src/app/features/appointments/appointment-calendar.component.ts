import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppointmentCalendarStore } from './appointment-calendar.store';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Component({
  selector: 'app-appointment-calendar',
  imports: [
    RouterLink, DatePipe, MatButtonModule, MatIconModule,
    MatCardModule, MatProgressBarModule, MatTooltipModule,
  ],
  providers: [AppointmentCalendarStore],
  template: `
    <header class="toolbar">
      <h1>Appointments</h1>
      <span class="spacer"></span>
      <a mat-stroked-button routerLink="/appointments">
        <mat-icon>list</mat-icon>
        List
      </a>
      <a mat-flat-button routerLink="/appointments/new">
        <mat-icon>add</mat-icon>
        New
      </a>
    </header>

    <div class="month-bar">
      <button mat-icon-button (click)="store.previous()" aria-label="Previous month">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <h2>{{ store.month() | date: 'MMMM y' }}</h2>
      <button mat-icon-button (click)="store.next()" aria-label="Next month">
        <mat-icon>chevron_right</mat-icon>
      </button>
      <button mat-stroked-button (click)="store.today()">Today</button>
      <span class="spacer"></span>
      <span class="muted">{{ store.monthTotal() }} this month</span>
    </div>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
    @if (loadError()) { <p class="error">{{ loadError() }}</p> }

    <div class="grid" role="grid">
      @for (name of weekdays; track name) {
        <div class="weekday" role="columnheader">{{ name }}</div>
      }

      @for (day of store.days(); track day.iso) {
        <div class="day" [class.outside]="!day.inMonth" [class.today]="day.isToday" role="gridcell">
          <span class="date">{{ day.date | date: 'd' }}</span>
          @for (a of day.appointments; track a.id) {
            <a
              class="chip"
              [class]="a.status"
              [routerLink]="['/appointments', a.id]"
              [matTooltip]="a.doctorName ? a.status + ' · ' + a.doctorName : a.status">
              <span class="time">{{ a.time }}</span>
              <span class="who">{{ a.patientName }}</span>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .toolbar h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1; }
    .month-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .month-bar h2 { font: var(--mat-sys-title-medium); margin: 0; min-width: 10rem; text-align: center; }
    .muted { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .error { color: var(--mat-sys-error); }

    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px;
      background: var(--mat-sys-outline-variant); border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-small); overflow: hidden; }
    .weekday { background: var(--mat-sys-surface-container); padding: 0.4rem 0.5rem;
      font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); text-align: center; }
    .day { background: var(--mat-sys-surface); min-height: 6.5rem; padding: 0.35rem;
      display: flex; flex-direction: column; gap: 0.2rem; }
    .day.outside { background: var(--mat-sys-surface-container-low); }
    .day.outside .date { color: var(--mat-sys-outline); }
    .day .date { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .day.today .date { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary);
      border-radius: 1rem; padding: 0 0.4rem; align-self: flex-start; }

    .chip { display: flex; gap: 0.3rem; align-items: baseline; padding: 0.15rem 0.35rem;
      border-radius: var(--mat-sys-corner-extra-small); font: var(--mat-sys-body-small);
      text-decoration: none; color: var(--mat-sys-on-secondary-container);
      background: var(--mat-sys-secondary-container); overflow: hidden; }
    .chip .time { flex: none; font-variant-numeric: tabular-nums; }
    .chip .who { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip.confirmed { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .chip.cancelled { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
      text-decoration: line-through; }
    .chip.completed { background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }

    /* Seven columns cannot survive a phone; fall back to a stacked agenda where
       each day is a full-width row and empty days collapse away. */
    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; }
      .weekday { display: none; }
      .day { min-height: 0; flex-direction: row; flex-wrap: wrap; align-items: center; }
      .day:not(.today):has(.date:only-child) { display: none; }
      .chip { flex: 1 1 100%; }
    }
  `,
})
export class AppointmentCalendarComponent {
  protected store = inject(AppointmentCalendarStore);
  protected weekdays = WEEKDAYS;

  protected loadError = computed(() => {
    const e = this.store.error();
    if (!e) return '';
    return e instanceof Error ? e.message : 'Could not load appointments.';
  });
}
