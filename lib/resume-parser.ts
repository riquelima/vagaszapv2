/**
 * Pure-Node resume parser. Replaces scripts/process_resume.py so the
 * /api/resume/parse route works on Vercel without a Python runtime.
 *
 * Supports:
 *   - PDF  -> pdfjs-dist (pure JS, no native deps)
 *   - DOCX -> mammoth
 *   - DOC  -> best-effort text extraction (binary scan for readable strings)
 *   - PNG/JPG -> returns empty text (no OCR in serverless); profile is built
 *                from filename heuristics only.
 *
 * After extracting the raw text we run deterministic regex extraction
 * (emails, phones, links, name heuristic) and then either call the
 * MiniMax LLM for a richer profile or fall back to a smart local builder.
 */

import mammoth from 'mammoth';

// pdfjs-dist ESM build works in Node 18+ (Vercel default runtime).
// Use a dynamic import so the bundler doesn't try to resolve it at the
// top level under weird module conditions.
async function getPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Disable worker: we run once per request inside a serverless function.
  // `GlobalWorkerOptions` is an ESM live binding (getter-only on the module
  // namespace) so we must mutate the imported object directly instead of
  // reassigning the property on the namespace.
  const { GlobalWorkerOptions } = pdfjs;
  if (GlobalWorkerOptions) GlobalWorkerOptions.workerSrc = '';
  return pdfjs;
}

// LLM key/env helpers were removed along with the parser call above.
// If LLM enrichment is re-enabled in the future, reintroduce them via env
// only (no hardcoded keys).

// ---------------------------------------------------------------------------
// Text extraction per file type
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    // Disable the worker (we're already on a server, single-shot).
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines using Y coordinates when available so the resulting
    // text keeps line breaks similar to the original document.
    const items: { str: string; y: number; x: number }[] = [];
    for (const item of content.items as any[]) {
      if (typeof item.str === 'string') {
        const tx = item.transform || [0, 0, 0, 0, 0, 0];
        items.push({ str: item.str, y: tx[5], x: tx[4] });
      }
    }
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let lastY: number | null = null;
    for (const it of items) {
      if (lastY !== null && Math.abs(lastY - it.y) > 2) out += '\n';
      out += it.str + ' ';
      lastY = it.y;
    }
    out += '\n';
  }
  return out.trim();
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || '').trim();
}

function extractDocText(buffer: Buffer): Promise<string> {
  // Legacy .doc: scan the binary for printable ASCII/UTF-8 runs. Crude but
  // good enough to recover names/contact info when no DOCX is available.
  const ascii = buffer.toString('latin1');
  const runs = ascii.match(/[A-Za-zÀ-ÿ0-9@.,+\-()\s]{4,}/g) || [];
  return Promise.resolve(runs.join('\n').trim());
}

async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return extractPdfText(buffer);
  if (lower.endsWith('.docx')) return extractDocxText(buffer);
  if (lower.endsWith('.doc')) return extractDocText(buffer);
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    // No OCR available in serverless runtime; return empty so the caller
    // can still build a baseline profile from filename/contact hints.
    return '';
  }
  // Try PDF first as a last resort.
  return extractPdfText(buffer).catch(() => extractDocxText(buffer).catch(() => ''));
}

// ---------------------------------------------------------------------------
// Deterministic regex extraction (mirrors the original Python script)
// ---------------------------------------------------------------------------

interface Entities {
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  inferred_name: string;
  clean_text: string;
}

function extractDeterministicEntities(rawText: string): Entities {
  const textClean = rawText
    .replace(/\u2212/g, '-')
    .replace(/[\u2013\u2014]/g, '-');

  const emails = textClean.match(
    /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
  ) || [];
  const email = (emails[0] || '').trim();

  let phones =
    textClean.match(
      /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-\s]?\d{4})/g,
    ) || [];
  if (!phones.length) {
    phones =
      textClean.match(
        /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}/g,
      ) || [];
  }
  const phone = (phones[0] || '').trim();

  const linkedins =
    textClean.match(
      /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+/g,
    ) || [];
  const linkedin = (linkedins[0] || '').trim();

  const githubs =
    textClean.match(
      /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_\-]+/g,
    ) || [];
  const github = (githubs[0] || '').trim();

  // Name heuristic: scan the first 15 non-empty lines for a 2-4 word title.
  let name = '';
  const lines = textClean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 15)) {
    const lower = line.toLowerCase();
    const badWords = [
      'contact',
      'skills',
      'about',
      'brazil',
      'curriculum',
      'resume',
      'experiência',
      'experience',
      'relocation',
      'email',
    ];
    if (
      line.split(/\s+/).length >= 2 &&
      line.split(/\s+/).length <= 4 &&
      !badWords.some((w) => lower.includes(w)) &&
      !/[@\d+]/.test(line)
    ) {
      name = line;
      break;
    }
  }
  if (!name && email) {
    const prefix = email.split('@')[0];
    const parts = prefix.split(/[._-]/);
    name = parts
      .filter((p) => p.length > 1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  return {
    email,
    phone,
    linkedin,
    github,
    inferred_name: name,
    clean_text: textClean,
  };
}

// ---------------------------------------------------------------------------
// CJK sanitization
// ---------------------------------------------------------------------------

function sanitizeCjkDeep<T>(obj: T): T {
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
  const replacements: Record<string, string> = {
    '第三方物流': 'Logística Terceirizada (3PL)',
    '物流': 'Logística',
    '供应链': 'Supply Chain',
    '仓储': 'Armazenagem',
    '运输': 'Transporte',
    '采购': 'Compras',
    '制造': 'Manufatura',
  };
  const clean = (s: string): string => {
    let out = s;
    for (const [k, v] of Object.entries(replacements)) {
      out = out.split(k).join(v);
    }
    out = out.replace(cjkRegex, '');
    out = out.replace(/ {2,}/g, ' ').trim();
    return out;
  };
  if (typeof obj === 'string') return clean(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeCjkDeep(v)) as unknown as T;
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = sanitizeCjkDeep(v);
    }
    return result as unknown as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Smart local profile builder (fallback if LLM is unavailable)
// ---------------------------------------------------------------------------

function buildIntelligentLocalProfile(cleanText: string, entities: Entities) {
  const name = entities.inferred_name || 'Profissional de Tecnologia';
  const parts = name.split(/\s+/);
  const first_name = parts[0] || 'Profissional';
  const last_name = parts.length > 1 ? parts.slice(1).join(' ') : '';

  const techKeywords = [
    'Python',
    'JavaScript',
    'TypeScript',
    'React',
    'Node.js',
    'QA',
    'Cypress',
    'Selenium',
    'REST APIs',
    'Postman',
    'n8n',
    'AI Agents',
    'SQL',
    'Docker',
    'AWS',
    'GCP',
    'Jenkins',
    'CI/CD',
    'Linux',
    'DevOps',
    'BSS/OSS',
  ];
  const detectedSkills = techKeywords.filter((k) =>
    new RegExp(`\\b${k.replace(/[.+]/g, '\\$&')}\\b`, 'i').test(cleanText),
  );
  const finalSkills =
    detectedSkills.length > 0
      ? detectedSkills
      : ['Trabalho Remoto', 'Comunicação', 'Resolução de Problemas', 'Operações Globais'];

  const companies: string[] = [];
  for (const c of [
    'Netcracker',
    'Du Telecom',
    'TELUS',
    'Nuuday',
    'Intelektus',
    'Google',
    'Amazon',
    'Meta',
  ]) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(cleanText)) companies.push(c);
  }

  let years = 5;
  const yearMatch = cleanText.match(/(\d+)\+?\s*years/i);
  const yearMatchPt = cleanText.match(/(\d+)\+?\s*anos/i);
  if (yearMatch || yearMatchPt) {
    const n = parseInt((yearMatch || yearMatchPt)![1], 10);
    if (!Number.isNaN(n)) years = n;
  }
  const seniority = years >= 6 ? 'Sênior' : years >= 2 ? 'Pleno' : 'Júnior';
  const score = seniority === 'Sênior' ? 88 : seniority === 'Pleno' ? 82 : 75;

  const compStr =
    companies.length > 0
      ? ` com passagens por organizações como ${companies.slice(0, 3).join(', ')}`
      : '';
  const skillsStr = finalSkills.slice(0, 5).join(', ');

  const summary_pt =
    `${name} é um profissional nível ${seniority} com mais de ${years} anos de experiência sólida em tecnologia${compStr}. ` +
    `Possui expertise comprovada em ${skillsStr}, atuando no desenvolvimento e garantia de qualidade de arquiteturas escaláveis. ` +
    `Apresenta histórico de entrega consistente em projetos de alta criticidade e forte vivência em colaboração para times distribuídos. ` +
    `Demonstra excelente alinhamento com demandas de contratação remota internacional em dólar e euro.`;

  const summary_en =
    `${name} is a ${seniority} professional with over ${years} years of experience in technology${compStr}. ` +
    `Proficient in ${skillsStr}, with proven track record delivering mission-critical projects and collaborating with global teams.`;

  let school = 'Universidade / Ensino Superior';
  const schoolMatch = cleanText.match(
    /(?:Universidade|Faculdade|Centro Universitário|Instituto Federal|PUC|UNIFACS|USP|UNICAMP|UFRJ|UFC|UNIFOR|FGV)[^\n,.]+/i,
  );
  if (schoolMatch) school = schoolMatch[0].trim();

  let degree = 'Bacharelado';
  if (/\bMBA\b/i.test(cleanText)) degree = 'MBA / Pós-Graduação';
  else if (/\b(Pós-Graduação|Especialização)\b/i.test(cleanText)) degree = 'Pós-Graduação';

  const discipline = /logística/i.test(cleanText)
    ? 'Logística e Operações'
    : 'Tecnologia da Informação';

  return {
    full_name: name,
    first_name,
    last_name,
    email: entities.email,
    phone: entities.phone,
    location: 'Brasil (Disponível Remoto Internacional)',
    linkedin: entities.linkedin,
    github: entities.github,
    portfolio: '',
    school,
    degree,
    discipline,
    education_start_year: '2016',
    education_end_year: '2020',
    top_skills: finalSkills.slice(0, 6),
    score,
    seniority,
    years_experience: years,
    strengths: [
      `Histórico profissional comprovado de ${years}+ anos com entregas em projetos corporativos`,
      `Domínio prático de ferramentas-chave: ${finalSkills.slice(0, 4).join(', ')}`,
      'Perfil técnico preparado para comunicação ágil e atuação em equipes distribuídas',
    ],
    weaknesses: [
      'Necessidade de adicionar mais métricas quantificáveis de impacto em cada experiência',
    ],
    improvements: [
      'Incluir certificações internacionais da área para elevar o ranqueamento ATS',
      'Destacar links diretos para GitHub, cases práticos e recomendações no LinkedIn',
    ],
    summary_pt,
    summary_en,
  };
}

// ---------------------------------------------------------------------------
// LLM enrichment was removed in production: the parser now relies entirely on
// the deterministic local builder. This eliminates the external call (which was
// failing intermittently with errors pointing to a misconfigured proxy),
// removes the hardcoded API key, and makes uploads resilient.
// ---------------------------------------------------------------------------

async function parseWithMinimax(
  _rawText: string,
  _entities: Entities,
): Promise<any | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ParseResult {
  success: boolean;
  profile?: Record<string, unknown>;
  raw_text_length?: number;
  has_photo?: boolean;
  error?: string;
}

export async function parseResumeBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<ParseResult> {
  try {
    const rawText = await extractTextFromBuffer(buffer, fileName);
    const entities = extractDeterministicEntities(rawText);

    let profile = await parseWithMinimax(rawText, entities);
    if (!profile) {
      profile = buildIntelligentLocalProfile(entities.clean_text, entities);
    }

    // Validate / merge high-precision entities (mirrors Python script).
    const currentEmail = profile.email || '';
    if (
      entities.email &&
      (!currentEmail || !currentEmail.includes('@') || /exemplo/i.test(currentEmail))
    ) {
      profile.email = entities.email;
    }
    const currentPhone = profile.phone || '';
    if (entities.phone && (!currentPhone || /99999/.test(currentPhone))) {
      profile.phone = entities.phone;
    }
    if (entities.linkedin && !profile.linkedin) profile.linkedin = entities.linkedin;
    if (entities.github && !profile.github) profile.github = entities.github;
    if (
      entities.inferred_name &&
      (!profile.full_name || /Candidato/i.test(profile.full_name))
    ) {
      profile.full_name = entities.inferred_name;
      const parts = entities.inferred_name.split(/\s+/);
      profile.first_name = parts[0] || '';
      profile.last_name = parts.length > 1 ? parts.slice(1).join(' ') : '';
    }

    if (!profile.score || Number(profile.score) <= 0) profile.score = 88;
    if (!profile.seniority) profile.seniority = 'Sênior';

    const text = entities.clean_text;
    if (
      !profile.school ||
      /Nome da Faculdade \/ Universidade|^$/.test(profile.school as string)
    ) {
      const m = text.match(
        /(?:Universidade|Faculdade|Centro Universitário|Instituto Federal|PUC|UNIFACS|USP|UNICAMP|UFRJ|UFC|UNIFOR|FGV)[^\n,.]+/i,
      );
      profile.school = m ? m[0].trim() : 'Universidade / Ensino Superior';
    }
    if (!profile.degree || /Bacharelado ou MBA|^$/.test(profile.degree as string)) {
      if (/\bMBA\b/i.test(text)) profile.degree = 'MBA / Pós-Graduação';
      else if (/\b(Bacharel|Bacharelado|Graduação)\b/i.test(text))
        profile.degree = 'Bacharelado';
      else if (/\b(Tecnólogo|Tecnologia)\b/i.test(text)) profile.degree = 'Tecnólogo';
      else profile.degree = 'Bacharelado';
    }
    if (
      !profile.discipline ||
      /Área ou Curso|^$/.test(profile.discipline as string)
    ) {
      const discMatch = text.match(
        /(?:em|de)\s+(Logística|Administração|Engenharia|Ciência da Computação|Sistemas de Informação|Gestão de Operações|Supply Chain|Direito|Contabilidade)/i,
      );
      if (discMatch) profile.discipline = discMatch[1].trim();
      else if (Array.isArray(profile.top_skills) && profile.top_skills.length)
        profile.discipline = profile.top_skills[0];
      else profile.discipline = 'Gestão de Operações';
    }
    if (!profile.education_start_year) profile.education_start_year = '2016';
    if (!profile.education_end_year) profile.education_end_year = '2020';

    const summary = (profile.summary_pt as string) || '';
    if (
      !summary ||
      summary.trim().length < 40 ||
      /profissional dedicado com foco em resultados/i.test(summary)
    ) {
      const fb = buildIntelligentLocalProfile(entities.clean_text, entities);
      profile.summary_pt = fb.summary_pt;
    }

    profile.raw_text = rawText;
    profile.resumeText = rawText;
    profile.photo_url = null; // photo extraction skipped (no Python pypdf)

    profile = sanitizeCjkDeep(profile);

    return {
      success: true,
      profile,
      raw_text_length: rawText.length,
      has_photo: false,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao processar currículo.' };
  }
}
