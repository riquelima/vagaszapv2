import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { job_url, profile } = await req.json();

    if (!job_url || !profile || !profile.resume_url) {
      return NextResponse.json({ success: false, error: 'Faltam parâmetros ou o currículo não foi anexado.' }, { status: 400 });
    }

    // Baixa o currículo do Supabase (para enviar como anexo para o Worker)
    const resumeRes = await fetch(profile.resume_url);
    if (!resumeRes.ok) {
      return NextResponse.json({ success: false, error: 'Falha ao baixar o currículo do Supabase.' }, { status: 500 });
    }
    const resumeBlob = await resumeRes.blob();

    // Monta o FormData para enviar para o nosso Worker VPS
    const formData = new FormData();
    formData.append('job_url', job_url);
    formData.append('profile', JSON.stringify(profile));
    formData.append('minimax_key', process.env.MINIMAX_API_KEY || '');
    formData.append('resume', resumeBlob, 'curriculo.pdf');

    console.log('Enviando requisição de automação para a VPS Worker...');
    
    // IP do Worker Hostinger que contém o Playwright rodando na porta 4000
    const workerUrl = 'http://185.173.110.54:4000/apply';
    
    const applyRes = await fetch(workerUrl, {
      method: 'POST',
      body: formData
    });

    if (!applyRes.ok) {
      let errTxt = '';
      try {
         const errJson = await applyRes.json();
         errTxt = errJson.error || JSON.stringify(errJson);
      } catch (e) {
         errTxt = await applyRes.text();
      }
      return NextResponse.json({ success: false, error: 'Falha no robô (VPS): ' + errTxt }, { status: applyRes.status });
    }

    const result = await applyRes.json();
    return NextResponse.json({ success: true, message: result.message || 'Candidatura enviada via robô com sucesso!' });

  } catch (error: any) {
    console.error('Erro na rota auto-apply VPS:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
