import { Component, computed, inject } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';
import { ClinicProfileComponent } from './clinic-profile.component';
import { TeamComponent } from '../team/team.component';

/** One home for the things a clinic owner administers: who they are, and who works there. */
@Component({
  selector: 'app-clinic-settings',
  imports: [MatTabsModule, ClinicProfileComponent, TeamComponent],
  template: `
    <header class="head">
      <h1>{{ clinicName() }}</h1>
    </header>

    <mat-tab-group>
      <mat-tab label="Profile">
        <div class="tab-body"><app-clinic-profile /></div>
      </mat-tab>
      <mat-tab label="Team">
        <div class="tab-body"><app-team /></div>
      </mat-tab>
    </mat-tab-group>
  `,
  styles: `
    .head h1 { font: var(--mat-sys-headline-small); margin: 0 0 1rem; }
    .tab-body { padding-top: 1rem; }
  `,
})
export class ClinicSettingsComponent {
  private ctx = inject(ClinicContextService);
  protected clinicName = computed(() => this.ctx.access()?.clinicName ?? 'Clinic');
}
