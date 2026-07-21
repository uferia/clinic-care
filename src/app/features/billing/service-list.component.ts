import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { ServiceStore } from './service.store';
import { Service } from './billing.model';

@Component({
  selector: 'app-service-list',
  imports: [
    DecimalPipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatSlideToggleModule, MatProgressBarModule,
    MatTableModule,
  ],
  providers: [ServiceStore],
  template: `
    <header class="toolbar">
      <h1>Service Catalog</h1>
      <span class="spacer"></span>
      <mat-slide-toggle
        [ngModel]="store.activeOnly()"
        (ngModelChange)="store.setActiveOnly($event)">
        Active only
      </mat-slide-toggle>
    </header>

    <mat-card appearance="outlined" class="form-card">
      <mat-card-content class="row">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="draftName" placeholder="Consultation" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="price">
          <mat-label>Price</mat-label>
          <input matInput type="number" min="0" step="0.01" [(ngModel)]="draftPrice" />
        </mat-form-field>
        <button mat-flat-button [disabled]="!draftName().trim() || saving()" (click)="save()">
          <mat-icon>{{ editingId() ? 'save' : 'add' }}</mat-icon>
          {{ editingId() ? 'Update' : 'Add' }}
        </button>
        @if (editingId()) {
          <button mat-button (click)="resetDraft()">Cancel</button>
        }
      </mat-card-content>
    </mat-card>

    @if (err()) { <p class="error">{{ err() }}</p> }

    @if (store.isLoading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (store.error()) {
      <div class="state error-state">
        <mat-icon>cloud_off</mat-icon>
        <p>Failed to load services.</p>
        <button mat-stroked-button (click)="store.reload()">Retry</button>
      </div>
    } @else if (store.services().length) {
      <table mat-table [dataSource]="store.services()" class="mat-elevation-z0">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let s">{{ s.name }}</td>
        </ng-container>
        <ng-container matColumnDef="price">
          <th mat-header-cell *matHeaderCellDef>Price</th>
          <td mat-cell *matCellDef="let s">{{ s.price | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="active">
          <th mat-header-cell *matHeaderCellDef>Active</th>
          <td mat-cell *matCellDef="let s">{{ s.active ? 'Yes' : 'No' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let s" class="actions">
            <button mat-icon-button (click)="edit(s)" aria-label="Edit service">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button (click)="remove(s)" aria-label="Delete service">
              <mat-icon>delete_outline</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    } @else {
      <div class="state"><p class="muted">No services yet.</p></div>
    }
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .spacer { flex: 1 1 auto; }
    .form-card { margin-bottom: 1.25rem; }
    .row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .grow { flex: 1 1 16rem; }
    .price { flex: 0 1 9rem; }
    table { width: 100%; }
    .actions { text-align: right; white-space: nowrap; }
    .state { display: grid; place-items: center; gap: 0.5rem; padding: 2rem; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
  `,
})
export class ServiceListComponent {
  store = inject(ServiceStore);
  cols = ['name', 'price', 'active', 'actions'];

  draftName = signal('');
  draftPrice = signal<number>(0);
  editingId = signal<string | null>(null);
  saving = signal(false);
  err = signal('');

  edit(s: Service) {
    this.editingId.set(s.id);
    this.draftName.set(s.name);
    this.draftPrice.set(s.price);
  }

  resetDraft() {
    this.editingId.set(null);
    this.draftName.set('');
    this.draftPrice.set(0);
  }

  async save() {
    this.saving.set(true);
    this.err.set('');
    const dto = {
      name: this.draftName().trim(),
      description: '',
      price: Number(this.draftPrice()) || 0,
      active: true,
    };
    try {
      const id = this.editingId();
      if (id) await this.store.update(id, dto);
      else await this.store.add(dto);
      this.resetDraft();
    } catch (e) {
      // Leave the draft intact so the in-progress edit isn't lost.
      this.err.set(e instanceof Error ? e.message : 'Failed to save service.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(s: Service) {
    this.err.set('');
    try {
      await this.store.remove(s.id);
    } catch (e) {
      this.err.set(e instanceof Error ? e.message : 'Failed to delete service.');
    }
  }
}
