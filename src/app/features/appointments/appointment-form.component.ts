import { Component, signal, computed, effect, inject, input, resource } from '@angular/core';
import { form, FormField, required, validateTree } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  APPOINTMENT_STATUSES,
  AppointmentStatus,
  CreateAppointmentDto,
  toAppointment,
  toAppointmentWrite,
} from './appointment.model';
import { toPatient } from '../patients/patient.model';
import { toDoctor } from '../doctors/doctor.model';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';
import {
  combineDateTime,
  fromHm,
  fromIsoDate,
  toHm,
  toIsoDate,
} from '../../core/date.util';
import { firstMessage } from '../../core/form-errors';
import { AppointmentStore } from './appointment.store';
import { matchPatientByName } from './patient-name-match.util';

/** Shape returned by the parse-appointment-request edge function. */
interface ParsedBookingRequest {
  doctorId: string | null;
  patientNameGuess: string;
  date: string | null;
  time: string | null;
  reason: string;
}

/** Form-side model: date and time are Dates so the pickers can bind to them. */
interface BookingFormModel {
  patientId: string;
  doctorId: string;
  date: Date | null;
  time: Date | null;
  reason: string;
  status: AppointmentStatus;
}

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
    MatDatepickerModule,
    MatTimepickerModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <header class="form-head">
      <a mat-icon-button routerLink="/appointments" aria-label="Back to appointments">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <h1>{{ id() ? 'Reschedule' : 'Book' }} Appointment</h1>
    </header>

    <mat-card appearance="outlined" class="assist-card">
      <mat-card-content>
        <div class="assist-row">
          <mat-form-field appearance="outline" class="assist-input">
            <mat-label>Describe the booking</mat-label>
            <input
              matInput
              placeholder="e.g. book Maria Santos with Dr. Cruz next Tuesday afternoon, follow-up"
              [value]="assistantText()"
              (input)="assistantText.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); fillFromText()" />
            <mat-hint>Used to fill the form below — not stored</mat-hint>
          </mat-form-field>
          <button
            mat-stroked-button
            type="button"
            [disabled]="!assistantText().trim() || assistantBusy()"
            (click)="fillFromText()">
            @if (assistantBusy()) {
              <mat-spinner diameter="18" />
            } @else {
              Fill form
            }
          </button>
        </div>
        @if (assistantError()) {
          <div class="save-error" role="alert">{{ assistantError() }}</div>
        }
      </mat-card-content>
    </mat-card>

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
            <input
              matInput
              [matDatepicker]="datePicker"
              [min]="minDate()"
              [formField]="bookingForm.date" />
            <mat-datepicker-toggle matIconSuffix [for]="datePicker" />
            <mat-datepicker #datePicker />
            @if (bookingForm.date().touched() && bookingForm.date().invalid()) {
              <mat-error>Date is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Time</mat-label>
            <input matInput [matTimepicker]="timePicker" [formField]="bookingForm.time" />
            <mat-timepicker-toggle matIconSuffix [for]="timePicker" />
            <!-- 30-minute slots: a clinic books on the half hour, and a free
                 text time invites 09:07. -->
            <mat-timepicker #timePicker interval="30m" />
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

          @if (saveError()) {
            <div class="save-error" role="alert">{{ saveError() }}</div>
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

    .assist-card {
      margin-bottom: 1rem;
    }

    .assist-row {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .assist-input {
      flex: 1;
    }

    .assist-row button {
      margin-top: 0.375rem;
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

    .save-error {
      grid-column: 1 / -1;
      margin-top: 0.5rem;
      padding: 0.625rem 0.875rem;
      border-radius: 0.5rem;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-small);
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
  private supabase = inject(SUPABASE);
  private router = inject(Router);
  private appointmentStore = inject(AppointmentStore);

  id = input<string>();
  saving = signal(false);
  saveError = signal<string | null>(null);
  statuses = APPOINTMENT_STATUSES;

  assistantText = signal('');
  assistantBusy = signal(false);
  assistantError = signal<string | null>(null);

  private patientsResource = resource({
    loader: async () => {
      const { data } = await this.supabase.from('patients').select('*').order('last_name');
      return ((data as any[]) ?? []).map(toPatient);
    },
  });
  private doctorsResource = resource({
    loader: async () => {
      const { data } = await this.supabase.from('doctors').select('*').order('name');
      return ((data as any[]) ?? []).map(toDoctor);
    },
  });

  patients = computed(() => this.patientsResource.value() ?? []);
  doctors = computed(() => this.doctorsResource.value() ?? []);

  model = signal<BookingFormModel>({
    patientId: '',
    doctorId: '',
    date: null,
    time: null,
    reason: '',
    status: 'pending',
  });

  /**
   * Earliest selectable day. Only applied when booking — an existing record
   * being edited may legitimately sit in the past.
   */
  minDate = computed(() => {
    if (this.id()) return null;
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
      const when = combineDateTime(date, time);
      if (!when) return null;
      // Past dates are legitimate on records being completed or cancelled.
      if (status === 'completed' || status === 'cancelled') return null;
      return when > new Date()
        ? null
        : {
            kind: 'pastAppointment',
            message: 'Appointment must be in the future',
            fieldTree: fieldTreeOf(schema.time),
          };
    });
  });

  /**
   * First authored message on `time` — required, or the cross-field rule.
   * Skips the timepicker's own message-less validator errors.
   */
  timeError = computed(() =>
    firstMessage(this.bookingForm.time().errors(), 'Time is required'),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      if (!id) return;
      this.supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .single()
        .then(({ data, error }: { data: unknown; error: unknown }) => {
          if (error || !data) return;
          const a = toAppointment(data as any);
          this.model.set({
            patientId: a.patientId,
            doctorId: a.doctorId,
            date: fromIsoDate(a.date),
            time: fromHm(a.time),
            reason: a.reason,
            status: a.status,
          });
        });
    });
  }

  /**
   * Sends the free-text description to the AI booking assistant and fills the
   * form fields with what comes back. Never writes anything itself — staff
   * still reviews and hits Save. A blank/ambiguous patient match is left for
   * staff to pick manually rather than risk booking the wrong patient.
   */
  async fillFromText() {
    const text = this.assistantText().trim();
    if (!text) return;

    this.assistantBusy.set(true);
    this.assistantError.set(null);
    try {
      const { data, error } = await this.supabase.functions.invoke('parse-appointment-request', {
        body: { text },
      });
      if (error) throw await edgeError(error);
      const parsed = data as ParsedBookingRequest;

      const patientId = parsed.patientNameGuess
        ? matchPatientByName(parsed.patientNameGuess, this.patients())
        : null;

      this.model.update((m) => ({
        ...m,
        patientId: patientId ?? m.patientId,
        doctorId: parsed.doctorId ?? m.doctorId,
        date: fromIsoDate(parsed.date) ?? m.date,
        time: fromHm(parsed.time) ?? m.time,
        reason: parsed.reason || m.reason,
      }));
    } catch (e) {
      this.assistantError.set(e instanceof Error ? e.message : "Couldn't fill the form.");
    } finally {
      this.assistantBusy.set(false);
    }
  }

  save() {
    if (this.bookingForm().invalid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const model = this.model();
    // Back to the wire format: `YYYY-MM-DD` and `HH:mm`.
    const dto: CreateAppointmentDto = {
      ...model,
      date: model.date ? toIsoDate(model.date) : '',
      time: model.time ? toHm(model.time) : '',
    };
    const write = toAppointmentWrite(dto);
    const id = this.id();
    const op = id
      ? this.supabase.from('appointments').update(write).eq('id', id)
      : this.supabase.from('appointments').insert(write);
    op.then(({ error }: { error: unknown }) => {
      if (error) {
        this.saving.set(false);
        this.saveError.set("Couldn't save. Please try again.");
      } else {
        this.appointmentStore.reload();
        this.router.navigate(['/appointments']);
      }
    });
  }
}
