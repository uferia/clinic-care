import { inject, Service } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { edgeError } from '../../core/edge-error';

/** Self-service clinic registration. Any signed-in account with no membership may call this once. */
@Service()
export class RegistrationStore {
  private supabase = inject(SUPABASE);

  async register(name: string): Promise<void> {
    const { error } = await this.supabase.functions.invoke('register-clinic', {
      body: { name: name.trim() },
    });
    if (error) throw await edgeError(error);
  }
}
