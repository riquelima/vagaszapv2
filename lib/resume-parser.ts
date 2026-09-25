import mammoth from 'mammoth';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 4_000_000;
const MAX_PHOTO_BYTES = 200 * 1024;
export function validateResumeInput(name: string, size: number): string | null {
  if (!/\.(pdf|docx|doc|png|jpe?g)$/i.test(name)) return 'Formato inválido. Envie PDF ou DOCX.';
  if (!size || size > MAX_RESUME_BYTES) return 'Arquivo vazio ou maior que 10 MB.';
  return null;
}

interface Extraction { text: string; photo: string | null; warnings: string[] }
function portraitSize(width: number, height: number) {
  return width >= 50 && height >= 50 && width / height >= 0.5 && width / height <= 1.5 && width * height <= MAX_PIXELS;
}
async function photoData(input: Buffer, raw?: { width: number; height: number; channels: 3 | 4 }): Promise<string | null> {
  if (input.length > 16 * 1024 * 1024) return null;
  const image = sharp(input, { limitInputPixels: MAX_PIXELS, ...(raw ? { raw } : {}) });
  const meta = await image.metadata();
  if (!portraitSize(meta.width || 0, meta.height || 0)) return null;
  
  // Reject flat artwork, gradients, and simple logos; this is not face recognition, but we can filter by entropy.
  const stats = await image.stats();
  const [r, g, b] = stats.channels;
  const isGrayscale = Math.abs(r.mean - g.mean) < 2 && Math.abs(g.mean - b.mean) < 2;
  
  // Real photos are chaotic (high entropy). Gradients/graphics have lower entropy.
  if (stats.entropy < 5.5 || stats.channels.slice(0, 3).every(c => c.stdev < 20)) return null;
  if (isGrayscale && stats.entropy < 6.0) return null;

  const output = await image.rotate().resize({ width: 320, height: 400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  
  // A real photo of a person (even small) usually has enough complex detail that its JPEG size is > 4KB.
  // Simple graphics and gradients compress extremely well.
  if (output.length < 4500) return null;

  return output.length <= MAX_PHOTO_BYTES ? `data:image/jpeg;base64,${output.toString('base64')}` : null;
}

async function extractPdf(buffer: Buffer): Promise<Extraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Keep PDF.js external to Next so its Node fake-worker and optional native
  // image decoder resolve relative to the installed package, including Vercel.
  // Next.js server actions / API routes can use the standard fake worker automatically in Node.
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true, maxImageSize: MAX_PIXELS });
  const result: Extraction = { text: '', photo: null, warnings: [] };
  try {
    const doc = await task.promise;
    if (doc.numPages > 40) throw new Error('Currículo excede o limite de 40 páginas.');
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i);
      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
      let y: number | undefined;
      for (const item of items) {
        if (y !== undefined && Math.abs(y - item.transform[5]) > 2) result.text += '\n';
        result.text += item.str + ' ';
        y = item.transform[5];
      }
      result.text += '\n';
      if (n <= 2 && !result.photo) {
        try {
          const ops = await page.getOperatorList();
          let matrix = [1, 0, 0, 1, 0, 0];
          const stack: number[][] = [];
          const viewport = page.getViewport({ scale: 1 });
          let candidates = 0;
          for (let i = 0; i < ops.fnArray.length; i++) {
            const op = ops.fnArray[i], args = ops.argsArray[i];
            if (op === pdfjs.OPS.save) stack.push([...matrix]);
            else if (op === pdfjs.OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
            else if (op === pdfjs.OPS.transform) matrix = pdfjs.Util.transform(matrix, args);
            else if (op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject) {
              const w = Math.hypot(matrix[0], matrix[1]), h = Math.hypot(matrix[2], matrix[3]);
              if (w < 50 || h < 50 || w > 800 || h > 800 || ++candidates > 30) continue;
              const id = args[0];
              const image = op === pdfjs.OPS.paintInlineImageXObject ? id : await Promise.race([
                new Promise<any>(resolve => (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, resolve)),
                new Promise<null>(resolve => { const timer = setTimeout(() => resolve(null), 1500); timer.unref(); }),
              ]);
              if (!image?.data || !portraitSize(image.width, image.height)) continue;
              const channels = image.kind === pdfjs.ImageKind.RGB_24BPP ? 3 : image.kind === pdfjs.ImageKind.RGBA_32BPP ? 4 : null;
              if (!channels) continue;
              result.photo = await photoData(Buffer.from(image.data), { width: image.width, height: image.height, channels });
              if (result.photo) break;
            }
          }
        } catch { result.warnings.push('Não foi possível extrair a foto do PDF; o texto foi preservado.'); }
      }
      page.cleanup();
    }
    return result;
  } finally { await task.destroy(); }
}

async function extractDocx(buffer: Buffer): Promise<Extraction> {
  const zip = await JSZip.loadAsync(buffer);
  // Bound inflated content before mammoth reads the archive (ZIP bomb guard).
  let inflated = 0;
  for (const file of Object.values(zip.files)) {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
    inflated += size;
    if (inflated > 30 * 1024 * 1024) throw new Error('DOCX excede o limite de conteúdo descompactado.');
  }
  const text = (await mammoth.extractRawText({ buffer })).value;
  const result: Extraction = { text, photo: null, warnings: [] };
  try {
    const xml = await zip.file('word/document.xml')?.async('string') || '';
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
    
    // Tenta pela estrutura XML (w:drawing) que nos dá o tamanho na página
    for (const drawing of xml.match(/<w:drawing\b[\s\S]*?<\/w:drawing>/g) || []) {
      const extent = drawing.match(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
      const id = drawing.match(/r:embed="([^"]+)"/)?.[1];
      if (!extent || !id) continue;
      const w = Number(extent[1]) / 12700, h = Number(extent[2]) / 12700;
      if (w < 50 || h < 50 || w > 800 || h > 800) continue;
      const rel = (rels.match(/<Relationship\b[^>]*\/>/g) || []).find(r => r.includes(`Id="${id}"`));
      const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
      if (!target || !/^media\/[\w. -]+\.(png|jpe?g)$/i.test(target)) continue;
      const image = await zip.file(`word/${target}`)?.async('nodebuffer');
      if (image) result.photo = await photoData(image);
      if (result.photo) break;
    }

    // Fallback: Varre a pasta 'word/media/' inteira se o XML falhar (pega imagens inseridas de outras formas)
    if (!result.photo) {
      const mediaFiles = Object.keys(zip.files).filter(k => /^word\/media\/[\w. -]+\.(png|jpe?g)$/i.test(k));
      for (const mediaPath of mediaFiles) {
        const image = await zip.file(mediaPath)?.async('nodebuffer');
        if (image) result.photo = await photoData(image);
        if (result.photo) break;
      }
    }
  } catch { result.warnings.push('Não foi possível extrair a foto do DOCX; o texto foi preservado.'); }
  return result;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const string = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 2000) : '';
const strings = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter(i => typeof i === 'string').map(string).filter(Boolean))].slice(0, 20) : [];
// Resumo executivo fallback (caso MiniMax falhe): identifica empresas, cargos e monta parágrafo premium
function fallbackSummary(text: string, skills: string[], roles: string[], years: string | undefined): string {
  // Detecta empresas comuns em currículos em PT/EN (ordem importa — cita as mais relevantes)
  const companyPatterns = [
    'Netcracker', 'Cognizant', 'ThinkSeg', 'Intelektus', 'Porto Seguro', 'Uber', 'Easy Taxi',
    'Google', 'Amazon', 'Meta', 'Microsoft', 'Apple', 'Oracle', 'Salesforce', 'IBM', 'Accenture',
    'Telus', 'Du Telecom', 'Nuuday', 'Santander', 'Itaú', 'Bradesco', 'Nubank', 'Stone',
    'Magazine Luiza', 'Mercado Livre', 'B3', 'Petrobras', 'Vale', 'Globo', 'Natura'
  ];
  const foundCompanies: string[] = [];
  for (const c of companyPatterns) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    if (re.test(text) && !foundCompanies.includes(c)) foundCompanies.push(c);
    if (foundCompanies.length >= 5) break;
  }
  const companiesPhrase = foundCompanies.length
    ? `com passagens por empresas como ${foundCompanies.slice(0, 5).join(', ')}`
    : 'com sólida experiência corporativa';
  const skillsPhrase = skills.length
    ? `Domínio prático em ${skills.slice(0, 6).join(', ')}${skills.length > 6 ? ` e outras ${skills.length - 6} tecnologias` : ''}`
    : 'Perfil versátil em múltiplas frentes técnicas';
  const rolesPhrase = roles.length
    ? `atuando em cargos como ${roles.slice(0, 3).join(', ')}`
    : 'com entrega consistente em projetos de alta criticidade';
  const yearsPhrase = years || 'experiência consolidada';
  return `Profissional de tecnologia ${yearsPhrase}, ${companiesPhrase}, ${rolesPhrase}. ${skillsPhrase}. Histórico comprovado em colaboração com times distribuídos e forte alinhamento com demandas de contratação remota internacional em dólar e euro.`.trim();
}

function localProfile(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const match = (regex: RegExp) => text.match(regex)?.[0]?.trim() || '';
  const labeled = (label: string) => text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim() || '';
  const detected = (terms: string[]) => terms.filter(t => new RegExp(`(?:^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text));
  const first = lines[0] || '';
  const name = labeled('nome|name') || (/^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,5}$/u.test(first) && !/curr[ií]culo|resume|desenvolvedor|engenheir|analista|experi[eê]ncia|forma[çc][aã]o|software|curriculum|vitae/i.test(first) ? first : '');
  // Catálogo expandido de skills técnicas/ferramentas/metodologias para detecção local
  const skills = detected([
    // Linguagens
    'Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'C#', 'Ruby', 'PHP', 'Kotlin', 'Swift',
    // Frameworks Web
    'React', 'Next.js', 'Node.js', 'Vue', 'Angular', 'Tailwind', 'Express', 'NestJS',
    // Backend / APIs
    'REST APIs', 'GraphQL', 'API REST',
    // QA / Testes
    'Cypress', 'Selenium', 'Playwright', 'Postman', 'Jest', 'JUnit', 'Test Automation', 'End-to-End Testing',
    // Dados / Analytics
    'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'BigQuery', 'Data Modeling', 'ETL', 'Data Analysis',
    // DevOps / Cloud
    'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Vercel', 'CI/CD', 'Jenkins', 'GitHub Actions', 'Linux',
    // Ferramentas / Plataformas
    'Git', 'GitHub', 'GitLab', 'Jira', 'Confluence', 'Trello', 'Notion', 'Slack', 'Teams', 'Zoom',
    // IA / Automação
    'AI Agents', 'n8n', 'Zapier', 'Make', 'RPA', 'OpenAI', 'LLM', 'LangChain', 'Supabase', 'Firebase',
    // Mobile
    'React Native', 'Flutter', 'iOS', 'Android',
    // BI / Visualização
    'Power BI', 'Tableau', 'Looker', 'Metabase',
    // Metodologias
    'Scrum', 'Kanban', 'Agile', 'BSS/OSS', 'Telecom'
  ]);
  const roles = detected(['Desenvolvedor', 'Desenvolvedora', 'Software Engineer', 'Analista de Dados', 'Analista de QA', 'Designer', 'Gerente de Projetos', 'Assistente Administrativo', 'QA Engineer', 'QA Analyst', 'Customer Support', 'Content Analyst', 'Data Scientist', 'Founder', 'CEO']);
  const years = text.match(/(\d{1,2})\+?\s*(?:anos|years)\s*(?:de\s*)?(?:experi[eê]ncia|experience)/i);
  const yearsStr = years ? years[0] : undefined;
  // Resumo executivo premium (fallback local rico em informações reais do currículo)
  const summary = (skills.length > 0 || roles.length > 0 || yearsStr)
    ? fallbackSummary(text, skills, roles, yearsStr)
    : '';
  return {
    full_name: name, first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' '),
    email: match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/),
    phone: match(/(?<!\d)(?:\+?55[ .-]*)?\(?\d{2}\)?[ .-]*9?\d{4}[- .]?\d{4}(?!\d)/),
    linkedin: match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i),
    github: match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i),
    portfolio: labeled('portf[oó]lio|portfolio'), location: labeled('localiza[çc][aã]o|location|cidade|city'),
    school: match(/(?:Universidade|Faculdade|Centro Universitário|Instituto Federal)\s+[^\n,;]+/i),
    degree: match(/\b(?:Bacharelado|Bacharel|MBA|Tecnólogo|Mestrado|Doutorado|Pós-Graduação)\b/i),
    discipline: labeled('curso|course'), education_start_year: '', education_end_year: '',
    top_skills: skills, target_roles: roles, seniority: match(/\b(?:Júnior|Pleno|Sênior|Junior|Senior)\b/i),
    years_experience: years ? Number(years[1]) : 0,
    summary_pt: summary, summary_en: '', strengths: [] as string[], weaknesses: [] as string[], improvements: [] as string[],
  };
}

async function enrich(text: string, profile: ReturnType<typeof localProfile>, warnings: string[]): Promise<boolean> {
  const key = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY_ALT || "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA";
  if (!key) {
    warnings.push('MINIMAX_API_KEY ausente no servidor — usando apenas extração local.');
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  // Prompt premium para Resumo Executivo + Skills completas via MiniMax
  const premiumPrompt = `Você é um Headhunter Executivo Sênior e Consultor de Carreiras Globais especializado em tecnologia.

TAREFA: Analise o currículo abaixo e gere EXATAMENTE um JSON puro (sem markdown, sem comentários).

CAMPOS OBRIGATÓRIOS:
1. "full_name" — Nome completo do candidato. Se não encontrar, retorne string vazia.
2. "email" — Endereço de e-mail do candidato. Se não encontrar, retorne string vazia.
3. "phone" — Número de telefone. Se não encontrar, retorne string vazia.
4. "location" — Cidade/Estado/País de residência.
5. "linkedin" — URL do LinkedIn (se houver).
6. "target_roles" — Array de strings com 1 a 3 cargos que o candidato busca ou atua.
7. "summary_pt" — Resumo Executivo PREMIUM em Português do Brasil, 4 a 6 frases (parágrafo coeso). DEVE citar nominalmente as principais empresas onde o candidato atuou (ex: Netcracker, Cognizant, ThinkSeg, Intelektus, Porto Seguro, Uber, Easy Taxi), cargos ocupados, anos totais de experiência, tecnologias/ferramentas centrais e diferenciais competitivos. Seja ESPECÍFICO e fundamentado em fatos reais do currículo. PROIBIDO frases genéricas tipo "profissional dedicado com foco em resultados".
8. "top_skills" — Array com 14 a 20 habilidades técnicas, ferramentas, metodologias e plataformas. Varie entre: linguagens (Python, JavaScript, SQL), ferramentas (Cypress, Selenium, n8n, Docker, Postman, Git), frameworks (Next.js, React, Node.js), plataformas (Supabase, GCP, AWS, Vercel), IA/automação (AI Agents, LLMs, RPA), metodologias (REST APIs, CI/CD, QA Engineering, Test Automation), e soft skills técnicas (Data Modeling, KPI Development, End-to-End Testing).
9. "remote_score" — Número (int) de 0 a 100 avaliando o quão forte e sênior é a experiência do candidato para as áreas que ele atua. Avalie a profundidade das experiências, resultados alcançados e tempo de carreira.
10. "remote_score_criteria" — Array com exatos 4 ou 5 objetos justificando a nota. Cada objeto deve ter: "label" (ex: "Impacto e Resultados", "Nível de Senioridade"), "max_points" (soma total deve ser 100), "points" (pontos atingidos) e "evidence" (O motivo ou trecho do currículo que justifica a nota).

REGRAS:
- Use EXCLUSIVAMENTE Português do Brasil. PROIBIDO caracteres asiáticos (CJK).
- Retorne APENAS o JSON puro, sem markdown.

TEXTO DO CURRÍCULO:
"""${text.slice(0, 12000)}"""`;

  try {
    const response = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: 'MiniMax-Text-01', temperature: 0.15, max_tokens: 3000, messages: [
        { role: 'system', content: 'Você é um recrutador técnico internacional sênior. Retorne EXCLUSIVAMENTE JSON puro válido, sem markdown. É EXPRESSAMENTE PROIBIDO usar caracteres asiáticos (CJK) ou frases genéricas.' },
        { role: 'user', content: premiumPrompt },
      ] }),
    });
    if (!response.ok) {
      warnings.push(`MiniMax respondeu HTTP ${response.status} — usando fallback local para resumo/skills.`);
      return false;
    }
    const body = await response.json();
    let rawContent = string(body?.choices?.[0]?.message?.content);
    // Remove blocos de raciocínio do MiniMax (<think>...</think>) que antecedem o JSON
    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Remove marcadores markdown de bloco de código (```json ... ```)
    rawContent = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    // Extrai JSON balanceado do final da resposta
    let parsed: unknown = null;
    // 1ª tentativa: parse direto
    try { parsed = JSON.parse(rawContent); } catch { /* tenta abaixo */ }
    // 2ª tentativa: localizar JSON balanceado a partir do primeiro '{' (multinível)
    if (!parsed) {
      const start = rawContent.indexOf('{');
      if (start !== -1) {
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = start; i < rawContent.length; i++) {
          const c = rawContent[i];
          if (inStr) {
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') inStr = false;
          } else {
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
        }
        if (end > start) {
          try { parsed = JSON.parse(rawContent.slice(start, end + 1)); } catch { /* tenta abaixo */ }
        }
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push('MiniMax retornou resposta sem JSON válido — usando fallback local.');
      return false;
    }
    const data = parsed as Record<string, unknown>;

    let accepted = false;

    // ── 1. RESUMO EXECUTIVO PREMIUM (MiniMax) ─────────────────────
    if (typeof data.summary_pt === 'string' && data.summary_pt.trim().length >= 80) {
      profile.summary_pt = data.summary_pt.trim().slice(0, 1500);
      accepted = true;
    }

    // ── 2. SKILLS EXPANDIDAS (MiniMax) ────────────────────────────
    if (Array.isArray(data.top_skills) && data.top_skills.length > 0) {
      const cleaned = [...new Set(data.top_skills.map(string).filter(Boolean))];
      // Normaliza e deduplica com skills locais já detectadas
      const normalizedLocal = new Set(profile.top_skills.map(s => s.toLowerCase().trim()));
      const merged = [...profile.top_skills];
      for (const s of cleaned) {
        if (s.length > 1 && !normalizedLocal.has(s.toLowerCase().trim())) {
          merged.push(s);
          normalizedLocal.add(s.toLowerCase().trim());
        }
      }
      profile.top_skills = merged.slice(0, 24);
      accepted = true;
    }

    // ── 3. DADOS PESSOAIS E DE CONTATO (MiniMax) ──────────────────
    if (typeof data.full_name === 'string' && data.full_name.trim().length > 3 && !profile.full_name) profile.full_name = data.full_name.trim();
    if (typeof data.full_name === 'string' && data.full_name.trim().length > 3 && profile.full_name && data.full_name.length > profile.full_name.length) profile.full_name = data.full_name.trim(); // Preferir o nome completo da IA se for mais completo
    if (typeof data.email === 'string' && data.email.includes('@')) profile.email = data.email.trim();
    if (typeof data.phone === 'string' && data.phone.trim().length > 7) profile.phone = data.phone.trim();
    if (typeof data.location === 'string' && data.location.trim().length > 2) profile.location = data.location.trim();
    if (typeof data.linkedin === 'string' && data.linkedin.includes('linkedin.com')) profile.linkedin = data.linkedin.trim();
    if (Array.isArray(data.target_roles) && data.target_roles.length > 0) profile.target_roles = data.target_roles.map(string).filter(Boolean);

    // ── 4. SCORE INTELIGENTE (MiniMax) ────────────────────────────
    if (typeof data.remote_score === 'number') {
      (profile as any).remote_score = data.remote_score;
      (profile as any).score = data.remote_score;
    }
    if (Array.isArray(data.remote_score_criteria) && data.remote_score_criteria.length > 0) {
      (profile as any).remote_score_criteria = data.remote_score_criteria;
    }

    // Higieniza CJK acidental no resumo e skills
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
    if (profile.summary_pt) profile.summary_pt = profile.summary_pt.replace(cjkRegex, '').replace(/\s{2,}/g, ' ').trim();
    if (profile.top_skills) profile.top_skills = profile.top_skills.map(s => s.replace(cjkRegex, '').trim()).filter(Boolean);

    profile.first_name = profile.full_name.split(' ')[0] || '';
    profile.last_name = profile.full_name.split(' ').slice(1).join(' ');
    return accepted;
  } catch (err) {
    warnings.push(`Falha ao consultar MiniMax: ${err instanceof Error ? err.message : 'erro desconhecido'}.`);
    return false;
  } finally { clearTimeout(timer); }
}

function scores(text: string, profile: ReturnType<typeof localProfile>) {
  const criteria = [
    { label: 'Dados de Contato Essenciais', max_points: 10, evidence: profile.email || profile.phone },
    { label: 'Domínio de Idiomas (Inglês/Espanhol)', max_points: 20, evidence: text.match(/[^\n.]*(?:ingl[eê]s|english|espanhol|spanish)[^\n.]*/i)?.[0]?.trim() || '' },
    { label: 'Resultados Mensuráveis (Uso de métricas e %)', max_points: 25, evidence: text.match(/[^\n.]*(?:reduz\w*|aument\w*|melhor\w*|improv\w*|increas\w*|reduc\w*)[^\n.]*\d+\s*%[^\n.]*/i)?.[0]?.trim() || '' },
    { label: 'Presença Profissional (LinkedIn, GitHub ou Portfólio)', max_points: 15, evidence: profile.linkedin || profile.github || profile.portfolio },
    { label: 'Clareza de Cargos e Objetivo', max_points: 15, evidence: Array.isArray(profile.target_roles) && profile.target_roles.length > 0 ? profile.target_roles.join(', ') : '' },
    { label: 'Profundidade em Competências da Área', max_points: 15, evidence: Array.isArray(profile.top_skills) && profile.top_skills.length >= 6 ? `${profile.top_skills.length} skills detectadas` : '' },
  ].map(c => ({ ...c, points: c.evidence ? c.max_points : 0 }));
  
  const required = ['full_name', 'email', 'phone', 'location', 'target_roles', 'top_skills'] as const;
  const missing = required.filter(k => {
    const val = (profile as any)[k];
    return !val || (Array.isArray(val) && val.length === 0);
  });
  
  const totalScore = criteria.reduce((sum, c) => sum + c.points, 0);
  return { 
    score: totalScore, 
    remote_score: totalScore, 
    remote_score_criteria: criteria, 
    auto_apply_score: Math.round(100 * (required.length - missing.length) / required.length), 
    auto_apply_missing: missing 
  };
}

export interface ParseResult {
  success: boolean;
  profile?: Record<string, unknown>;
  raw_text_length?: number;
  has_photo?: boolean;
  error?: string;
}
export async function parseResumeBuffer(buffer: Buffer, fileName: string): Promise<ParseResult> {
  const invalid = validateResumeInput(fileName, buffer.length);
  if (invalid) return { success: false, error: invalid };
  if (/\.(png|jpe?g)$/i.test(fileName)) return { success: false, error: 'Imagem sem camada de texto. OCR não está disponível; envie PDF pesquisável ou DOCX.' };
  if (/\.doc$/i.test(fileName)) return { success: false, error: 'DOC legado não é suportado com segurança. Converta para DOCX ou PDF pesquisável.' };
  try {
    const extracted = /\.pdf$/i.test(fileName) ? await extractPdf(buffer) : await extractDocx(buffer);
    const text = extracted.text.trim();
    if (!/[\p{L}\p{N}]{2}/u.test(text)) return { success: false, error: 'Documento vazio ou escaneado, sem texto extraível. OCR não está disponível; envie PDF pesquisável ou DOCX.' };
    const profile = localProfile(text);
    const ai = await enrich(text, profile, extracted.warnings);
    if (!ai) extracted.warnings.push('IA indisponível ou sem dados verificáveis; extração local utilizada.');
    if (!extracted.photo) extracted.warnings.push('Nenhuma foto retrato identificada com segurança.');
    const defaultScores = scores(text, profile);
    const finalScores = {
      score: (profile as any).remote_score ?? defaultScores.score,
      remote_score: (profile as any).remote_score ?? defaultScores.remote_score,
      remote_score_criteria: (profile as any).remote_score_criteria ?? defaultScores.remote_score_criteria,
      auto_apply_score: (profile as any).auto_apply_score ?? defaultScores.auto_apply_score,
      auto_apply_missing: (profile as any).auto_apply_missing ?? defaultScores.auto_apply_missing,
    };
    return { success: true, profile: { ...profile, ...finalScores, photo_url: extracted.photo,
      extraction_method: ai ? 'ai' : 'local', extraction_warnings: extracted.warnings,
      remote_score_description: ai ? 'Score avaliado por Inteligência Artificial baseado no contexto completo.' : 'Heurística de prontidão do currículo para trabalho remoto.',
      raw_text: text, resumeText: text }, raw_text_length: text.length, has_photo: Boolean(extracted.photo) };
  } catch { return { success: false, error: 'Não foi possível ler o documento. Ele pode estar corrompido, protegido ou exceder os limites de processamento. Envie PDF pesquisável ou DOCX válido.' }; }
}
