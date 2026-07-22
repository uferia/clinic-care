export const environment = {
  production: false,
  // Shown to clinics whose trial is ending or has ended — activation is still
  // arranged manually, so this is their only route to a paid subscription.
  supportEmail: 'ulysses.feria@gmail.com',
  // Local Supabase stack (npx supabase start). The anon key is a public,
  // browser-safe key — RLS is the security boundary, not this key.
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};
