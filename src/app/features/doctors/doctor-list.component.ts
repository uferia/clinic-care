import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DoctorStore } from './doctor.store';
import { SPECIALTIES } from './doctor.model';

@Component({
  selector: 'app-doctor-list',
  imports: [
    RouterLink,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
  ],
  template: `
    <header class="toolbar">
      <h1>Doctors</h1>
      <span class="spacer"></span>
      <a mat-flat-button routerLink="new">
        <mat-icon>add</mat-icon>
        New Doctor
      </a>
    </header>

    <div class="filters">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
        <mat-label>Search doctors</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input
          matInput
          type="search"
          placeholder="Name or specialty"
          [ngModel]="store.searchInput()"
          (ngModelChange)="store.setSearch($event)" />
      </mat-form-field>

      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="specialty">
        <mat-label>Specialty</mat-label>
        <mat-select
          [ngModel]="store.specialty()"
          (ngModelChange)="store.setSpecialty($event)">
          <mat-option value="">All specialties</mat-option>
          @for (s of specialties; track s) {
            <mat-option [value]="s">{{ s }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-slide-toggle
        [ngModel]="store.availableOnly()"
        (ngModelChange)="store.setAvailableOnly($event)">
        Available only
      </mat-slide-toggle>
    </div>

    @if (store.isLoading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load doctors.</p>
        <button mat-stroked-button (click)="store.reload()">
          <mat-icon>refresh</mat-icon>
          Retry
        </button>
      </div>
    } @else if (store.visibleDoctors().length) {
      <div class="grid">
        @for (d of store.visibleDoctors(); track d.id) {
          <mat-card appearance="outlined" class="doctor-card">
            <mat-card-content>
              <div class="card-head">
                <div class="avatar" [class.off]="!d.available">
                  <mat-icon>medical_services</mat-icon>
                </div>
                <div class="who">
                  <a class="name-link" [routerLink]="[d.id]">{{ d.name }}</a>
                  <span class="specialty">{{ d.specialty }}</span>
                </div>
              </div>

              <div class="meta">
                <span class="rating" [matTooltip]="d.rating + ' out of 5'">
                  <mat-icon aria-hidden="true">star</mat-icon>
                  {{ d.rating }}
                </span>
                <span class="status" [class.available]="d.available">
                  {{ d.available ? 'Available' : 'Unavailable' }}
                </span>
              </div>
            </mat-card-content>

            <mat-card-actions align="end">
              <a mat-button [routerLink]="[d.id]">Edit</a>
              <button
                mat-icon-button
                matTooltip="Delete doctor"
                [attr.aria-label]="'Delete ' + d.name"
                (click)="store.remove(d.id)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </mat-card-actions>
          </mat-card>
        }
      </div>

      <mat-paginator
        [length]="store.total()"
        [pageSize]="store.pageSize"
        [pageIndex]="store.page() - 1"
        [hidePageSize]="true"
        (page)="onPage($event)" />
    } @else {
      <div class="state">
        <mat-icon>person_search</mat-icon>
        <p class="muted">No doctors found.</p>
      </div>
    }
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .filters {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }

    .search {
      flex: 1 1 16rem;
      min-width: 0;
    }

    .specialty {
      flex: 0 1 14rem;
      min-width: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
      gap: 1rem;
    }

    .doctor-card mat-card-content {
      padding-bottom: 0;
    }

    .card-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .avatar {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 50%;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      flex: none;
    }

    .avatar.off {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-outline);
    }

    .who {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .name-link {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-primary);
      text-decoration: none;
    }

    .name-link:hover {
      text-decoration: underline;
    }

    .specialty {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.875rem;
    }

    .rating {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .rating mat-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      color: var(--mat-sys-tertiary);
    }

    .status {
      padding: 0.125rem 0.5rem;
      border-radius: 1rem;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
    }

    .status.available {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    @media (max-width: 37.5rem) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class DoctorListComponent {
  store = inject(DoctorStore);
  specialties = SPECIALTIES;

  onPage(e: PageEvent) {
    this.store.setPage(e.pageIndex + 1);
  }
}
