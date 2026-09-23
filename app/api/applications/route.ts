import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Reads `vagas_compat_automation/applied_jobs.json` and returns the structured
 * list of applications with their verification status. Used by the SaaS
 * dashboard to display, per job, whether the bot successfully submitted the
 * application and what evidence was captured.
 *
 * Query params:
 *   - status    : filter by status (submitted|failed|needs_manual_review|dry_run)
 *   - limit     : max records (default 200)
 *   - summary=1 : return only counts (no per-record list)
 */

type Evidence = {
  thank_you_url?: string | null;
  post_submit_url?: string | null;
  post_submit_title?: string | null;
  screenshot_path?: string | null;
  http_status?: number | null;
  response_snippet?: string | null;
  confirmation_keywords_found?: string[];
};

type ApplicationRecord = {
  id?: string;
  job_id?: string;
  title?: string;
  company?: string;
  url?: string;
  category?: string;
  score?: number;
  score_reason?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  duration_s?: number | null;
  evidence?: Evidence;
  form_log?: Array<{ label: string; status: string }>;
  submit_result?: string | null;
  errors?: string[];
  live_submit?: boolean;
  applied_at?: string; // legacy field
};

const ALLOWED_STATUSES = new Set([
  'submitted',
  'failed',
  'needs_manual_review',
  'dry_run',
  'pending',
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limitRaw = searchParams.get('limit');
  const summaryOnly = searchParams.get('summary') === '1';

  const limit = Math.max(
    1,
    Math.min(1000, Number.parseInt(limitRaw || '200', 10) || 200),
  );

  // File lives at <repo>/vagas_compat_automation/applied_jobs.json
  const filePath = path.join(
    process.cwd(),
    'vagas_compat_automation',
    'applied_jobs.json',
  );

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({
      success: true,
      source: 'none',
      total: 0,
      summary: {},
      applications: [],
      note: 'applied_jobs.json not found — run the automation first',
    });
  }

  let raw: ApplicationRecord[] = [];
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ApplicationRecord[];
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: `failed to parse applied_jobs.json: ${e.message}` },
      { status: 500 },
    );
  }

  // Counts
  const counts: Record<string, number> = {};
  for (const r of raw) {
    const s = r.status || 'unknown';
    counts[s] = (counts[s] || 0) + 1;
  }

  if (summaryOnly) {
    return NextResponse.json({
      success: true,
      source: 'applied_jobs.json',
      total: raw.length,
      summary: counts,
    });
  }

  // Filter
  let filtered = raw;
  if (status && ALLOWED_STATUSES.has(status)) {
    filtered = filtered.filter((r) => r.status === status);
  }

  // Sort newest first by finished_at || started_at || applied_at
  filtered.sort((a, b) => {
    const ta = Date.parse(
      a.finished_at || a.started_at || a.applied_at || '',
    );
    const tb = Date.parse(
      b.finished_at || b.started_at || b.applied_at || '',
    );
    return (tb || 0) - (ta || 0);
  });

  // Limit
  const sliced = filtered.slice(0, limit);

  return NextResponse.json({
    success: true,
    source: 'applied_jobs.json',
    total: raw.length,
    filtered_total: filtered.length,
    returned: sliced.length,
    summary: counts,
    applications: sliced,
  });
}
