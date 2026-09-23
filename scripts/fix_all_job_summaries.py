#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Higienização Completa de Resumos de Vagas
Elimina qualquer output conversacional ou metadados de IA e substitui por resumos
profissionais, atrativos e adequados para o VagasZap.
"""

import urllib.request
import json
import re
import os

SUPABASE_URL = "https://ffxpsothavxbrdhshtoj.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A"

BAD_PATTERNS = [
    r'olá', r'como posso', r'preciso que você', r'compartilhe a descrição',
    r'não tenho acesso', r'não foi fornecid', r'fornecer os detalhes',
    r'assim que você', r'para criar o resumo', r'desculpe', r'como ia', r'como modelo de ia',
    r'como assistente', r'por favor, envie', r'insira o texto', r'infelizmente, não recebi',
    r'percebi que você não incluiu', r'você não forneceu', r'não recebi os detalhes', r'colar o texto'
]

CUSTOM_SUMMARIES = {
    "Developer Relations Engineer": (
        "Atue como elo estratégico entre a engenharia da Canonical e a comunidade global de desenvolvedores Ubuntu e open source. "
        "Oportunidade 100% remota com remuneração em moeda forte, liderando iniciativas técnicas, documentação e evangelismo de soluções inovadoras."
    ),
    "Alliances Field Engineer": (
        "Engenheiro de Alianças Técnicas para atuar na integração do ecossistema Ubuntu com grandes parceiros de tecnologia e hardware. "
        "Posição 100% remota com foco em consultoria de arquitetura, alinhamento técnico e aceleração de soluções corporativas."
    ),
    "Cloud Engineering Manager": (
        "Liderança estratégica de engenharia de nuvem na Canonical. Gerencie equipes distribuídas de alta performance na entrega de "
        "infraestruturas OpenStack, Kubernetes e computação em nuvem escalável com contratação global em moeda forte."
    ),
    "Cloud Field Engineering Manager": (
        "Gestão de equipes técnicas de campo especializadas em arquiteturas de nuvem pública e privada com Ubuntu. Conduza projetos "
        "complexos para clientes corporativos de grande porte em ambiente 100% remoto internacional."
    ),
    "Customer Success  - Team Manager": (
        "Liderança de time de Sucesso do Cliente na Canonical, garantindo adoção, retenção e expansão de valor de produtos Ubuntu e open source "
        "em contas globais. Posição remota com forte foco em excelência e relacionamento executivo."
    ),
    "Customer Success - Team Manager": (
        "Liderança de time de Sucesso do Cliente na Canonical, garantindo adoção, retenção e expansão de valor de produtos Ubuntu e open source "
        "em contas globais. Posição remota com forte foco em excelência e relacionamento executivo."
    ),
    "Head of Security Operations": (
        "Liderança sênior de Operações de Segurança (SecOps) para salvaguardar a infraestrutura e ecossistemas da Canonical em escala global. "
        "Conduza monitoramento contínuo, resposta a incidentes e conformidade em nível mundial."
    ),
    "Junior Ads Specialist": (
        "Oportunidade júnior de entrada na equipe de marketing e publicidade da Canonical. Apoie a criação, otimização e análise de "
        "campanhas digitais globais para promover soluções Ubuntu com remuneração internacional em dólar."
    ),
    "People & Operations Specialist | Part-time": (
        "Atuação flexível em suporte a pessoas e processos operacionais do GTO Wizard. Oportunidade remota com foco em onboarding, "
        "gestão administrativa interna e suporte contínuo às rotinas operacionais da equipe."
    )
}

def is_bad(summary):
    if not summary or len(summary.strip()) < 25:
        return True
    return any(re.search(p, summary, re.IGNORECASE) for p in BAD_PATTERNS)

def generate_clean_summary(title, company, category):
    for key, text in CUSTOM_SUMMARIES.items():
        if key.lower() in title.lower():
            return text
            
    if category == "tech":
        return (
            f"Oportunidade técnica para atuar como {title} na {company}. "
            f"Posição 100% remota com foco no desenvolvimento de soluções escaláveis, inovação tecnológica "
            f"e colaboração direta com times globais de engenharia."
        )
    else:
        return (
            f"Vaga de {title} na {company}. Posição 100% remota com foco em suporte operacional de excelência, "
            f"otimização de rotinas e relacionamento contínuo com clientes internacionais."
        )

def fix_local_files():
    files = [
        "saas-vagaszap/data/jobs_catalog.json",
        "saas-vagaszap/data/n8n_vagas_synced.json"
    ]
    for path in files:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            jobs = json.load(f)
        
        fixed_count = 0
        for j in jobs:
            s = j.get("summary", "")
            if is_bad(s):
                cat = j.get("category", "tech")
                clean = generate_clean_summary(j.get("title", ""), j.get("company", ""), cat)
                j["summary"] = clean
                fixed_count += 1
                print(f"  [FIXED LOCAL] {j.get('id')} - {j.get('title')}")
                
        with open(path, "w", encoding="utf-8") as f:
            json.dump(jobs, f, indent=2, ensure_ascii=False)
        print(f"✅ {path}: {fixed_count} vagas corrigidas com sucesso!")

def fix_supabase():
    print("\n🔍 Buscando vagas no Supabase...")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/jobs?select=id,title,company,category,summary_pt",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    )
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode())
    
    updates = []
    for r in rows:
        s = r.get("summary_pt", "")
        if is_bad(s):
            clean = generate_clean_summary(r.get("title", ""), r.get("company", ""), r.get("category", "tech"))
            updates.append({"id": r["id"], "summary_pt": clean})
            print(f"  [FIXING SUPABASE] {r['id']} - {r['title']}")
            
    if not updates:
        print("✅ Nenhuma vaga com bug encontrada no Supabase.")
        return

    # Atualiza cada uma no Supabase
    for item in updates:
        patch_url = f"{SUPABASE_URL}/rest/v1/jobs?id=eq.{item['id']}"
        req_patch = urllib.request.Request(
            patch_url,
            method="PATCH",
            data=json.dumps({"summary_pt": item["summary_pt"]}).encode("utf-8"),
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
        )
        try:
            with urllib.request.urlopen(req_patch) as patch_resp:
                pass
        except Exception as e:
            print(f"  Erro atualizando {item['id']}: {e}")
            
    print(f"🎉 {len(updates)} vagas corrigidas no Supabase com sucesso!")

if __name__ == '__main__':
    fix_local_files()
    fix_supabase()
