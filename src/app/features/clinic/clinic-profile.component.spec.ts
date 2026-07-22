import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ClinicProfileComponent } from './clinic-profile.component';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';

const access: ClinicAccess = {
  clinicId: 'c1',
  clinicName: 'Sunrise',
  address: '12 Mabini St',
  phone: null,
  email: null,
  taxId: null,
  role: 'clinic_admin',
  status: 'trialing',
  trialEndsAt: new Date(Date.now() + 86400_000).toISOString(),
  activeUntil: null,
};

function render(invoke = vi.fn().mockResolvedValue({ data: { clinic: {} }, error: null })) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{
      provide: SUPABASE,
      useValue: { auth: { getUser: async () => ({ data: { user: null } }) }, functions: { invoke }, from: () => ({}) },
    }],
  });
  TestBed.inject(ClinicContextService).access.set(access);
  const fixture = TestBed.createComponent(ClinicProfileComponent);
  fixture.detectChanges();
  return { fixture, invoke, el: fixture.nativeElement as HTMLElement };
}

function typeInto(el: HTMLElement, label: string, value: string) {
  const field = [...el.querySelectorAll('mat-form-field')]
    .find(f => f.textContent?.includes(label))!;
  const input = field.querySelector('input, textarea') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ClinicProfileComponent', () => {
  it('seeds the form from the clinic already in context', () => {
    const { el } = render();
    const name = el.querySelector('input') as HTMLInputElement;
    expect(name.value).toBe('Sunrise');
  });

  it('keeps Save disabled until something actually changes', () => {
    const { el, fixture } = render();
    const save = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('Save'))!;
    expect(save.disabled).toBe(true);

    typeInto(el, 'Clinic name', 'Sunrise Family Clinic');
    fixture.detectChanges();
    expect(save.disabled).toBe(false);
  });

  it('refuses to save a blank clinic name', () => {
    const { el, fixture } = render();
    typeInto(el, 'Clinic name', '   ');
    fixture.detectChanges();
    const save = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('Save'))!;
    expect(save.disabled).toBe(true);
  });

  it('sends no clinic_id — the server pins the caller to their own clinic', async () => {
    const { el, fixture, invoke } = render();
    typeInto(el, 'Clinic name', 'Sunrise Family Clinic');
    typeInto(el, 'Phone', '+63 900 000 0000');
    fixture.detectChanges();
    ([...el.querySelectorAll('button')].find(b => b.textContent?.includes('Save')) as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r));

    expect(invoke).toHaveBeenCalledWith('update-clinic', {
      body: {
        name: 'Sunrise Family Clinic',
        address: '12 Mabini St',
        phone: '+63 900 000 0000',
        email: '',
        tax_id: '',
      },
    });
  });

  it('surfaces the edge function error body', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { el, fixture } = render(vi.fn().mockResolvedValue({ data: null, error }));
    typeInto(el, 'Clinic name', 'Nope');
    fixture.detectChanges();
    ([...el.querySelectorAll('button')].find(b => b.textContent?.includes('Save')) as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    expect(el.textContent).toContain('forbidden');
  });
});
