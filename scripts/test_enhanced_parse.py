import urllib.request
import json
import re
import os
from pypdf import PdfReader

MINIMAX_API_KEY = "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA"

pdf_path = "/Users/teste/Documents/Workana Application/Henrique_Lima_Resume_EN.pdf"
reader = PdfReader(pdf_path)
text = ""
for p in reader.pages:
    text += (p.extract_text() or "") + "\n"

text_clean = text.replace('\u2212', '-').replace('\u2013', '-').replace('\u2014', '-')

# Pre-extract deterministic patterns
emails = re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text_clean)
phones = re.findall(r'(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-\s]?\d{4})', text_clean)
hint_email = emails[0] if emails else ""
hint_phone = phones[0] if phones else ""

prompt = f"""Você é um Headhunter Executivo e Consultor Sênior de Carreiras Internacionais.
Analise a fundo o currículo fornecido abaixo e extraia com precisão absoluta os dados estruturados do candidato.

DIRETRIZES OBRIGATÓRIAS:
1. 'full_name': Nome completo real do profissional (ex: 'Henrique Lima').
2. 'email': Extraia com exatidão o e-mail do candidato constante no currículo. (Dica detectada: {hint_email}). JAMAIS retorne email genérico.
3. 'phone': Extraia com exatidão o telefone com código de área/país constante no currículo. (Dica detectada: {hint_phone}). JAMAIS retorne telefone genérico.
4. 'summary_pt': Crie um Resumo Executivo em português de ATÉ 5 LINHAS detalhado e aprofundado, baseado estritamente na trajetória do candidato. Deve mencionar expressamente: as principais empresas/projetos em que atuou, tempo total de experiência, cargos ocupados, tecnologias/ferramentas centrais e diferenciais competitivos. É TERMINANTEMENTE PROIBIDO texto genérico ou vago como 'profissional dedicado com foco em resultados'.
5. 'summary_en': Executive summary in English with the same depth (up to 5 sentences).
6. 'score': Pontuação técnica de 0 a 100 de acordo com a robustez do perfil para contratação remota internacional.
7. 'seniority': Classificação técnica entre 'Júnior', 'Pleno' ou 'Sênior'.
8. 'strengths': 3 a 4 pontos fortes concretos e específicos extraídos do currículo.
9. 'improvements': 2 a 3 sugestões pragmáticas de melhoria para potencializar a aprovação em processos seletivos internacionais.
10. 'top_skills': 5 a 8 habilidades técnicas e ferramentas principais.

Retorne EXCLUSIVAMENTE um JSON puro válido:
{{
  "full_name": "Nome Completo",
  "first_name": "Primeiro Nome",
  "last_name": "Sobrenome",
  "email": "email@exemplo.com",
  "phone": "+55 11 99999-9999",
  "location": "Localização",
  "linkedin": "url",
  "github": "url",
  "portfolio": "url",
  "top_skills": ["Skill 1", "Skill 2"],
  "score": 88,
  "seniority": "Sênior",
  "years_experience": 10,
  "strengths": ["Ponto 1", "Ponto 2"],
  "weaknesses": ["Ponto fraco 1"],
  "improvements": ["Melhoria 1", "Melhoria 2"],
  "summary_pt": "Resumo detalhado em português com até 5 linhas citando empresas e tecnologias reais...",
  "summary_en": "Detailed executive summary in English..."
}}

TEXTO DO CURRÍCULO:
{text_clean[:5000]}"""

req = urllib.request.Request(
    'https://api.minimaxi.chat/v1/text/chatcompletion_v2',
    headers={'Authorization': f'Bearer {MINIMAX_API_KEY}', 'Content-Type': 'application/json'},
    data=json.dumps({
        'model': 'MiniMax-M2.5',
        'messages': [
            {'role': 'system', 'content': 'Você é um analisador técnico de currículos e ATS. Retorne exclusivamente JSON válido.'},
            {'role': 'user', 'content': prompt}
        ],
        'temperature': 0.1,
        'max_tokens': 1600
    }).encode('utf-8')
)

resp = urllib.request.urlopen(req, timeout=35)
data = json.loads(resp.read().decode())
content = data['choices'][0]['message']['content'].strip()
content_clean = content.replace('```json', '').replace('```', '').strip()
match = re.search(r"\{[\s\S]*\}", content_clean)
if match:
    res = json.loads(match.group(0))
    print("NAME:", res.get("full_name"))
    print("EMAIL:", res.get("email"))
    print("PHONE:", res.get("phone"))
    print("SCORE:", res.get("score"))
    print("SENIORITY:", res.get("seniority"))
    print("\n--- SUMMARY PT (ATÉ 5 LINHAS) ---")
    print(res.get("summary_pt"))
    print("\n--- STRENGTHS ---")
    print(res.get("strengths"))
    print("\n--- IMPROVEMENTS ---")
    print(res.get("improvements"))
