import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClinicContextService } from '../clinic/clinic-context.service';

export const accessGuard: CanActivateFn = () => {
  const ctx = inject(ClinicContextService);
  const router = inject(Router);
  if (!ctx.hasClinic()) return router.createUrlTree(['/no-access']);
  if (!ctx.isActive()) return router.createUrlTree(['/blocked']);
  return true;
};
