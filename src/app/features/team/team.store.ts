import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

export interface TeamMember {
  id: string;
  email: string;
  role: 'clinic_admin' | 'staff';
  /** False until the person's first Google sign-in binds the membership. */
  bound: boolean;
}

export interface InviteResult {
  inserted: string[];
  skipped: string[];
}

@Service()
export class TeamStore {
  private supabase = inject(SUPABASE);
  private ctx = inject(ClinicContextService);

  private membersResource = resource({
    params: () => ({ clinicId: this.ctx.access()?.clinicId ?? null }),
    loader: async ({ params }) => {
      if (!params.clinicId) return [] as TeamMember[];
      // RLS already scopes this to the caller's clinic; the filter also keeps a super-admin
      // (who reads every clinic's rows) looking at their own team here.
      const { data, error } = await this.supabase
        .from('memberships')
        .select('id, email, role, user_id')
        .eq('clinic_id', params.clinicId)
        .order('email');
      if (error) throw error;
      return (data ?? []).map((r: any): TeamMember => ({
        id: r.id,
        email: r.email,
        role: r.role,
        bound: r.user_id !== null,
      }));
    },
  });

  readonly members = computed<TeamMember[]>(() => this.membersResource.value() ?? []);
  readonly isLoading = computed(() => this.membersResource.isLoading());
  readonly error = computed(() => this.membersResource.error());

  reload() {
    this.membersResource.reload();
  }

  /** No clinic_id is sent — the edge function pins a clinic_admin to their own clinic. */
  async invite(emails: string[], role: 'clinic_admin' | 'staff'): Promise<InviteResult> {
    const { data, error } = await this.supabase.functions.invoke('add-members', {
      body: { emails, role },
    });
    if (error) throw await edgeError(error);
    this.membersResource.reload();
    return {
      inserted: (data as InviteResult)?.inserted ?? [],
      skipped: (data as InviteResult)?.skipped ?? [],
    };
  }
}
