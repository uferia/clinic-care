import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClinicContextService } from '../clinic/clinic-context.service';

export const clinicAdminGuard: CanActivateFn = () => {
  const ctx = inject(ClinicContextService);
  const router = inject(Router);
  return ctx.isClinicAdmin() ? true : router.createUrlTree(['/dashboard']);
};
