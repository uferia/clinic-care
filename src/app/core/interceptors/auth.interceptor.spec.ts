import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, Observable } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../auth/auth.service';
import { API } from '../api';

function capture(url: string): HttpRequest<unknown> {
  let seen!: HttpRequest<unknown>;
  const next: HttpHandlerFn = (req): Observable<HttpEvent<unknown>> => {
    seen = req;
    return of({} as HttpEvent<unknown>);
  };
  TestBed.runInInjectionContext(() =>
    authInterceptor(new HttpRequest('GET', url), next).subscribe(),
  );
  return seen;
}

describe('authInterceptor', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('attaches a bearer token to API requests when signed in', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'tok123',
    }));
    TestBed.inject(AuthService);
    const req = capture(`${API}/patients`);
    expect(req.headers.get('Authorization')).toBe('Bearer tok123');
  });

  it('does not attach a token when signed out', () => {
    const req = capture(`${API}/patients`);
    expect(req.headers.has('Authorization')).toBe(false);
  });

  it('does not attach a token to non-API requests even when signed in', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'tok123',
    }));
    TestBed.inject(AuthService);
    const req = capture('https://example.com/other');
    expect(req.headers.has('Authorization')).toBe(false);
  });
});
