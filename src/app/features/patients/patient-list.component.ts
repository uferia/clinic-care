import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PatientStore } from './patient.store';

@Component({
  selector: 'app-patient-list',
  imports: [
    RouterLink,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatCardModule,
    MatTooltipModule,
  ],
  template: `
    <header class="toolbar">
      <h1>Patients</h1>
      <span class="spacer"></span>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
        <mat-label>Search patients</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input
          matInput
          type="search"
          placeholder="Name or phone"
          [ngModel]="store.searchInput()"
          (ngModelChange)="store.setSearch($event)" />
      </mat-form-field>
      <a mat-flat-button routerLink="new">
        <mat-icon>add</mat-icon>
        New Patient
      </a>
    </header>

    <mat-card appearance="outlined" class="surface">
      @if (store.patientsResource.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (store.patientsResource.error()) {
        <div class="state error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>Failed to load patients.</p>
          <button mat-stroked-button (click)="store.patientsResource.reload()">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
        </div>
      } @else if (store.visiblePatients().length) {
        @if (isHandset()) {
          <ul class="card-list">
            @for (p of store.visiblePatients(); track p.id) {
              <li class="patient-card">
                <div class="card-main">
                  <a class="name-link" [routerLink]="[p.id]">
                    {{ p.lastName }}, {{ p.firstName }}
                  </a>
                  <span class="blood-chip">{{ p.bloodType }}</span>
                </div>
                <a class="contact" [href]="'mailto:' + p.email">{{ p.email }}</a>
                <a class="contact" [href]="'tel:' + p.phone">{{ p.phone }}</a>
                <button
                  mat-icon-button
                  class="card-delete"
                  matTooltip="Delete patient"
                  [attr.aria-label]="'Delete ' + p.firstName + ' ' + p.lastName"
                  (click)="store.remove(p.id)">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              </li>
            }
          </ul>
        } @else {
        <table mat-table [dataSource]="store.visiblePatients()">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let p">
              <a class="name-link" [routerLink]="[p.id]">{{ p.lastName }}, {{ p.firstName }}</a>
            </td>
          </ng-container>

          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let p" class="muted">{{ p.email }}</td>
          </ng-container>

          <ng-container matColumnDef="phone">
            <th mat-header-cell *matHeaderCellDef>Phone</th>
            <td mat-cell *matCellDef="let p" class="muted">{{ p.phone }}</td>
          </ng-container>

          <ng-container matColumnDef="bloodType">
            <th mat-header-cell *matHeaderCellDef>Blood</th>
            <td mat-cell *matCellDef="let p">
              <span class="blood-chip">{{ p.bloodType }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef aria-label="Actions"></th>
            <td mat-cell *matCellDef="let p" class="actions">
              <button
                mat-icon-button
                matTooltip="Delete patient"
                [attr.aria-label]="'Delete ' + p.firstName + ' ' + p.lastName"
                (click)="store.remove(p.id)">
                <mat-icon>delete_outline</mat-icon>
              </button>
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
          <mat-icon>person_search</mat-icon>
          <p class="muted">No patients found.</p>
        </div>
      }
    </mat-card>
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

    .search {
      min-width: 16rem;
    }

    @media (max-width: 37.5rem) {
      .toolbar {
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      /* Search takes the full row; the CTA sits beside the heading. */
      .search {
        order: 3;
        flex: 1 1 100%;
        min-width: 0;
      }

      .spacer {
        display: none;
      }

      h1 {
        flex: 1 1 auto;
      }
    }

    .card-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .patient-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding: 0.875rem 3rem 0.875rem 1rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .patient-card:last-child {
      border-bottom: none;
    }

    .card-main {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.125rem;
    }

    .card-main .name-link {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-primary);
    }

    .contact {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      text-decoration: none;
      width: fit-content;
    }

    .card-delete {
      position: absolute;
      top: 50%;
      right: 0.25rem;
      transform: translateY(-50%);
    }

    .surface {
      overflow: hidden;
      padding: 0;
    }

    table {
      width: 100%;
    }

    .name-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      font-weight: 500;
    }

    .name-link:hover {
      text-decoration: underline;
    }

    .blood-chip {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 1rem;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .actions {
      text-align: right;
    }

    .state {
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      padding: 3rem 1rem;
    }

    .state mat-icon {
      --mat-icon-color: var(--mat-sys-outline);
      width: 2.5rem;
      height: 2.5rem;
      font-size: 2.5rem;
    }

    .error-state mat-icon {
      --mat-icon-color: var(--mat-sys-error);
    }

    .error-state p {
      color: var(--mat-sys-error);
      margin: 0;
    }
  `,
})
export class PatientListComponent {
  store = inject(PatientStore);
  columns = ['name', 'email', 'phone', 'bloodType', 'actions'];

  // The 5-column table needs ~494px and clips the delete action below that,
  // so handsets get a card list. Tablets are wide enough for the real table.
  private breakpoints = inject(BreakpointObserver);
  isHandset = toSignal(
    this.breakpoints.observe(Breakpoints.Handset).pipe(map(r => r.matches)),
    { initialValue: false },
  );

  onPage(e: PageEvent) {
    // mat-paginator is 0-indexed; the store's page signal is 1-indexed.
    this.store.setPage(e.pageIndex + 1);
  }
}
