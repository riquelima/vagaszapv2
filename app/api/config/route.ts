import { NextResponse } from 'next/server';

/**
 * Public runtime config exposed to the browser.
 *
 * The browser cannot read env vars without the `NEXT_PUBLIC_` prefix; we
 * expose the (anon, non-secret) values here so the client can initialize the
 * Supabase SDK. Server-only secrets (SERVICE_ROLE_KEY) are NEVER returned.
 */
export async function GET() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  return NextResponse.json({
    supabaseUrl,
    supabaseAnonKey,
  });
}
