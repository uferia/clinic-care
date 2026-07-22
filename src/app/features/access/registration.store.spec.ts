import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RegistrationStore } from './registration.store';
import { SUPABASE } from '../../core/supabase.client';

function setup(invoke: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { functions: { invoke } } }],
  });
  return TestBed.inject(RegistrationStore);
}

describe('RegistrationStore', () => {
  it('invokes register-clinic with a trimmed name', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { clinic: { id: 'c1' } }, error: null });
    await setup(invoke).register('  Sunrise Clinic  ');
    expect(invoke).toHaveBeenCalledWith('register-clinic', { body: { name: 'Sunrise Clinic' } });
  });

  it('surfaces the edge function error body instead of the generic message', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'already a member' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    await expect(setup(invoke).register('Second Clinic')).rejects.toThrow('already a member');
  });
});
