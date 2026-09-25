import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseResumeBuffer, validateResumeInput, MAX_RESUME_BYTES } from '@/lib/resume-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_SUPABASE_ANON_KEY || '';
  return url && key ? createClient(url, key) : null;
}
const failure = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let buffer: Buffer;
    let fileName: string;
    let storagePath: string | null = null;
    const supabase = getSupabase();
    if (contentType.includes('application/json')) {
      let body;
      try { body = await request.json(); } catch { return failure('JSON inválido.', 400); }
      if (!body || typeof body !== 'object' || typeof body.storagePath !== 'string' || (body.fileName !== undefined && typeof body.fileName !== 'string')) return failure('storagePath e fileName devem ser strings.', 400);
      const path = body.storagePath.trim();
      if (!/^[A-Za-z0-9._-]+$/.test(path) || path.includes('..')) return failure('storagePath inválido.', 400);
      fileName = body.fileName?.trim() || path;
      const invalid = validateResumeInput(fileName, 1);
      if (invalid) return failure(invalid, 400);
      if (!supabase) return failure('Supabase não configurado no servidor.', 500);
      const { data, error } = await supabase.storage.from('resumes').download(path);
      if (error || !data) return failure('Não foi possível baixar o arquivo do Storage.', 404);
      const sizeError = validateResumeInput(fileName, data.size);
      if (sizeError) return failure(sizeError, 400);
      buffer = Buffer.from(await data.arrayBuffer());
      storagePath = path;
    } else if (contentType.includes('multipart/form-data')) {
      const length = Number(request.headers.get('content-length'));
      if (length > MAX_RESUME_BYTES + 64 * 1024) return failure('Arquivo maior que 10 MB.', 400);
      let form;
      try { form = await request.formData(); } catch { return failure('Formulário inválido.', 400); }
      const file = form.get('file');
      if (!file || typeof file === 'string') return failure('Nenhum arquivo válido enviado.', 400);
      fileName = file.name;
      const invalid = validateResumeInput(fileName, file.size);
      if (invalid) return failure(invalid, 400);
      buffer = Buffer.from(await file.arrayBuffer());
    } else return failure('Use multipart/form-data ou application/json.', 400);

    const invalid = validateResumeInput(fileName, buffer.length);
    if (invalid) return failure(invalid, 400);
    const result = await parseResumeBuffer(buffer, fileName);
    if (!result.success || !result.profile) return failure(result.error || 'Falha ao extrair o currículo.', 422);

    let resumeUrl = '';
    if (supabase) {
      const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
      const path = storagePath || `${crypto.randomUUID()}${ext}`;
      let stored = Boolean(storagePath);
      if (!stored) {
        const { error } = await supabase.storage.from('resumes').upload(path, buffer, { contentType: ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false });
        stored = !error;
        if (error) (result.profile.extraction_warnings as string[]).push('Texto extraído, mas não foi possível armazenar o currículo.');
      }
      if (stored) resumeUrl = supabase.storage.from('resumes').getPublicUrl(path).data.publicUrl;
    }
    result.profile.resume_url = resumeUrl;
    return NextResponse.json({ success: true, profile: result.profile, fileName, fileSize: `${(buffer.length / 1024).toFixed(1)} KB` });
  } catch {
    return failure('Erro interno ao processar currículo.', 500);
  }
}
