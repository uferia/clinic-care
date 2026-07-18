import { Component, signal, effect, inject, input } from '@angular/core';
import { form, FormField, required, min, max, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CreateDoctorDto, SPECIALTIES, toDoctor, toDoctorWrite } from './doctor.model';
import { SUPABASE } from '../../core/supabase.client';

@Component({
  selector: 'app-doctor-form',
  imports: [
    FormField,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <header class="form-head">
      <a mat-icon-button routerLink="/doctors" aria-label="Back to doctors">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <h1>{{ id() ? 'Edit' : 'New' }} Doctor</h1>
    </header>

    <mat-card appearance="outlined">
      <mat-card-content>
        <form class="grid" (submit)="$event.preventDefault(); save()">
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Full name</mat-label>
            <input matInput [formField]="doctorForm.name" />
            <mat-hint>Include title, e.g. Dr. Ana Cruz</mat-hint>
            @if (doctorForm.name().touched() && doctorForm.name().invalid()) {
              <mat-error>Name is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Specialty</mat-label>
            <mat-select [formField]="doctorForm.specialty">
              @for (s of specialties; track s) {
                <mat-option [value]="s">{{ s }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Rating</mat-label>
            <!-- min/max come from the schema's min()/max() validators, which
                 bind the attributes themselves; setting them here is an error. -->
            <input matInput type="number" step="0.1" [formField]="doctorForm.rating" />
            <mat-hint>0 to 5</mat-hint>
            @if (doctorForm.rating().touched() && doctorForm.rating().invalid()) {
              <mat-error>Rating must be between 0 and 5</mat-error>
            }
          </mat-form-field>

          <div class="toggle-row">
            <mat-slide-toggle [formField]="doctorForm.available">
              Accepting appointments
            </mat-slide-toggle>
          </div>

          @if (saveError()) {
            <div class="save-error" role="alert">{{ saveError() }}</div>
          }

          <div class="actions">
            <a mat-button routerLink="/doctors">Cancel</a>
            <button
              mat-flat-button
              type="submit"
              [disabled]="doctorForm().invalid() || saving()">
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

    .wide {
      grid-column: 1 / -1;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      padding-block: 0.5rem;
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
export class DoctorFormComponent {
  private supabase = inject(SUPABASE);
  private router = inject(Router);

  id = input<string>();
  saving = signal(false);
  saveError = signal<string | null>(null);
  specialties = SPECIALTIES;

  model = signal<CreateDoctorDto>({
    name: '',
    specialty: 'General Medicine',
    rating: 5,
    available: true,
  });

  doctorForm = form(this.model, (schema) => {
    required(schema.name, { message: 'Name is required' });
    required(schema.specialty);
    min(schema.rating, 0);
    max(schema.rating, 5);
    // A number input yields NaN when cleared, which min/max both silently pass.
    validate(schema.rating, ({ value }) =>
      Number.isFinite(value())
        ? null
        : { kind: 'ratingRequired', message: 'Rating is required' },
    );
  });

  constructor() {
    // edit mode: load and patch the model signal
    effect(() => {
      const id = this.id();
      if (!id) return;
      this.supabase
        .from('doctors')
        .select('*')
        .eq('id', id)
        .single()
        .then(({ data, error }: { data: unknown; error: unknown }) => {
          if (error || !data) return;
          const d = toDoctor(data as any);
          this.model.set({ name: d.name, specialty: d.specialty, rating: d.rating, available: d.available });
        });
    });
  }

  save() {
    if (this.doctorForm().invalid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const dto: CreateDoctorDto = this.model();
    const write = toDoctorWrite(dto);
    const id = this.id();
    const op = id
      ? this.supabase.from('doctors').update(write).eq('id', id)
      : this.supabase.from('doctors').insert(write);
    op.then(({ error }: { error: unknown }) => {
      if (error) {
        this.saving.set(false);
        this.saveError.set("Couldn't save. Please try again.");
      } else {
        this.router.navigate(['/doctors']);
      }
    });
  }
}
