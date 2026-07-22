import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BlockedComponent } from './blocked.component';
import { ClinicContextService, ClinicAccess } from '../../core/clinic/clinic-context.service';
import { SUPABASE } from '../../core/supabase.client';
import { supportEmail } from '../../shared/support-contact';

function render(access: ClinicAccess | null): HTMLElement {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: SUPABASE, useValue: { auth: {}, from: () => ({}) } }],
  });
  TestBed.inject(ClinicContextService).access.set(access);
  const fixture = TestBed.createComponent(BlockedComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const expiredTrial: ClinicAccess = {
  clinicId: 'c1',
  clinicName: 'Sunrise',
  role: 'clinic_admin',
  status: 'trialing',
  trialEndsAt: '2026-07-21T00:00:00Z',
  activeUntil: null,
};

describe('BlockedComponent', () => {
  it('offers a mailto that names the clinic, so activation needs no back-and-forth', () => {
    const link = render(expiredTrial).querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(link.href).toContain(supportEmail);
    expect(decodeURIComponent(link.href)).toContain('Sunrise');
  });

  it('names the date the trial ended', () => {
    expect(render(expiredTrial).textContent).toContain('ended on Jul 21, 2026.');
  });

  it('omits the date rather than trailing a bare period when none is known', () => {
    const text = render({ ...expiredTrial, trialEndsAt: null }).textContent ?? '';
    expect(text).toContain('ended.');
    expect(text).not.toContain(' .');
  });

  it('still shows a contact route when the clinic context failed to load', () => {
    const link = render(null).querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(link.href).toContain(supportEmail);
  });
});
