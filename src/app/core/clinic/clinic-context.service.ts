import { Injectable, computed, inject, signal } from '@angular/core';
import { SUPABASE } from '../supabase.client';

export interface ClinicAccess {
  clinicId: string;
  clinicName: string;
  status: 'trialing' | 'active' | 'expired';
  trialEndsAt: string | null;
  activeUntil: string | null;
}

@Injectable({ providedIn: 'root' })
export class ClinicContextService {
  private supabase = inject(SUPABASE);

  readonly access = signal<ClinicAccess | null>(null);
  readonly ready = signal(false);
  readonly isSuperAdmin = signal(false);

  readonly hasClinic = computed(() => this.access() !== null);

  readonly isActive = computed(() => {
    const a = this.access();
    if (!a) return false;
    const now = Date.now();
    if (a.status === 'trialing' && a.trialEndsAt) return new Date(a.trialEndsAt).getTime() > now;
    if (a.status === 'active' && a.activeUntil) return new Date(a.activeUntil).getTime() > now;
    return false;
  });

  /** Whole days until the relevant expiry, or null when nothing applies. */
  readonly daysLeft = computed(() => {
    const a = this.access();
    if (!a) return null;
    const target = a.status === 'trialing' ? a.trialEndsAt : a.status === 'active' ? a.activeUntil : null;
    if (!target) return null;
    const ms = new Date(target).getTime() - Date.now();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400_000);
  });

  async load(): Promise<void> {
    try {
      const { data: userData } = await this.supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        this.access.set(null);
        return;
      }
      const { data: sa } = await this.supabase
        .from('super_admins')
        .select('user_id')
        .eq('user_id', uid)
        .maybeSingle();
      this.isSuperAdmin.set(!!sa);
      const { data: membership } = await this.supabase
        .from('memberships')
        .select('clinic_id, clinics(name)')
        .eq('user_id', uid)
        .maybeSingle();
      if (!membership) {
        this.access.set(null);
        return;
      }
      const clinic = (membership as any).clinics;
      const clinicName = Array.isArray(clinic) ? clinic[0]?.name : clinic?.name;
      const { data: sub } = await this.supabase
        .from('subscriptions')
        .select('status, trial_ends_at, active_until')
        .eq('clinic_id', (membership as any).clinic_id)
        .maybeSingle();
      this.access.set({
        clinicId: (membership as any).clinic_id,
        clinicName: clinicName ?? 'Your clinic',
        status: ((sub as any)?.status ?? 'expired') as ClinicAccess['status'],
        trialEndsAt: (sub as any)?.trial_ends_at ?? null,
        activeUntil: (sub as any)?.active_until ?? null,
      });
    } catch {
      this.access.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  clear(): void {
    this.access.set(null);
    this.isSuperAdmin.set(false);
  }
}
