import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, TitleCasePipe, NgTemplateOutlet } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppointmentStore } from './appointment.store';
import { APPOINTMENT_STATUSES, AppointmentStatus, AppointmentView } from './appointment.model';

@Component({
  selector: 'app-appointment-list',
  imports: [
    RouterLink,
    FormsModule,
    DatePipe,
    TitleCasePipe,
    NgTemplateOutlet,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCardModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  template: `
    <header class="toolbar">
      <h1>Appointments</h1>
      <span class="spacer"></span>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="status-filter">
        <mat-label>Status</mat-label>
        <mat-select [ngModel]="store.status()" (ngModelChange)="store.setStatus($event)">
          <mat-option value="">All statuses</mat-option>
          @for (s of statuses; track s) {
            <mat-option [value]="s">{{ s | titlecase }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <a mat-flat-button routerLink="new">
        <mat-icon>add</mat-icon>
        Book
      </a>
    </header>

    <mat-card appearance="outlined" class="surface">
      @if (store.appointmentsResource.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (store.appointmentsResource.error()) {
        <div class="state error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>Failed to load appointments.</p>
          <button mat-stroked-button (click)="store.appointmentsResource.reload()">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
        </div>
      } @else if (store.appointments().length) {
        @if (isHandset()) {
          <ul class="card-list">
            @for (a of store.appointments(); track a.id) {
              <li class="appt-card" [class.busy]="store.busy().has(a.id)">
                <div class="card-main">
                  <span class="who">{{ a.patientName }}</span>
                  <span class="status-chip" [attr.data-status]="a.status">
                    {{ a.status | titlecase }}
                  </span>
                </div>
                <span class="sub">{{ a.doctorName }}</span>
                <span class="sub">
                  {{ a.when ? (a.when | date: 'EEE d MMM, h:mm a') : a.date + ' ' + a.time }}
                  @if (isPast(a)) { <span class="past-flag">past</span> }
                </span>
                <span class="reason">{{ a.reason }}</span>
                <button mat-icon-button class="card-menu" [matMenuTriggerFor]="menu"
                        [attr.aria-label]="'Actions for ' + a.patientName">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #menu>
                  <ng-container *ngTemplateOutlet="actions; context: { $implicit: a }" />
                </mat-menu>
              </li>
            }
          </ul>
        } @else {
          <table mat-table [dataSource]="store.appointments()">
            <ng-container matColumnDef="when">
              <th mat-header-cell *matHeaderCellDef>When</th>
              <td mat-cell *matCellDef="let a">
                <span class="when">
                  {{ a.when ? (a.when | date: 'EEE d MMM') : a.date }}
                </span>
                <span class="time">
                  {{ a.when ? (a.when | date: 'h:mm a') : a.time }}
                  @if (isPast(a)) { <span class="past-flag">past</span> }
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="patient">
              <th mat-header-cell *matHeaderCellDef>Patient</th>
              <td mat-cell *matCellDef="let a">{{ a.patientName }}</td>
            </ng-container>

            <ng-container matColumnDef="doctor">
              <th mat-header-cell *matHeaderCellDef>Doctor</th>
              <td mat-cell *matCellDef="let a" class="muted">{{ a.doctorName }}</td>
            </ng-container>

            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Reason</th>
              <td mat-cell *matCellDef="let a" class="muted reason-cell">{{ a.reason }}</td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let a">
                <span class="status-chip" [attr.data-status]="a.status">
                  {{ a.status | titlecase }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef aria-label="Actions"></th>
              <td mat-cell *matCellDef="let a" class="actions-cell">
                <button mat-icon-button [matMenuTriggerFor]="rowMenu"
                        [disabled]="store.busy().has(a.id)"
                        [attr.aria-label]="'Actions for ' + a.patientName">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #rowMenu>
                  <ng-container *ngTemplateOutlet="actions; context: { $implicit: a }" />
                </mat-menu>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        }

        <mat-paginator
          [length]="store.total()"
          [pageSize]="store.pageSize"
          [pageIndex]="store.page() - 1"
          [hidePageSize]="true"
          (page)="onPage($event)" />
      } @else {
        <div class="state">
          <mat-icon>event_busy</mat-icon>
          <p class="muted">No appointments found.</p>
        </div>
      }
    </mat-card>

    <ng-template #actions let-a>
      <a mat-menu-item [routerLink]="[a.id]">
        <mat-icon>edit_calendar</mat-icon>
        <span>Reschedule</span>
      </a>
      @if (a.status !== 'confirmed' && a.status !== 'cancelled') {
        <button mat-menu-item (click)="store.setStatusOf(a.id, 'confirmed')">
          <mat-icon>check_circle</mat-icon>
          <span>Confirm</span>
        </button>
      }
      @if (a.status !== 'completed' && a.status !== 'cancelled') {
        <button mat-menu-item (click)="store.setStatusOf(a.id, 'completed')">
          <mat-icon>task_alt</mat-icon>
          <span>Mark completed</span>
        </button>
      }
      @if (a.status !== 'cancelled') {
        <button mat-menu-item (click)="store.setStatusOf(a.id, 'cancelled')">
          <mat-icon>event_busy</mat-icon>
          <span>Cancel</span>
        </button>
      }
      <button mat-menu-item class="danger" (click)="store.remove(a.id)">
        <mat-icon>delete_outline</mat-icon>
        <span>Delete</span>
      </button>
    </ng-template>
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .status-filter {
      flex: 0 1 11rem;
      min-width: 0;
    }

    .surface {
      overflow: hidden;
      padding: 0;
    }

    table {
      width: 100%;
    }

    .when {
      display: block;
      font-weight: 500;
    }

    .time {
      display: block;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .reason-cell {
      max-width: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .past-flag {
      margin-left: 0.375rem;
      padding: 0 0.3125rem;
      border-radius: 0.5rem;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-outline);
    }

    .actions-cell {
      text-align: right;
    }

    .card-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .appt-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding: 0.875rem 3rem 0.875rem 1rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .appt-card:last-child {
      border-bottom: none;
    }

    .appt-card.busy {
      opacity: 0.5;
    }

    .card-main {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .who {
      font: var(--mat-sys-title-small);
    }

    .sub {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .reason {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0.25rem;
    }

    .card-menu {
      position: absolute;
      top: 0.5rem;
      right: 0.25rem;
    }

  `,
})
export class AppointmentListComponent {
  store = inject(AppointmentStore);
  statuses = APPOINTMENT_STATUSES;
  columns = ['when', 'patient', 'doctor', 'reason', 'status', 'actions'];

  private breakpoints = inject(BreakpointObserver);
  isHandset = toSignal(
    this.breakpoints.observe(Breakpoints.Handset).pipe(map(r => r.matches)),
    { initialValue: false },
  );

  isPast(a: AppointmentView): boolean {
    return !!a.when && a.when.getTime() < Date.now();
  }

  onPage(e: PageEvent) {
    this.store.setPage(e.pageIndex + 1);
  }
}
