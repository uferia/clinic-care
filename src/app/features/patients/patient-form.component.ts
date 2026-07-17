import { Component, signal, computed, effect, inject, input } from '@angular/core';
import { form, FormField, required, email, maxDate, validate } from '@angular/forms/signals';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BLOOD_TYPES, BloodType, CreatePatientDto, Patient } from './patient.model';
import { isValidMobile, toE164 } from './phone.util';
import { API } from '../../core/api';
import { fromIsoDate, toIsoDate } from '../../core/date.util';
import { firstMessage } from '../../core/form-errors';

/** Form-side model: `birthDate` is a real Date so the datepicker can bind to it. */
interface PatientFormModel {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: Date | null;
  bloodType: BloodType;
}

@Component({
  selector: 'app-patient-form',
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
    MatProgressSpinnerModule,
  ],
  template: `
    <header class="form-head">
      <a mat-icon-button routerLink="/patients" aria-label="Back to patients">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <h1>{{ id() ? 'Edit' : 'New' }} Patient</h1>
    </header>

    <mat-card appearance="outlined">
      <mat-card-content>
        <form class="grid" (submit)="$event.preventDefault(); save()">
          <mat-form-field appearance="outline">
            <mat-label>First name</mat-label>
            <input matInput [formField]="patientForm.firstName" />
            @if (patientForm.firstName().touched() && patientForm.firstName().invalid()) {
              <mat-error>First name is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Last name</mat-label>
            <input matInput [formField]="patientForm.lastName" />
            @if (patientForm.lastName().touched() && patientForm.lastName().invalid()) {
              <mat-error>Last name is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" [formField]="patientForm.email" />
            @if (patientForm.email().touched() && patientForm.email().invalid()) {
              <mat-error>Enter a valid email</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Phone</mat-label>
            <input matInput [formField]="patientForm.phone" />
            <mat-hint>Mobile, e.g. 0917 123 4567 or +63 917 123 4567</mat-hint>
            @if (patientForm.phone().touched() && patientForm.phone().invalid()) {
              <mat-error>Enter a valid PH mobile number</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Birth date</mat-label>
            <!-- maxDate on the schema binds the picker's own max, so future
                 dates are unreachable in the calendar as well as invalid. -->
            <input
              matInput
              [matDatepicker]="birthPicker"
              [formField]="patientForm.birthDate" />
            <mat-datepicker-toggle matIconSuffix [for]="birthPicker" />
            <mat-datepicker #birthPicker startView="multi-year" />
            @if (patientForm.birthDate().touched() && patientForm.birthDate().invalid()) {
              <mat-error>{{ birthDateError() }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Blood type</mat-label>
            <mat-select [formField]="patientForm.bloodType">
              @for (bt of bloodTypes; track bt) {
                <mat-option [value]="bt">{{ bt }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <div class="actions">
            <a mat-button routerLink="/patients">Cancel</a>
            <button
              mat-flat-button
              type="submit"
              [disabled]="patientForm().invalid() || saving()">
              @if (saving()) {
                <mat-spinner diameter="18" />
                Saving…
              } @else {
                Save
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

    @media (max-width: 40rem) {
      .grid {
        grid-template-columns: 1fr;
        // Stacked fields put each hint directly above the next field's
        // outline label, so rows need more room than the 2-column layout.
        row-gap: 0.75rem;
      }

      .actions {
        margin-top: 0.75rem;
      }
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
  `,
})
export class PatientFormComponent {
  private http = inject(HttpClient);
  private router = inject(Router);

  id = input<string>();                    // route param via withComponentInputBinding
  saving = signal(false);
  bloodTypes = BLOOD_TYPES;

  /** Today at midnight — the latest a birth date can be. */
  readonly today = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  })();

  // 1. the model IS a signal
  model = signal<PatientFormModel>({
    firstName: '', lastName: '', email: '', phone: '',
    birthDate: null, bloodType: 'O+',
  });

  // 2. validation lives in a schema function — declarative, typed
  patientForm = form(this.model, (schema) => {
    required(schema.firstName, { message: 'First name is required' });
    required(schema.lastName);
    required(schema.email);
    email(schema.email);
    required(schema.phone);
    validate(schema.phone, ({ value }) =>
      value() && !isValidMobile(value())
        ? { kind: 'invalidMobile', message: 'Enter a valid PH mobile number' }
        : null
    );
    required(schema.birthDate, { message: 'Birth date is required' });
    // Now that birthDate is a real Date, the built-in replaces the hand-rolled
    // future-date check — and binds the picker's max as a side effect.
    maxDate(schema.birthDate, this.today, {
      error: { kind: 'futureDate', message: 'Birth date cannot be in the future' },
    });
  });

  /** First authored error on birthDate — required or the maxDate message. */
  birthDateError = computed(() =>
    firstMessage(this.patientForm.birthDate().errors(), 'Enter a valid birth date'),
  );

  constructor() {
    // edit mode: load and patch the model signal
    effect(() => {
      const id = this.id();
      if (id) {
        this.http.get<Patient>(`${API}/patients/${id}`)
          .subscribe(({ id: _, createdAt: __, ...dto }) =>
            this.model.set({ ...dto, birthDate: fromIsoDate(dto.birthDate) }));
      }
    });
  }

  save() {
    if (this.patientForm().invalid()) return;
    this.saving.set(true);
    const model = this.model();
    // The wire format is a string date and one canonical phone form, whatever
    // the picker and the phone field happen to hold.
    const dto: CreatePatientDto = {
      ...model,
      phone: toE164(model.phone),
      birthDate: model.birthDate ? toIsoDate(model.birthDate) : '',
    };
    const req$ = this.id()
      ? this.http.patch(`${API}/patients/${this.id()}`, dto)
      : this.http.post(`${API}/patients`, { ...dto, createdAt: new Date().toISOString() });
    req$.subscribe({
      next: () => this.router.navigate(['/patients']),
      error: () => this.saving.set(false),
    });
  }
}