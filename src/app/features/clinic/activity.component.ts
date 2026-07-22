import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivityStore, ActivityEntry, describe } from './activity.store';

@Component({
  selector: 'app-activity',
  imports: [DatePipe, MatCardModule, MatIconModule, MatProgressBarModule],
  template: `
    <mat-card appearance="outlined" class="section">
      <h2>Activity</h2>
      <p class="meta">
        Who changed access, the clinic profile, or the subscription. Recorded automatically and
        cannot be edited.
      </p>

      @if (store.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (store.error()) { <p class="err">Could not load the activity trail.</p> }

      @for (entry of store.entries(); track entry.id) {
        <div class="entry">
          <mat-icon class="mark">{{ icon(entry) }}</mat-icon>
          <span class="text">
            <span><strong>{{ entry.actorEmail }}</strong> {{ describe(entry) }}</span>
            <span class="when">{{ entry.createdAt | date: 'medium' }}</span>
          </span>
        </div>
      } @empty {
        @if (!store.isLoading()) { <p class="meta">Nothing recorded yet.</p> }
      }
    </mat-card>
  `,
  styles: `
    .section { padding: 1rem; }
    .section h2 { font: var(--mat-sys-title-medium); margin: 0 0 0.25rem; }
    .meta { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); margin: 0 0 0.75rem; }
    .err { color: var(--mat-sys-error); }
    .entry { display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .entry:last-child { border-bottom: none; }
    .entry .mark { color: var(--mat-sys-on-surface-variant); flex: none; }
    .entry .text { display: flex; flex-direction: column; }
    .entry .when { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
  `,
})
export class ActivityComponent {
  protected store = inject(ActivityStore);
  protected describe = describe;

  protected icon(entry: ActivityEntry): string {
    if (entry.action.startsWith('member.')) return 'group';
    if (entry.action.startsWith('subscription.')) return 'card_membership';
    return 'store';
  }
}
