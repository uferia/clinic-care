import { computed, inject, resource, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

export interface ActivityEntry {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Human wording for each recorded action. Unknown actions fall back to the raw key. */
const ACTION_LABELS: Record<string, string> = {
  'clinic.register': 'registered the clinic',
  'clinic.create': 'created the clinic',
  'clinic.update': 'updated the clinic profile',
  'member.invite': 'invited',
  'member.role_change': 'changed the role of',
  'member.remove': 'removed',
  'subscription.activate': 'activated the subscription until',
  'subscription.expire': 'ended the subscription',
};

export function describe(entry: ActivityEntry): string {
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const role = entry.details?.['role'];
  const previous = entry.details?.['previous_name'];

  // On registration `target` is the registrant's email, which would read as
  // "registered the clinic owner@x.com". The clinic's name is in the details.
  if (entry.action === 'clinic.register') {
    const name = entry.details?.['name'];
    return name ? `${verb} ${name}` : verb;
  }
  if (entry.action === 'member.role_change' && role) return `${verb} ${entry.target} to ${role}`;
  if (entry.action === 'member.invite' && role) return `${verb} ${entry.target} as ${role}`;
  if (entry.action === 'clinic.update' && previous && previous !== entry.target) {
    return `renamed the clinic from ${previous} to ${entry.target}`;
  }
  return entry.target ? `${verb} ${entry.target}` : verb;
}

@Service()
export class ActivityStore {
  private supabase = inject(SUPABASE);
  private ctx = inject(ClinicContextService);

  private entriesResource = resource({
    params: () => ({ clinicId: this.ctx.access()?.clinicId ?? null }),
    loader: async ({ params }) => {
      if (!params.clinicId) return [] as ActivityEntry[];
      // RLS restricts this to clinic_admins of this clinic; the filter keeps a
      // super-admin (who can read every clinic's trail) looking at this one.
      const { data, error } = await this.supabase
        .from('audit_log')
        .select('id, actor_email, action, target, details, created_at')
        .eq('clinic_id', params.clinicId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r: any): ActivityEntry => ({
        id: r.id,
        actorEmail: r.actor_email ?? 'a deleted account',
        action: r.action,
        target: r.target ?? '',
        details: r.details ?? {},
        createdAt: r.created_at,
      }));
    },
  });

  readonly entries = computed<ActivityEntry[]>(() =>
    this.entriesResource.hasValue() ? this.entriesResource.value() : [],
  );
  readonly isLoading = computed(() => this.entriesResource.isLoading());
  readonly error = computed(() => this.entriesResource.error());

  reload() {
    this.entriesResource.reload();
  }
}
