import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = util.promisify(execFile);

// Vercel serverless filesystem is read-only except /tmp. We MUST use os.tmpdir()
// and never path.join(process.cwd(), 'tmp') because process.cwd() === /var/task
// and that directory is read-only at runtime, causing:
//   ENOENT: no such file or directory, mkdir '/var/task/tmp'
function writableTmpDir(): string {
  const base = os.tmpdir() || '/tmp';
  const dir = path.join(base, 'vagaszap-resume');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e: any) {
    // Last-resort fallback to /tmp itself (always writable on Vercel).
    return '/tmp';
  }
  return dir;
}

export async function POST(request: Request) {
  try {
    // Initialize Supabase Client inside the handler so build doesn't fail on missing env vars
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    let supabase = null;
    if (supabaseUrl && supabaseKey) {
      supabase = createClient(supabaseUrl, supabaseKey);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const safeExt = file.name.endsWith('.docx')
      ? '.docx'
      : file.name.endsWith('.doc')
        ? '.doc'
        : file.name.endsWith('.png')
          ? '.png'
          : file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')
            ? '.jpg'
            : '.pdf';

    // Always write the uploaded buffer to a writable tmp dir (os.tmpdir()
    // resolves to /tmp on Vercel). NEVER use path.join(process.cwd(), 'tmp')
    // — that directory is read-only at runtime in serverless, throwing:
    //   ENOENT: no such file or directory, mkdir '/var/task/tmp'
    const scriptPath = path.join(process.cwd(), 'scripts', 'process_resume.py');
    const tmpDir = writableTmpDir();
    const tmpPath = path.join(
      tmpDir,
      `cv_${Date.now()}_${Math.random().toString(36).substring(7)}${safeExt}`,
    );

    fs.writeFileSync(tmpPath, buffer);

    let stdout: string;
    try {
      const result = await execFileAsync('python3', [scriptPath, tmpPath], {
        timeout: 55000,
        maxBuffer: 15 * 1024 * 1024,
      });
      stdout = result.stdout;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch (e) {
        /* best-effort cleanup */
      }
    }

    const result = JSON.parse(stdout);
    if (!result.success || !result.profile) {
      throw new Error(result.error || 'Falha ao processar o currículo.');
    }

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${safeExt}`;
    let resumeUrl = '';

    if (supabase) {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (!uploadError && uploadData) {
        const { data: publicUrlData } = supabase.storage.from('resumes').getPublicUrl(fileName);
        resumeUrl = publicUrlData.publicUrl;
      } else {
        console.warn("Could not upload resume to Supabase:", uploadError);
      }
    } else {
      console.warn("Supabase client not initialized, skipping resume upload.");
    }

    result.profile.resume_url = resumeUrl; // Append to profile

    return NextResponse.json({
      success: true,
      profile: result.profile,
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(1)} KB`,
    });
  } catch (error: any) {
    console.error('Erro na rota /api/resume/parse:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao processar currículo.' },
      { status: 500 },
    );
  }
}

