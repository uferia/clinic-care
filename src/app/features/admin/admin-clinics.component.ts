import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CLINIC_NAME_MAX, clinicNameError } from '../../core/clinic-name';
import { AdminStore } from './admin.store';

@Component({
  selector: 'app-admin-clinics',
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    <header class="head">
      <h1>Clinics</h1>
    </header>

    <mat-card appearance="outlined" class="create">
      <form (submit)="$event.preventDefault(); create()">
        <mat-form-field appearance="outline">
          <mat-label>New clinic name</mat-label>
          <input
            matInput
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            [attr.maxlength]="nameMax" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="!!nameError() || busy()">Create</button>
      </form>
      <!-- Plain text, not <mat-error>: signal-bound fields never put mat-form-field into
           the error state that would reveal one. -->
      @if (name() && nameError()) { <div class="err">{{ nameError() }}</div> }
      @if (createError()) { <div class="err">{{ createError() }}</div> }
    </mat-card>

    @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

    <div class="grid">
      @for (c of store.clinics(); track c.id) {
        <mat-card appearance="outlined" class="clinic">
          <a [routerLink]="[c.id]" class="clinic-name">{{ c.name }}</a>
          <span class="badge" [class.trial]="c.status === 'trialing'" [class.expired]="c.status === 'expired'">{{ c.status }}</span>
          <p class="meta">
            @if (c.status === 'trialing') { Trial ends {{ c.trialEndsAt | date: 'mediumDate' }} }
            @else if (c.status === 'active') { Active until {{ c.activeUntil | date: 'mediumDate' }} }
            @else { No active subscription }
          </p>
          <p class="meta">{{ c.memberCount }} member(s)</p>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .head h1 { font: var(--mat-sys-headline-small); margin: 0 0 1rem; }
    .create form { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.5rem; }
    .create mat-form-field { flex: 1; }
    .err { color: var(--mat-sys-error); padding: 0 0.5rem 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 1rem; margin-top: 1rem; }
    .clinic { display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem; }
    .clinic-name { font: var(--mat-sys-title-medium); color: var(--mat-sys-primary); text-decoration: none; }
    .badge { align-self: flex-start; padding: 0.1rem 0.55rem; border-radius: 1rem; font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); text-transform: capitalize; }
    .badge.trial { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .badge.expired { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .meta { margin: 0; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
  `,
})
export class AdminClinicsComponent {
  protected store = inject(AdminStore);
  protected name = signal('');
  protected busy = signal(false);
  protected createError = signal<string | null>(null);

  protected nameMax = CLINIC_NAME_MAX;
  protected nameError = computed(() => clinicNameError(this.name()));

  async create() {
    if (this.nameError()) return;
    this.busy.set(true);
    this.createError.set(null);
    try {
      await this.store.createClinic(this.name().trim());
      this.name.set('');
    } catch {
      this.createError.set("Couldn't create the clinic.");
    } finally {
      this.busy.set(false);
    }
  }
}
