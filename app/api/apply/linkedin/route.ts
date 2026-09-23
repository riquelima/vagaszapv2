import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — LinkedIn é mais lento (login + múltiplas vagas)

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

function runPythonScript(scriptPath: string, payload: object): Promise<any> {
  return new Promise((resolve) => {
    // Prefere o Python do venv local com Playwright instalado;
    // fallback para system python3 (sem Playwright — retornará erro claro)
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

    // LinkedIn pode demorar muito mais (login + scrape + N vagas)
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({
        success: false,
        status: 'TIMEOUT',
        error: 'Auto-apply LinkedIn excedeu o tempo limite de 280s.',
      });
    }, 280_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        status: 'SPAWN_ERROR',
        error: `Falha ao iniciar Python: ${err.message}`,
        stderr: stderr.slice(-500),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const last = lines[lines.length - 1] || '';
      try {
        const parsed = JSON.parse(last);
        resolve(parsed);
      } catch {
        resolve({
          success: false,
          status: 'PARSE_ERROR',
          error: `Python retornou saída não-JSON (exit ${code}).`,
          stdoutTail: stdout.slice(-800),
          stderrTail: stderr.slice(-500),
        });
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { profile, maxJobs, matchThreshold, liAt, jsessionId } = body;

    const scriptPath = findScriptPath();
    if (!scriptPath) {
      return NextResponse.json(
        {
          success: false,
          status: 'SCRIPT_NOT_FOUND',
          error: 'Script linkedin_auto_apply.py não encontrado em scripts/.',
        },
        { status: 500 },
      );
    }

    const payload = {
      profile: profile || {},
      maxJobs: typeof maxJobs === 'number' ? maxJobs : 10,
      matchThreshold: typeof matchThreshold === 'number' ? matchThreshold : 0.7,
      liAt: liAt || undefined,
      jsessionId: jsessionId || undefined,
    };

    const result = await runPythonScript(scriptPath, payload);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, status: 'API_ERROR', error: error.message },
      { status: 500 },
    );
  }
}

// Health-check
export async function GET() {
  const scriptPath = findScriptPath();
  return NextResponse.json({
    success: true,
    endpoint: '/api/apply/linkedin',
    method: 'POST',
    scriptFound: !!scriptPath,
    scriptPath,
    requirements: {
      env: ['LINKEDIN_LI_AT (cookie de sessão)'],
      optional: ['LINKEDIN_JSESSIONID'],
      profile: ['full_name', 'email', 'phone', 'location', 'top_skills', 'years_experience', 'linkedin'],
    },
    filters: {
      easyApply: true,
      location: 'Brazil',
      remote: true,
      matchThreshold: 0.7,
    },
  });
}
