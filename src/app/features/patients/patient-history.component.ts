import { Component, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SUPABASE } from '../../core/supabase.client';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { ClinicalNotesStore } from './clinical-note.store';
import { toIsoDate } from '../../core/date.util';

interface ApptView {
  id: string;
  date: string;
  time: string;
  doctor: string;
  reason: string;
  status: string;
}

@Component({
  selector: 'app-patient-history',
  providers: [ClinicalNotesStore],
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatDatepickerModule, MatListModule,
    MatProgressBarModule,
  ],
  template: `
    <section>
      <h2>Appointments</h2>
      @if (apptLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (apptError()) {
        <div class="state error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>Failed to load appointments.</p>
          <button mat-stroked-button (click)="loadAppointments(patientId())">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
        </div>
      } @else if (appointments().length) {
        <mat-list>
          @for (a of appointments(); track a.id) {
            <mat-list-item>
              <span matListItemTitle>{{ a.date }} {{ a.time }} — {{ a.doctor }}</span>
              <span matListItemLine class="muted">{{ a.reason || 'No reason' }} · {{ a.status }}</span>
            </mat-list-item>
          }
        </mat-list>
      } @else {
        <p class="muted">No appointments.</p>
      }
    </section>

    <section>
      <h2>Clinical notes</h2>
      <mat-card appearance="outlined">
        <mat-card-content class="note-form">
          <mat-form-field appearance="outline">
            <mat-label>Visit date</mat-label>
            <input matInput [matDatepicker]="dp" [(ngModel)]="visitDate" />
            <mat-datepicker-toggle matIconSuffix [for]="dp" />
            <mat-datepicker #dp />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Note</mat-label>
            <textarea matInput rows="2" [(ngModel)]="body"></textarea>
          </mat-form-field>
          <button mat-flat-button [disabled]="!body.trim()" (click)="addNote()">
            <mat-icon>add</mat-icon> Add
          </button>
        </mat-card-content>
      </mat-card>

      @if (notes.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (notes.error()) {
        <div class="state error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>Failed to load notes.</p>
          <button mat-stroked-button (click)="notes.reload()">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
        </div>
      } @else {
        @for (n of notes.notes(); track n.id) {
          <mat-card appearance="outlined" class="note">
            <mat-card-content>
              <div class="note-head">
                <strong>{{ n.visitDate }}</strong>
                <span class="muted">{{ n.authorEmail }}</span>
                <span class="spacer"></span>
                <button mat-icon-button aria-label="Delete note" (click)="notes.remove(n.id)">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              </div>
              <p class="body">{{ n.body }}</p>
            </mat-card-content>
          </mat-card>
        } @empty {
          <p class="muted">No notes yet.</p>
        }
      }
    </section>
  `,
  styles: `
    section { margin-bottom: 1.5rem; }
    h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.5rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .note-form { display: flex; gap: 0.75rem; align-items: flex-start; flex-wrap: wrap; }
    .note-form .grow { flex: 1 1 16rem; }
    .note { margin-bottom: 0.5rem; }
    .note-head { display: flex; align-items: center; gap: 0.5rem; }
    .note-head .spacer { flex: 1 1 auto; }
    .body { margin: 0.25rem 0 0; white-space: pre-wrap; }
  `,
})
export class PatientHistoryComponent {
  private supabase = inject(SUPABASE);
  notes = inject(ClinicalNotesStore);

  patientId = input.required<string>();

  appointments = signal<ApptView[]>([]);
  apptLoading = signal(false);
  apptError = signal(false);
  visitDate: Date | null = new Date();
  body = '';

  constructor() {
    effect(() => {
      const id = this.patientId();
      this.notes.setPatient(id);
      this.loadAppointments(id);
    });
  }

  async loadAppointments(patientId: string) {
    this.apptLoading.set(true);
    try {
      const { data, error } = await this.supabase
        .from('appointments')
        .select('*, doctor:doctors(name)')
        .eq('patient_id', patientId)
        .order('date', { ascending: false });
      if (error) {
        this.apptError.set(true);
        return;
      }
      this.apptError.set(false);
      const rows = (data as (AppointmentRowEmbedded & { doctor: { name: string } | null })[]) ?? [];
      this.appointments.set(rows.map(r => ({
        id: r.id, date: r.date, time: r.time,
        doctor: r.doctor?.name ?? '—', reason: r.reason ?? '', status: r.status,
      })));
    } finally {
      this.apptLoading.set(false);
    }
  }

  async addNote() {
    const body = this.body.trim();
    if (!body) return;
    // Author is the signed-in staff user, resolved from the session — not the patient.
    const { data: { user } } = await this.supabase.auth.getUser();
    await this.notes.add({
      patientId: this.patientId(),
      visitDate: toIsoDate(this.visitDate ?? new Date()),
      body,
      authorEmail: user?.email ?? '',
    });
    this.visitDate = new Date();
    this.body = '';
  }
}
