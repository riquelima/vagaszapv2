import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { job_url, profile } = await req.json();

    if (!job_url || !profile || !profile.resume_url) {
      return NextResponse.json({ success: false, error: 'Faltam parâmetros ou o currículo não foi anexado.' }, { status: 400 });
    }

    // Extrai board_token e job_id da URL
    // Exemplo: https://boards.greenhouse.io/openai/jobs/5231234
    const match = job_url.match(/boards\.greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/);
    if (!match) {
      return NextResponse.json({ success: false, error: 'URL do Greenhouse inválida.' }, { status: 400 });
    }

    const [, board_token, job_id] = match;

    // 1. Busca os campos do formulário na API do Greenhouse
    const ghApiUrl = `https://boards-api.greenhouse.io/v1/boards/${board_token}/jobs/${job_id}`;
    const ghRes = await fetch(ghApiUrl);
    if (!ghRes.ok) {
      return NextResponse.json({ success: false, error: 'Vaga não encontrada no Greenhouse.' }, { status: 404 });
    }
    const jobData = await ghRes.json();
    const questions = jobData.questions || [];

    // 2. Constrói as perguntas para o Minimax
    const questionsToAsk = questions.map((q: any) => ({
      name: q.fields[0].name,
      label: q.label,
      type: q.fields[0].type,
      required: q.required
    }));

    // Filtra perguntas padrão (nome, email, telefone) que já preenchemos com dados diretos
    const customQuestions = questionsToAsk.filter((q: any) => !['first_name', 'last_name', 'email', 'phone', 'resume'].includes(q.name));

    let aiAnswers: Record<string, string> = {};

    if (customQuestions.length > 0) {
      const prompt = `Você é um candidato aplicando para uma vaga. Com base no currículo abaixo, preencha os campos obrigatórios do formulário. 
Responda em JSON puro, onde a chave é o "name" do campo e o valor é a sua resposta.
Seja conciso. Se o currículo não tiver a informação exata para perguntas como "pretensão salarial", "vínculo" ou "anos de exp com X", deduza algo profissional e provável (ex: "A combinar", "PJ", ou um número que faça sentido com a senioridade).

Currículo:
Nome: ${profile.full_name}
Email: ${profile.email}
Nível: ${profile.seniority}
Skills: ${profile.top_skills?.join(', ')}
Resumo: ${profile.summary_pt}

Campos do formulário (JSON):
${JSON.stringify(customQuestions, null, 2)}
`;

      const minimaxRes = await fetch('https://api.minimaxi.chat/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "MiniMax-M2.5",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: "json_object" }
        })
      });

      const minimaxData = await minimaxRes.json();
      const content = minimaxData.choices?.[0]?.message?.content;
      if (content) {
        try {
          aiAnswers = JSON.parse(content);
        } catch(e) {}
      }
    }

    // 3. Baixa o currículo do Supabase (para enviar como anexo)
    const resumeRes = await fetch(profile.resume_url);
    if (!resumeRes.ok) {
      return NextResponse.json({ success: false, error: 'Falha ao baixar o currículo do Supabase.' }, { status: 500 });
    }
    const resumeBlob = await resumeRes.blob();

    // 4. Monta o FormData para o POST final
    const formData = new FormData();
    formData.append('first_name', profile.first_name || 'Candidato');
    formData.append('last_name', profile.last_name || 'Anonimo');
    formData.append('email', profile.email || 'candidato@email.com');
    formData.append('phone', profile.phone || '00000000000');
    formData.append('resume', resumeBlob, 'curriculo.pdf');

    // Adiciona as respostas da IA no FormData
    for (const [key, value] of Object.entries(aiAnswers)) {
      formData.append(key, value as string);
    }

    // 5. Envia a candidatura!
    const applyRes = await fetch(ghApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(board_token + ':').toString('base64')}`
      },
      body: formData
    });

    if (!applyRes.ok) {
      const errTxt = await applyRes.text();
      return NextResponse.json({ success: false, error: 'Falha no Greenhouse: ' + errTxt }, { status: applyRes.status });
    }

    return NextResponse.json({ success: true, message: 'Candidatura enviada com sucesso!' });

  } catch (error: any) {
    console.error('Erro na rota auto-apply:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
