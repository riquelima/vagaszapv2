const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const { chromium } = require('playwright');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

async function generateAnswersWithMinimax(apiKey, profile, customQuestions) {
  const prompt = `Você é um candidato aplicando para uma vaga. Com base no currículo abaixo, preencha os campos do formulário. 
Responda em JSON puro, onde a chave é o ID ou nome do campo e o valor é a sua resposta.
Seja conciso. Se não tiver certeza, deduza algo profissional e curto.

Currículo:
Nome: ${profile.full_name || profile.first_name + ' ' + profile.last_name}
Email: ${profile.email}
Nível: ${profile.seniority || ''}
Skills: ${profile.top_skills ? profile.top_skills.join(', ') : ''}
Resumo: ${profile.summary_pt || ''}

Campos do formulário (JSON):
${JSON.stringify(customQuestions, null, 2)}`;

  try {
    const res = await axios.post('https://api.minimaxi.chat/v1/text/chatcompletion_v2', {
      model: 'MiniMax-M2.5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = res.data.choices[0].message.content;
    return JSON.parse(content);
  } catch (err) {
    console.error('Erro no Minimax:', err.message);
    return {};
  }
}

app.post('/apply', upload.single('resume'), async (req, res) => {
  const { job_url, profile: profileStr, minimax_key } = req.body;
  if (!job_url || !profileStr || !req.file || !minimax_key) {
    return res.status(400).json({ error: 'Faltam parâmetros.' });
  }
  
  let profile;
  try { profile = JSON.parse(profileStr); } catch(e) { profile = {}; }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    const page = await context.newPage();
    
    console.log(`Navigating to ${job_url}...`);
    await page.goto(job_url, { waitUntil: 'networkidle' });

    await page.waitForSelector('#application_form', { timeout: 10000 }).catch(() => null);

    const fillIfExists = async (selector, value) => {
        if(value) {
            const el = await page.$(selector);
            if(el) {
                await el.evaluate(e => e.value = ''); 
                await el.type(value);
            }
        }
    };

    await fillIfExists('input[name="job_application[first_name]"]', profile.first_name || profile.full_name);
    await fillIfExists('input[name="job_application[last_name]"]', profile.last_name || '.');
    await fillIfExists('input[name="job_application[email]"]', profile.email);
    await fillIfExists('input[name="job_application[phone]"]', profile.phone);
    
    const resumeInput = await page.$('input[name="job_application[answers_attributes][0][resume_attributes][attachment]"], input[type="file"]');
    if(resumeInput) {
        await resumeInput.setInputFiles(req.file.path);
    } else {
        const resumeBtn = await page.$('button[data-source="attach"]');
        if (resumeBtn) {
           const [fileChooser] = await Promise.all([
             page.waitForEvent('filechooser'),
             resumeBtn.click()
           ]);
           await fileChooser.setFiles(req.file.path);
        }
    }

    console.log('Analisando campos customizados...');
    const customFields = [];
    const fields = await page.$$('.custom_question');
    for (const field of fields) {
        const labelEl = await field.$('label');
        let labelText = '';
        if (labelEl) {
           labelText = await labelEl.evaluate(el => el.childNodes[0].textContent.trim());
        }
        
        const input = await field.$('input[type="text"]');
        if (input) {
            const name = await input.getAttribute('name');
            customFields.push({ name, label: labelText, type: 'text' });
            continue;
        }
        
        const select = await field.$('select');
        if (select) {
            const name = await select.getAttribute('name');
            const options = await select.$$eval('option', opts => opts.map(o => o.value).filter(v => v));
            customFields.push({ name, label: labelText, type: 'select', options });
            continue;
        }
        
        const textarea = await field.$('textarea');
        if (textarea) {
            const name = await textarea.getAttribute('name');
            customFields.push({ name, label: labelText, type: 'textarea' });
            continue;
        }
    }

    let aiAnswers = {};
    if (customFields.length > 0) {
        console.log(`Perguntando ao Minimax sobre ${customFields.length} campos...`);
        aiAnswers = await generateAnswersWithMinimax(minimax_key, profile, customFields);
        console.log('Respostas recebidas:', aiAnswers);
        
        for (const field of customFields) {
            const answer = aiAnswers[field.name] || aiAnswers[field.label];
            if (!answer) continue;
            
            if (field.type === 'text' || field.type === 'textarea') {
                await fillIfExists(`[name="${field.name}"]`, answer.toString());
            } else if (field.type === 'select') {
                const select = await page.$(`select[name="${field.name}"]`);
                if (select) {
                    const opts = field.options;
                    let bestMatch = opts[0];
                    for(const o of opts) {
                        if (o.toLowerCase().includes(answer.toString().toLowerCase())) {
                            bestMatch = o;
                            break;
                        }
                    }
                    await select.selectOption({ value: bestMatch });
                }
            }
        }
    }

    console.log('Submetendo formulário...');
    const submitBtn = await page.$('#submit_app');
    if (submitBtn) {
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(()=>null),
            submitBtn.click()
        ]);
        console.log('Formulário submetido!');
    } else {
        console.log('Botão de submit não encontrado.');
    }

    res.json({ success: true, message: 'Candidatura enviada via Headless Browser!' });

  } catch (err) {
    console.error('Erro na automação:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.listen(4000, () => console.log('VPS Worker running on port 4000...'));
