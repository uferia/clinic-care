import { inject, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';
import { ClinicContextService } from '../../core/clinic/clinic-context.service';

export interface ClinicProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
}

@Service()
export class ClinicProfileStore {
  private supabase = inject(SUPABASE);
  private ctx = inject(ClinicContextService);

  /**
   * No clinic_id is sent — the edge function pins a clinic_admin to their own clinic.
   * Reloads the shared context afterwards so the toolbar and invoice letterhead follow.
   */
  async save(profile: ClinicProfile): Promise<void> {
    const { error } = await this.supabase.functions.invoke('update-clinic', {
      body: {
        name: profile.name.trim(),
        address: profile.address,
        phone: profile.phone,
        email: profile.email,
        tax_id: profile.taxId,
      },
    });
    if (error) throw await edgeError(error);
    await this.ctx.load();
  }
}
