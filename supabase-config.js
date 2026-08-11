// Supabase browser configuration.
// Only the publishable/anon key belongs in browser code.
// Never put a service-role/secret key here.

const SUPABASE_URL = 'https://qwnciffohlballxxkwey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__gkOLiw1BU99O-_I6vqKHg_JqeWKwK5';

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  throw new Error('Supabase JS library did not load. Check the CDN script in index.html.');
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);
