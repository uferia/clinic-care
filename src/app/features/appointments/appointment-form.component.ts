import { Component, signal, computed, effect, inject, input } from '@angular/core';
import { form, FormField, required, validateTree } from '@angular/forms/signals';
import { HttpClient, httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  APPOINTMENT_STATUSES,
  Appointment,
  CreateAppointmentDto,
} from './appointment.model';
import { Patient } from '../patients/patient.model';
import { Doctor } from '../doctors/doctor.model';
import { API } from '../../core/api';

@Component({
  selector: 'app-appointment-form',
  imports: [
    FormField,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <header class="form-head">
      <a mat-icon-button routerLink="/appointments" aria-label="Back to appointments">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <h1>{{ id() ? 'Reschedule' : 'Book' }} Appointment</h1>
    </header>

    <mat-card appearance="outlined">
      <mat-card-content>
        <form class="grid" (submit)="$event.preventDefault(); save()">
          <mat-form-field appearance="outline">
            <mat-label>Patient</mat-label>
            <mat-select [formField]="bookingForm.patientId">
              @for (p of patients(); track p.id) {
                <mat-option [value]="p.id">{{ p.lastName }}, {{ p.firstName }}</mat-option>
              }
            </mat-select>
            @if (bookingForm.patientId().touched() && bookingForm.patientId().invalid()) {
              <mat-error>Select a patient</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Doctor</mat-label>
            <mat-select [formField]="bookingForm.doctorId">
              @for (d of doctors(); track d.id) {
                <mat-option [value]="d.id" [disabled]="!d.available">
                  {{ d.name }} — {{ d.specialty }}
                  @if (!d.available) { <span class="opt-note">(unavailable)</span> }
                </mat-option>
              }
            </mat-select>
            @if (bookingForm.doctorId().touched() && bookingForm.doctorId().invalid()) {
              <mat-error>Select a doctor</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" [formField]="bookingForm.date" />
            @if (bookingForm.date().touched() && bookingForm.date().invalid()) {
              <mat-error>Date is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Time</mat-label>
            <input matInput type="time" [formField]="bookingForm.time" />
            <!-- The cross-field past-appointment error is targeted here via
                 validateTree, so it surfaces on the field the user can fix. -->
            @if (bookingForm.time().touched() && bookingForm.time().invalid()) {
              <mat-error>{{ timeError() }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="wide">
            <mat-label>Reason</mat-label>
            <input matInput [formField]="bookingForm.reason" />
            @if (bookingForm.reason().touched() && bookingForm.reason().invalid()) {
              <mat-error>Reason is required</mat-error>
            }
          </mat-form-field>

          @if (id()) {
            <mat-form-field appearance="outline">
              <mat-label>Status</mat-label>
              <mat-select [formField]="bookingForm.status">
                @for (s of statuses; track s) {
                  <mat-option [value]="s">{{ s }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }

          <div class="actions">
            <a mat-button routerLink="/appointments">Cancel</a>
            <button
              mat-flat-button
              type="submit"
              [disabled]="bookingForm().invalid() || saving()">
              @if (saving()) {
                <mat-spinner diameter="18" />
                Saving…
              } @else {
                {{ id() ? 'Save changes' : 'Book appointment' }}
              }
            </button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .form-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem 1rem;
      padding-top: 0.5rem;
    }

    .wide {
      grid-column: 1 / -1;
    }

    .opt-note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .actions mat-spinner {
      margin-right: 0.5rem;
    }

    @media (max-width: 40rem) {
      .grid {
        grid-template-columns: 1fr;
        row-gap: 0.75rem;
      }
    }
  `,
})
export class AppointmentFormComponent {
  private http = inject(HttpClient);
  private router = inject(Router);

  id = input<string>();
  saving = signal(false);
  statuses = APPOINTMENT_STATUSES;

  // Dropdown sources. _per_page=100 keeps every option on one payload; a real
  // backend would want a searchable/typeahead control instead.
  private patientsResource = httpResource<Patient[]>(
    () => `${API}/patients?_page=1&_per_page=100&_sort=lastName`,
  );
  private doctorsResource = httpResource<Doctor[]>(
    () => `${API}/doctors?_page=1&_per_page=100&_sort=name`,
  );

  patients = computed(() => {
    const raw = this.patientsResource.value() as any;
    return (raw?.data ?? raw ?? []) as Patient[];
  });
  doctors = computed(() => {
    const raw = this.doctorsResource.value() as any;
    return (raw?.data ?? raw ?? []) as Doctor[];
  });

  model = signal<CreateAppointmentDto>({
    patientId: '',
    doctorId: '',
    date: '',
    time: '',
    reason: '',
    status: 'pending',
  });

  bookingForm = form(this.model, (schema) => {
    required(schema.patientId);
    required(schema.doctorId);
    required(schema.date);
    required(schema.time);
    required(schema.reason);
    required(schema.status);

    // Cross-field: date and time are only meaningful together. validateTree
    // lets the error target `time` so it renders in that field's mat-error,
    // rather than sitting on the form root where no field would show it.
    validateTree(schema, ({ value, fieldTreeOf }) => {
      const { date, time, status } = value();
      if (!date || !time) return null;
      // Past dates are legitimate on records being completed or cancelled.
      if (status === 'completed' || status === 'cancelled') return null;
      return new Date(`${date}T${time}`) > new Date()
        ? null
        : {
            kind: 'pastAppointment',
            message: 'Appointment must be in the future',
            fieldTree: fieldTreeOf(schema.time),
          };
    });
  });

  /** First error message on `time`, whether required or the cross-field rule. */
  timeError = computed(() => {
    const errs = this.bookingForm.time().errors() as { message?: string }[];
    return errs[0]?.message ?? 'Time is required';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) {
        this.http
          .get<Appointment>(`${API}/appointments/${id}`)
          .subscribe(({ id: _, ...dto }) => this.model.set(dto));
      }
    });
  }

  save() {
    if (this.bookingForm().invalid()) return;
    this.saving.set(true);
    const dto = this.model();
    const req$ = this.id()
      ? this.http.patch(`${API}/appointments/${this.id()}`, dto)
      : this.http.post(`${API}/appointments`, dto);
    req$.subscribe({
      next: () => this.router.navigate(['/appointments']),
      error: () => this.saving.set(false),
    });
  }
}
