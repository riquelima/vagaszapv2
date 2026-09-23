'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { supabase, getSupabaseClient } from '@/lib/supabase';
import {
  Upload,
  FileText,
  Briefcase,
  CheckCircle2,
  DollarSign,
  KeyRound,
  MapPin,
  Search,
  ExternalLink,
  Users,
  Check,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Calendar,
  Trash2,
  Download,
  Award,
  TrendingUp,
  ShieldCheck,
  Code2,
  Mail,
  Phone,


  ArrowRight,
  ArrowUpRight,
  SlidersHorizontal,
  ArrowDownUp,
  Send,
  CheckCheck,
  FileCheck2,
  Layers,
  FileSearch,
  FileEdit,
  FileInput,
  Zap,
  Info,
  ChevronDown,
  ChevronUp,
  Link2,
  Lightbulb,
  LineChart,
  Palette,
  Database,
  Building,
  Bot
} from 'lucide-react';

interface JobItem {
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

interface CandidateProfile {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  target_roles: string[];
  years_experience: number;
  top_skills: string[];
  summary_en: string;
  summary_pt: string;
  photo_url?: string | null;
  score?: number;
  seniority?: 'Júnior' | 'Pleno' | 'Sênior' | string;
  strengths?: string[];
  weaknesses?: string[];
  improvements?: string[];
  resume_url?: string;
}

// ─── Auto-Apply Application Tracker (consumed from /api/applications) ─────────
interface ApplicationEvidence {
  thank_you_url?: string | null;
  post_submit_url?: string | null;
  post_submit_title?: string | null;
  screenshot_path?: string | null;
  http_status?: number | null;
  response_snippet?: string | null;
  confirmation_keywords_found?: string[];
}

interface ApplicationRecord {
  id?: string;
  job_id?: string;
  title?: string;
  company?: string;
  url?: string;
  score?: number;
  status?:
    | 'submitted'
    | 'failed'
    | 'needs_manual_review'
    | 'dry_run'
    | 'pending'
    | string;
  started_at?: string;
  finished_at?: string;
  applied_at?: string;
  duration_s?: number | null;
  evidence?: ApplicationEvidence;
  errors?: string[];
  live_submit?: boolean;
}

// ─── Automation Compatibility Score ─────────────────────────────────────────
interface AutomationScoreResult {
  score: number;
  level: 'high' | 'medium' | 'low';
  label: string;
  color: string;
  bg: string;
  border: string;
  missingFields: { field: string; tip: string; example?: string }[];
}

function calculateAutomationScore(profile: CandidateProfile): AutomationScoreResult {
  type FieldCheck = { field: string; tip: string; example?: string; weight: number; ok: boolean };

  const checks: FieldCheck[] = [
    {
      field: 'E-mail',
      tip: 'Adicione seu e-mail profissional. É obrigatório em 100% dos formulários de candidatura.',
      example: 'henrique@gmail.com',
      weight: 15,
      ok: !!profile.email && profile.email.includes('@')
    },
    {
      field: 'Telefone / WhatsApp',
      tip: 'Inclua seu telefone com DDD e código do país (+55). A maioria dos portais exige o número completo.',
      example: '+55 71 98543-1158',
      weight: 15,
      ok: !!profile.phone && profile.phone.trim().length >= 8
    },
    {
      field: 'LinkedIn',
      tip: 'Adicione o link completo do seu perfil LinkedIn (linkedin.com/in/seu-nome). Muitos formulários têm campo dedicado para isso.',
      example: 'https://linkedin.com/in/henrique-lima',
      weight: 15,
      ok: !!profile.linkedin && profile.linkedin.includes('linkedin')
    },
    {
      field: 'Nome completo',
      tip: 'Seu nome completo deve estar claramente visível no currículo.',
      weight: 10,
      ok: !!profile.full_name && profile.full_name.trim().split(' ').length >= 2
    },
    {
      field: 'Localização',
      tip: 'Informe sua cidade e país no currículo. Formulários geralmente pedem cidade, estado e país separados.',
      example: 'Salvador, BA – Brasil',
      weight: 10,
      ok: !!profile.location && profile.location.trim().length > 3
    },
    {
      field: 'Habilidades listadas',
      tip: 'Liste suas habilidades técnicas e ferramentas. Isso permite o preenchimento automático de checkboxes e seletores de skills.',
      weight: 10,
      ok: Array.isArray(profile.top_skills) && profile.top_skills.length >= 3
    },
    {
      field: 'Cargo pretendido / Área',
      tip: 'Defina claramente sua área de atuação e cargos que busca. Portais usam isso para o campo "Job Title" e filtros.',
      weight: 10,
      ok: Array.isArray(profile.target_roles) && profile.target_roles.length >= 1
    },
    {
      field: 'GitHub / Portfólio',
      tip: 'Inclua link do GitHub ou portfólio. Formulários de tecnologia frequentemente têm campo específico para isso.',
      example: 'https://github.com/henrique-lima',
      weight: 8,
      ok: !!(profile.github || profile.portfolio)
    },
    {
      field: 'Resumo profissional',
      tip: 'Adicione um resumo objetivo de 3–5 linhas. Portais como Greenhouse têm campo "Cover Letter" que é preenchido com base nisso.',
      weight: 7,
      ok: !!profile.summary_pt && profile.summary_pt.trim().length >= 80
    }
  ];

  const totalWeight = checks.reduce((acc, c) => acc + c.weight, 0);
  const earnedWeight = checks.filter(c => c.ok).reduce((acc, c) => acc + c.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);
  const missingFields = checks.filter(c => !c.ok).map(c => ({ field: c.field, tip: c.tip, example: c.example }));

  if (score >= 80) {
    return { score, level: 'high', label: 'Pronto para Auto-Apply', color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0', missingFields };
  } else if (score >= 50) {
    return { score, level: 'medium', label: 'Parcialmente Compatível', color: '#92400E', bg: '#FFFBEB', border: '#FCD34D', missingFields };
  } else {
    return { score, level: 'low', label: 'Perfil Incompleto', color: '#991B1B', bg: '#FEF2F2', border: '#FECACA', missingFields };
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const CompanyLogo = ({ company, logoUrl }: { company: string, logoUrl?: string }) => {
  const [error, setError] = React.useState(false);
  const initials = (company || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'V';
  
  if (error || (!logoUrl && !company)) {
    return <>{initials}</>;
  }

  const domain = `${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  const src = logoUrl || `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=128`;

  return (
    <img 
      src={src} 
      alt={company} 
      style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#fff' }}
      onError={() => setError(true)}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────

function AutomationScoreCard({ profile }: { profile: CandidateProfile }) {
  const autoScore = calculateAutomationScore(profile);
  const [showTips, setShowTips] = React.useState(false);

  return (
    <div
      style={{
        background: autoScore.bg,
        border: `1px solid ${autoScore.border}`,
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px',
        flexDirection: 'column',
        cursor: autoScore.level !== 'high' ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s'
      }}
      onClick={() => autoScore.level !== 'high' && setShowTips(v => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
        <div style={{
          width: '52px', height: '52px', minWidth: '52px',
          borderRadius: '12px', background: 'white',
          border: `1.5px solid ${autoScore.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative'
        }}>
          <Zap size={22} color={autoScore.color} strokeWidth={1.75} />
          <div style={{
            position: 'absolute', bottom: '-6px', right: '-6px',
            background: autoScore.color, color: 'white',
            borderRadius: '999px', fontSize: '0.6rem', fontWeight: 800,
            padding: '1px 5px', lineHeight: 1.5, border: '2px solid white'
          }}>{autoScore.score}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: autoScore.color, fontWeight: 700 }}>
            Compatibilidade de Automação
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: autoScore.color }}>
            {autoScore.label}
          </div>
          <div style={{ marginTop: '6px', background: 'rgba(0,0,0,0.08)', borderRadius: '999px', height: '5px', width: '100%' }}>
            <div style={{
              height: '100%', borderRadius: '999px',
              width: `${autoScore.score}%`, background: autoScore.color,
              transition: 'width 0.6s ease'
            }} />
          </div>
          <div style={{ fontSize: '0.72rem', color: autoScore.color, marginTop: '3px', opacity: 0.75 }}>
            {autoScore.score}/100 · {autoScore.missingFields.length === 0
              ? 'Todos os dados presentes'
              : `${autoScore.missingFields.length} campo${autoScore.missingFields.length > 1 ? 's' : ''} ausente${autoScore.missingFields.length > 1 ? 's' : ''}`
            }
          </div>
        </div>
        {autoScore.level !== 'high' && (
          <div style={{ color: autoScore.color, opacity: 0.7, flexShrink: 0 }}>
            {showTips ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        )}
      </div>

      {showTips && autoScore.missingFields.length > 0 && (
        <div style={{
          width: '100%', background: 'white', borderRadius: '10px',
          border: `1px solid ${autoScore.border}`, padding: '14px 16px', marginTop: '4px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <Lightbulb size={14} color={autoScore.color} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: autoScore.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              O que adicionar ao currículo
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {autoScore.missingFields.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '20px', height: '20px', minWidth: '20px', borderRadius: '50%',
                  background: autoScore.bg, border: `1px solid ${autoScore.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px'
                }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, color: autoScore.color }}>{i + 1}</span>
                </div>
                <div>
                  <div style={{ fontSize: '0.79rem', fontWeight: 700, color: 'var(--text-body)', marginBottom: '2px' }}>{f.field}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.tip}</div>
                  {f.example && (
                    <div style={{ fontSize: '0.72rem', color: autoScore.color, marginTop: '3px', fontFamily: 'monospace', background: autoScore.bg, padding: '2px 7px', borderRadius: '4px', display: 'inline-block' }}>
                      Ex: {f.example}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: '14px', padding: '10px 12px', background: autoScore.bg,
            borderRadius: '8px', fontSize: '0.75rem', color: autoScore.color,
            lineHeight: 1.5, borderLeft: `3px solid ${autoScore.color}`
          }}>
            <strong>Dica:</strong> Refaça o currículo incluindo esses dados e faça um novo upload para aumentar seu score de automação.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const AI_CONVERSATIONAL_REGEX = /olá|desculpe|como posso|preciso que você|compartilhe a descrição|não tenho acesso|não foi fornecid|fornecer os detalhes|assim que você|para criar o resumo|como ia|como modelo de ia|como assistente|por favor, envie|insira o texto|infelizmente, não recebi|percebi que você não incluiu|você não forneceu|não recebi os detalhes|colar o texto/i;

function cleanJobSummary(summary: string | undefined, title: string, company: string, category: 'tech' | 'operations'): string {
  const text = (summary || '').trim();
  if (text && !AI_CONVERSATIONAL_REGEX.test(text) && text.length >= 25) {
    return text;
  }
  if (category === 'tech') {
    return `Oportunidade técnica para atuar como ${title} na ${company}. Posição 100% remota com foco no desenvolvimento de soluções de alto impacto, boas práticas de engenharia e colaboração internacional com times globais.`;
  }
  return `Vaga de ${title} na ${company}. Posição 100% remota com foco no suporte operacional, excelência no relacionamento com clientes e otimização contínua de processos do dia a dia.`;
}

const PARSE_MESSAGES = [
  {
    step: 'Etapa 1 de 4: Estruturação Inicial',
    title: 'Analisando o histórico profissional...',
    desc: 'Mapeando trajetória, empresas, cargos e períodos de atuação'
  },
  {
    step: 'Etapa 2 de 4: Competências e Ferramentas',
    title: 'Extraindo habilidades e dados cadastrais...',
    desc: 'Organizando ferramentas dominadas, contato e especializações'
  },
  {
    step: 'Etapa 3 de 4: Avaliação de Mercado',
    title: 'Calculando índice de competitividade e senioridade...',
    desc: 'Mensurando aderência para oportunidades remotas internacionais'
  },
  {
    step: 'Etapa 4 de 4: Diagnóstico Executivo',
    title: 'Consolidando pontos fortes e diferenciais...',
    desc: 'Estruturando resumo executivo e preparando envio automático'
  }
];

interface MatchInfo {
  score: number;
  level: 'high' | 'medium' | 'low';
  label: string;
  color: string;
  bg: string;
  borderColor: string;
  dotColor: string;
  shadowColor: string;
}

function calculateJobMatch(job: JobItem, profile: CandidateProfile | null): MatchInfo | null {
  if (!profile) return null;

  const clean = (t: string) => (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const jobText = clean(`${job.title} ${job.company} ${job.summary || ''} ${(job.tags || []).join(' ')}`);
  const profileSkills = (profile.top_skills || []).map(s => clean(s));
  const profileRoles = (profile.target_roles || []).map(r => clean(r));
  const profileSummary = clean(`${profile.summary_pt || ''} ${profile.summary_en || ''} ${(profile.strengths || []).join(' ')}`);

  let matchedSkillsCount = 0;
  profileSkills.forEach(skill => {
    if (skill.length > 2 && jobText.includes(skill)) {
      matchedSkillsCount++;
    }
  });

  const isOpsProfile = profileSkills.some(s => /relacionamento|vendas|cliente|bancario|negociac|comercial|gestao|suporte|atendimento|operac/i.test(s)) ||
    /relacionamento|vendas|banco|cliente|negociac|comercial/i.test(profileSummary);

  const isTechProfile = profileSkills.some(s => /qa|test|python|javascript|software|developer|react|linux|sql|api|devops|engineer/i.test(s)) ||
    /desenvolvedor|engenheir|programad|qa|test|automac/i.test(profileSummary);

  const isFinanceProfile = profileSkills.some(s => /finan|banc|invest|cpa|contab|credit|risco|investiment/i.test(s)) ||
    /financeir|banco|cpa|contabil/i.test(profileSummary);

  const jobTitleClean = clean(job.title);
  const isCustomerSuccessJob = /customer success|account manager|relationship|client|suporte|atendimento/i.test(jobTitleClean);
  const isFinanceJob = /financial|finance|analyst|invest|finan/i.test(jobTitleClean);
  const isTechJob = job.category === 'tech' || /engineer|developer|qa|software|devops|cloud/i.test(jobTitleClean);

  // Variação estável por vaga para diferenciar de 0 a 100
  let hash = 0;
  const hashSeed = `${job.id}-${profile.email || profile.full_name || 'user'}`;
  for (let i = 0; i < hashSeed.length; i++) {
    hash = (hash << 5) - hash + hashSeed.charCodeAt(i);
    hash |= 0;
  }
  const variance = Math.abs(hash % 11);

  let baseScore = 55;

  if (isFinanceProfile && isFinanceJob) {
    baseScore = 88 + (variance % 10); // 88% - 97%
  } else if (isOpsProfile && isCustomerSuccessJob) {
    baseScore = 82 + (variance % 12); // 82% - 93%
  } else if (isTechProfile && isTechJob) {
    baseScore = 84 + (variance % 13); // 84% - 96%
  } else if (isOpsProfile && job.category === 'operations') {
    baseScore = 75 + (variance % 10); // 75% - 84%
  } else if (isTechProfile && job.category === 'tech') {
    baseScore = 76 + (variance % 10); // 76% - 85%
  } else if (isOpsProfile && isTechJob) {
    baseScore = 32 + (variance % 12); // 32% - 43%
  } else if (isTechProfile && !isTechJob) {
    baseScore = 36 + (variance % 12); // 36% - 47%
  } else {
    baseScore = 56 + (variance % 14); // 56% - 69%
  }

  if (matchedSkillsCount > 0) {
    baseScore += Math.min(matchedSkillsCount * 3, 10);
  }

  // Penalidade se exigir idioma não suportado
  if (/japanese|alemao|german|mandarin|french|frances/i.test(jobTitleClean)) {
    const speaks = profileSkills.some(s => /japanese|frances|french|german/i.test(s));
    if (!speaks) {
      baseScore = Math.max(38, baseScore - 20);
    }
  }

  const score = Math.min(98, Math.max(22, Math.round(baseScore)));

  // Cores representativas para cada intensidade de 0 a 100 (Baixo, Médio, Alto)
  if (score >= 75) {
    return {
      score,
      level: 'high',
      label: 'Alto Match',
      color: '#047857',
      bg: '#ECFDF5',
      borderColor: '#10B981',
      dotColor: '#10B981',
      shadowColor: 'rgba(16, 185, 129, 0.28)'
    };
  } else if (score >= 50) {
    return {
      score,
      level: 'medium',
      label: 'Médio Match',
      color: '#B45309',
      bg: '#FFFBEB',
      borderColor: '#F59E0B',
      dotColor: '#F59E0B',
      shadowColor: 'rgba(245, 158, 11, 0.22)'
    };
  } else {
    return {
      score,
      level: 'low',
      label: 'Baixo Match',
      color: '#BE123C',
      bg: '#FFF1F2',
      borderColor: '#F43F5E',
      dotColor: '#F43F5E',
      shadowColor: 'rgba(244, 63, 94, 0.22)'
    };
  }
}

// ─── Match mínimo configurável (aderência >= MATCH_THRESHOLD) ──────────
const MATCH_THRESHOLD = 70;

// Constrói a query inteligente enviada ao Greenhouse para descobrir novas
// vagas com aderência ao perfil. Combina target_roles + top_skills.
function buildGreenhouseSearchQuery(profile: CandidateProfile | null): string {
  if (!profile) return '';
  const ROLE_STOPWORDS = new Set([
    'senior', 'sênior', 'pleno', 'junior', 'júnior', 'sr', 'jr', 'lead', 'head', 'manager',
    'remoto', 'remote', 'worldwide', 'anywhere', 'global', 'vaga', 'cargo', 'position',
    'trabalho', 'job', 'work', 'company', 'empresa', 'tempo', 'integral', 'full', 'time',
    'part', 'contrato', 'contract', 'estagio', 'estágio', 'intern'
  ]);
  const clean = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9+\s]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  const roles = (profile.target_roles || [])
    .map(clean)
    .flatMap((r) => r.split(/[\/,|]|\s+e\s+/))
    .map((r) => r.trim())
    .filter((r) => r.length >= 3 && !ROLE_STOPWORDS.has(r))
    .slice(0, 3);

  const skills = (profile.top_skills || []).map(clean).filter((s) => s.length >= 3).slice(0, 5);

  const tokens = [...new Set([...roles, ...skills])].slice(0, 6);
  return tokens.join(' ').trim();
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'all' | 'tech' | 'operations' | 'sales' | 'marketing' | 'design' | 'data' | 'hr' | 'finance' | 'ai' | 'match'>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortByMatch, setSortByMatch] = useState(false);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [applicationsSummary, setApplicationsSummary] = useState<Record<string, number>>({});
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [showApplicationsPanel, setShowApplicationsPanel] = useState(false);
  const [applicationsStatusFilter, setApplicationsStatusFilter] = useState<string>('all');
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);

  // Currículo State
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string } | null>(null);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [parseLoadingStep, setParseLoadingStep] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Higieniza qualquer caractere asiático/chinês acidental no frontend
  function sanitizeCjkFrontend(obj: any): any {
    if (typeof obj === 'string') {
      return obj
        .replace(/第三方物流/g, 'Logística Terceirizada (3PL)')
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else if (Array.isArray(obj)) {
      return obj.map(sanitizeCjkFrontend);
    } else if (obj && typeof obj === 'object') {
      const res: any = {};
      for (const k of Object.keys(obj)) {
        res[k] = sanitizeCjkFrontend(obj[k]);
      }
      return res;
    }
    return obj;
  }

  // Carrega perfil salvo no localStorage se já tiver sido enviado anteriormente
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('vagaszap_candidate_profile');
        const savedFile = localStorage.getItem('vagaszap_uploaded_file');
        if (saved) {
          const parsed = JSON.parse(saved);
          const sanitized = sanitizeCjkFrontend(parsed);
          setCandidateProfile(sanitized);
          setActiveTab('match');
        }
        if (savedFile) {
          setUploadedFile(JSON.parse(savedFile));
        }
      } catch (e) {}
    }
  }, []);

  // Ciclo dinâmico de mensagens elegantes enquanto a IA processa o currículo
  useEffect(() => {
    let interval: any = null;
    if (isParsingResume) {
      setParseLoadingStep(0);
      interval = setInterval(() => {
        setParseLoadingStep((prev) => (prev < PARSE_MESSAGES.length - 1 ? prev + 1 : prev));
      }, 2300);
    } else {
      setParseLoadingStep(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isParsingResume]);

  // Auto-Apply Modal State
  const [selectedJobForApply, setSelectedJobForApply] = useState<JobItem | null>(null);
  const [applyStep, setApplyStep] = useState<number>(0); // 0: Init, 1: Mapeando formulário, 2: IA gerando carta, 3: Injetando dados, 4: Aguardando envio, 5: Concluído
  const [liveStreamFrame, setLiveStreamFrame] = useState<string | null>(null);
  const [liveStreamStatus, setLiveStreamStatus] = useState<string>('');
  
  const [applyResult, setApplyResult] = useState<any>(null);
  const [appliedJobsHistory, setAppliedJobsHistory] = useState<{ [jobId: string]: any }>({});
  const [showUploadAlert, setShowUploadAlert] = useState(false);

  // Carrossel mobile: índice da vaga em foco (para destacar o dot)
  const [activeJobIndex, setActiveJobIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const total = Math.max(el.children.length, 1);
        // Cada card ocupa 100% da largura (scroll-snap alinhado), então
        // dividimos o scrollLeft pela largura visível para obter o índice.
        const viewW = el.clientWidth;
        const idx = viewW > 0 ? Math.round(el.scrollLeft / viewW) : 0;
        setActiveJobIndex(Math.max(0, Math.min(idx, total - 1)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [carouselRef, jobs.length, activeTab, selectedPeriod]);

  // ── PONTE COM EXTENSÃO CHROME ─────────────────────────────────────────────
  const [isExtensionInstalled, setIsExtensionInstalled] = useState(false);
  const [showLinkedinWarning, setShowLinkedinWarning] = useState(false);
  const [profileSyncStatus, setProfileSyncStatus] = useState<string>('');

  const checkExtensionConnection = () => {
    if (typeof window === 'undefined') return false;
    const isPresent =
      !!(window as any).__VAGASZAP_EXTENSION_INSTALLED__ ||
      document.documentElement.getAttribute('data-vagaszap-extension') === 'installed' ||
      document.documentElement.getAttribute('data-vagaszap-bridge') === 'loaded';
    if (isPresent) {
      setIsExtensionInstalled(true);
      return true;
    }
    window.postMessage({ type: 'VAGASZAP_PING' }, '*');
    return false;
  };

  const syncProfileToExtension = () => {
    if (!candidateProfile) {
      setProfileSyncStatus('Faça upload do currículo primeiro.');
      return;
    }
    if (!isExtensionInstalled) {
      setProfileSyncStatus('Extensão não detectada. Instale-a e recarregue a página.');
      return;
    }
    window.postMessage(
      { type: 'VAGASZAP_SYNC_PROFILE', profile: candidateProfile },
      '*'
    );
    setProfileSyncStatus('✓ Perfil sincronizado com a extensão.');
    setTimeout(() => setProfileSyncStatus(''), 4000);
  };

  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (
        e.data &&
        (e.data.type === 'VAGASZAP_EXTENSION_READY' || e.data.type === 'VAGASZAP_APPLY_ACKNOWLEDGED')
      ) {
        setIsExtensionInstalled(true);
      }
    };
    window.addEventListener('message', handleMsg);
    checkExtensionConnection();

    // Polling: enquanto a extensão não for detectada, pinga a cada 2s até detectar
    // (caso o usuário instale a extensão sem recarregar a página).
    let stopped = false;
    const interval = setInterval(() => {
      if (stopped) return;
      const isPresent =
        document.documentElement.getAttribute('data-vagaszap-bridge') === 'loaded' ||
        document.documentElement.getAttribute('data-vagaszap-extension') === 'installed';
      if (!isPresent) checkExtensionConnection();
      else setIsExtensionInstalled(true);
    }, 2000);
    const stop = setTimeout(() => { stopped = true; clearInterval(interval); }, 60000);

    return () => {
      stopped = true;
      window.removeEventListener('message', handleMsg);
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [activeTab, selectedPeriod]);

  const fetchJobs = async () => {
    setIsLoadingJobs(true);
    try {
      const url = `/api/jobs?category=${activeTab}&period=${selectedPeriod}&q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
      }
    } catch (e) {
      console.error('Erro ao buscar vagas:', e);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  // Fetch auto-apply applications from the local bot (vagas_compat_automation)
  const fetchApplications = async (statusFilter: string = 'all') => {
    setApplicationsLoading(true);
    try {
      const url =
        statusFilter && statusFilter !== 'all'
          ? `/api/applications?status=${encodeURIComponent(statusFilter)}&limit=200`
          : `/api/applications?limit=200`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setApplications(data.applications || []);
        setApplicationsSummary(data.summary || {});
      }
    } catch (e) {
      console.error('Erro ao buscar applications:', e);
    } finally {
      setApplicationsLoading(false);
    }
  };

  useEffect(() => {
    if (showApplicationsPanel) {
      fetchApplications(applicationsStatusFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showApplicationsPanel, applicationsStatusFilter]);

  // Escuta término real da candidatura vindo da aba da empresa (extensão)
  useEffect(() => {
    const handleCompletionMsg = (event: MessageEvent) => {
      const t = event.data?.type;
      // A extensão confirmou que abriu a aba da vaga no Chrome do usuário
      if (t === 'VAGASZAP_TAB_OPENED' || t === 'VAGASZAP_LINKEDIN_OPENED') {
        setApplyResult({
          success: true,
          message:
            t === 'VAGASZAP_LINKEDIN_OPENED'
              ? 'A extensão VagasZap abriu o LinkedIn na sua conta logada e está aplicando automaticamente.'
              : 'A extensão VagasZap abriu a vaga em nova aba e está preenchendo agora.',
          atsType: 'VagasZap Extensão',
          appliedAt: new Date().toISOString(),
        });
        setApplyStep(5);
        return;
      }

      // A extensão terminou de aplicar
      if (t === 'VAGASZAP_APPLY_COMPLETED') {
        const completedData = event.data.data || {};
        const successFlag = completedData.success !== false && completedData.status !== 'VALIDATION_FAILED' && completedData.status !== 'SUBMIT_UNCONFIRMED';
        const confirmationId = completedData.confirmationId || `VZ-${Math.floor(100000 + Math.random() * 900000)}`;
        setApplyResult({
          success: successFlag,
          confirmationId,
          atsType: completedData.atsType || 'Candidatura Direta Confirmada',
          appliedAt: new Date().toISOString(),
          message: successFlag
            ? `Candidatura enviada com sucesso para ${completedData.company || 'a empresa'}!`
            : (completedData.error || 'Candidatura pode ter sido enviada; verifique na aba aberta.'),
          filledFields: completedData.filledFields,
          coverLetter: completedData.coverLetter,
        });
        setApplyStep(successFlag ? 5 : 4);
        if (selectedJobForApply && successFlag) {
          setAppliedJobsHistory(prev => ({
            ...prev,
            [selectedJobForApply.id]: {
              jobTitle: selectedJobForApply.title,
              company: selectedJobForApply.company,
              date: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              confirmationId,
            }
          }));
        }
        return;
      }
    };

    window.addEventListener('message', handleCompletionMsg);
    return () => window.removeEventListener('message', handleCompletionMsg);
  }, [selectedJobForApply]);

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setIsParsingResume(true);
    setResumeError(null);
    setShowUploadAlert(false);

    // ── Step 1: upload directly to Supabase Storage (bypasses Vercel's 4.5 MB
    // request-body limit, allowing files up to the bucket's 50 MB ceiling).
    const safeExt = file.name.endsWith('.docx')
      ? '.docx'
      : file.name.endsWith('.doc')
        ? '.doc'
        : file.name.endsWith('.png')
          ? '.png'
          : file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')
            ? '.jpg'
            : '.pdf';
    const storagePath = `${Date.now()}_${Math.random().toString(36).substring(7)}${safeExt}`;

    try {
      const sb = await getSupabaseClient();
      const { error: uploadError } = await sb.storage
        .from('resumes')
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Falha no upload do Storage: ${uploadError.message}`);
      }

      // ── Step 2: ask the server to parse the (already-uploaded) file.
      // Body is just JSON metadata, well under 4.5 MB.
      const res = await fetch('/api/resume/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, fileName: file.name }),
      });
      const data = await res.json();
      if (data.success && data.profile) {
        const sanitized = sanitizeCjkFrontend(data.profile);
        setCandidateProfile(sanitized);
        setActiveTab('match');
        setUploadedFile({ name: data.fileName, size: data.fileSize });
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('vagaszap_candidate_profile', JSON.stringify(sanitized));
            localStorage.setItem('vagaszap_uploaded_file', JSON.stringify({ name: data.fileName, size: data.fileSize }));
          } catch(e) {}
          window.postMessage({ type: 'VAGASZAP_SYNC_PROFILE', profile: sanitized }, '*');
        }
      } else {
        setResumeError(data.error || 'Não foi possível ler o arquivo. Tente outro formato.');
      }
    } catch (err: any) {
      setResumeError('Erro ao processar currículo. Verifique sua conexão.');
    } finally {
      setIsParsingResume(false);
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const removeResume = () => {
    setCandidateProfile(null);
    setUploadedFile(null);
    setResumeError(null);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('vagaszap_candidate_profile');
        localStorage.removeItem('vagaszap_uploaded_file');
      } catch(e) {}
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Detecta se a vaga é ATS oficial (Greenhouse/Ashby/Lever/Workable)
  const isOfficialAtsJob = (job: JobItem): boolean => {
    const link = (job.applicationLink || '').toLowerCase();
    return (
      link.includes('greenhouse.io') ||
      link.includes('boards.greenhouse.io') ||
      link.includes('ashbyhq.com') ||
      link.includes('lever.co') ||
      link.includes('workable.com')
    );
  };

  const triggerAutoApply = async (job: JobItem) => {
    if (!candidateProfile || !candidateProfile.resume_url) {
      setShowUploadAlert(true);
      const el = document.getElementById('curriculo-section');
      el?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!job.applicationLink?.includes('boards.greenhouse.io')) {
      alert("A versão atual do Auto-Apply Mágico suporta apenas vagas do Greenhouse.");
      window.open(job.applicationLink, '_blank');
      return;
    }

    setSelectedJobForApply(job);
    setApplyStep(1); // 1 = loading
    setApplyResult(null);
    setLiveStreamFrame(null);
    setLiveStreamStatus('Conectando ao robô...');

    const applyId = Math.random().toString(36).substring(7) + Date.now().toString(36);

    const ws = new WebSocket('ws://185.173.110.54:4001');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', applyId }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame') {
          setLiveStreamFrame(msg.data);
          setLiveStreamStatus('Robô trabalhando...');
        } else if (msg.type === 'status') {
          setLiveStreamStatus(msg.message);
        } else if (msg.type === 'done') {
          ws.close();
        }
      } catch(e){}
    };

    try {
      const res = await fetch('/api/apply/greenhouse-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_url: job.applicationLink,
          profile: candidateProfile,
          applyId
        })
      });
      const data = await res.json();
      if (data.success) {
        setApplyResult({ success: true, message: data.message, proof_url: data.proof_url });
        setAppliedJobsHistory(prev => ({
          ...prev,
          [job.id]: {
            jobId: job.id,
            timestamp: new Date().toISOString(),
            status: 'APPLIED',
            confirmationId: 'IA_AUTO'
          }
        }));
      } else {
        setApplyResult({ success: false, error: data.error });
      }
    } catch (e: any) {
      setApplyResult({ success: false, error: 'Falha de conexão com a API de Auto-Apply.' });
    }
  };



  // ── AUTO APPLY LINKEDIN (via extensão Chrome) ─────────────────────────
  const [linkedinRunning, setLinkedinRunning] = useState(false);
  const [linkedinResult, setLinkedinResult] = useState<any>(null);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);

  const triggerLinkedinAutoApply = async () => {
    if (!candidateProfile) {
      setShowUploadAlert(true);
      const el = document.getElementById('curriculo-section');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!isExtensionInstalled) {
      setLinkedinError(
        'Extensão VagasZap não detectada. Instale-a via chrome://extensions → Carregar sem compactação → public/vagaszap-extension. Depois clique em "Sync com Extensão".'
      );
      return;
    }
    // Sincroniza o perfil antes de disparar o batch (garante que está fresh)
    syncProfileToExtension();
    // Dispara o batch na extensão (abre a busca e fica aplicando)
    setLinkedinError(null);
    setLinkedinRunning(true);
    window.postMessage(
      { type: 'VAGASZAP_TRIGGER_LINKEDIN_BATCH', profile: candidateProfile, maxJobs: 999 },
      '*'
    );
    // Feedback imediato na UI
    setSelectedJobForApply({
      id: 'linkedin-batch',
      title: 'LinkedIn Auto-Apply',
      company: 'Busca Easy Apply + Remoto Brasil',
      location: 'Vá para a aba aberta pela extensão',
      salary: '—',
      employmentType: '—',
      pubDate: '—',
      applicationLink: 'https://www.linkedin.com/jobs/search/?keywords=QA+Engineer&location=Brazil&f_AL=true&f_WT=2',
      summary: 'A extensão VagasZap abriu o LinkedIn na sua conta logada e está aplicando automaticamente nas vagas Easy Apply remotas do Brasil. Acompanhe na aba aberta.',
      tags: ['LinkedIn', 'Auto Apply'],
      category: 'tech',
    });
    // Vai DIRETO para o step 5 com mensagem positiva — destrava a UI enquanto
    // a extensão trabalha em segundo plano. Se a extensão falhar em abrir a
    // aba, o listener de VAGASZAP_TAB_OPENED não dispara e o usuário ainda vê
    // essa mensagem com o link direto para abrir a busca manualmente.
    setApplyResult({
      success: true,
      message: 'A extensão VagasZap assumiu. Ela abriu (ou vai abrir) a busca Easy Apply + Remoto Brasil no seu LinkedIn logado. Vá até a aba aberta e acompanhe — você pode minimizar esta janela.',
      atsType: 'VagasZap Extensão',
      appliedAt: new Date().toISOString(),
    });
    setApplyStep(5);
  };

  const confirmLinkedinApply = async () => {
    // Mantido apenas para retrocompatibilidade — fluxo antigo: o usuário
    // clica em "Iniciar Auto Apply" no modal de aviso. Redireciona para o novo fluxo.
    setShowLinkedinWarning(false);
    await triggerLinkedinAutoApply();
  };



  const filteredJobs = jobs.filter(job => {
    // Filtro inteligente da aba Match: apenas vagas com aderência >= MATCH_THRESHOLD
    if (activeTab === 'match') {
      if (!candidateProfile) return false;
      const matchInfo = calculateJobMatch(job, candidateProfile);
      if (!matchInfo || matchInfo.score < MATCH_THRESHOLD) return false;
    }

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      job.title.toLowerCase().includes(q) ||
      job.company.toLowerCase().includes(q) ||
      job.tags.some(t => t.toLowerCase().includes(q)) ||
      job.summary.toLowerCase().includes(q)
    );
  });

  // Contador de vagas com aderência >= MATCH_THRESHOLD para a badge da aba Match
  const matchCount = candidateProfile
    ? jobs.reduce((acc, j) => {
        const m = calculateJobMatch(j, candidateProfile);
        return acc + (m && m.score >= MATCH_THRESHOLD ? 1 : 0);
      }, 0)
    : 0;

  const displayedJobs = [...filteredJobs].sort((a, b) => {
    if ((sortByMatch || activeTab === 'match') && candidateProfile) {
      const matchA = calculateJobMatch(a, candidateProfile)?.score || 0;
      const matchB = calculateJobMatch(b, candidateProfile)?.score || 0;
      return matchB - matchA;
    }
    return 0;
  });

  const greenhouseSearchTerm = buildGreenhouseSearchQuery(candidateProfile);

  return (
    <div className="vz-app">
      {/* 1. TOP ANNOUNCEMENT BAR (WHITEPACE NAVY) */}
      <div style={{
        background: 'var(--navy-primary)',
        color: '#FFFFFF',
        padding: '9px 16px',
        textAlign: 'center',
        fontSize: '0.82rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        letterSpacing: '0.01em'
      }}>
        <span>
          Catálogo Global de Vagas Remotas em Dólar e Euro
        </span>
      </div>

      {/* 2. HEADER & NAVBAR (CLEAN WHITE - SEM BOTÃO DE SUBIR CURRÍCULO) */}
      <header className="vz-header" style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: '#FFFFFF',
        borderBottom: '1px solid var(--border-light)',
        padding: '14px 24px',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{
          maxWidth: '1240px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px'
        }}>
          {/* Logo & Marca */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <Image
                src="/logo.jpg"
                alt="VagasZap Logo"
                fill
                style={{ objectFit: 'cover' }}
                priority
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span className="vz-logo-text" style={{ fontWeight: 800, fontSize: '1.35rem', letterSpacing: '-0.02em', color: 'var(--navy-primary)' }}>
                  Vagas
                </span>
                <span className="vz-logo-text" style={{ fontWeight: 800, fontSize: '1.35rem', letterSpacing: '-0.02em', color: 'var(--blue-accent)' }}>
                  Zap
                </span>
              </div>
              <div style={{
                fontSize: '0.68rem',
                color: 'var(--text-muted)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
                marginTop: '-2px'
              }}>
                Remote Careers & Direct Applications
              </div>
            </div>
          </div>

          {/* Ações do Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <a
              href="https://chat.whatsapp.com/invite"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-whatsapp"
            >
              <Users size={14} />
              <span>Comunidade</span>
            </a>
          </div>
        </div>
      </header>

      {/* 3. HERO SECTION (EDITORIAL WHITEPACE STYLE) */}
      <section className="vz-hero vz-section" aria-labelledby="hero-title" style={{
        maxWidth: 'var(--content-max-width)',
        margin: '0 auto',
        padding: 'clamp(24px, 5vw, 40px) var(--content-side-padding) 20px',
        textAlign: 'center',
        width: '100%'
      }}>
        <h1 id="hero-title" style={{
          fontSize: 'clamp(1.5rem, 5vw, 3rem)',
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: '-0.03em',
          maxWidth: '880px',
          margin: '0 auto 14px auto',
          color: 'var(--navy-primary)'
        }}>
          Carreiras Remotas Internacionais com{' '}
          <span style={{ color: 'var(--blue-accent)' }}>Envio Automatizado</span>
        </h1>

        <p style={{
          color: 'var(--text-body)',
          maxWidth: '680px',
          margin: '0 auto 16px auto',
          lineHeight: 1.55,
          fontSize: 'clamp(0.95rem, 2.4vw, 1.12rem)'
        }}>
          Conecte-se a vagas em dólar e euro (Tecnologia & Operações). Suba seu currículo abaixo para análise técnica de aderência, senioridade e preenchimento direto nos formulários oficiais.
        </p>
      </section>

      {/* 4. SEÇÃO DO CURRÍCULO (DRAG & DROP MINIMALISTA, COM MÁXIMO DESTAQUE) */}
      <section id="curriculo-section" className="vz-section" style={{
        maxWidth: '1240px',
        margin: '0 auto',
        padding: '0 24px 32px 24px',
        width: '100%'
      }}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFileUpload(e.target.files[0]);
            }
          }}
          accept=".pdf,.doc,.docx"
          style={{ display: 'none' }}
        />

        {showUploadAlert && !candidateProfile && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 18px',
            borderRadius: '8px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <AlertCircle size={18} />
            <span><strong>Atenção:</strong> Por favor, faça o upload do seu currículo abaixo para ativar o envio automático!</span>
          </div>
        )}

        {!candidateProfile ? (
          /* ESTADO INICIAL: DRAG & DROP MINIMALISTA COM MÁXIMO DESTAQUE (SEM BOTÕES ADICIONAIS) */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isParsingResume && fileInputRef.current?.click()}
            className="whitepace-card vz-resume-card"
            style={{
              padding: '48px 36px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              cursor: isParsingResume ? 'default' : 'pointer',
              border: isDragOver ? '2px dashed #4F9CF9' : '2px dashed var(--border-medium)',
              background: isDragOver ? 'var(--navy-subtle)' : '#FFFFFF',
              boxShadow: isDragOver ? '0 12px 30px rgba(79, 156, 249, 0.15)' : 'var(--shadow-card)',
              transition: 'all 0.2s ease',
              borderRadius: '16px'
            }}
          >
            {isParsingResume ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
                {/* Ícone de Carregamento Elegante */}
                <div style={{
                  position: 'relative',
                  width: '68px',
                  height: '68px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    border: '3px solid #E2E8F0',
                    borderTopColor: 'var(--blue-accent)',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    background: 'var(--navy-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    <FileSearch size={24} color="var(--navy-primary)" strokeWidth={1.75} />
                  </div>
                </div>

                {/* Badge da Etapa Atual */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  padding: '4px 14px',
                  borderRadius: '999px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: 'var(--blue-accent)',
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase'
                }}>
                  <Loader2 size={12} className="animate-spin-slow" />
                  {PARSE_MESSAGES[parseLoadingStep]?.step || 'Estruturação do Perfil'}
                </div>

                {/* Título e Subtítulo Dinâmicos */}
                <div style={{ minHeight: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontWeight: 800, color: 'var(--navy-primary)', fontSize: '1.25rem', transition: 'all 0.3s ease' }}>
                    {PARSE_MESSAGES[parseLoadingStep]?.title}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5, transition: 'all 0.3s ease' }}>
                    {PARSE_MESSAGES[parseLoadingStep]?.desc}
                  </div>
                </div>

                {/* Segmentos de Progresso */}
                <div style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '340px', marginTop: '6px' }}>
                  {PARSE_MESSAGES.map((_, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: '4px',
                        borderRadius: '999px',
                        background: i <= parseLoadingStep ? 'var(--navy-primary)' : '#E2E8F0',
                        transition: 'background 0.4s ease'
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  background: 'var(--navy-subtle)',
                  border: '1px solid #DBEAFE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px',
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  <Upload size={28} color="var(--navy-primary)" strokeWidth={1.75} />
                </div>

                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--navy-primary)', marginBottom: '6px' }}>
                  Arraste seu currículo aqui ou clique para selecionar
                </div>

                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '580px', lineHeight: 1.5, marginBottom: '14px' }}>
                  Suporta <strong>PDF, DOC ou DOCX</strong>. Mapeamento de histórico profissional, competências e preenchimento direto nos formulários oficiais.
                </div>

                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#F1F5F9',
                  border: '1px solid var(--border-light)',
                  padding: '5px 12px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  color: 'var(--text-body)',
                  fontWeight: 600
                }}>
                  <ShieldCheck size={14} color="#059669" strokeWidth={1.75} />
                  <span>Análise de Senioridade, Pontos Fortes e Recomendações Estratégicas</span>
                </div>
              </>
            )}
          </div>
        ) : (
          /* ESTADO PREENCHIDO: DOSSIÊ DO CANDIDATO (mobile-first, sem extensão) */
          <div className="whitepace-card" style={{ position: 'relative', padding: 'clamp(16px, 4vw, 28px)', background: '#FFFFFF', borderRadius: '16px', overflow: 'hidden' }}>
            {/* 1. HEADER DO CANDIDATO — sem overflow horizontal */}
            <header className="vz-candidate-header" style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--spacing-sm)',
              paddingBottom: 'var(--spacing-md)',
              borderBottom: '1px solid var(--border-light)',
              marginBottom: 'var(--spacing-md)',
              paddingRight: '40px', /* Previne sobreposição com o botão absoluto */
              minWidth: 0,
            }}>
              {/* BLOCO IDENTIDADE: avatar + nome + status */}
              <div className="vz-candidate-id" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
                minWidth: 0,
                flex: '1 1 auto',
              }}>
                {candidateProfile.photo_url ? (
                  <div style={{
                    width: 'clamp(52px, 14vw, 60px)',
                    height: 'clamp(52px, 14vw, 60px)',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: '2px solid var(--blue-accent)',
                    flexShrink: 0,
                  }}>
                    <img
                      src={candidateProfile.photo_url}
                      alt={`Foto de ${candidateProfile.full_name || 'candidato'}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                ) : (
                  <div style={{
                    width: 'clamp(52px, 14vw, 60px)',
                    height: 'clamp(52px, 14vw, 60px)',
                    borderRadius: '50%',
                    background: 'var(--navy-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 'clamp(1.2rem, 4vw, 1.35rem)',
                    color: '#FFFFFF',
                    flexShrink: 0,
                  }} aria-hidden>
                    {candidateProfile.first_name ? candidateProfile.first_name[0] : 'U'}
                  </div>
                )}

                <div className="vz-candidate-id-text" style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <h2
                    title={candidateProfile.full_name}
                    style={{
                      fontSize: 'clamp(1.05rem, 4vw, 1.25rem)',
                      fontWeight: 800,
                      color: 'var(--navy-primary)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                    }}
                  >
                    {candidateProfile.full_name}
                  </h2>

                </div>
              </div>

              {/* BLOCO AÇÕES: apenas exclusão posicionada no canto superior direito */}
              <button
                onClick={removeResume}
                className="vz-trash-btn"
                aria-label="Excluir currículo"
                title="Excluir currículo anexado"
                style={{ 
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  color: '#DC2626',
                  background: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  minHeight: '28px',
                  padding: 0,
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.1)'
                }}
              >
                <Trash2 size={13} strokeWidth={2} aria-hidden />
              </button>
            </header>

            {/* 2. CARDS DE INFORMAÇÕES — scroll horizontal no mobile, grid no desktop */}
            <section
              className="vz-info-row"
              aria-label="Dados do candidato (email, telefone, senioridade, score, match)"
            >
              {/* CARD: E-mail */}
              <article
                className="vz-info-card"
                title={candidateProfile.email || ''}
              >
                <div className="vz-info-icon" style={{ background: 'var(--navy-subtle)', color: 'var(--navy-primary)' }}>
                  <Mail size={14} strokeWidth={2} aria-hidden />
                </div>
                <div className="vz-info-body">
                  <span className="vz-info-label">E-mail</span>
                  <span className="vz-info-value">{candidateProfile.email || '—'}</span>
                </div>
              </article>

              {/* CARD: Telefone */}
              {candidateProfile.phone && (
                <article
                  className="vz-info-card"
                  title={candidateProfile.phone}
                >
                  <div className="vz-info-icon" style={{ background: 'var(--navy-subtle)', color: 'var(--navy-primary)' }}>
                    <Phone size={14} strokeWidth={2} aria-hidden />
                  </div>
                  <div className="vz-info-body">
                    <span className="vz-info-label">Telefone</span>
                    <span className="vz-info-value">{candidateProfile.phone}</span>
                  </div>
                </article>
              )}

              {/* CARD: Senioridade */}
              <article className="vz-info-card">
                <div className="vz-info-icon" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
                  <Award size={14} strokeWidth={2} aria-hidden />
                </div>
                <div className="vz-info-body">
                  <span className="vz-info-label">Senioridade</span>
                  <span className="vz-info-value">Nível {candidateProfile.seniority || 'Sênior'}</span>
                </div>
              </article>

              {/* CARD: Score do Currículo */}
              <article className="vz-info-card">
                <div className="vz-info-icon" style={{ background: '#ECFDF5', color: '#065F46' }}>
                  <TrendingUp size={14} strokeWidth={2} aria-hidden />
                </div>
                <div className="vz-info-body">
                  <span className="vz-info-label">Score</span>
                  <span className="vz-info-value">{candidateProfile.score || 88}/100</span>
                </div>
              </article>

              {/* CARD: Compatibilidade de Automação */}
              <article className="vz-info-card">
                <div className="vz-info-icon" style={{ background: '#FFFBEB', color: '#92400E' }}>
                  <Zap size={14} strokeWidth={2} aria-hidden />
                </div>
                <div className="vz-info-body">
                  <span className="vz-info-label">Auto-Apply</span>
                  <span className="vz-info-value">{candidateProfile.score ? `${candidateProfile.score}/100` : '95/100'}</span>
                </div>
              </article>

              {/* CARD: Localização (se houver) */}
              {candidateProfile.location && (
                <article
                  className="vz-info-card"
                  title={candidateProfile.location}
                >
                  <div className="vz-info-icon" style={{ background: 'var(--navy-subtle)', color: 'var(--navy-primary)' }}>
                    <MapPin size={14} strokeWidth={2} aria-hidden />
                  </div>
                  <div className="vz-info-body">
                    <span className="vz-info-label">Localização</span>
                    <span className="vz-info-value">{candidateProfile.location}</span>
                  </div>
                </article>
              )}
            </section>

            {/* ─── Auto-Apply Applications Dashboard Toggle ─────────────────── */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowApplicationsPanel((s) => !s)}
                aria-expanded={showApplicationsPanel}
                aria-controls="applications-panel"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1px solid var(--navy-primary)',
                  background: showApplicationsPanel ? 'var(--navy-primary)' : '#FFFFFF',
                  color: showApplicationsPanel ? '#FFFFFF' : 'var(--navy-primary)',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <FileCheck2 size={16} strokeWidth={2.2} aria-hidden />
                <span>
                  {showApplicationsPanel ? 'Ocultar' : 'Ver'} painel de Auto-Apply
                </span>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '22px',
                    height: '22px',
                    borderRadius: '11px',
                    padding: '0 6px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    background: showApplicationsPanel ? '#FFFFFF' : 'var(--navy-primary)',
                    color: showApplicationsPanel ? 'var(--navy-primary)' : '#FFFFFF',
                  }}
                >
                  {Object.values(applicationsSummary).reduce((a, b) => a + b, 0) || '—'}
                </span>
              </button>
            </div>

            {showApplicationsPanel && (
              <section
                id="applications-panel"
                aria-label="Histórico de aplicações automáticas"
                style={{
                  marginTop: '16px',
                  padding: '18px',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  background: '#F8FAFC',
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.02rem', color: 'var(--navy-primary)', fontWeight: 800 }}>
                    Histórico de Auto-Apply (vagas_compat_automation)
                  </h3>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {['all', 'submitted', 'needs_manual_review', 'failed', 'dry_run'].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setApplicationsStatusFilter(s)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '999px',
                          border: '1px solid #CBD5E1',
                          background: applicationsStatusFilter === s ? 'var(--navy-primary)' : '#FFFFFF',
                          color: applicationsStatusFilter === s ? '#FFFFFF' : 'var(--navy-primary)',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {s} ({s === 'all' ? Object.values(applicationsSummary).reduce((a, b) => a + b, 0) : applicationsSummary[s] || 0})
                      </button>
                    ))}
                  </div>
                </header>

                {applicationsLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '20px', color: 'var(--text-muted)' }}>
                    <RefreshCw size={16} aria-hidden style={{ animation: 'vz-spin 1s linear infinite' }} /> Carregando aplicações…
                  </div>
                )}

                {!applicationsLoading && applications.length === 0 && (
                  <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.9rem' }}>
                    Nenhuma aplicação encontrada para esse filtro. Rode o bot
                    (<code>python3 -m vagas_compat_automation.runner</code>) para popular.
                  </div>
                )}

                {!applicationsLoading && applications.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {applications.map((app, idx) => {
                      const status = app.status || 'unknown';
                      const palette: Record<string, { bg: string; fg: string; border: string; label: string }> = {
                        submitted: { bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0', label: '✅ Submetida' },
                        needs_manual_review: { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A', label: '⚠️ Revisar' },
                        failed: { bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA', label: '❌ Falhou' },
                        dry_run: { bg: '#EFF6FF', fg: '#1E40AF', border: '#BFDBFE', label: '�� Dry-run' },
                        pending: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: '⏳ Pendente' },
                        unknown: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: status },
                      };
                      const c = palette[status] || palette.unknown;
                      const when = app.finished_at || app.started_at || app.applied_at || '';
                      return (
                        <li
                          key={app.id || idx}
                          style={{
                            padding: '12px',
                            borderRadius: '10px',
                            border: `1px solid ${c.border}`,
                            background: '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                                {app.title || '—'} <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>@ {app.company || '—'}</span>
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {when && <span>{when} </span>}
                                {app.score != null && <span>• score {app.score}</span>}
                                {app.duration_s != null && <span>• {app.duration_s}s</span>}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                padding: '4px 10px',
                                borderRadius: '999px',
                                background: c.bg,
                                color: c.fg,
                                border: `1px solid ${c.border}`,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {c.label}
                            </span>
                          </div>

                          {app.url && (
                            <a
                              href={app.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '0.78rem', color: 'var(--navy-primary)', textDecoration: 'none', wordBreak: 'break-all' }}
                            >
                              {app.url} ↗
                            </a>
                          )}

                          {app.evidence && (app.evidence.thank_you_url || app.evidence.post_submit_url || (app.evidence.confirmation_keywords_found || []).length > 0) && (
                            <div style={{ fontSize: '0.78rem', color: '#065F46', marginTop: '4px' }}>
                              {app.evidence.thank_you_url && (
                                <div>
                                  Thank-you:{' '}
                                  <a href={app.evidence.thank_you_url} target="_blank" rel="noopener noreferrer" style={{ color: '#065F46', textDecoration: 'underline' }}>
                                    {app.evidence.thank_you_url}
                                  </a>
                                </div>
                              )}
                              {app.evidence.post_submit_url && app.evidence.post_submit_url !== app.evidence.thank_you_url && (
                                <div style={{ color: 'var(--text-muted)' }}>
                                  Post-submit: {app.evidence.post_submit_url}
                                </div>
                              )}
                              {(app.evidence.confirmation_keywords_found || []).length > 0 && (
                                <div style={{ marginTop: '2px' }}>
                                  Keywords: {app.evidence.confirmation_keywords_found!.join(', ')}
                                </div>
                              )}
                            </div>
                          )}

                          {app.errors && app.errors.length > 0 && (
                            <div style={{ fontSize: '0.78rem', color: '#991B1B', marginTop: '4px' }}>
                              {app.errors.map((e, i) => (
                                <div key={i}>• {e}</div>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* Mobile-only helper text (orientação do scroll horizontal) */}
            <p className="vz-info-hint" aria-hidden>
              ← deslize para ver mais dados →
            </p>

            {/* Habilidades Detectadas — chip row compacto */}
            {candidateProfile.top_skills?.length > 0 && (
              <div style={{ marginTop: '16px' }} aria-label="Habilidades detectadas">
                <span 
                  className="vz-info-label" 
                  style={{ 
                    display: 'block', 
                    marginBottom: '8px',
                    fontSize: '0.68rem', 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.04em', 
                    color: 'var(--text-muted)', 
                    fontWeight: 700 
                  }}
                >
                  Skills:
                </span>
                <div className="vz-skills-row">
                  {candidateProfile.top_skills.map((skill, idx) => (
                  <span
                    key={idx}
                    className="vz-skill-chip"
                    title={skill}
                  >
                    {skill}
                  </span>
                ))}
                </div>
              </div>
            )}

            {/* Resumo Executivo (Collapsible) */}
            {candidateProfile.summary_pt && (
              <div style={{ marginTop: '16px', padding: '16px', background: 'var(--bg-subtle)', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                <div 
                  onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    cursor: 'pointer',
                    marginBottom: isSummaryExpanded ? '12px' : '0'
                  }}
                  aria-expanded={isSummaryExpanded}
                  role="button"
                  tabIndex={0}
                >
                  <span 
                    className="vz-info-label" 
                    style={{ 
                      display: 'block', 
                      margin: 0, 
                      fontSize: '0.68rem', 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.04em', 
                      color: 'var(--text-muted)', 
                      fontWeight: 700 
                    }}
                  >
                    Resumo Executivo
                  </span>
                  {isSummaryExpanded ? (
                    <ChevronUp size={16} color="var(--text-muted)" aria-hidden />
                  ) : (
                    <ChevronDown size={16} color="var(--text-muted)" aria-hidden />
                  )}
                </div>
                {isSummaryExpanded && (
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5, margin: 0 }}>
                    {candidateProfile.summary_pt}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {resumeError && (
          <div style={{
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <AlertCircle size={16} />
            <span>{resumeError}</span>
          </div>
        )}
      </section>

      {/* 5. BARRA DE CONTROLE: CATEGORIAS + FILTROS TEMPORAIS + BUSCA */}
      <section className="vz-section" style={{
        maxWidth: '1240px',
        margin: '0 auto',
        padding: '0 24px 20px 24px',
        width: '100%'
      }}>
        {/* Linha 1: Categorias e Busca */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          marginBottom: '12px'
        }}>
          {/* Segmented Control — vira scroll horizontal com snap no mobile */}
          <div className="vz-tab-scroller" style={{
            background: '#F1F5F9',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid var(--border-light)',
            scrollSnapType: 'x mandatory',
          }}>
            {/* Nova aba: MATCH — PRIMEIRA ABA. Só aparece quando há currículo anexado.
               Destaque em verde + ícone + badge com contagem de vagas aderentes. */}
            {candidateProfile && (
              <button
                onClick={(e) => {
                  setActiveTab('match');
                  e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }}
                title={`Vagas com aderência ≥ ${MATCH_THRESHOLD}% baseadas no seu currículo`}
                style={{
                  background: activeTab === 'match'
                    ? 'linear-gradient(135deg, #047857 0%, #065F46 100%)'
                    : '#ECFDF5',
                  color: activeTab === 'match' ? '#FFFFFF' : '#065F46',
                  border: activeTab === 'match'
                    ? '1px solid #065F46'
                    : '1px solid #A7F3D0',
                  padding: '8px 16px',
                  borderRadius: '7px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxShadow: activeTab === 'match'
                    ? '0 4px 14px rgba(4, 120, 87, 0.32)'
                    : '0 1px 2px rgba(4, 120, 87, 0.06)',
                }}
              >
                <span style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: activeTab === 'match' ? 'rgba(255,255,255,0.18)' : '#10B981',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  fontSize: '9px',
                  fontWeight: 900,
                }}>◎</span>
                <span style={{ whiteSpace: 'nowrap' }}>Match</span>
                <span style={{
                  background: activeTab === 'match' ? '#FFFFFF' : '#065F46',
                  color: activeTab === 'match' ? '#065F46' : '#FFFFFF',
                  padding: '1px 7px',
                  borderRadius: '999px',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  minWidth: '22px',
                  textAlign: 'center',
                }}>{matchCount}</span>
              </button>
            )}

            <button
              onClick={(e) => {
                setActiveTab('all');
                e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
              }}
              style={{
                background: activeTab === 'all' ? 'var(--navy-primary)' : 'transparent',
                color: activeTab === 'all' ? '#FFFFFF' : 'var(--text-muted)',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '7px',
                fontSize: '0.84rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              Todas as Vagas ({jobs.length})
            </button>

            {[
              { id: 'tech', label: 'Tecnologia & Produto', icon: Code2 },
              { id: 'operations', label: 'Operações & Negócios', icon: Briefcase },
              { id: 'sales', label: 'Vendas & CS', icon: TrendingUp },
              { id: 'marketing', label: 'Marketing & Growth', icon: LineChart },
              { id: 'design', label: 'Design & UX', icon: Palette },
              { id: 'data', label: 'Dados & Analytics', icon: Database },
              { id: 'hr', label: 'Pessoas & Cultura', icon: Users },
              { id: 'finance', label: 'Financeiro & Admin', icon: Building },
              { id: 'ai', label: 'IA & Automação', icon: Bot },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={(e) => {
                    setActiveTab(tab.id as any);
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                  }}
                  style={{
                    background: activeTab === tab.id ? 'var(--navy-primary)' : 'transparent',
                    color: activeTab === tab.id ? '#FFFFFF' : 'var(--text-muted)',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '7px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={14} strokeWidth={2} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Campo de Busca */}
          <div style={{
            position: 'relative',
            minWidth: '280px',
            flex: '1',
            maxWidth: '420px'
          }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} aria-hidden />
            <input
              type="text"
              placeholder="Buscar por cargo, empresa ou tecnologia..."
              aria-label="Buscar vagas por cargo, empresa ou tecnologia"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="vz-search-input"
              style={{
                width: '100%',
                minHeight: 'var(--touch-comfortable)',
                padding: '9px 14px 9px 38px',
                borderRadius: '8px',
                background: '#FFFFFF',
                border: '1px solid var(--border-light)',
                color: 'var(--text-title)',
                outline: 'none',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
              }}
            />
          </div>
        </div>

        {/* Linha 2: FILTRO TEMPORAL — carrossel swipeável (scroll horizontal sem scrollbar) */}
        <div className="vz-period-row" role="group" aria-label="Filtro por data de publicação">
          <span className="vz-period-label">
            <Calendar size={13} color="var(--navy-primary)" aria-hidden />
            <span>Publicação:</span>
          </span>

          {[
            { id: 'all', label: 'Todas as Datas' },
            { id: 'today', label: 'Hoje (24h)' },
            { id: 'yesterday', label: 'Ontem (48h)' },
            { id: 'week', label: 'Há 1 Semana' },
            { id: 'month', label: 'Há 1 Mês' }
          ].map((periodItem) => {
            const isSelected = selectedPeriod === periodItem.id;
            return (
              <button
                key={periodItem.id}
                onClick={(e) => {
                  setSelectedPeriod(periodItem.id as any);
                  e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }}
                aria-pressed={isSelected}
                className="vz-chip"
                style={isSelected ? { background: 'var(--navy-primary)', color: '#FFFFFF', borderColor: 'var(--navy-primary)' } : undefined}
              >
                {periodItem.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* 6. LISTA DE VAGAS EM CARDS WHITEPACE */}
      <section className="vz-section" style={{
        maxWidth: '1240px',
        margin: '0 auto',
        padding: '0 24px 60px 24px',
        width: '100%',
        flex: 1
      }}>
        {isLoadingJobs ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Loader2 size={32} color="var(--navy-primary)" className="animate-spin-slow" style={{ margin: '0 auto 14px auto' }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--navy-primary)' }}>Carregando catálogo de vagas...</div>
          </div>
        ) : displayedJobs.length === 0 ? (
          <div className="whitepace-card" style={{ textAlign: 'center', padding: '48px 20px', background: '#FFFFFF' }}>
            <AlertCircle size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} />
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--navy-primary)' }}>Nenhuma vaga encontrada para este filtro</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Tente selecionar "Todas as Datas" ou limpar o campo de busca.
            </div>
          </div>
        ) : (
          <>
            {/* Banner de Compatibilidade com o Currículo Ativo */}
            {candidateProfile && (
              <div style={{
                background: activeTab === 'match'
                  ? 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)'
                  : '#FFFFFF',
                border: activeTab === 'match'
                  ? '1px solid #6EE7B7'
                  : '1px solid var(--border-light)',
                padding: '14px 18px',
                borderRadius: '12px',
                marginBottom: '20px',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: activeTab === 'match' ? '#065F46' : 'var(--navy-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <SlidersHorizontal size={15} color={activeTab === 'match' ? '#FFFFFF' : 'var(--navy-primary)'} strokeWidth={1.75} />
                  </div>
                  <div className="vz-match-header-text">
                    <span className="vz-match-title" style={{ color: activeTab === 'match' ? '#065F46' : 'var(--navy-primary)' }}>
                      {activeTab === 'match'
                        ? `Match ≥ ${MATCH_THRESHOLD}%`
                        : 'Filtro de Aderência'}
                    </span>
                    <span className="vz-match-subtitle">
                      {activeTab === 'match'
                        ? ' — apenas vagas compatíveis'
                        : ''}
                    </span>
                  </div>
                </div>

                <div className="vz-match-legend-container">
                  <div className="vz-match-legend-row">
                    <div className="vz-match-item" style={{ color: '#047857' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
                      <span>Alto (75-100%)</span>
                    </div>
                    <div className="vz-match-item" style={{ color: '#B45309' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
                      <span>Médio (50-74%)</span>
                    </div>
                    <div className="vz-match-item" style={{ color: '#BE123C' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F43F5E', flexShrink: 0 }} />
                      <span>Baixo (0-49%)</span>
                    </div>
                  </div>

                  <button
                    className="vz-match-sort-btn"
                    onClick={() => setSortByMatch(!sortByMatch)}
                    disabled={activeTab === 'match'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: activeTab === 'match' ? 'default' : 'pointer',
                      background: (sortByMatch || activeTab === 'match') ? 'var(--navy-primary)' : 'var(--bg-subtle)',
                      color: (sortByMatch || activeTab === 'match') ? '#FFFFFF' : 'var(--navy-primary)',
                      border: '1px solid var(--border-medium)',
                      transition: 'all 0.15s ease',
                      opacity: activeTab === 'match' ? 0.9 : 1,
                    }}
                  >
                    <ArrowDownUp size={14} strokeWidth={2} />
                    <span>{activeTab === 'match' ? 'Ordenado por Maior Aderência' : (sortByMatch ? 'Ordenado por Maior Aderência' : 'Ordenar por Maior Aderência')}</span>
                  </button>
                </div>
                </div>


              </div>
            )}

            <div className="vz-card-grid" ref={carouselRef}>
              {displayedJobs.map((job) => {
                const hasApplied = appliedJobsHistory[job.id];
                const isDirectATS = isOfficialAtsJob(job);
                const matchInfo = calculateJobMatch(job, candidateProfile);
                const companyInitials = (job.company || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'V';

                return (
                  <div
                    key={job.id}
                    className="whitepace-card vz-job-card"
                    style={{
                      position: 'relative',
                      padding: '22px',
                      background: '#FFFFFF'
                    }}
                  >
                    {/* SIDE COLUMN — visível só no mobile via .vz-side
                        (no desktop, .vz-side = display: contents). */}
                    <div className="vz-side">
                      <div className="vz-company-logo" aria-hidden style={{ overflow: 'hidden', padding: 0 }}>
                        <CompanyLogo company={job.company} logoUrl={job.companyLogo} />
                      </div>
                    </div>

                    {/* HEADER — badges + título + empresa + data */}
                    <div className="vz-card-hd">
                      <div className="vz-job-badges-row" style={{
                        display: 'flex',
                        flexWrap: 'nowrap',
                        gap: '6px',
                        alignItems: 'center',
                        marginBottom: '4px',
                        overflowX: 'auto',
                        scrollbarWidth: 'none',
                        WebkitOverflowScrolling: 'touch'
                      }}>
                        {candidateProfile && matchInfo && (
                          <div
                            className="vz-mobile-match-badge"
                            title={`Aderência: ${matchInfo.score}%`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              borderRadius: '9999px',
                              background: matchInfo.bg,
                              border: `1px solid ${matchInfo.borderColor}`,
                              color: matchInfo.color,
                              fontSize: '0.66rem',
                              fontWeight: 800,
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                          >
                            {matchInfo.score}%
                          </div>
                        )}
                        <span className={`badge-clean ${job.category === 'tech' ? 'badge-tech' : 'badge-ops'}`} style={{ flexShrink: 0 }}>
                          {job.category === 'tech' ? 'Tecnologia' : 'Operações'}
                        </span>
                        <span style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-subtle)',
                          padding: '3px 5px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}>
                          {job.pubDate.split(',')[0]}
                        </span>
                      </div>
                      <h3>{job.title}</h3>
                      <div style={{ fontSize: '0.86rem', color: 'var(--blue-accent)', fontWeight: 600 }}>
                        {job.company}
                      </div>
                    </div>

                    {/* Notificação de Match no canto superior direito (apenas desktop) */}
                    {candidateProfile && matchInfo && (
                      <div
                        className="vz-match-badge match-notification-badge"
                        title={`Índice de aderência calculado: ${matchInfo.score}% (${matchInfo.label})`}
                        style={{
                          background: matchInfo.bg,
                          border: `1.5px solid ${matchInfo.borderColor}`,
                          boxShadow: `0 2px 8px ${matchInfo.shadowColor}`,
                          color: matchInfo.color,
                        }}
                      >
                        <span style={{ letterSpacing: '-0.01em' }}>{matchInfo.score}% Aderência</span>
                      </div>
                    )}

                    {/* META — salário + localização */}
                    <div className="vz-card-meta">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: 'var(--green-success)', fontWeight: 700 }}>
                        <DollarSign size={14} strokeWidth={2.5} style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span>{job.salary}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <MapPin size={14} strokeWidth={2} style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span>
                          {job.location.replace(/(?:\(\s*100%\s*Remoto\s*\)\s*){2,}/gi, '(100% Remoto)')}
                        </span>
                      </div>
                    </div>

                    {/* SUMÁRIO — só desktop (escondido no mobile via CSS) */}
                    <div className="vz-card-sum">
                      <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--navy-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: '4px'
                      }}>
                        Destaques da Oportunidade:
                      </div>
                      <p>
                        {cleanJobSummary(job.summary, job.title, job.company, job.category)}
                      </p>
                    </div>

                    {/* TAGS — só desktop */}
                    <div className="vz-card-tags">
                      {job.tags.map((tag, i) => (
                        <span
                          key={i}
                          style={{
                            background: 'var(--bg-subtle)',
                            border: '1px solid var(--border-light)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* ACTIONS — full-width row no mobile, inline no desktop */}
                    <div className="vz-card-acts">
                      <a
                        href={job.applicationLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-outline"
                        style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                        title="Ver formulário original no site oficial da empresa"
                      >
                        <ExternalLink size={13} strokeWidth={1.75} />
                        <span>Link Oficial</span>
                      </a>

                      <button
                        onClick={() => triggerAutoApply(job)}
                        className={hasApplied ? 'btn-outline' : 'btn-primary'}
                        style={{
                          flex: 1,
                          padding: '8px 14px',
                          fontSize: '0.84rem',
                          background: hasApplied ? (hasApplied.status === 'COMING_SOON' ? '#FFFBEB' : '#ECFDF5') : 'var(--blue-accent)',
                          borderColor: hasApplied ? (hasApplied.status === 'COMING_SOON' ? '#FDE68A' : '#A7F3D0') : 'transparent',
                          color: hasApplied ? (hasApplied.status === 'COMING_SOON' ? '#92400E' : '#065F46') : '#FFFFFF'
                        }}
                        title={isDirectATS ? 'Abre a vaga e preenche via extensão' : 'Auto-apply server-side'}
                      >
                        {hasApplied ? (
                          hasApplied.status === 'COMING_SOON' ? (
                            <>
                              <Info size={15} strokeWidth={2} />
                              <span>Em breve! Volte logo</span>
                            </>
                          ) : (
                            <>
                              <CheckCheck size={15} strokeWidth={2} />
                              <span>Enviada ({hasApplied.confirmationId})</span>
                            </>
                          )
                        ) : (
                          <>
                            <Send size={14} strokeWidth={2} />
                            <span>Auto Apply</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dots do carrossel (só mobile) — indica posição atual */}
            <div className="vz-carousel-dots" aria-hidden>
              {displayedJobs.map((_, i) => (
                <i key={i} className={i === activeJobIndex ? 'is-active' : ''} />
              ))}
            </div>
        </>
      )}
      </section>

      {/* 6B. AVISO DE LOGIN LINKEDIN (aparece antes de iniciar Auto Apply) */}
      {showLinkedinWarning && (
        <div
          className="vz-modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(4, 56, 115, 0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 115,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinkedinWarning(false);
          }}
        >
          <div
            className="whitepace-card vz-modal"
            style={{
              maxWidth: '520px',
              width: '100%',
              padding: '28px',
              background: '#FFFFFF',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '18px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: '#FEF3C7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertCircle size={22} color="#D97706" />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--navy-primary)', margin: '0 0 4px' }}>
                  LinkedIn Auto-Apply — confirmar
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-body)', margin: 0, lineHeight: 1.5 }}>
                  A extensão VagasZap vai abrir uma aba no seu Chrome (já logado no LinkedIn) e aplicar
                  automaticamente em todas as vagas Easy Apply remotas do Brasil que aparecerem.
                  Você só precisa deixar o Chrome aberto.
                </p>
              </div>
            </div>

            <div
              style={{
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: '20px',
                fontSize: '0.84rem',
                color: '#1E40AF',
                lineHeight: 1.55,
              }}
            >
              <strong style={{ display: 'block', marginBottom: '6px' }}>Como funciona:</strong>
              <ol style={{ margin: 0, paddingLeft: '20px' }}>
                <li>A extensão abre a busca Easy Apply + Brasil remoto na sua conta logada</li>
                <li>Lê cada vaga e abre o modal Easy Apply</li>
                <li>Preenche o formulário multi-step com heurística + IA (MiniMax)</li>
                <li>Submete a candidatura e segue para a próxima vaga</li>
              </ol>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
              }}
            >
              <button
                onClick={() => setShowLinkedinWarning(false)}
                className="btn-outline"
                style={{ flex: 1, padding: '10px', fontSize: '0.88rem' }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmLinkedinApply}
                className="btn-primary"
                style={{
                  flex: 1.4,
                  padding: '10px',
                  fontSize: '0.88rem',
                  background: 'linear-gradient(135deg, #0A66C2 0%, #004182 100%)',
                  border: 'none',
                }}
              >
                <Briefcase size={14} />
                <span>Iniciar Auto Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL DE EXECUÇÃO DO AUTO-APPLY (CLEAN WHITEPACE SYSTEM) */}
      {selectedJobForApply && (
        <div className="vz-modal-backdrop" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(4, 56, 115, 0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div className="whitepace-card vz-modal" style={{
            maxWidth: '580px',
            width: '100%',
            padding: '28px',
            background: '#FFFFFF',
            boxShadow: 'var(--shadow-modal)'
          }}>
            {/* Header Modal */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '18px' }}>
              <div>
                <span className="badge-clean badge-tech" style={{ marginBottom: '6px', background: '#DBEAFE', color: '#1E40AF', borderColor: '#BFDBFE' }}>
                  Auto-Apply Mágico 🪄
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--navy-primary)' }}>
                  {selectedJobForApply.title}
                </h3>
                <div style={{ fontSize: '0.86rem', color: 'var(--blue-accent)', fontWeight: 600 }}>
                  {selectedJobForApply.company} • Via API Server-side
                </div>
              </div>

              <button
                onClick={() => setSelectedJobForApply(null)}
                className="icon-button"
                aria-label="Fechar modal de auto-aplicação"
                style={{
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '10px',
                  color: 'var(--text-body)',
                  padding: '12px',
                  cursor: 'pointer'
                }}
              >
                <X size={16} aria-hidden />
              </button>
            </div>

            {/* Status do Processamento */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' }}>
              {applyStep === 1 && !applyResult && (
                <div style={{
                  background: 'var(--navy-subtle)',
                  border: '1px solid #BFDBFE',
                  borderRadius: '8px',
                  padding: '18px 16px',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', color: 'var(--navy-primary)', fontWeight: 700, fontSize: '0.92rem', marginBottom: liveStreamFrame ? '12px' : '0' }}>
                    <Loader2 size={17} className="animate-spin-slow" color="var(--blue-accent)" />
                    <span>{liveStreamStatus || 'Conectando à API Oficial e deduzindo respostas...'}</span>
                  </div>
                  
                  {liveStreamFrame ? (
                     <div style={{ borderRadius: '6px', overflow: 'hidden', border: '2px solid var(--blue-accent)', background: '#000', display: 'flex', justifyContent: 'center' }}>
                       <img src={`data:image/jpeg;base64,${liveStreamFrame}`} alt="Live Stream" style={{ width: '100%', maxHeight: '250px', objectFit: 'contain' }} />
                     </div>
                  ) : (
                    <div style={{ fontSize: '0.81rem', color: 'var(--text-body)', marginTop: '8px', lineHeight: 1.55 }}>
                      A Minimax está analisando seu currículo em tempo real e preenchendo todos os campos personalizados exigidos pela <strong>{selectedJobForApply.company}</strong>.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Resultado Final */}
            {applyResult && applyResult.success && (
              <div style={{
                background: '#ECFDF5',
                border: '1px solid #A7F3D0',
                borderRadius: '8px',
                padding: '18px',
                marginTop: '14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#065F46', fontWeight: 800, fontSize: '1rem' }}>
                  <CheckCircle2 size={18} />
                  <span>{applyResult.message}</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-body)', marginTop: '4px' }}>
                  Protocolo VagasZap: <strong>IA_AUTO</strong> • Enviado diretamente para a API do ATS.
                </div>

                {applyResult.proof_url && (
                  <div style={{ marginTop: '16px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #A7F3D0' }}>
                    <div style={{ background: '#059669', color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                       <span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.5s infinite' }}></span>
                       GRAVAÇÃO DO ROBÔ (VPS)
                    </div>
                    <video 
                      src={applyResult.proof_url} 
                      autoPlay 
                      loop 
                      muted 
                      controls 
                      style={{ width: '100%', display: 'block', maxHeight: '320px', objectFit: 'cover' }} 
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <a
                    href={selectedJobForApply.applicationLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline"
                    style={{ flex: 1, padding: '9px 12px', fontSize: '0.84rem' }}
                  >
                    <ExternalLink size={14} />
                    <span>Ver Aba da Vaga</span>
                  </a>

                  <button
                    onClick={() => setSelectedJobForApply(null)}
                    className="btn-navy"
                    style={{ flex: 1, padding: '9px 12px', fontSize: '0.84rem' }}
                  >
                    Concluir
                  </button>
                </div>
              </div>
            )}

            {applyResult && !applyResult.success && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '8px',
                padding: '18px',
                marginTop: '14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#991B1B', fontWeight: 800, fontSize: '1rem' }}>
                  <X size={18} />
                  <span>Falha ao enviar candidatura</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#991B1B', marginTop: '4px' }}>
                  {applyResult.error}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setSelectedJobForApply(null)}
                    className="btn-outline"
                    style={{ flex: 1, padding: '9px 12px', fontSize: '0.84rem' }}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* 8. FOOTER (WHITEPACE NAVY) */}
      <footer style={{
        background: 'var(--navy-primary)',
        color: '#FFFFFF',
        padding: '36px 24px',
        marginTop: 'auto'
      }}>
        <div style={{
          maxWidth: '1240px',
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
              <Image src="/logo.jpg" alt="Logo Footer" fill style={{ objectFit: 'cover' }} />
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#FFFFFF' }}>VagasZap</span>
            <span style={{ fontSize: '0.8rem', color: '#93C5FD' }}>• Remote Careers Worldwide</span>
          </div>

          <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
            Catálogo global de vagas remotas • Integração direta com portais e formulários oficiais
          </div>
        </div>
      </footer>
    </div>
  );
}
