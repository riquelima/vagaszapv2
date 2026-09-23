# Vagas Compatibility Automation

Automação em Python que busca vagas de **Operations** + **Technology** no Supabase
do VagasZap, classifica compatibilidade com o seu perfil usando a **API MiniMax**,
abre cada vaga no **Google Chrome já logado** (via AppleScript), preenche o
formulário de candidatura com o currículo em inglês (`Henrique_Lima_Resume_EN.pdf`)
e **verifica automaticamente** se a submissão foi aceita pelo ATS — gravando
evidência (URL pós-submit, palavras-chave de confirmação, screenshot) em
`applied_jobs.json`.

## Arquitetura

| Arquivo | Função |
|---|---|
| `config.py` | Carrega `.env` e expõe constantes (URL, chave, threshold). |
| `supabase_jobs.py` | Faz `GET` no PostgREST `/jobs?category=in.(tech,operations)`. |
| `profile_loader.py` | Carrega `henrique_master_profile.json` e monta texto para o LLM. |
| `minimax_scorer.py` | Envia cada vaga + perfil à API MiniMax e extrai `score 0-100`. |
| `chrome_applescript.py` | Ponte com Chrome via `osascript`. Inclui **helpers de verificação pós-submit**: `snapshot_page`, `detect_thank_you`, `wait_for_navigation`, `take_screenshot`. |
| `application_tracker.py` | Persiste cada candidatura com **status** + **evidência** (URL, keywords, screenshot). Escrita atômica. |
| `runner.py` | Orquestrador end-to-end (fetch → score → filtra ≥90% → aplica → **verifica** → grava). |

## Status das aplicações

Cada registro em `applied_jobs.json` tem um `status` explícito:

| Status | Significado | Como confirmar |
|---|---|---|
| `submitted` | Submit clicado **e** thank-you page detectada | `evidence.thank_you_url` + `confirmation_keywords_found` |
| `needs_manual_review` | Submit clicado mas sem confirmação clara | revisar `evidence.post_submit_url` e `screenshot_path` |
| `failed` | Erro técnico (página não carregou, exceção, etc.) | `errors[]` |
| `dry_run` | `LIVE_SUBMIT=false` — nada foi clicado | `live_submit: false` |
| `pending` | Estado intermediário, não deve aparecer no arquivo final | — |

## Como funciona a verificação (a parte que dá certeza)

Após o `click_submit()`, o runner executa 3 verificações independentes:

1. **Mudança de URL** — `wait_for_navigation(15s)` confirma que a página mudou
   para fora do formulário (a maioria dos ATS redireciona para uma thank-you page).
2. **Palavras-chave de confirmação** — `detect_thank_you` procura no `innerText`,
   `title` e `url` termos como `"thank you"`, `"application submitted"`,
   `"candidatura enviada"`, etc. (16 keywords, multilíngue).
3. **Screenshot** — `screenshots/<job_id>.png` é capturado via `screencapture`
   para inspeção visual posterior.

O registro só é marcado como `submitted` se **pelo menos uma** das verificações
passou. Caso contrário, vai para `needs_manual_review` com a URL e screenshot
salvos para você decidir.

## Pré-requisitos

- macOS (depende de AppleScript).
- Google Chrome aberto e logado nos portais das vagas (Greenhouse, Lever, etc).
- Python 3.11+ (testado em 3.14).
- Chave MiniMax válida em `.env` (`MINIMAX_API_KEY`).
- O arquivo `Henrique_Lima_Resume_EN.pdf` em `../Henrique_Lima_Resume_EN.pdf`.

## Como rodar

### 1) Dry-run (preenche mas NÃO clica Submit)
```bash
cd "/Users/teste/Documents/Workana Application"
python3 -m vagas_compat_automation.runner
```

### 2) Live (preenche + clica Submit + verifica)
Edite `.env` e mude `LIVE_SUBMIT=false` para `LIVE_SUBMIT=true`, depois rode o mesmo comando.

### 3) Ajustar limite e threshold
No `.env`:
```
COMPAT_THRESHOLD=90
MAX_APPLIES=10
FETCH_LIMIT=80
JOB_CATEGORIES=tech,operations
```

## Fluxo

1. **Fetch**: baixa as 80 vagas mais recentes com `category IN ('tech','operations')`.
2. **Dedup**: remove IDs já terminais (qualquer status) em `applied_jobs.json`.
3. **Score**: chama MiniMax (`/v1/chat/completions`) pedindo JSON
   `{score, reason, matched_skills, missing}`.
4. **Filter**: mantém só `score >= COMPAT_THRESHOLD`.
5. **Apply**: para cada vaga elegível (até `MAX_APPLIES`):
   - `tell application "Google Chrome"` cria nova aba com `application_link`.
   - Aguarda `document.readyState === "complete"`.
   - Preenche campos via `fill_by_label` (First name, Email, Phone, LinkedIn, Cover letter…).
   - Anexa `Henrique_Lima_Resume_EN.pdf` via `fetch('file://...') → File → DataTransfer`.
   - Clica `Submit` (somente se `LIVE_SUBMIT=true`).
   - **Verifica** com `verify_submission` (URL change + keywords + screenshot).
   - Grava em `applied_jobs.json` com status terminal.

## Observações

- Cada chamada LLM custa tokens; o `batch_score` imprime o score por vaga.
- Se a descrição da vaga estiver em português, o prompt já instrui o scorer a
  considerar a senioridade e o stack técnico (não o idioma).
- O preenchimento de formulários é **heurístico** (match por label). Vagas com
  formulários muito customizados podem precisar de extensões por ATS (Greenhouse,
  Lever, Workday). Nesses casos, o `run_js` retorna `LABEL_NOT_FOUND` no log.
- Nenhuma senha é armazenada: o robô depende da sessão já ativa no Chrome.
- **Sempre revise `applied_jobs.json`** após uma rodada live — entradas com
  status `needs_manual_review` precisam de confirmação manual de que a vaga
  foi mesmo enviada (a maioria dos casos é apenas um ATS que não tem thank-you
  page, mas vale checar).
