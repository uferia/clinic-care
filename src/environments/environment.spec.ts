import { environment } from './environment';

describe('environment', () => {
  it('exposes a Supabase URL and a non-empty anon key', () => {
    expect(environment.supabaseUrl).toMatch(/^https?:\/\//);
    expect(environment.supabaseAnonKey.length).toBeGreaterThan(20);
  });
});
