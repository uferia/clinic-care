import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { SUPABASE } from '../../core/supabase.client';

describe('LoginComponent', () => {
  function setup() {
    const client = { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn() } };
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: SUPABASE, useValue: client }],
    });
    const auth = TestBed.inject(AuthService);
    const signIn = vi.spyOn(auth, 'signIn').mockResolvedValue();
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { fixture, signIn };
  }

  it('renders a Google sign-in button', () => {
    const { fixture } = setup();
    const btn = fixture.nativeElement.querySelector('button.google-signin');
    expect(btn).not.toBeNull();
  });

  it('calls auth.signIn when the button is clicked', () => {
    const { fixture, signIn } = setup();
    fixture.nativeElement.querySelector('button.google-signin').click();
    expect(signIn).toHaveBeenCalledOnce();
  });
});
