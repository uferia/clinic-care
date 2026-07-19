import { Component, inject, input, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PatientStore } from './patient.store';
import { Patient } from './patient.model';
import { PatientHistoryComponent } from './patient-history.component';
import { PatientDocumentsComponent } from './patient-documents.component';

@Component({
  selector: 'app-patient-detail',
  imports: [
    RouterLink, FormsModule, MatTabsModule, MatCardModule, MatButtonModule,
    MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule,
    PatientHistoryComponent, PatientDocumentsComponent,
  ],
  template: `
    <header class="head">
      <a mat-icon-button routerLink="/patients" aria-label="Back to patients">
        <mat-icon>arrow_back</mat-icon>
      </a>
      @if (patient(); as p) {
        <h1>{{ p.firstName }} {{ p.lastName }}</h1>
        <span class="spacer"></span>
        <a mat-stroked-button [routerLink]="['/patients', p.id, 'edit']">
          <mat-icon>edit</mat-icon> Edit
        </a>
      }
    </header>

    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }

    @if (patient(); as p) {
      <mat-tab-group>
        <mat-tab label="Overview">
          <div class="tab">
            <mat-card appearance="outlined">
              <mat-card-content class="contact">
                <div><span class="k">Email</span> {{ p.email || '—' }}</div>
                <div><span class="k">Phone</span> {{ p.phone || '—' }}</div>
                <div><span class="k">Birth date</span> {{ p.birthDate || '—' }}</div>
                <div><span class="k">Blood type</span> {{ p.bloodType }}</div>
              </mat-card-content>
            </mat-card>

            <mat-card appearance="outlined">
              <mat-card-content>
                <h2>Medical background</h2>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Allergies</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="allergies"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Conditions</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="conditions"></textarea>
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Medications</mat-label>
                  <textarea matInput rows="2" [(ngModel)]="medications"></textarea>
                </mat-form-field>
                <button mat-flat-button [disabled]="saving()" (click)="saveMedical(p.id)">
                  <mat-icon>save</mat-icon> Save
                </button>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <mat-tab label="History">
          <div class="tab"><app-patient-history [patientId]="p.id" /></div>
        </mat-tab>

        <mat-tab label="Documents">
          <div class="tab"><app-patient-documents [patientId]="p.id" /></div>
        </mat-tab>
      </mat-tab-group>
    } @else if (!loading()) {
      <p class="muted">Patient not found.</p>
    }
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .head h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .tab { padding: 1rem 0; display: flex; flex-direction: column; gap: 1rem; }
    .contact { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .contact .k { display: block; font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
    h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.75rem; }
    .full { width: 100%; }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class PatientDetailComponent {
  private store = inject(PatientStore);
  id = input.required<string>();

  patient = signal<Patient | null>(null);
  loading = signal(true);
  saving = signal(false);

  allergies = '';
  conditions = '';
  medications = '';

  constructor() {
    effect(() => {
      const id = this.id();
      this.loading.set(true);
      this.store.getById(id).then(p => {
        this.patient.set(p);
        this.allergies = p?.allergies ?? '';
        this.conditions = p?.conditions ?? '';
        this.medications = p?.medications ?? '';
        this.loading.set(false);
      });
    });
  }

  async saveMedical(id: string) {
    this.saving.set(true);
    try {
      await this.store.saveMedical(id, {
        allergies: this.allergies, conditions: this.conditions, medications: this.medications,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
