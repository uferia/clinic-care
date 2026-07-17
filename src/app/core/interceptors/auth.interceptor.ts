import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { API } from '../api';

// json-server performs no auth and ignores this header. It is attached as the
// honest place the session token would travel to a real backend.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const user = inject(AuthService).user();
  if (user && req.url.startsWith(API)) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${user.credential}` },
    });
  }
  return next(req);
};
