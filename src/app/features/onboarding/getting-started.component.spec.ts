import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { GettingStartedComponent } from './getting-started.component';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';

function makeClient(counts: Record<string, number>) {
  return {
    auth: {},
    from: vi.fn((table: string) => ({
      select: () => Promise.resolve({ count: counts[table] ?? 0, error: null }),
    })),
  };
}

const access: ClinicAccess = {
  clinicId: 'c1',
  clinicName: 'Sunrise',
  role: 'clinic_admin',
  status: 'trialing',
  trialEndsAt: new Date(Date.now() + 86400_000).toISOString(),
  activeUntil: null,
};

async function render(counts: Record<string, number>, clinic: ClinicAccess = access) {
  // Some tests render twice (dismiss, then re-render) so start from a clean module.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: SUPABASE, useValue: makeClient(counts) }],
  });
  TestBed.inject(ClinicContextService).access.set(clinic);
  const fixture = TestBed.createComponent(GettingStartedComponent);
  fixture.detectChanges();
  await new Promise(r => setTimeout(r));
  fixture.detectChanges();
  return fixture;
}

describe('GettingStartedComponent', () => {
  beforeEach(() => localStorage.clear());

  it('lists the outstanding setup steps for a new clinic', async () => {
    const el = (await render({ memberships: 1 })).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Finish setting up Sunrise');
    expect(el.textContent).toContain('Add a doctor');
    expect(el.querySelectorAll('.step').length).toBe(6);
  });

  it('disappears once every step is done', async () => {
    const el = (await render({
      doctors: 1, services: 1, billing_settings: 1,
      patients: 1, appointments: 1, memberships: 2,
    })).nativeElement as HTMLElement;
    expect(el.textContent).toBe('');
  });

  it('stays hidden for this clinic after Hide, across reloads', async () => {
    const fixture = await render({ memberships: 1 });
    const hide = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    hide.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('');

    // A fresh render of the same clinic reads the stored dismissal.
    const again = await render({ memberships: 1 });
    expect((again.nativeElement as HTMLElement).textContent).toBe('');
  });

  it('dismissing one clinic does not silence another', async () => {
    const fixture = await render({ memberships: 1 });
    ((fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement).click();

    const other = await render({ memberships: 1 }, { ...access, clinicId: 'c2', clinicName: 'Other' });
    expect((other.nativeElement as HTMLElement).textContent).toContain('Finish setting up Other');
  });
});
