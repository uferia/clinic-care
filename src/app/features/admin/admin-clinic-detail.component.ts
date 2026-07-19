import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminStore } from './admin.store';
import { AdminClinic, AdminMember } from './admin.model';

@Component({
  selector: 'app-admin-clinic-detail',
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <header class="head">
      <a mat-icon-button routerLink="/admin" aria-label="Back"><mat-icon>arrow_back</mat-icon></a>
      <h1>{{ clinic()?.name ?? 'Clinic' }}</h1>
    </header>

    @if (clinic(); as c) {
      <mat-card appearance="outlined" class="section">
        <h2>Subscription</h2>
        <p class="meta">
          Status: <strong>{{ c.status }}</strong>
          @if (c.status === 'trialing') { · trial ends {{ c.trialEndsAt | date: 'mediumDate' }} }
          @else if (c.status === 'active') { · active until {{ c.activeUntil | date: 'mediumDate' }} }
        </p>
        <div class="actions">
          <button mat-flat-button (click)="activate()" [disabled]="busy()">Activate / +1 month</button>
          <button mat-stroked-button (click)="expire()" [disabled]="busy()">Expire</button>
        </div>
        @if (actionError()) { <div class="err">{{ actionError() }}</div> }
      </mat-card>
    }

    <mat-card appearance="outlined" class="section">
      <h2>Add members</h2>
      <mat-form-field appearance="outline" class="wide">
        <mat-label>Emails (one per line)</mat-label>
        <textarea matInput rows="4" [value]="emails()" (input)="emails.set($any($event.target).value)"></textarea>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Role</mat-label>
        <mat-select [value]="role()" (valueChange)="role.set($event)">
          <mat-option value="staff">staff</mat-option>
          <mat-option value="clinic_admin">clinic_admin</mat-option>
        </mat-select>
      </mat-form-field>
      <button mat-flat-button (click)="add()" [disabled]="!emails().trim() || busy()">Add</button>
      @if (addResult()) { <div class="ok">{{ addResult() }}</div> }
    </mat-card>

    <mat-card appearance="outlined" class="section">
      <h2>Members</h2>
      @for (m of members(); track m.id) {
        <div class="member">
          <span>{{ m.email }}</span>
          <span class="role">{{ m.role }}</span>
          <span class="bound" [class.yes]="m.bound">{{ m.bound ? 'active' : 'invited' }}</span>
        </div>
      } @empty { <p class="meta">No members yet.</p> }
    </mat-card>
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .head h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .section { padding: 1rem; margin-bottom: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.75rem; }
    .wide { width: 100%; }
    .actions { display: flex; gap: 0.5rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .err { color: var(--mat-sys-error); margin-top: 0.5rem; }
    .ok { color: var(--mat-sys-primary); margin-top: 0.5rem; }
    .member { display: flex; gap: 1rem; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .member .role { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .member .bound { margin-left: auto; padding: 0.1rem 0.5rem; border-radius: 1rem; font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container); }
    .member .bound.yes { background: var(--mat-sys-tertiary-container); }
  `,
})
export class AdminClinicDetailComponent {
  protected store = inject(AdminStore);
  id = input.required<string>();

  protected clinic = computed<AdminClinic | undefined>(() => this.store.clinics().find(c => c.id === this.id()));
  protected members = signal<AdminMember[]>([]);
  protected emails = signal('');
  protected role = signal<'staff' | 'clinic_admin'>('staff');
  protected busy = signal(false);
  protected actionError = signal<string | null>(null);
  protected addResult = signal<string | null>(null);

  constructor() {
    // Ensure the clinics list is loaded (so `clinic()` resolves on deep-link) and load members.
    effect(() => {
      const id = this.id();
      if (id) this.loadMembers(id);
    });
  }

  private async loadMembers(id: string) {
    this.members.set(await this.store.members(id));
  }

  private parseEmails(): string[] {
    return this.emails().split(/[\n,]/).map(e => e.trim()).filter(Boolean);
  }

  async activate() {
    this.busy.set(true); this.actionError.set(null);
    try { await this.store.activate(this.id(), 1); } catch { this.actionError.set("Action failed."); }
    finally { this.busy.set(false); }
  }

  async expire() {
    this.busy.set(true); this.actionError.set(null);
    try { await this.store.expire(this.id()); } catch { this.actionError.set("Action failed."); }
    finally { this.busy.set(false); }
  }

  async add() {
    const list = this.parseEmails();
    if (!list.length) return;
    this.busy.set(true); this.addResult.set(null);
    try {
      await this.store.addMembers(this.id(), list, this.role());
      this.emails.set('');
      await this.loadMembers(this.id());
      this.addResult.set('Members added.');
    } catch {
      this.addResult.set('Failed to add members.');
    } finally {
      this.busy.set(false);
    }
  }
}
