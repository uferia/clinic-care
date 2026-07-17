import { decodeJwt } from './auth.service';

/** Build a JWT with the given payload (unsigned; signature segment is ignored). */
function makeJwt(payload: object): string {
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

describe('decodeJwt', () => {
  it('decodes the payload of a well-formed token', () => {
    const token = makeJwt({
      email: 'a@b.com', name: 'Ada Lovelace',
      picture: 'http://x/p.png', exp: 1893456000,
    });
    expect(decodeJwt(token)).toEqual({
      email: 'a@b.com', name: 'Ada Lovelace',
      picture: 'http://x/p.png', exp: 1893456000,
    });
  });

  it('returns null for a token without three segments', () => {
    expect(decodeJwt('not.a')).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    expect(decodeJwt('aaa.@@@.bbb')).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService session validity', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('is not authenticated with no session', () => {
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });

  it('is authenticated for an unexpired stored session', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: future, credential: 'x.y.z',
    }));
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('drops an expired stored session', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    localStorage.setItem('clinic-care.session', JSON.stringify({
      email: 'a@b.com', name: 'A', picture: '', exp: past, credential: 'x.y.z',
    }));
    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('clinic-care.session')).toBeNull();
  });

  it('rejects and clears a session whose exp is missing', () => {
    const b64url = (o: object) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${b64url({ alg: 'none' })}.${b64url({ email: 'a@b.com', name: 'A', picture: '' })}.sig`;
    const auth = TestBed.inject(AuthService);
    auth.handleCredential({ credential: token });
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('clinic-care.session')).toBeNull();
  });
});
