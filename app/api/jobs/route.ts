import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export interface JobItem {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  salary: string;
  employmentType: string;
  pubDate: string;
  pubTimestamp?: number;
  applicationLink: string;
  summary: string;
  tags: string[];
  category: 'tech' | 'operations';
}

const AI_CONVERSATIONAL_PATTERNS = [
  /olá/i,
  /desculpe/i,
  /como posso/i,
  /preciso que você/i,
  /compartilhe a descrição/i,
  /não tenho acesso/i,
  /não foi fornecid/i,
  /fornecer os detalhes/i,
  /assim que você/i,
  /para criar o resumo/i,
  /como modelo de ia/i,
  /como ia/i,
  /como assistente/i,
  /por favor, envie/i,
  /insira o texto/i,
  /infelizmente, não recebi/i,
  /percebi que você não incluiu/i,
  /você não forneceu/i,
  /não recebi os detalhes/i,
  /colar o texto/i
];

function sanitizeJobSummary(title: string, company: string, rawSummary: string | undefined, category: 'tech' | 'operations'): string {
  const text = (rawSummary || '').trim();
  const hasAIBug = AI_CONVERSATIONAL_PATTERNS.some(regex => regex.test(text));
  const isTooShort = text.length < 25;

  if (!hasAIBug && !isTooShort) {
    return text;
  }

  if (category === 'tech') {
    return `Oportunidade técnica para atuar como ${title} na ${company}. Posição 100% remota com foco no desenvolvimento de soluções de alto impacto, boas práticas de engenharia e colaboração internacional com times globais.`;
  } else {
    return `Vaga de ${title} na ${company}. Posição 100% remota com foco no suporte operacional, excelência no relacionamento com clientes e otimização contínua de processos do dia a dia.`;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'all'; // 'tech' | 'operations' | 'all'
  const period = searchParams.get('period') || 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  const search = (searchParams.get('q') || '').toLowerCase().trim();

  const nowSec = Math.floor(Date.now() / 1000);

  try {
    // 1. Consulta Principal no Supabase
    let query = supabase
      .from('jobs')
      .select('*')
      .order('pub_timestamp', { ascending: false });

    // Exclui vagas do Himalayas (redirecionam para portal intermediário, sem suporte a Auto-Apply)
    query = query.not('application_link', 'ilike', '%himalayas.app%');

    if (category === 'tech' || category === 'operations') {
      query = query.eq('category', category);
    }

    if (period === 'today') {
      query = query.gte('pub_timestamp', nowSec - 86400);
    } else if (period === 'yesterday') {
      query = query.gte('pub_timestamp', nowSec - 172800);
    } else if (period === 'week') {
      query = query.gte('pub_timestamp', nowSec - 604800);
    } else if (period === 'month') {
      query = query.gte('pub_timestamp', nowSec - 2592000);
    }

    const { data: dbJobs, error: dbError } = await query;

    let jobs: JobItem[] = [];

    if (!dbError && dbJobs && dbJobs.length > 0) {
      jobs = dbJobs.map(row => ({
        id: row.id,
        title: row.title,
        company: row.company,
        companyLogo: row.company_logo,
        location: row.location,
        salary: row.salary,
        employmentType: row.employment_type,
        pubDate: row.pub_date,
        pubTimestamp: Number(row.pub_timestamp),
        applicationLink: row.application_link,
        summary: sanitizeJobSummary(row.title, row.company, row.summary_pt, row.category),
        tags: row.tags || [],
        category: row.category,
      }));
    } else {
      // Fallback local do catálogo de vagas
      const filePath = path.join(process.cwd(), 'data', 'jobs_catalog.json');
      if (fs.existsSync(filePath)) {
        const localJobs: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        jobs = localJobs.map(j => ({
          ...j,
          summary: sanitizeJobSummary(j.title, j.company, j.summary, j.category)
        }));
      }
    }

    // Remove vagas do Himalayas (portal intermediário sem suporte a Auto-Apply direto)
    jobs = jobs.filter(j => !j.applicationLink?.includes('himalayas.app'));

    // Filtro por Busca de Texto se fornecido
    if (search) {
      jobs = jobs.filter(j =>
        j.title.toLowerCase().includes(search) ||
        j.company.toLowerCase().includes(search) ||
        j.tags.some(t => t.toLowerCase().includes(search)) ||
        j.summary.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({
      success: true,
      total: jobs.length,
      jobs
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Webhook para inserção e auto-atualização contínua de vagas no Supabase
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const incoming = Array.isArray(body) ? body : [body];

    const rows = incoming.map(j => ({
      id: j.id,
      title: j.title,
      company: j.company,
      company_logo: j.companyLogo || j.company_logo,
      location: j.location || 'Worldwide (100% Remoto)',
      salary: j.salary || 'A combinar ($ USD / Remoto)',
      employment_type: j.employmentType || j.employment_type || 'Full-time (Remoto)',
      pub_date: j.pubDate || j.pub_date || 'Hoje',
      pub_timestamp: j.pubTimestamp || j.pub_timestamp || Math.floor(Date.now() / 1000),
      application_link: j.applicationLink || j.application_link,
      summary_pt: j.summary || j.summary_pt || '',
      tags: j.tags || [],
      category: j.category || 'tech'
    }));

    const { data, error } = await supabase
      .from('jobs')
      .upsert(rows, { onConflict: 'id' });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `${rows.length} vagas sincronizadas com sucesso!`
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
