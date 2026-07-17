import { Component, signal, computed, effect, inject, input } from '@angular/core';
import { form, FormField, required, email, validate, submit } from '@angular/forms/signals';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CreatePatientDto, Patient } from './patient.model';
import { isValidMobile, toE164 } from './phone.util';
import { API } from '../../core/api';

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
            <input matInput type="date" [formField]="patientForm.birthDate" />
            @if (patientForm.birthDate().touched() && patientForm.birthDate().invalid()) {
              <mat-error>Birth date is required and cannot be in the future</mat-error>
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
  bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-'] as const;

  // 1. the model IS a signal
  model = signal<CreatePatientDto>({
    firstName: '', lastName: '', email: '', phone: '',
    birthDate: '', bloodType: 'O+',
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
    required(schema.birthDate);
    validate(schema.birthDate, ({ value }) =>          // custom validator: just a function
      value() && new Date(value()) > new Date()
        ? { kind: 'futureDate', message: 'Birth date cannot be in the future' }
        : null
    );
  });

  constructor() {
    // edit mode: load and patch the model signal
    effect(() => {
      const id = this.id();
      if (id) {
        this.http.get<Patient>(`${API}/patients/${id}`)
          .subscribe(({ id: _, createdAt: __, ...dto }) => this.model.set(dto));
      }
    });
  }

  save() {
    if (this.patientForm().invalid()) return;
    this.saving.set(true);
    // Store one canonical phone form regardless of how it was typed.
    const dto = { ...this.model(), phone: toE164(this.model().phone) };
    const req$ = this.id()
      ? this.http.patch(`${API}/patients/${this.id()}`, dto)
      : this.http.post(`${API}/patients`, { ...dto, createdAt: new Date().toISOString() });
    req$.subscribe({
      next: () => this.router.navigate(['/patients']),
      error: () => this.saving.set(false),
    });
  }
}