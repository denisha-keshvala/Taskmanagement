// Supabase browser configuration.
// This is the publishable key only. Never put a Supabase secret/service-role key here.

const SUPABASE_URL = 'https://qwnciffohlballxxkwey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__gkOLiw1BU99O-_I6vqKHg_JqeWKwK5';

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
