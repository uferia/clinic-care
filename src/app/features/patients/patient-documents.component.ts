import { Component, inject, input, signal, effect } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PatientDocumentsStore } from './patient-document.store';
import { PatientDocument } from './patient-document.model';

@Component({
  selector: 'app-patient-documents',
  providers: [PatientDocumentsStore],
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="bar">
      <button mat-flat-button [disabled]="busy()" (click)="picker.click()">
        <mat-icon>upload_file</mat-icon> Upload
      </button>
      <input #picker type="file" hidden accept="image/jpeg,image/png,application/pdf"
             (change)="onPick($event)" />
      @if (busy()) { <span class="muted">Uploading…</span> }
    </div>

    @if (err()) { <p class="error">{{ err() }}</p> }

    @if (store.documents().length) {
      <div class="grid">
        @for (d of store.documents(); track d.id) {
          <mat-card appearance="outlined" class="doc">
            <button class="open" (click)="open(d)" [attr.aria-label]="'Open ' + d.fileName">
              @if (d.isImage && thumbs()[d.id]) {
                <img [src]="thumbs()[d.id]" [alt]="d.fileName" />
              } @else {
                <mat-icon class="ficon">{{ d.isImage ? 'image' : 'picture_as_pdf' }}</mat-icon>
              }
            </button>
            <div class="meta">
              <span class="name" [title]="d.fileName">{{ d.fileName }}</span>
              <button mat-icon-button aria-label="Delete document" (click)="remove(d)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          </mat-card>
        }
      </div>
    } @else {
      <p class="muted">No documents.</p>
    }
  `,
  styles: `
    .bar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; }
    .doc { padding: 0; overflow: hidden; }
    .open { display: block; width: 100%; height: 7rem; border: 0; padding: 0; cursor: pointer;
            background: var(--mat-sys-surface-container); }
    .open img { width: 100%; height: 100%; object-fit: cover; }
    .ficon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: var(--mat-sys-on-surface-variant);
             display: flex; align-items: center; justify-content: center; margin: auto; }
    .meta { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.25rem 0.25rem 0.5rem; }
    .name { flex: 1 1 auto; font: var(--mat-sys-label-small); overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class PatientDocumentsComponent {
  store = inject(PatientDocumentsStore);
  patientId = input.required<string>();

  busy = signal(false);
  err = signal('');
  thumbs = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      this.store.setPatient(this.patientId());
    });
    // Load thumbnails for image documents whenever the list changes.
    effect(() => {
      const docs = this.store.documents();
      for (const d of docs) {
        if (d.isImage && !this.thumbs()[d.id]) {
          this.store.downloadUrl(d).then(url =>
            this.thumbs.update(t => ({ ...t, [d.id]: url })));
        }
      }
    });
  }

  async onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.err.set('');
    this.busy.set(true);
    try {
      await this.store.upload(file);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      this.busy.set(false);
    }
  }

  async open(d: PatientDocument) {
    try {
      const url = await this.store.downloadUrl(d);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Could not open document.');
    }
  }

  async remove(d: PatientDocument) {
    this.err.set('');
    try {
      await this.store.remove(d);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Delete failed.');
    }
  }
}
