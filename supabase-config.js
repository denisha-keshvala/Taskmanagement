// Supabase browser configuration
const SUPABASE_URL = "https://qwnciffohlballxxkwey.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__gkOLiw1BU99O-_I6vqKHg_JqeWKwK5";

if (!window.supabase) {
  console.error("Supabase JS library failed to load.");
} else {
  window.supabaseClient = window.supabase.createClient(
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

  console.log("Supabase client initialized.");
}
