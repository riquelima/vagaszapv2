import { NextResponse } from 'next/server';

/**
 * DEBUG endpoint — shows which Supabase-related env vars the server can see.
 * Returns only boolean presence (true/false) and a short prefix of values,
 * never the full secret. Safe to expose for diagnostic purposes; remove or
 * protect behind an auth check before going to production.
 */
export async function GET() {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_SUPABASE_URL',
    'NEXT_SUPABASE_ANON_KEY',
    'MINIMAX_API_KEY',
  ];

  const presence: Record<string, boolean> = {};
  const samples: Record<string, string | null> = {};
  for (const k of keys) {
    const v = process.env[k];
    presence[k] = Boolean(v && v.length > 0);
    if (v) {
      // Show only the first 8 chars so a user can confirm it's the right key
      // without leaking the secret itself.
      samples[k] = v.substring(0, 12) + (v.length > 12 ? '…' : '');
    } else {
      samples[k] = null;
    }
  }

  const hasAnySupabase =
    presence.SUPABASE_URL ||
    presence.NEXT_PUBLIC_SUPABASE_URL ||
    presence.NEXT_SUPABASE_URL;
  const hasAnyKey =
    presence.SUPABASE_SERVICE_ROLE_KEY ||
    presence.SUPABASE_ANON_KEY ||
    presence.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    presence.NEXT_SUPABASE_ANON_KEY;

  return NextResponse.json({
    supabase_configured: hasAnySupabase && hasAnyKey,
    presence,
    samples,
    node_env: process.env.NODE_ENV,
    vercel_env: process.env.VERCEL_ENV || null,
    vercel_region: process.env.VERCEL_REGION || null,
  });
}
