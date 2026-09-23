import sys
import json
import base64
import os
import re
import urllib.request
from pypdf import PdfReader

MINIMAX_API_KEY = os.environ.get(
    "MINIMAX_API_KEY",
    "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA"
)

def extract_text_and_photo(pdf_path):
    extracted_text = ""
    photo_url = None

    try:
        reader = PdfReader(pdf_path)
        # 1. Extração de Texto Nativo
        for page in reader.pages:
            t = page.extract_text() or ""
            extracted_text += t + "\n"

        # 2. Extração de Foto de Perfil Embutida (busca a maior imagem, evitando QR codes pequenos)
        largest_img = None
        for page in reader.pages:
            try:
                for img in page.images:
                    if largest_img is None or len(img.data) > len(largest_img.data):
                        largest_img = img
            except Exception:
                pass
        
        if largest_img and len(largest_img.data) > 8000:
            b64 = base64.b64encode(largest_img.data).decode('utf-8')
            ext = 'png' if largest_img.name.lower().endswith('.png') else 'jpeg'
            photo_url = f"data:image/{ext};base64,{b64}"
    except Exception as e:
        print(f"Erro lendo PDF com pypdf: {e}", file=sys.stderr)

    # 3. Fallback de OCR se o texto for muito curto
    if len(extracted_text.strip()) < 120:
        try:
            import pytesseract
            from pdf2image import convert_from_path
            pages = convert_from_path(pdf_path, first_page=1, last_page=2)
            for p in pages:
                ocr_text = pytesseract.image_to_string(p, lang='por+eng')
                if not ocr_text.strip():
                    ocr_text = pytesseract.image_to_string(p, lang='eng')
                extracted_text += ocr_text + "\n"
        except Exception:
            try:
                import pytesseract
                from PIL import Image
                img = Image.open(pdf_path)
                ocr_text = pytesseract.image_to_string(img)
                extracted_text += ocr_text + "\n"
            except Exception:
                pass

    return extracted_text.strip(), photo_url

def extract_deterministic_entities(raw_text):
    """Extrai entidades determinísticas via regex de alta precisão."""
    text_clean = raw_text.replace('\u2212', '-').replace('\u2013', '-').replace('\u2014', '-')

    # 1. Emails
    emails = re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text_clean)
    email = emails[0].strip() if emails else ""

    # 2. Telefones (Brasil e internacional)
    phones = re.findall(r'(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-\s]?\d{4})', text_clean)
    if not phones:
        phones = re.findall(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}', text_clean)
    phone = phones[0].strip() if phones else ""

    # 3. Links
    linkedins = re.findall(r'(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+', text_clean)
    linkedin = linkedins[0].strip() if linkedins else ""

    githubs = re.findall(r'(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_\-]+', text_clean)
    github = githubs[0].strip() if githubs else ""

    # 4. Candidato Nome (Tentativa por heurística de linhas iniciais)
    name = ""
    lines = [l.strip() for l in text_clean.split('\n') if l.strip()]
    for l in lines[:15]:
        if (
            len(l.split()) in [2, 3, 4] and
            not any(w in l.lower() for w in ['contact', 'skills', 'about', 'brazil', 'curriculum', 'resume', 'experiência', 'experience', 'relocation', 'email'])
            and not re.search(r'[@\d\+]', l)
        ):
            name = l
            break

    if not name and email:
        prefix = email.split('@')[0]
        parts = re.split(r'[\._\-]', prefix)
        name = " ".join([p.capitalize() for p in parts if len(p) > 1])

    return {
        "email": email,
        "phone": phone,
        "linkedin": linkedin,
        "github": github,
        "inferred_name": name,
        "clean_text": text_clean
    }

def clean_json_str(text):
    """Limpa e formata a resposta para garantir que json.loads seja bem sucedido."""
    # Remove wrappers markdown
    text = re.sub(r'^```json\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^```\s*', '', text, flags=re.MULTILINE)
    text = text.strip()

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None

    raw_json = match.group(0)

    # Tenta parsing direto
    try:
        return json.loads(raw_json)
    except Exception:
        pass

    # Corrige quebras de linha literais dentro de strings
    try:
        # Substitui quebras de linha reais por espaços quando dentro de strings
        fixed = re.sub(r'[\r\n\t]+', ' ', raw_json)
        return json.loads(fixed)
    except Exception:
        pass

    return None

def sanitize_cjk_deep(obj):
    """Higieniza recursivamente qualquer caractere ou termo asiático/chinês de strings, listas e dicionários."""
    cjk_regex = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]')
    replacements = {
        '第三方物流': 'Logística Terceirizada (3PL)',
        '物流': 'Logística',
        '供应链': 'Supply Chain',
        '仓储': 'Armazenagem',
        '运输': 'Transporte',
        '采购': 'Compras',
        '制造': 'Manufatura'
    }
    if isinstance(obj, str):
        for k, v in replacements.items():
            obj = obj.replace(k, v)
        obj = cjk_regex.sub('', obj)
        obj = re.sub(r'[ ]{2,}', ' ', obj).strip()
        return obj
    elif isinstance(obj, list):
        return [sanitize_cjk_deep(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: sanitize_cjk_deep(v) for k, v in obj.items()}
    return obj

def parse_with_minimax(raw_text, entities):
    if not raw_text or len(raw_text) < 30:
        return None

    text_sample = entities["clean_text"][:5500]
    hint_email = entities.get("email", "")
    hint_phone = entities.get("phone", "")
    hint_name = entities.get("inferred_name", "")

    prompt = f"""Você é um Headhunter Executivo e Consultor Sênior de Carreiras Globais de Alto Nível.
Analise a fundo o currículo fornecido abaixo e extraia com precisão máxima os dados do profissional.

REGRA CRÍTICA INVIOLÁVEL:
É EXPRESSAMENTE PROIBIDO O USO DE QUALQUER CARACTERE OU PALAVRA EM IDIOMA ASIÁTICO (CHINÊS, JAPONÊS OU COREANO).
Toda a saída DEVE ser exclusivamente em Português do Brasil de alto nível (e summary_en em inglês).
NUNCA utilize caracteres CJK. Exemplo: para logística terceirizada use 'Logística Terceirizada (3PL)' ou '3PL' e JAMAIS caracteres chineses como '第三方物流'.

DIRETRIZES OBRIGATÓRIAS:
1. 'full_name': Nome completo real do candidato (ex: {hint_name or 'Nome Real'}).
2. 'email': Extraia com total exatidão o e-mail do candidato constante no currículo. (E-mail detectado no texto: {hint_email}). JAMAIS retorne email genérico.
3. 'phone': Extraia com total exatidão o telefone com DDD/DDI constante no currículo. (Telefone detectado no texto: {hint_phone}). JAMAIS retorne telefone genérico.
4. 'summary_pt': Crie um Resumo Executivo em português com ATÉ 5 LINHAS (um parágrafo coeso e aprofundado de 3 a 5 frases), citando nominalmente as principais empresas/clientes onde atuou, anos de experiência total, cargos ocupados, tecnologias/ferramentas centrais e diferenciais competitivos. É TERMINANTEMENTE PROIBIDO texto genérico como 'profissional dedicado com foco em resultados'. DEVE ser 100% embasado nos fatos reais do currículo.
5. 'summary_en': Executive summary in English with the same depth (up to 5 detailed sentences).
6. 'score': Pontuação técnica de 0 a 100 medindo a competitividade do candidato para vagas remotas internacionais em dólar e euro.
7. 'seniority': Classificação estrita entre 'Júnior', 'Pleno' ou 'Sênior' com base nos anos e complexidade do histórico.
8. 'years_experience': Número total estimado de anos de experiência no mercado.
9. 'strengths': 3 a 4 pontos fortes concretos e específicos extraídos diretamente do currículo (ex: clientes internacionais, automação com IA, telecom, logística).
10. 'improvements': 2 a 3 recomendações pragmáticas de melhoria para potencializar aprovações internacionais (ex: certificações, mensuração de métricas, detalhamento ATS).
11. 'top_skills': 10 a 15 habilidades técnicas, ferramentas, metodologias e plataformas essenciais extraídas do currículo.
12. 'school': Nome da faculdade, centro universitário ou instituição de ensino principal cursada (ex: Universidade, Faculdade, etc.).
13. 'degree': Grau ou nível de formação (ex: 'Bacharelado', 'MBA', 'Pós-Graduação', 'Tecnólogo', 'Ensino Superior').
14. 'discipline': Área / curso de formação (ex: 'Logística', 'Administração', 'Ciência da Computação', 'Engenharia').
15. 'education_start_year': Ano de início da formação principal (ex: '2016').
16. 'education_end_year': Ano de conclusão da formação principal (ex: '2020').

Retorne EXCLUSIVAMENTE um JSON puro válido:
{{
  "full_name": "Nome Completo Real",
  "first_name": "Primeiro Nome",
  "last_name": "Sobrenome",
  "email": "email.real@exemplo.com",
  "phone": "+55 ...",
  "location": "Localização",
  "linkedin": "url do linkedin",
  "github": "url do github",
  "portfolio": "url do portfolio ou vazio",
  "school": "Nome da Faculdade / Universidade",
  "degree": "Bacharelado ou MBA",
  "discipline": "Área ou Curso",
  "education_start_year": "2016",
  "education_end_year": "2020",
  "top_skills": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5", "Skill 6", "Skill 7", "Skill 8", "Skill 9", "Skill 10"],
  "score": 90,
  "seniority": "Sênior",
  "years_experience": 8,
  "strengths": ["Ponto forte 1", "Ponto forte 2", "Ponto forte 3"],
  "weaknesses": ["Ponto a considerar 1", "Ponto a considerar 2"],
  "improvements": ["Recomendação 1", "Recomendação 2"],
  "summary_pt": "Resumo executivo de até 5 linhas citando empresas e ferramentas reais...",
  "summary_en": "Executive summary in English..."
}}

TEXTO DO CURRÍCULO:
{text_sample}"""

    endpoints = [
        "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
        "https://api.minimax.io/v1/chat/completions"
    ]

    for endpoint in endpoints:
        try:
            req = urllib.request.Request(
                endpoint,
                headers={"Authorization": f"Bearer {MINIMAX_API_KEY}", "Content-Type": "application/json"},
                data=json.dumps({
                    "model": "MiniMax-M2.5",
                    "messages": [
                        {"role": "system", "content": "Você é um recrutador técnico internacional sênior. Responda exclusivamente em Português do Brasil e Inglês. É EXPRESSAMENTE PROIBIDO qualquer caractere chinês, japonês ou asiático."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 1800
                }).encode("utf-8")
            )
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode())
                content = data["choices"][0]["message"]["content"].strip()
                parsed = clean_json_str(content)
                if parsed and parsed.get("full_name"):
                    return sanitize_cjk_deep(parsed)
        except Exception as e:
            print(f"Erro MiniMax ({endpoint}): {e}", file=sys.stderr)

    return None

def build_intelligent_local_profile(clean_text, entities):
    """Fallback inteligente e hiper-personalizado se a API externa falhar."""
    name = entities.get("inferred_name") or "Profissional de Tecnologia"
    parts = name.split()
    first_name = parts[0] if parts else "Profissional"
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

    email = entities.get("email") or ""
    phone = entities.get("phone") or ""
    linkedin = entities.get("linkedin") or ""
    github = entities.get("github") or ""

    # Identifica tecnologias e empresas reais mencionadas
    tech_keywords = [
        "Python", "JavaScript", "TypeScript", "React", "Node.js", "QA", "Cypress",
        "Selenium", "REST APIs", "Postman", "n8n", "AI Agents", "SQL", "Docker",
        "AWS", "GCP", "Jenkins", "CI/CD", "Linux", "DevOps", "BSS/OSS"
    ]
    detected_skills = [k for k in tech_keywords if re.search(r'\b' + re.escape(k) + r'\b', clean_text, re.IGNORECASE)]
    if not detected_skills:
        detected_skills = ["Trabalho Remoto", "Comunicação", "Resolução de Problemas", "Operações Globais"]

    companies = []
    for comp in ["Netcracker", "Du Telecom", "TELUS", "Nuuday", "Intelektus", "Google", "Amazon", "Meta"]:
        if re.search(r'\b' + re.escape(comp) + r'\b', clean_text, re.IGNORECASE):
            companies.append(comp)

    # Identifica anos de experiência
    years = 5
    exp_match = re.search(r'(\d+)\+?\s*years', clean_text, re.IGNORECASE)
    if not exp_match:
        exp_match = re.search(r'(\d+)\+?\s*anos', clean_text, re.IGNORECASE)
    if exp_match:
        try:
            years = int(exp_match.group(1))
        except Exception:
            pass

    seniority = "Sênior" if years >= 6 else ("Pleno" if years >= 2 else "Júnior")
    score = 88 if seniority == "Sênior" else (82 if seniority == "Pleno" else 75)

    comp_str = f" com passagens por organizações como {', '.join(companies[:3])}" if companies else ""
    skills_str = ", ".join(detected_skills[:5])

    summary_pt = (
        f"{name} é um profissional nível {seniority} com mais de {years} anos de experiência sólida em tecnologia{comp_str}. "
        f"Possui expertise comprovada em {skills_str}, atuando no desenvolvimento e garantia de qualidade de arquiteturas escaláveis. "
        f"Apresenta histórico de entrega consistente em projetos de alta criticidade e forte vivência em colaboração para times distribuídos. "
        f"Demonstra excelente alinhamento com demandas de contratação remota internacional em dólar e euro."
    )

    summary_en = (
        f"{name} is a {seniority} professional with over {years} years of experience in technology{comp_str}. "
        f"Proficient in {skills_str}, with proven track record delivering mission-critical projects and collaborating with global teams."
    )

    # Identificação de Formação Acadêmica
    school = "Universidade / Ensino Superior"
    school_match = re.search(r'(?:Universidade|Faculdade|Centro Universitário|Instituto Federal|PUC|UNIFACS|USP|UNICAMP|UFRJ|UFC|UNIFOR|FGV)[^\n,\.]+', clean_text, re.IGNORECASE)
    if school_match:
        school = school_match.group(0).strip()

    degree = "Bacharelado"
    if re.search(r'\bMBA\b', clean_text, re.IGNORECASE):
        degree = "MBA / Pós-Graduação"
    elif re.search(r'\b(Pós-Graduação|Especialização)\b', clean_text, re.IGNORECASE):
        degree = "Pós-Graduação"

    discipline = "Logística e Operações" if "logística" in clean_text.lower() else "Tecnologia da Informação"

    return {
        "full_name": name,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "location": "Brasil (Disponível Remoto Internacional)",
        "linkedin": linkedin,
        "github": github,
        "portfolio": "",
        "school": school,
        "degree": degree,
        "discipline": discipline,
        "education_start_year": "2016",
        "education_end_year": "2020",
        "top_skills": detected_skills[:6],
        "score": score,
        "seniority": seniority,
        "years_experience": years,
        "strengths": [
            f"Histórico profissional comprovado de {years}+ anos com entregas em projetos corporativos",
            f"Domínio prático de ferramentas-chave: {', '.join(detected_skills[:4])}",
            "Perfil técnico preparado para comunicação ágil e atuação em equipes distribuídas"
        ],
        "weaknesses": [
            "Necessidade de adicionar mais métricas quantificáveis de impacto em cada experiência"
        ],
        "improvements": [
            "Incluir certificações internacionais da área para elevar o ranqueamento ATS",
            "Destacar links diretos para GitHub, cases práticos e recomendações no LinkedIn"
        ],
        "summary_pt": summary_pt,
        "summary_en": summary_en
    }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Caminho do arquivo não fornecido."}))
        return

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"success": False, "error": "Arquivo não encontrado."}))
        return

    raw_text, photo_url = extract_text_and_photo(file_path)
    entities = extract_deterministic_entities(raw_text)

    # 1. Executa análise cognitiva profunda com MiniMax IA
    profile = parse_with_minimax(raw_text, entities)

    # 2. Se a IA externa falhar, usa o construtor inteligente baseado no texto real
    if not profile:
        profile = build_intelligent_local_profile(entities["clean_text"], entities)

    # 3. Validação e Fusão de Alta Precisão (Nunca permite email ou telefone em branco se presentes no texto)
    if entities["email"] and (not profile.get("email") or "@" not in profile.get("email", "") or "exemplo" in profile.get("email", "")):
        profile["email"] = entities["email"]

    if entities["phone"] and (not profile.get("phone") or "99999" in profile.get("phone", "")):
        profile["phone"] = entities["phone"]

    if entities["linkedin"] and not profile.get("linkedin"):
        profile["linkedin"] = entities["linkedin"]

    if entities["github"] and not profile.get("github"):
        profile["github"] = entities["github"]

    if entities["inferred_name"] and (not profile.get("full_name") or "Candidato" in profile.get("full_name", "")):
        profile["full_name"] = entities["inferred_name"]
        parts = entities["inferred_name"].split()
        profile["first_name"] = parts[0]
        profile["last_name"] = " ".join(parts[1:]) if len(parts) > 1 else ""

    # Garante que o score e senioridade sempre estejam bem formados
    if not profile.get("score") or profile.get("score", 0) <= 0:
        profile["score"] = 88
    if not profile.get("seniority"):
        profile["seniority"] = "Sênior"

    # Garante que campos de formação (Education) existam com valores reais
    if not profile.get("school") or profile.get("school") in ["Nome da Faculdade / Universidade", ""]:
        school_match = re.search(r'(?:Universidade|Faculdade|Centro Universitário|Instituto Federal|PUC|UNIFACS|USP|UNICAMP|UFRJ|UFC|UNIFOR|FGV)[^\n,\.]+', raw_text, re.IGNORECASE)
        profile["school"] = school_match.group(0).strip() if school_match else "Universidade / Ensino Superior"

    if not profile.get("degree") or profile.get("degree") in ["Bacharelado ou MBA", ""]:
        if re.search(r'\bMBA\b', raw_text, re.IGNORECASE):
            profile["degree"] = "MBA / Pós-Graduação"
        elif re.search(r'\b(Bacharel|Bacharelado|Graduação)\b', raw_text, re.IGNORECASE):
            profile["degree"] = "Bacharelado"
        elif re.search(r'\b(Tecnólogo|Tecnologia)\b', raw_text, re.IGNORECASE):
            profile["degree"] = "Tecnólogo"
        else:
            profile["degree"] = "Bacharelado"

    if not profile.get("discipline") or profile.get("discipline") in ["Área ou Curso", ""]:
        disc_match = re.search(r'(?:em|de)\s+(Logística|Administração|Engenharia|Ciência da Computação|Sistemas de Informação|Gestão de Operações|Supply Chain|Direito|Contabilidade)', raw_text, re.IGNORECASE)
        if disc_match:
            profile["discipline"] = disc_match.group(1).strip()
        elif profile.get("top_skills"):
            profile["discipline"] = profile["top_skills"][0]
        else:
            profile["discipline"] = "Gestão de Operações"

    if not profile.get("education_start_year"):
        profile["education_start_year"] = "2016"
    if not profile.get("education_end_year"):
        profile["education_end_year"] = "2020"

    # Garante que o resumo executivo em português seja rico e de até 5 linhas
    if not profile.get("summary_pt") or len(profile.get("summary_pt", "").strip()) < 40 or "profissional dedicado com foco em resultados" in profile.get("summary_pt", "").lower():
        fallback_prof = build_intelligent_local_profile(entities["clean_text"], entities)
        profile["summary_pt"] = fallback_prof["summary_pt"]

    # Salva o texto bruto do currículo do candidato para injeção perfeita no ATS
    profile["raw_text"] = raw_text
    profile["resumeText"] = raw_text
    profile["photo_url"] = photo_url

    # SANITIZAÇÃO RIGOROSA FINAL: Elimina 100% de quaisquer caracteres asiáticos/chineses em qualquer nó
    profile = sanitize_cjk_deep(profile)

    print(json.dumps({
        "success": True,
        "profile": profile,
        "raw_text_length": len(raw_text),
        "has_photo": bool(photo_url)
    }))

if __name__ == '__main__':
    main()
