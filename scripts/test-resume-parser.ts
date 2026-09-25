import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import { parseResumeBuffer, MAX_RESUME_BYTES, validateResumeInput } from '../lib/resume-parser';
import { POST } from '../app/api/resume/parse/route';

const originalFetch = globalThis.fetch;
const saved = { ...process.env };
const text = ['Ana Teste', 'ana@example.test', '+55 (11) 91234-5678', 'Cidade: Salvador', 'Desenvolvedora Python SQL', '3 anos de experiencia', 'Trabalho remoto com Slack', 'English intermediario', 'Reduzi custos em 20%', 'linkedin.com/in/ana-teste'];
before(() => {
  for (const key of Object.keys(process.env)) if (/MINIMAX|SUPABASE/.test(key)) delete process.env[key];
  globalThis.fetch = async () => { throw new Error('Rede externa proibida no teste'); };
});
after(() => { globalThis.fetch = originalFetch; process.env = saved; });
async function portrait() {
  const pixels = Buffer.alloc(120 * 160 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + Math.floor(i / 97) * 13) % 256;
  return sharp(pixels, { raw: { width: 120, height: 160, channels: 3 } }).png().toBuffer();
}
async function pdf(lines = text, image?: Buffer, fullPage = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 730 - i * 24, size: 12 }));
  if (image) page.drawImage(await doc.embedPng(image), { x: 400, y: 500, width: fullPage ? 600 : 90, height: fullPage ? 800 : 120 });
  return Buffer.from(await doc.save());
}
async function docx(lines = text, image?: Buffer, fullPage = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${lines.map(l => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}${image ? `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${(fullPage ? 600 : 90) * 12700}" cy="${(fullPage ? 800 : 120) * 12700}"/><a:graphic><a:graphicData><a:blip r:embed="photo"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` : ''}</w:body></w:document>`);
  if (image) {
    zip.file('word/media/photo.png', image);
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="photo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/></Relationships>');
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('PDF Node: texto, contatos, contrato e critérios independentes de autoapply', async () => {
  const result = await parseResumeBuffer(await pdf(), 'CV.PDF');
  assert.equal(result.success, true, result.error);
  const p = result.profile!;
  assert.equal(p.email, 'ana@example.test');
  assert.equal(p.extraction_method, 'local');
  assert.equal(p.raw_text, p.resumeText);
  assert.equal(p.auto_apply_score, 100);
  assert.equal(p.remote_score, 100);
  assert.equal(p.photo_url, null);
  const criteria = p.remote_score_criteria as { evidence: string; points: number; max_points: number }[];
  assert.equal(criteria.reduce((n, c) => n + c.points, 0), p.remote_score);
  for (const c of criteria) assert.ok(!c.evidence || (p.raw_text as string).includes(c.evidence));
  const basic = (await parseResumeBuffer(await pdf(text.slice(0, 5)), 'x.pdf')).profile!;
  assert.equal(basic.auto_apply_score, 100);
  assert.equal(basic.remote_score, 15);
});
test('PDF e DOCX: imagem retrato embutida e tamanho limitado', async () => {
  const image = await portrait();
  for (const [ext, bytes] of [['pdf', await pdf(text, image)], ['docx', await docx(text, image)]] as const) {
    const r = await parseResumeBuffer(bytes, `cv.${ext}`);
    assert.equal(r.success, true, r.error);
    assert.match(String(r.profile!.photo_url), /^data:image\/jpeg;base64,/);
    assert.ok(Buffer.from(String(r.profile!.photo_url).split(',')[1], 'base64').length <= 200 * 1024);
    assert.equal(r.profile!.email, 'ana@example.test');
  }
});
test('Rejeita página inteira e logotipo simples como foto', async () => {
  const image = await portrait();
  const logo = await sharp({ create: { width: 120, height: 160, channels: 3, background: 'red' } }).png().toBuffer();
  for (const [ext, bytes] of [['pdf', await pdf(text, image, true)], ['docx', await docx(text, image, true)], ['pdf', await pdf(text, logo)], ['docx', await docx(text, logo)]] as const) {
    const r = await parseResumeBuffer(bytes, `cv.${ext}`);
    assert.equal(r.success, true);
    assert.equal(r.profile!.photo_url, null);
  }
});
test('Foto corrompida não invalida texto DOCX', async () => {
  const r = await parseResumeBuffer(await docx(text, Buffer.from('broken')), 'cv.docx');
  assert.equal(r.success, true);
  assert.equal(r.profile!.photo_url, null);
  assert.ok((r.profile!.extraction_warnings as string[]).some(w => w.includes('foto do DOCX')));
});
test('Sem evidências não inventa perfil, resumo ou score', async () => {
  const p = (await parseResumeBuffer(await docx(['Curriculo', 'Informacoes adicionais']), 'cv.docx')).profile!;
  for (const k of ['location', 'school', 'degree', 'education_start_year', 'education_end_year', 'seniority', 'summary_pt']) assert.equal(p[k], '');
  assert.equal(p.years_experience, null);
  assert.deepEqual(p.top_skills, []);
  assert.deepEqual(p.target_roles, []);
  assert.equal(p.remote_score, 0);
  assert.equal(p.auto_apply_score, 0);
});
test('Vazio, escaneado, corrompido e extensão/tamanho inválidos falham sem perfil', async () => {
  for (const [name, bytes] of [['empty.pdf', await pdf([])], ['scan.pdf', await pdf([], await portrait(), true)], ['bad.pdf', Buffer.from('bad')], ['empty.docx', await docx([])], ['bad.docx', Buffer.from('bad')], ['x.png', await portrait()], ['x.doc', Buffer.from('bad')]] as const) {
    const r = await parseResumeBuffer(bytes, name);
    assert.equal(r.success, false, name);
    assert.equal(r.profile, undefined);
    assert.ok(r.error);
  }
  assert.ok(validateResumeInput('cv.exe', 100));
  assert.ok(validateResumeInput('cv.pdf', MAX_RESUME_BYTES + 1));
  assert.ok(validateResumeInput('cv.pdf', 0));
});
test('Falha IA mantém local; resposta malformada ou inventada não sobrescreve contatos', async () => {
  process.env.MINIMAX_API_KEY = 'synthetic-test-key';
  try {
    const bytes = await docx();
    assert.equal((await parseResumeBuffer(bytes, 'cv.docx')).profile!.extraction_method, 'local');
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ email: 'fake@example.test', phone: {}, full_name: 45, location: 'Paris', school: 'Inventada', top_skills: [123, {}, 'Python', 'Inventado'], target_roles: 'invalid', summary_pt: 'Inventado', score: 999, years_experience: 80 }) } }] }));
    const p = (await parseResumeBuffer(bytes, 'cv.docx')).profile!;
    assert.equal(p.email, 'ana@example.test');
    assert.equal(p.location, 'Salvador');
    assert.equal(p.school, '');
    assert.equal(p.years_experience, 3);
    assert.ok((p.top_skills as string[]).every(s => typeof s === 'string' && s !== 'Inventado'));
    assert.equal(p.extraction_method, 'ai');
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: {} } }] }));
    assert.equal((await parseResumeBuffer(bytes, 'cv.docx')).profile!.extraction_method, 'local');
  } finally { delete process.env.MINIMAX_API_KEY; globalThis.fetch = async () => { throw new Error('offline'); }; }
});
test('Rota: 200 válido, 422 parsing e 400 entrada inválida', async () => {
  for (const [name, bytes, expected] of [['cv.pdf', await pdf(), 200], ['cv.pdf', Buffer.from('bad'), 422], ['cv.docx', await docx([]), 422], ['cv.exe', Buffer.from('bad'), 400], ['cv.pdf', Buffer.alloc(0), 400]] as const) {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(bytes)], name));
    const response = await POST(new Request('http://localhost/api/resume/parse', { method: 'POST', body: form }));
    assert.equal(response.status, expected);
    const body = await response.json();
    assert.equal(body.success, expected === 200);
    if (expected !== 200) assert.equal(body.profile, undefined);
  }
  for (const body of ['null', '{', JSON.stringify({ storagePath: '../bad.pdf' }), JSON.stringify({ storagePath: 123 })]) {
    assert.equal((await POST(new Request('http://localhost/api/resume/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))).status, 400);
  }
});
