import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/jobs/linkedin
 * Retorna a lista de vagas Easy Apply remotas BR com match > threshold.
 *
 * Parâmetros opcionais via query string:
 *   - maxJobs (default 30)
 *   - matchThreshold (default 0.7)
 *
 * Ou via POST com JSON no body (mais seguro — aceita profile customizado).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const maxJobs = parseInt(searchParams.get('maxJobs') || '30', 10);
  const matchThreshold = parseFloat(searchParams.get('matchThreshold') || '0.7');

  return runLinkedinScrape({}, maxJobs, matchThreshold);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const profile = body.profile || {};
    const maxJobs = body.maxJobs || 30;
    const matchThreshold = body.matchThreshold || 0.7;
    return runLinkedinScrape(profile, maxJobs, matchThreshold);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}

const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'scripts', 'linkedin_auto_apply.py'),
  path.join(process.cwd(), '..', 'saas-vagaszap', 'scripts', 'linkedin_auto_apply.py'),
  path.join(process.cwd(), 'saas-vagaszap', 'scripts', 'linkedin_auto_apply.py'),
];

function findScriptPath(): string | null {
  for (const p of SCRIPT_CANDIDATES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').accessSync(p);
      return p;
    } catch {
      // continua
    }
  }
  return null;
}

function runPythonPreview(scriptPath: string, payload: any): Promise<any> {
  return new Promise((resolve) => {
    const pythonBin =
      process.env.PYTHON_BIN ||
      path.join(process.cwd(), '.venv-playwright', 'bin', 'python') ||
      'python3';
    const child = spawn(
      pythonBin,
      [scriptPath, '--payload', JSON.stringify(payload)],
      { cwd: process.cwd(), env: process.env },
    );

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ success: false, status: 'TIMEOUT', error: 'Preview LinkedIn excedeu 100s.' });
    }, 100_000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, status: 'SPAWN_ERROR', error: err.message });
    });

    child.on('close', () => {
      clearTimeout(timeout);
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const last = lines[lines.length - 1] || '';
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({
          success: false,
          status: 'PARSE_ERROR',
          error: 'Saída não-JSON.',
          stdoutTail: stdout.slice(-500),
        });
      }
    });
  });
}

async function runLinkedinScrape(
  profile: any,
  maxJobs: number,
  matchThreshold: number,
) {
  const scriptPath = findScriptPath();
  if (!scriptPath) {
    return NextResponse.json(
      {
        success: false,
        error: 'linkedin_auto_apply.py não encontrado.',
        hint: 'Certifique-se que LINKEDIN_LI_AT está configurado no .env.local',
      },
      { status: 500 },
    );
  }

  // No preview: não aplica, só faz scrape + scoring. Forçamos maxJobs pequeno.
  const result = await runPythonPreview(scriptPath, {
    profile,
    maxJobs: Math.min(maxJobs, 20),
    matchThreshold,
    liAt: process.env.LINKEDIN_LI_AT || undefined,
    jsessionId: process.env.LINKEDIN_JSESSIONID || undefined,
  });

  return NextResponse.json(result);
}
