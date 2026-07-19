import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { AdminClinic, AdminMember } from './admin.model';

@Service()
export class AdminStore {
  private supabase = inject(SUPABASE);

  private clinicsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase
        .from('clinics')
        .select('id, name, created_at, subscriptions(status, trial_ends_at, active_until), memberships(count)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any): AdminClinic => {
        const sub = Array.isArray(row.subscriptions) ? row.subscriptions[0] : row.subscriptions;
        const count = Array.isArray(row.memberships) ? (row.memberships[0]?.count ?? 0) : 0;
        return {
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          status: sub?.status ?? 'expired',
          trialEndsAt: sub?.trial_ends_at ?? null,
          activeUntil: sub?.active_until ?? null,
          memberCount: count,
        };
      });
    },
  });

  clinics = computed<AdminClinic[]>(() => this.clinicsResource.value() ?? []);
  readonly isLoading = computed(() => this.clinicsResource.isLoading());
  readonly error = computed(() => this.clinicsResource.error());
  reload() {
    this.clinicsResource.reload();
  }

  private async invoke(name: string, body: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.functions.invoke(name, { body });
    if (error) throw error;
    this.clinicsResource.reload();
  }

  createClinic(name: string) {
    return this.invoke('create-clinic', { name });
  }
  addMembers(clinicId: string, emails: string[], role: 'clinic_admin' | 'staff') {
    return this.invoke('add-members', { clinic_id: clinicId, emails, role });
  }
  activate(clinicId: string, months = 1) {
    return this.invoke('set-subscription', { clinic_id: clinicId, months });
  }
  expire(clinicId: string) {
    return this.invoke('expire-clinic', { clinic_id: clinicId });
  }

  /** Members of one clinic (super-admin RLS returns them). */
  async members(clinicId: string): Promise<AdminMember[]> {
    const { data } = await this.supabase
      .from('memberships')
      .select('id, email, role, user_id')
      .eq('clinic_id', clinicId)
      .order('email');
    return ((data as any[]) ?? []).map(r => ({ id: r.id, email: r.email, role: r.role, bound: r.user_id !== null }));
  }
}
