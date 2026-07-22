import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

export interface SetupStep {
  key: string;
  label: string;
  hint: string;
  route: string;
  done: boolean;
}

/**
 * Setup progress is DERIVED from what the clinic actually has — no stored
 * checklist to drift out of sync with reality, and a clinic that imports data
 * some other way is never told to do work it has already done.
 */
@Service()
export class OnboardingStore {
  private supabase = inject(SUPABASE);
  private ctx = inject(ClinicContextService);

  /** RLS scopes every count to the caller's clinic. */
  private async count(table: string): Promise<number> {
    const { count, error } = await this.supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }

  private countsResource = resource({
    params: () => ({ clinicId: this.ctx.access()?.clinicId ?? null }),
    loader: async ({ params }) => {
      if (!params.clinicId) return null;
      const [doctors, services, billingSettings, patients, appointments, members] =
        await Promise.all([
          this.count('doctors'),
          this.count('services'),
          this.count('billing_settings'),
          this.count('patients'),
          this.count('appointments'),
          this.count('memberships'),
        ]);
      return { doctors, services, billingSettings, patients, appointments, members };
    },
  });

  readonly isLoading = computed(() => this.countsResource.isLoading());
  readonly error = computed(() => this.countsResource.error());

  reload() {
    this.countsResource.reload();
  }

  readonly steps = computed<SetupStep[]>(() => {
    const c = this.countsResource.hasValue() ? this.countsResource.value() : null;
    if (!c) return [];

    const steps: SetupStep[] = [
      {
        key: 'doctor',
        label: 'Add a doctor',
        hint: 'Appointments are booked against a doctor.',
        route: '/doctors/new',
        done: c.doctors > 0,
      },
      {
        key: 'service',
        label: 'Build your price list',
        hint: 'Invoice lines come from your service catalog.',
        route: '/billing/catalog',
        done: c.services > 0,
      },
      {
        key: 'billing',
        label: 'Set currency and tax',
        hint: 'Applied to every invoice you issue.',
        route: '/billing/settings',
        done: c.billingSettings > 0,
      },
      {
        key: 'patient',
        label: 'Register a patient',
        hint: 'Records, notes, and documents live on the patient.',
        route: '/patients/new',
        done: c.patients > 0,
      },
      {
        key: 'appointment',
        label: 'Book an appointment',
        hint: 'The daily view fills in from here.',
        route: '/appointments/new',
        done: c.appointments > 0,
      },
    ];

    // Only an admin can act on this one, so only an admin is asked to.
    if (this.ctx.isClinicAdmin()) {
      steps.push({
        key: 'team',
        label: 'Invite your team',
        hint: 'They sign in with Google — no passwords to hand out.',
        route: '/team',
        done: c.members > 1,
      });
    }

    return steps;
  });

  readonly doneCount = computed(() => this.steps().filter(s => s.done).length);
  readonly total = computed(() => this.steps().length);
  readonly complete = computed(() => this.total() > 0 && this.doneCount() === this.total());
}
