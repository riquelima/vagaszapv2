import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const safeExt = file.name.endsWith('.docx') ? '.docx' : (file.name.endsWith('.doc') ? '.doc' : (file.name.endsWith('.png') ? '.png' : (file.name.endsWith('.jpg') || file.name.endsWith('.jpeg') ? '.jpg' : '.pdf')));
    const tmpPath = path.join(tmpDir, `cv_${Date.now()}_${Math.random().toString(36).substring(7)}${safeExt}`);

    fs.writeFileSync(tmpPath, buffer);

    const scriptPath = path.join(process.cwd(), 'scripts', 'process_resume.py');

    try {
      const { stdout } = await execFileAsync('python3', [scriptPath, tmpPath], { 
        timeout: 55000, 
        maxBuffer: 15 * 1024 * 1024 
      });

      const result = JSON.parse(stdout);
      if (!result.success || !result.profile) {
        throw new Error(result.error || 'Falha ao processar o currículo.');
      }

      return NextResponse.json({
        success: true,
        profile: result.profile,
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`
      });
    } finally {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (e) {}
      }
    }
  } catch (error: any) {
    console.error('Erro na rota /api/resume/parse:', error);
    return NextResponse.json({ success: false, error: error.message || 'Erro ao processar currículo.' }, { status: 500 });
  }
}
