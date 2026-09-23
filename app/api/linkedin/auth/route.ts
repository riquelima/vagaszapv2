import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const maxDuration = 240; // até 4min para o usuário fazer login manual

const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'scripts', 'linkedin_auth_capture.py'),
  path.join(process.cwd(), '..', 'saas-vagaszap', 'scripts', 'linkedin_auth_capture.py'),
  path.join(process.cwd(), 'saas-vagaszap', 'scripts', 'linkedin_auth_capture.py'),
];

function findScriptPath(): string | null {
  for (const p of SCRIPT_CANDIDATES) {
    try {
      fs.accessSync(p);
      return p;
    } catch {
      // continua
    }
  }
  return null;
}

function runPythonScript(scriptPath: string, args: string[]): Promise<any> {
  return new Promise((resolve) => {
    const pythonBin =
      process.env.PYTHON_BIN ||
      path.join(process.cwd(), '.venv-playwright', 'bin', 'python') ||
      'python3';
    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({
        success: false,
        status: 'TIMEOUT',
        error: 'Captura de cookie excedeu 220s.',
      });
    }, 220_000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        status: 'SPAWN_ERROR',
        error: `Falha ao iniciar Python: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const last = lines[lines.length - 1] || '';
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({
          success: false,
          status: 'PARSE_ERROR',
          error: `Saída não-JSON (exit ${code}).`,
          stdoutTail: stdout.slice(-500),
        });
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const timeout = body?.timeout || 180;

    const scriptPath = findScriptPath();
    if (!scriptPath) {
      return NextResponse.json(
        {
          success: false,
          error: 'linkedin_auth_capture.py não encontrado em scripts/.',
        },
        { status: 500 },
      );
    }

    const result = await runPythonScript(scriptPath, ['--timeout', String(timeout)]);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

// Health-check
export async function GET() {
  const scriptPath = findScriptPath();
  return NextResponse.json({
    success: true,
    endpoint: '/api/linkedin/auth',
    method: 'POST',
    scriptFound: !!scriptPath,
    cookiesFile: '~/.vagaszap-linkedin-cookies.json',
    description: 'Abre Chromium visível para você fazer login manual no LinkedIn. Após login, o cookie li_at é capturado e salvo automaticamente para uso pelo Auto Apply.',
  });
}
