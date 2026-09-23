import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseResumeBuffer } from '@/lib/resume-parser';

function getSupabase() {
  // Server-only env vars (no NEXT_PUBLIC_ prefix). We accept the old
  // NEXT_PUBLIC_* names as a fallback for projects that haven't migrated yet.
  // We also accept NEXT_SUPABASE_* (without _PUBLIC_) for Vercel projects
  // that can't use the literal substring "PUBLIC" in env var names.
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_SUPABASE_URL ||
    '';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_SUPABASE_ANON_KEY ||
    '';
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabase();

    // Accept TWO input shapes:
    //   1. Legacy FormData("file"): kept for backwards compatibility / local dev.
    //      Limited to 4.5 MB by Vercel's request-body limit.
    //   2. JSON { storagePath, fileName }: the file is already in Supabase
    //      Storage (uploaded directly by the client), bypassing the Vercel
    //      limit. Recommended for production. Allows files up to the bucket's
    //      configured ceiling (default 50 MB).
    const contentType = request.headers.get('content-type') || '';
    let buffer: Buffer;
    let originalFileName: string;
    let storagePath: string | null = null;

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      const incomingPath = (body.storagePath || '').toString().trim();
      const incomingName = (body.fileName || '').toString().trim();
      if (!incomingPath) {
        return NextResponse.json(
          { success: false, error: 'storagePath é obrigatório.' },
          { status: 400 },
        );
      }
      // Path-traversal guard: only allow simple filenames (no slashes, no '..').
      if (!/^[A-Za-z0-9._-]+$/.test(incomingPath)) {
        return NextResponse.json(
          { success: false, error: 'storagePath inválido.' },
          { status: 400 },
        );
      }
      if (!supabase) {
        return NextResponse.json(
          { success: false, error: 'Supabase não configurado no servidor.' },
          { status: 500 },
        );
      }
      const { data: dl, error: dlErr } = await supabase.storage
        .from('resumes')
        .download(incomingPath);
      if (dlErr || !dl) {
        return NextResponse.json(
          {
            success: false,
            error: `Falha ao baixar do Storage: ${dlErr?.message || 'arquivo ausente'}`,
          },
          { status: 404 },
        );
      }
      const ab = await dl.arrayBuffer();
      buffer = Buffer.from(ab);
      storagePath = incomingPath;
      originalFileName = incomingName || incomingPath;
    } else {
      // Legacy multipart upload path.
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          { success: false, error: 'Nenhum arquivo enviado.' },
          { status: 400 },
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      originalFileName = file.name || 'upload';
    }

    const safeExt = originalFileName.endsWith('.docx')
      ? '.docx'
      : originalFileName.endsWith('.doc')
        ? '.doc'
        : originalFileName.endsWith('.png')
          ? '.png'
          : originalFileName.endsWith('.jpg') || originalFileName.endsWith('.jpeg')
            ? '.jpg'
            : '.pdf';

    // Parse the buffer in pure Node — no Python dependency, works on Vercel.
    const result = await parseResumeBuffer(buffer, originalFileName);
    if (!result.success || !result.profile) {
      throw new Error(result.error || 'Falha ao processar o currículo.');
    }

    // Resolve the public URL of the file we already have in Storage
    // (either the client uploaded it directly, or the legacy path uploads
    // it below). Re-uploading from buffer is idempotent thanks to upsert.
    let resumeUrl = '';
    const finalStorageName = storagePath
      ? storagePath
      : `${Date.now()}_${Math.random().toString(36).substring(7)}${safeExt}`;

    if (supabase) {
      // If the legacy path didn't pre-upload, do it now so the profile carries
      // a resume_url. The storage path for the legacy path is also derived.
      if (!storagePath) {
        const { error: uploadError } = await supabase.storage
          .from('resumes')
          .upload(finalStorageName, buffer, {
            contentType: 'application/octet-stream',
            upsert: true,
          });
        if (uploadError) {
          console.warn('Legacy resume upload failed:', uploadError);
        }
      }
      const { data: publicUrlData } = supabase.storage
        .from('resumes')
        .getPublicUrl(finalStorageName);
      resumeUrl = publicUrlData.publicUrl;
    } else {
      console.warn('Supabase client not initialized, skipping resume URL.');
    }

    (result.profile as Record<string, unknown>).resume_url = resumeUrl;

    return NextResponse.json({
      success: true,
      profile: result.profile,
      fileName: originalFileName,
      fileSize: `${(buffer.length / 1024).toFixed(1)} KB`,
    });
  } catch (error: any) {
    console.error('Erro na rota /api/resume/parse:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao processar currículo.' },
      { status: 500 },
    );
  }
}
