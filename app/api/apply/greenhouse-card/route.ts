import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 180; // 3 min — uma vaga só, mas pode ter múltiplos steps

const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'scripts', 'greenhouse_card_auto_apply.py'),
  path.join(process.cwd(), '..', 'saas-vagaszap', 'scripts', 'greenhouse_card_auto_apply.py'),
  path.join(process.cwd(), 'saas-vagaszap', 'scripts', 'greenhouse_card_auto_apply.py'),
];

function findScriptPath(): string | null {
  for (const p of SCRIPT_CANDIDATES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').accessSync(p);
      return p;
    } catch {
      // continua procurando
    }
  }
  return null;
}

function runPythonScript(scriptPath: string, payload: object): Promise<any> {
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
      resolve({
        success: false,
        status: 'TIMEOUT',
        error: 'Auto-apply Greenhouse (card) excedeu o tempo limite.',
      });
    }, 160_000);

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
        error: `Falha ao iniciar Python: ${err.message}. Verifique se python3 está no PATH e .venv-playwright existe.`,
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
    const { job, profile } = body;

    if (!job || !job.applicationLink) {
      return NextResponse.json(
        { success: false, error: 'Vaga ausente ou sem applicationLink.' },
        { status: 400 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Perfil ausente.' },
        { status: 400 },
      );
    }

    const scriptPath = findScriptPath();
    if (!scriptPath) {
      return NextResponse.json(
        {
          success: false,
          status: 'SCRIPT_NOT_FOUND',
          error: 'Script greenhouse_card_auto_apply.py não encontrado em scripts/.',
          hint: 'Verifique se saas-vagaszap/scripts/greenhouse_card_auto_apply.py existe.',
        },
        { status: 500 },
      );
    }

    const result = await runPythonScript(scriptPath, { job, profile });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, status: 'API_ERROR', error: error.message },
      { status: 500 },
    );
  }
}

export async function GET() {
  const scriptPath = findScriptPath();
  return NextResponse.json({
    success: true,
    endpoint: '/api/apply/greenhouse-card',
    method: 'POST',
    scriptFound: !!scriptPath,
    scriptPath,
    supportedAts: ['greenhouse', 'ashby', 'lever', 'workable'],
    mode: 'cdp_user_chrome_new_tab',
    requirements: {
      userChrome: 'Google Chrome (ou Brave) em execução',
      cdp: 'Conexão automática via localhost:9222 (launch com --remote-debugging-port)',
      venv: '.venv-playwright com Playwright instalado',
    },
  });
}
