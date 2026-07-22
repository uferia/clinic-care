import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { AuthService } from '../../core/auth/auth.service';
import { TeamStore, TeamMember } from './team.store';

@Component({
  selector: 'app-team',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <header class="head">
      <h1>Team</h1>
      <span class="meta">{{ clinicName() }}</span>
    </header>

    <mat-card appearance="outlined" class="section">
      <h2>Invite people</h2>
      <p class="meta">
        They sign in with Google using the email you list here — no password to share.
        An invite stays "invited" until their first sign-in.
      </p>
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
      <button mat-flat-button (click)="invite()" [disabled]="!emails().trim() || busy()">
        <mat-icon>person_add</mat-icon>
        Invite
      </button>
      @if (result()) { <div class="ok">{{ result() }}</div> }
      @if (inviteError()) { <div class="err">{{ inviteError() }}</div> }
    </mat-card>

    <mat-card appearance="outlined" class="section">
      <h2>Members</h2>
      @for (m of store.members(); track m.id) {
        <div class="member">
          <span class="who">
            {{ m.email }}
            @if (isSelf(m)) { <span class="meta">(you)</span> }
          </span>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="role-field">
            <mat-select
              [value]="m.role"
              [disabled]="busy() || isSelf(m)"
              (valueChange)="setRole(m, $event)"
              [attr.aria-label]="'Role for ' + m.email">
              <mat-option value="staff">staff</mat-option>
              <mat-option value="clinic_admin">clinic_admin</mat-option>
            </mat-select>
          </mat-form-field>

          <span class="bound" [class.yes]="m.bound">{{ m.bound ? 'active' : 'invited' }}</span>

          @if (isSelf(m)) {
            <span class="meta self-note">can't change your own access</span>
          } @else if (confirming() === m.id) {
            <button mat-flat-button class="danger" [disabled]="busy()" (click)="remove(m)">
              Confirm remove
            </button>
            <button mat-button [disabled]="busy()" (click)="confirming.set(null)">Cancel</button>
          } @else {
            <button
              mat-icon-button
              [disabled]="busy()"
              (click)="confirming.set(m.id)"
              [attr.aria-label]="'Remove ' + m.email">
              <mat-icon>person_remove</mat-icon>
            </button>
          }
        </div>
      } @empty {
        <p class="meta">No members yet.</p>
      }
      @if (memberError()) { <div class="err">{{ memberError() }}</div> }
    </mat-card>
  `,
  styles: `
    .head { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1rem; }
    .head h1 { font: var(--mat-sys-headline-small); margin: 0; }
    .section { padding: 1rem; margin-bottom: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.75rem; }
    .wide { width: 100%; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .err { color: var(--mat-sys-error); margin-top: 0.5rem; }
    .ok { color: var(--mat-sys-primary); margin-top: 0.5rem; }
    .member { display: flex; gap: 1rem; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .member .who { flex: 1; min-width: 12rem; }
    .member .role-field { width: 9.5rem; }
    .member .bound { padding: 0.1rem 0.5rem; border-radius: 1rem; font: var(--mat-sys-label-small);
      background: var(--mat-sys-secondary-container); }
    .member .bound.yes { background: var(--mat-sys-tertiary-container); }
    .member .self-note { white-space: nowrap; }
    .danger { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
  `,
})
export class TeamComponent {
  protected store = inject(TeamStore);
  private ctx = inject(ClinicContextService);
  private auth = inject(AuthService);

  protected clinicName = computed(() => this.ctx.access()?.clinicName ?? '');
  protected emails = signal('');
  protected role = signal<'staff' | 'clinic_admin'>('staff');
  protected busy = signal(false);
  protected result = signal<string | null>(null);
  protected inviteError = signal<string | null>(null);
  protected memberError = signal<string | null>(null);
  protected confirming = signal<string | null>(null);

  /** You cannot demote or remove yourself — that is a lockout, not an admin action. */
  protected isSelf(m: TeamMember): boolean {
    return m.email.toLowerCase() === (this.auth.user()?.email ?? '').toLowerCase();
  }

  async setRole(m: TeamMember, role: 'clinic_admin' | 'staff'): Promise<void> {
    if (role === m.role || this.busy()) return;
    this.busy.set(true);
    this.memberError.set(null);
    try {
      await this.store.setRole(m.id, role);
    } catch (e) {
      this.memberError.set(this.explain(e, `Could not change the role for ${m.email}.`));
      this.store.reload();
    } finally {
      this.busy.set(false);
    }
  }

  async remove(m: TeamMember): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.memberError.set(null);
    try {
      await this.store.remove(m.id);
      this.confirming.set(null);
    } catch (e) {
      this.memberError.set(this.explain(e, `Could not remove ${m.email}.`));
    } finally {
      this.busy.set(false);
    }
  }

  private explain(e: unknown, fallback: string): string {
    const message = e instanceof Error ? e.message : '';
    if (message.includes('last admin')) return 'A clinic must keep at least one clinic_admin.';
    return message || fallback;
  }

  private parseEmails(): string[] {
    return this.emails().split(/[\n,]/).map(e => e.trim()).filter(Boolean);
  }

  async invite(): Promise<void> {
    const list = this.parseEmails();
    if (!list.length || this.busy()) return;
    this.busy.set(true);
    this.result.set(null);
    this.inviteError.set(null);
    try {
      const { inserted, skipped } = await this.store.invite(list, this.role());
      this.emails.set('');
      const parts = [`Invited ${inserted.length}.`];
      if (skipped.length) parts.push(`Skipped (already in a clinic): ${skipped.join(', ')}`);
      this.result.set(parts.join(' '));
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Could not send invites.');
    } finally {
      this.busy.set(false);
    }
  }
}
