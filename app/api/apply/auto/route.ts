import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutos (limite Next.js)

// Localização do serviço Python de auto-apply
// (rodável dentro ou fora do monorepo)
const AUTO_APPLY_SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'scripts', 'greenhouse_auto_apply.py'),
  path.join(process.cwd(), '..', 'saas-vagaszap', 'scripts', 'greenhouse_auto_apply.py'),
  path.join(process.cwd(), 'saas-vagaszap', 'scripts', 'greenhouse_auto_apply.py'),
];

function findScriptPath(): string | null {
  for (const p of AUTO_APPLY_SCRIPT_CANDIDATES) {
    try {
      // require.resolve-like check sem importar
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
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({
        success: false,
        status: 'TIMEOUT',
        error: 'Auto-apply excedeu o tempo limite de 100s.',
      });
    }, 100_000); // 100s — abaixo do limite do Next.js

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
        error: `Falha ao iniciar Python: ${err.message}. Verifique se python3 está no PATH.`,
        stderr: stderr.slice(-500),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      // Pega a ÚLTIMA linha não-vazia do stdout (nosso JSON final)
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

    if (!job || !profile) {
      return NextResponse.json(
        { success: false, error: 'Dados da vaga ou do perfil ausentes.' },
        { status: 400 },
      );
    }

    // Bloqueia portals intermediários (Himalayas, etc.)
    const link = (job.applicationLink || job.link || '').toLowerCase();
    if (link.includes('himalayas.app') || link.includes('himalayas.com')) {
      return NextResponse.json(
        {
          success: false,
          status: 'BLOCKED',
          error: 'Portal intermediário bloqueado. Apenas ATS oficiais (Greenhouse/Ashby/Lever/Workable) são suportados.',
        },
        { status: 400 },
      );
    }

    // Localiza o script Python
    const scriptPath = findScriptPath();
    if (!scriptPath) {
      return NextResponse.json(
        {
          success: false,
          status: 'SCRIPT_NOT_FOUND',
          error: 'Script greenhouse_auto_apply.py não encontrado em scripts/.',
          hint: 'Verifique se saas-vagaszap/scripts/greenhouse_auto_apply.py existe.',
        },
        { status: 500 },
      );
    }

    // Dispara o serviço Python
    const result = await runPythonScript(scriptPath, { job, profile });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, status: 'API_ERROR', error: error.message },
      { status: 500 },
    );
  }
}

// GET opcional para health-check do endpoint
export async function GET() {
  const scriptPath = findScriptPath();
  return NextResponse.json({
    success: true,
    endpoint: '/api/apply/auto',
    method: 'POST',
    scriptFound: !!scriptPath,
    scriptPath,
    supportedAts: ['greenhouse', 'ashby', 'lever', 'workable'],
    blockedHosts: ['himalayas.app', 'himalayas.com'],
  });
}
