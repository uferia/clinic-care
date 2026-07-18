import { createSupabaseClient } from './supabase.client';

describe('createSupabaseClient', () => {
  it('builds a client exposing the auth API', () => {
    const client = createSupabaseClient();
    expect(typeof client.auth.signInWithOAuth).toBe('function');
    expect(typeof client.auth.getSession).toBe('function');
    expect(typeof client.auth.onAuthStateChange).toBe('function');
  });
});
