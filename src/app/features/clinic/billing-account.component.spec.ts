import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BillingAccountComponent } from './billing-account.component';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';

const activeAccess: ClinicAccess = {
  clinicId: 'c1',
  clinicName: 'Sunrise',
  address: null,
  phone: null,
  email: null,
  taxId: null,
  role: 'clinic_admin',
  status: 'active',
  trialEndsAt: null,
  activeUntil: new Date(Date.now() + 20 * 86400_000).toISOString(),
};

function render(access: ClinicAccess, invoke = vi.fn()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: { auth: {}, functions: { invoke }, from: () => ({}) } }],
  });
  TestBed.inject(ClinicContextService).access.set(access);
  const fixture = TestBed.createComponent(BillingAccountComponent);
  fixture.detectChanges();
  return { fixture, invoke, el: fixture.nativeElement as HTMLElement };
}

function findButton(el: HTMLElement, text: string): HTMLButtonElement {
  return [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;
}

describe('BillingAccountComponent', () => {
  it('shows a Cancel subscription button for an active plan, not Manage billing', () => {
    const { el } = render(activeAccess);
    expect(findButton(el, 'Cancel subscription')).toBeTruthy();
    expect(el.textContent).not.toContain('Manage billing');
  });

  it('requires a second click before actually cancelling', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { cancelled: true }, error: null });
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    expect(invoke).not.toHaveBeenCalled();
    expect(findButton(el, 'Confirm cancel')).toBeTruthy();

    findButton(el, 'Confirm cancel').click();
    await new Promise(r => setTimeout(r));
    expect(invoke).toHaveBeenCalledWith('cancel-subscription', { body: {} });
  });

  it('backs out of the confirm step without cancelling', () => {
    const invoke = vi.fn();
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    findButton(el, 'Keep subscription').click();
    fixture.detectChanges();

    expect(invoke).not.toHaveBeenCalled();
    expect(findButton(el, 'Cancel subscription')).toBeTruthy();
  });

  it('surfaces a cancellation error', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'no billing account yet' }), { status: 409 }),
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    const { fixture, el } = render(activeAccess, invoke);

    findButton(el, 'Cancel subscription').click();
    fixture.detectChanges();
    findButton(el, 'Confirm cancel').click();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();

    expect(el.textContent).toContain('no billing account yet');
  });
});
