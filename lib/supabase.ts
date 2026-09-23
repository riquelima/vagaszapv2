import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser-friendly Supabase client.
 *
 * Credentials come from /api/config so they can be set as SERVER-ONLY env
 * vars (without the NEXT_PUBLIC_ prefix). The hardcoded fallbacks keep
 * local dev working without an env file.
 *
 * IMPORTANT: this client only handles the anon (non-secret) key. Server-only
 * actions (e.g. downloading resumes bypassing RLS) must use the service-role
 * key inside API routes, never this client.
 */

const FALLBACK_SUPABASE_URL = 'https://ffxpsothavxbrdhshtoj.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A';

// Default singleton used across the app (covers SSR + first-paint client).
export const supabase = createClient(FALLBACK_SUPABASE_URL, FALLBACK_SUPABASE_ANON_KEY);

let cachedConfig: { supabaseUrl: string; supabaseAnonKey: string } | null = null;
let cachedClient: SupabaseClient | null = null;

/**
 * Fetch the (possibly overridden) public Supabase config from the server.
 * Use this from the browser before doing any storage/auth operation to
 * guarantee the latest values are in use (e.g. after rotating keys in Vercel).
 */
export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;

  let url = FALLBACK_SUPABASE_URL;
  let key = FALLBACK_SUPABASE_ANON_KEY;

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          supabaseUrl?: string;
          supabaseAnonKey?: string;
        };
        if (data.supabaseUrl) url = data.supabaseUrl;
        if (data.supabaseAnonKey) key = data.supabaseAnonKey;
      }
    } catch {
      // fall back to defaults
    }
  }

  cachedConfig = { supabaseUrl: url, supabaseAnonKey: key };
  cachedClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cachedClient;
}
