// Kendi kendine test: ağ çağrıları taklit edilir, gerçek dosyalar içe aktarılır.
// Çalıştırma:  node tests/self-test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, GEMINI_MODELS, getProviderConfig } from '../src/lib/defaults.js';
import { translateBatch } from '../src/lib/providers.js';
import { buildUserPrompt } from '../src/lib/prompt.js';
import {
  isChatModel,
  listModels,
  normalizeGeminiModels,
  normalizeOpenAiModels
} from '../src/lib/models.js';
import { fnv, videoCacheKey } from '../src/lib/cache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

const geminiBody = (arr, finish = 'STOP') => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: arr }) }] }, finishReason: finish }]
});

const geminiCfg = { ok: true, provider: 'gemini', apiKey: 'test-key', model: 'gemini-2.5-flash' };
const openaiCfg = {
  ok: true,
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model'
};

/* ------------------------------------------------------------------ */

console.log('defaults / yapılandırma');

assert.equal(getProviderConfig({ provider: 'gemini', geminiApiKey: '' }).ok, false);
assert.equal(getProviderConfig({ provider: 'openai', baseUrl: '', genericModel: 'x' }).ok, false);
const cfgOk = getProviderConfig({
  provider: 'gemini',
  geminiApiKey: ' AIzaXYZ ',
  geminiModel: 'gemini-2.5-flash'
});
assert.equal(cfgOk.apiKey, 'AIzaXYZ');
assert.equal(cfgOk.ok, true);
ok('eksik anahtar/yapılandırma doğru reddediliyor');

/* ------------------------------------------------------------------ */

console.log('model listesi');

assert.equal(DEFAULTS.geminiModel, GEMINI_MODELS[0], 'varsayılan model listede olmalı');
assert.equal(isChatModel('gemini-3.8-flash'), true);
assert.equal(isChatModel('text-embedding-004'), false);
assert.equal(isChatModel('whisper-large-v3'), false);
assert.equal(isChatModel('tts-1'), false);

const geminiList = normalizeGeminiModels({
  models: [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-3.0', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    {
      name: 'models/gemini-3.5-flash-lite',
      supportedGenerationMethods: ['generateContent', 'countTokens']
    }
  ]
});
assert.deepEqual(geminiList, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);

assert.deepEqual(
  normalizeOpenAiModels({
    data: [
      { id: 'llama-3.3-70b' },
      { id: 'whisper-large-v3' },
      { id: 'text-embedding-3-small' },
      { id: 'llama-3.3-70b' }
    ]
  }),
  ['llama-3.3-70b']
);
assert.deepEqual(normalizeOpenAiModels({ models: ['qwen2.5:7b', 'tts-1'] }), ['qwen2.5:7b']);
ok('embedding/ses/görsel modeller ayıklanıyor, kimlikler tekilleştiriliyor');

let modelUrl = '';
let modelHeaders = null;
globalThis.fetch = async (url, init) => {
  modelUrl = String(url);
  modelHeaders = init.headers;
  return json({
    models: [
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
    ]
  });
};
const geminiModels = await listModels({ provider: 'gemini', geminiApiKey: 'AIzaTEST' });
assert.deepEqual(geminiModels.models, ['gemini-3.8-flash']);
assert.equal(modelUrl.includes('AIzaTEST'), false, 'anahtar URL’ye yazılmamalı');
assert.equal(modelHeaders['x-goog-api-key'], 'AIzaTEST');
ok('Gemini model listesi alınıyor, anahtar URL’ye sızmıyor');

modelUrl = '';
modelHeaders = null;
globalThis.fetch = async (url, init) => {
  modelUrl = String(url);
  modelHeaders = init.headers;
  return json({ data: [{ id: 'llama-3.3-70b' }, { id: 'whisper-large-v3' }] });
};
const openAiModels = await listModels({
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1/',
  genericApiKey: 'sk-test'
});
assert.deepEqual(openAiModels.models, ['llama-3.3-70b']);
assert.equal(modelUrl, 'https://api.example.com/v1/models');
assert.equal(modelHeaders.Authorization, 'Bearer sk-test');

globalThis.fetch = async (_url, init) => {
  modelHeaders = init.headers;
  return json({ data: [{ id: 'qwen2.5:7b' }] });
};
await listModels({ provider: 'openai', baseUrl: 'http://localhost:11434/v1', genericApiKey: '' });
assert.equal(modelHeaders.Authorization, undefined, 'yerel sunucuya anahtarsız istek');
ok('OpenAI uyumlu model listesi ve yetkilendirme başlığı');

await assert.rejects(listModels({ provider: 'gemini' }), /anahtar/i);
ok('anahtarsız model listesi anlaşılır hata veriyor');

const titlePrompt = buildUserPrompt({
  items: ['hello'],
  targetLang: 'Türkçe',
  videoTitle: '  Transformer   Mimarisi\nİpuçları '
});
assert.match(titlePrompt, /VİDEO BAŞLIĞI/);
assert.match(titlePrompt, /Transformer Mimarisi İpuçları/);
ok('video başlığı tek satıra temizlenip bağlam olarak isteme ekleniyor');

/* ------------------------------------------------------------------ */

console.log('Gemini');

let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return json(geminiBody(['Merhaba dünya.', 'İkinci cümle.']));
};
let out = await translateBatch(geminiCfg, {
  items: ['Hello world.', 'Second sentence.'],
  targetLang: 'Türkçe'
});
assert.deepEqual(out, ['Merhaba dünya.', 'İkinci cümle.']);
assert.equal(calls, 1);
ok('temel çeviri + sıralama');

globalThis.fetch = async () =>
  json({
    candidates: [
      {
        content: { parts: [{ text: '```json\n{"translations":["kod bloğu içinde"]}\n```' }] },
        finishReason: 'STOP'
      }
    ]
  });
out = await translateBatch(geminiCfg, { items: ['fenced'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['kod bloğu içinde']);
ok('kod bloğuna sarılmış JSON ayrıştırılıyor');

// 429 → bekle → tekrar dene
calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  if (calls === 1) return json({ error: { message: 'Quota exceeded' } }, 429, { 'retry-after': '0' });
  return json(geminiBody(['tekrar denendi']));
};
out = await translateBatch(geminiCfg, { items: ['retry me'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['tekrar denendi']);
assert.equal(calls, 2);
ok('429 sonrası yeniden deneme');

// Eksik öğe → isteği ikiye bölerek onar
const seen = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const text = body.contents[0].parts[0].text;
  const count = Number((text.match(/ÇEVRİLECEK (\d+)/) || [])[1] || 0);
  seen.push(count);
  if (count > 1) return json(geminiBody(['sadece bir tane']));
  return json(geminiBody([`çeviri-${count}`]));
};
out = await translateBatch(geminiCfg, { items: ['a', 'b', 'c', 'd'], targetLang: 'Türkçe' });
assert.equal(out.length, 4);
assert.ok(out.every(Boolean), 'tüm öğeler doldurulmalı');
assert.ok(seen.includes(4) && seen.includes(2) && seen.includes(1), `bölme görülmeli: ${seen}`);
ok('eksik/uyumsuz yanıtta istek bölünerek tamamlanıyor');

// Kesik yanıt (MAX_TOKENS) → böl
globalThis.fetch = async (_url, init) => {
  const text = JSON.parse(init.body).contents[0].parts[0].text;
  const count = Number((text.match(/ÇEVRİLECEK (\d+)/) || [])[1] || 0);
  if (count > 1) return json(geminiBody([], 'MAX_TOKENS'));
  return json(geminiBody(['tamam']));
};
out = await translateBatch(geminiCfg, { items: ['x', 'y'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['tamam', 'tamam']);
ok('MAX_TOKENS kesilmesi bölünerek çözülüyor');

// Emekliye ayrılmış model (404) → bilinen güncel modele düş
const triedModels = [];
const oldCfg = { ...geminiCfg, model: 'gemini-2.5-flash', label: 'Gemini · gemini-2.5-flash' };
globalThis.fetch = async (url) => {
  const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
  triedModels.push(model);
  if (model !== 'gemini-3.8-flash') {
    return json({ error: { message: `models/${model} is not found for API version v1beta` } }, 404);
  }
  return json(geminiBody(['yedek modelden çeviri']));
};
out = await translateBatch(oldCfg, { items: ['fallback'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['yedek modelden çeviri']);
assert.equal(triedModels[0], 'gemini-2.5-flash');
assert.equal(triedModels[1], 'gemini-3.8-flash');
assert.equal(oldCfg.model, 'gemini-3.8-flash', 'çalışan model yapılandırmaya yazılmalı');
assert.match(oldCfg.label, /gemini-3\.8-flash/);
ok('model 404 verirse güncel modele otomatik geçiliyor');

// Tüm modeller 404 → tek denemede durmamalı, fatal hata vermeli
globalThis.fetch = async () => json({ error: { message: 'not found' } }, 404);
let fatalErr = null;
try {
  await translateBatch({ ...geminiCfg, model: 'gemini-yok' }, { items: ['a'], targetLang: 'Türkçe' });
} catch (e) {
  fatalErr = e;
}
assert.ok(fatalErr, 'hata beklenirdi');
assert.equal(fatalErr.fatal, true, 'model yoksa sonsuz yeniden deneme olmamalı');
assert.match(fatalErr.message, /Model bulunamadı/);
ok('hiçbir model yoksa anlaşılır ve kalıcı hata veriliyor');

/* ------------------------------------------------------------------ */

console.log('OpenAI uyumlu sağlayıcı');

let lastUrl = '';
let lastHeaders = null;
globalThis.fetch = async (url, init) => {
  lastUrl = String(url);
  lastHeaders = init.headers;
  return json({ choices: [{ message: { content: JSON.stringify({ translations: ['groq çeviri'] }) }, finish_reason: 'stop' }] });
};
out = await translateBatch(openaiCfg, { items: ['hello'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['groq çeviri']);
assert.equal(lastUrl, 'https://api.example.com/v1/chat/completions');
assert.equal(lastHeaders.Authorization, 'Bearer sk-test');
ok('OpenAI uyumlu istek gövdesi/başlıkları');

// response_format reddedilirse sade istekle tekrar denenir
calls = 0;
globalThis.fetch = async (_url, init) => {
  calls += 1;
  const body = JSON.parse(init.body);
  if (body.response_format) {
    return json({ error: { message: 'response_format is not supported' } }, 400);
  }
  return json({ choices: [{ message: { content: '{"translations":["sade mod"]}' }, finish_reason: 'stop' }] });
};
out = await translateBatch(openaiCfg, { items: ['x'], targetLang: 'Türkçe' });
assert.deepEqual(out, ['sade mod']);
assert.equal(calls, 2);
ok('response_format desteklenmiyorsa geri çekilme');

// Yerel sunucu: anahtar yoksa Authorization gönderilmez
let hasAuth = true;
globalThis.fetch = async (_url, init) => {
  hasAuth = Boolean(init.headers.Authorization);
  return json({ choices: [{ message: { content: '{"translations":["yerel"]}' } }] });
};
out = await translateBatch(
  { ok: true, provider: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen' },
  { items: ['x'], targetLang: 'Türkçe' }
);
assert.equal(hasAuth, false);
assert.deepEqual(out, ['yerel']);
ok('yerel modelde anahtarsız istek');

/* ------------------------------------------------------------------ */

console.log('içerik betiği: cümle gruplama');

const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'src', 'content', 'common.js'), 'utf8'), sandbox);
const AYC = sandbox.window.__AYC;
assert.ok(AYC && typeof AYC.buildChunks === 'function');

const chunks = AYC.buildChunks([
  { start: 0, end: 2, text: 'So the thing is' },
  { start: 2, end: 4, text: 'we need to keep' },
  { start: 4, end: 6, text: 'the whole sentence together.' },
  { start: 7, end: 9, text: 'Otherwise it' },
  { start: 9, end: 11, text: 'falls apart.' }
]);
assert.equal(chunks.length, 2);
assert.equal(chunks[0].text, 'So the thing is we need to keep the whole sentence together.');
assert.equal(chunks[1].text, 'Otherwise it falls apart.');
ok('cümle sonuna göre gruplama');

const long = AYC.buildChunks([
  { start: 0, end: 5, text: 'a'.repeat(200) },
  { start: 5, end: 10, text: 'b'.repeat(200) }
]);
assert.equal(long.length, 2);
ok('karakter sınırında bölme');

const bad = AYC.buildChunks([
  { start: NaN, end: 1, text: 'bozuk' },
  { start: 3, end: 2, text: '  ' },
  { start: 4, end: 6, text: 'geçerli' }
]);
assert.equal(bad.length, 1);
assert.equal(bad[0].end, 6);
ok('bozuk zaman damgaları ayıklanıyor');

/* ------------------------------------------------------------------ */

console.log('motor: zaman eşleme ve istek planlama');

const engineSandbox = { window: { __AYC: {} }, console, setInterval, clearInterval, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'src', 'content', 'engine.js'), 'utf8'), engineSandbox);
const Engine = engineSandbox.window.__AYC.Engine;
assert.equal(typeof Engine, 'function');

const fakeOverlay = {
  setPill() {},
  setText() {},
  clear() {},
  setProgress() {},
  setError() {},
  setNativeHidden() {},
  applySettings() {}
};

const engine = new Engine({ currentTime: 0 }, fakeOverlay);
engine.running = true;
engine.settings = { lookahead: 60, batchChars: 2200, maxBatchItems: 12, maxParallel: 2, targetLang: 'Türkçe' };
engine.chunks = Array.from({ length: 30 }, (_, i) => ({ start: i * 4, end: i * 4 + 4, text: `cümle ${i}` }));
engine.tr = new Array(30).fill(null);
engine.state = new Array(30).fill('idle');
engine.retryAt = new Array(30).fill(0);
engine.dirty = new Array(30).fill(false);

assert.equal(engine.currentIndex(0), 0);
assert.equal(engine.currentIndex(10), 2);
assert.equal(engine.currentIndex(13.5), 3);
assert.equal(engine.currentIndex(119), 29);
assert.equal(engine.currentIndex(200), -1, 'uzun boşlukta altyazı gizlenmeli');
assert.equal(engine.firstIndexFrom(13.5), 4);
assert.equal(engine.firstIndexFrom(0), 1);
ok('ikili arama ve boşluk davranışı');

let captured = null;
engine.fetchBatch = (idxs) => {
  captured = idxs;
};
engine.mode = 'transcript';
engine.pump(0);
assert.ok(captured && captured.length === 12, `12 öğe beklenirdi: ${captured && captured.length}`);
assert.equal(JSON.stringify(captured), JSON.stringify(Array.from({ length: 12 }, (_, i) => i)));
ok('ileri çeviri penceresi ilk 12 cümleyi seçiyor');

captured = null;
engine.mode = 'live';
engine.pump(116); // son parçanın başlangıcı
assert.equal(captured.join(','), '29', 'ekrandaki satır tek öğe olarak istenmeli (en düşük gecikme)');
ok('canlı modda ekrandaki satır tek başına isteniyor');

captured = null;
engine.tr[29] = 'çevrildi';
engine.pump(116);
assert.ok(captured && captured.length === 11, `geri doldurma 11 öğe olmalı: ${captured && captured.length}`);
assert.equal(captured[0], 18, 'geri doldurma en eski seçilen 18 olmalı');
assert.equal(captured[captured.length - 1], 28, 'kronolojik sırada ve ekrandaki satır hariç');
ok('ekrandaki satır çevriliyse en yeni parçalarla geri dolduruluyor');

captured = null;
engine.settings.liveMaxRpm = 2;
engine.sentAt = [Date.now(), Date.now()];
engine.pump(116);
assert.equal(captured, null, 'dakikalık bütçe dolunca istek atılmamalı');
engine.sentAt = [Date.now() - 61000, Date.now() - 61000];
engine.pump(116);
assert.ok(captured, 'bütçe penceresi dışına çıkan istekler sayılmamalı');
engine.settings.liveMaxRpm = 24;
ok('dakikalık istek bütçesi (429 koruması) çalışıyor');

captured = null;
engine.pump(10); // DVR: geri sarılmış
assert.equal(captured.join(','), '2', 'geri sarılmış konumdaki satır çevrilmeli');
ok('canlı yayında geri sarma (DVR) durumu kapsanıyor');

engine.chunks = Array.from({ length: 405 }, (_, i) => ({ start: i, end: i + 1, text: `x${i}` }));
engine.tr = new Array(405).fill(null);
engine.state = new Array(405).fill('idle');
engine.retryAt = new Array(405).fill(0);
engine.dirty = new Array(405).fill(true);
engine.openChunk = engine.chunks[404];
engine.prune();
assert.equal(engine.chunks.length, 400);
assert.equal(engine.tr.length, 400);
assert.equal(engine.state.length, 400);
assert.equal(engine.retryAt.length, 400);
assert.equal(engine.dirty.length, 400, 'dirty dizisi de hizalanmalı');
assert.equal(engine.chunks[0].text, 'x5', 'en eski 5 parça atılmalı');
assert.equal(engine.openChunk, engine.chunks[399], 'açık satır referansı kaymamalı');
ok('canlı modda budama dizileri hizalı tutuyor');

/* ------------------------------------------------------------------ */

console.log('tam video ön çeviri');

function makePreEngine(pretranslateAll) {
  const pre = new Engine({ currentTime: 0 }, fakeOverlay);
  pre.running = true;
  pre.mode = 'transcript';
  pre.videoId = 'vid';
  pre.settings = {
    lookahead: 20,
    batchChars: 2200,
    maxBatchItems: 4,
    maxParallel: 2,
    targetLang: 'Türkçe',
    pretranslateAll,
    liveMaxRpm: 0
  };
  pre.chunks = Array.from({ length: 10 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 10,
    text: `cümle ${i}`
  }));
  pre.tr = new Array(10).fill(null);
  pre.state = new Array(10).fill('idle');
  pre.retryAt = new Array(10).fill(0);
  pre.dirty = new Array(10).fill(false);
  return pre;
}

const pre = makePreEngine(true);
const batches = [];
pre.fetchBatch = (idxs) => {
  batches.push(Array.from(idxs));
  idxs.forEach((i) => {
    pre.tr[i] = 'çeviri';
    pre.state[i] = 'ok';
  });
};

pre.pump(0);
assert.deepEqual(batches[0], [0, 1, 2], 'önce ekrandaki + ileri pencere');
pre.pump(0);
assert.deepEqual(batches[1], [3, 4, 5, 6], 'pencere bitince arka plan sırayla devam etmeli');
pre.pump(0);
assert.deepEqual(batches[2], [7, 8, 9]);
assert.equal(pre.tr.filter(Boolean).length, 10, 'tüm video çevrilmeli');
ok('önce mevcut pencere, sonra tüm video arka planda sırayla çevriliyor');

const off = makePreEngine(false);
const offBatches = [];
off.fetchBatch = (idxs) => {
  offBatches.push(Array.from(idxs));
  idxs.forEach((i) => {
    off.tr[i] = 'çeviri';
    off.state[i] = 'ok';
  });
};
off.pump(0);
off.pump(0);
assert.equal(offBatches.length, 1, 'ayar kapalıyken yalnızca ileri pencere çevrilmeli');
ok('"tüm videoyu çevir" kapatılınca istek bütçesi harcanmıyor');

const titleEngine = makePreEngine(false);
titleEngine.videoTitle = 'Transformer Mimarisi';
titleEngine.chunks = [{ start: 0, end: 2, text: 'hello world' }];
titleEngine.tr = [null];
titleEngine.state = ['idle'];
titleEngine.retryAt = [0];
titleEngine.dirty = [false];

let sentPayload = null;
engineSandbox.window.__AYC.send = async (msg) => {
  sentPayload = msg.payload;
  return { translations: ['merhaba dünya'] };
};
await titleEngine.fetchBatch([0]);
assert.equal(sentPayload.videoTitle, 'Transformer Mimarisi');
assert.equal(titleEngine.tr[0], 'merhaba dünya');
ok('video başlığı çeviri isteğine bağlam olarak ekleniyor');

/* ------------------------------------------------------------------ */

console.log('canlı mod: satır satır çeviri (gecikme düzeltmesi)');

const liveOverlay = {
  setPill() {},
  setText() {},
  clear() {},
  setProgress() {},
  setError() {},
  setNativeHidden() {},
  applySettings() {}
};

const live = new Engine({ currentTime: 0 }, liveOverlay);
live.running = true;
live.mode = 'live';
live.videoId = 'vid';
live.settings = {
  lookahead: 60,
  batchChars: 2200,
  maxBatchItems: 12,
  maxParallel: 2,
  targetLang: 'Türkçe',
  liveRefreshMs: 1200,
  liveMaxRpm: 24
};
live.pump = () => {}; // istek planlaması ayrı test edilir

live.upsertLive({ text: 'Hello there', start: 1, end: 1.6, final: false });
assert.equal(live.chunks.length, 1, 'ilk satır parça olarak eklenmeli');
assert.equal(live.openChunk, live.chunks[0], 'satır açık kalmalı');
assert.ok(live.chunks[0].end > 1e5, 'açık satırın bitişi sentinel olmalı');
assert.equal(live.dirty[0], true, 'yeni satır çevrilmeyi beklemeli');
assert.equal(live.tr.length, 1);
assert.equal(live.state.length, 1);
assert.equal(live.retryAt.length, 1);
ok('canlı satır hemen parça olarak ekleniyor (cümle sonu beklenmiyor)');

live.upsertLive({ text: 'Hello there my friend', start: 1, end: 3, final: false });
assert.equal(live.chunks.length, 1, 'aynı satır büyürken yeni parça açılmamalı');
assert.equal(live.chunks[0].text, 'Hello there my friend', 'metin yerinde güncellenmeli');
assert.equal(live.openChunk, live.chunks[0]);
ok('satır büyüdükçe aynı parça yerinde güncelleniyor');

live.upsertLive({ text: 'Hello there my friend.', start: 1, end: 3.4, final: true });
assert.equal(live.openChunk, null, 'kapanan satır açık kalmamalı');
assert.equal(live.chunks[0].end, 3.4, 'gerçek bitiş zamanı yazılmalı');
assert.ok(live.retryAt[0] <= Date.now(), 'son çeviri hemen istenmeli');
ok('satır kapanınca bitiş zamanı ve son çeviri isteği ayarlanıyor');

live.upsertLive({ text: 'Second line here', start: 4, end: 5, final: false });
assert.equal(live.chunks.length, 2, 'yeni satır yeni parça açmalı');
assert.equal(live.openChunk, live.chunks[1]);
assert.equal(live.dirty.length, 2);
ok('yeni satır ayrı parça olarak ekleniyor');

// İlk istek gecikmesi: satır zaten uzunsa 500 ms bekleme atlanmalı.
const fastLine = new Engine({ currentTime: 0 }, liveOverlay);
fastLine.running = true;
fastLine.mode = 'live';
fastLine.videoId = 'vid';
fastLine.settings = { ...live.settings };
fastLine.pump = () => {};
fastLine.upsertLive({ text: 'This line is long enough to send now', start: 0, end: 1, final: false });
assert.ok(fastLine.retryAt[0] <= Date.now(), 'uzun ilk satır beklemeden istenmeli');

const shortLine = new Engine({ currentTime: 0 }, liveOverlay);
shortLine.running = true;
shortLine.mode = 'live';
shortLine.videoId = 'vid';
shortLine.settings = { ...live.settings };
shortLine.pump = () => {};
shortLine.upsertLive({ text: 'Hello there', start: 0, end: 1, final: false });
assert.ok(shortLine.retryAt[0] > Date.now() + 300, 'kısa ilk satır 500 ms beklemeli');
shortLine.upsertLive({ text: 'Hello there my friend, this is a long line', start: 0, end: 2, final: false });
assert.ok(shortLine.retryAt[0] <= Date.now(), 'satır uzayınca ilk istek beklemesi iptal edilmeli');
ok('uzun satırda ilk istek beklemesi atlanıyor, kısa satırda korunuyor');

// DVR ile geri sarma: geç gelen eski zamanlı satır sıralı yere girmeli.
live.upsertLive({ text: 'Second line here', start: 4, end: 4.8, final: true });
live.upsertLive({ text: 'Rewound line', start: 2, end: 3, final: true });
assert.equal(live.chunks.map((c) => c.start).join(','), '1,2,4', 'parçalar başlangıca göre sıralı kalmalı');
assert.equal(live.tr.length, 3);
assert.equal(live.dirty.length, 3);
assert.equal(live.retryAt.length, 3);
ok('geri sarılan satır ikili aramayı bozmadan sıralı ekleniyor');

// Metin gönderildikten sonra büyürse eski çeviri geçici gösterilir, yeniden istenir.
const AYCengine = engineSandbox.window.__AYC;
AYCengine.send = async () => ({ translations: ['eski çeviri'] });

const stale = new Engine({ currentTime: 0 }, liveOverlay);
stale.running = true;
stale.mode = 'live';
stale.videoId = 'vid';
stale.settings = { ...live.settings };
stale.chunks = [{ start: 0, end: 1e6, text: 'short text', sentLen: 0, sentText: '' }];
stale.tr = [null];
stale.state = ['idle'];
stale.retryAt = [0];
stale.dirty = [true];

const inflight = stale.fetchBatch([0]);
stale.chunks[0].text = 'short text and a lot more words here';
await inflight;
assert.equal(stale.tr[0], 'eski çeviri', 'eski çeviri boşsa geçici olarak gösterilmeli');
assert.equal(stale.dirty[0], true, 'metin büyüdüyse yeniden çevrilmeli');
assert.ok(stale.retryAt[0] > Date.now(), 'yeniden çeviri hız sınırına göre ertelenmeli');
ok('yanıt gelene kadar büyüyen satır yeniden çeviri kuyruğuna giriyor');

const same = stale.fetchBatch([0]);
await same;
assert.equal(stale.dirty[0], false, 'metin değişmediyse yeniden istenmemeli');
assert.equal(stale.state[0], 'ok');
ok('metin sabitse çeviri kalıcı olarak kabul ediliyor');

/* ------------------------------------------------------------------ */

console.log('canlı mod: altyazı uyarısı');

{
  const calls = [];
  const warnOverlay = {
    setPill(text, kind) {
      calls.push(['pill', text, kind]);
    },
    setText() {},
    clear() {},
    setProgress() {},
    setError(message) {
      calls.push(['error', message]);
    },
    setNativeHidden(hidden) {
      calls.push(['native', hidden]);
    },
    applySettings() {}
  };

  const warn = new Engine({ currentTime: 0, paused: true }, warnOverlay);
  warn.running = true;
  warn.mode = 'live';
  warn.videoId = 'vid';
  warn.settings = { hideYouTubeCaptions: true, liveRefreshMs: 1200, liveMaxRpm: 24 };
  warn.chunks = [];
  warn.tr = [];
  warn.state = [];
  warn.retryAt = [];
  warn.dirty = [];

  const errors = () => calls.filter((c) => c[0] === 'error');

  // 1) Duraklatılmış video: altyazı olmasa da uyarı verilmemeli.
  warn.checkLiveCaptions();
  assert.equal(errors().length, 0, 'duraklatılmışken uyarı basılmamalı');
  assert.ok(
    calls.some((c) => c[0] === 'native' && c[1] === false),
    'duraklatılmışken YouTube altyazısı görünür kalmalı'
  );

  // 2) Oynuyor ama 8 sn dolmadı: uyarı yok.
  warn.video.paused = false;
  warn.checkLiveCaptions();
  assert.equal(errors().length, 0, 'oynama süresi dolmadan uyarı basılmamalı');
  assert.ok(
    calls.some((c) => c[0] === 'native' && c[1] === false),
    'yakalama yokken YouTube altyazısı görünür kalmalı'
  );

  // 3) 8 sn doldu: uyarı bir kez basılmalı ve YouTube altyazısı geri gösterilmeli.
  warn.playingSince = Date.now() - 9000;
  warn.checkLiveCaptions();
  assert.ok(
    calls.some((c) => c[0] === 'error' && c[1].includes('Altyazı yakalanamadı')),
    'süre dolunca uyarı basılmalı'
  );
  assert.ok(
    calls.some((c) => c[0] === 'native' && c[1] === false),
    'uyarıda YouTube altyazısı geri gösterilmeli'
  );

  // 4) Aynı uyarı tekrar tekrar basılmamalı.
  const errorsAfterWarn = errors().length;
  warn.checkLiveCaptions();
  assert.equal(errors().length, errorsAfterWarn, 'uyarı yalnızca bir kez basılmalı');

  // 5) Altyazı gelince uyarı KENDİLİĞİNDEN temizlenmeli (canlı rozetine dönmeli).
  warn.chunks = [{ start: 0, end: 1e6, text: 'Hello there' }];
  warn.tr = [null];
  warn.state = ['idle'];
  warn.retryAt = [0];
  warn.dirty = [true];
  warn.checkLiveCaptions();
  const lastPill = calls.filter((c) => c[0] === 'pill').pop();
  assert.ok(lastPill && lastPill[2] === 'live', 'altyazı gelince uyarı canlı rozetine dönmeli');
  assert.ok(
    calls.some((c) => c[0] === 'native' && c[1] === true),
    'altyazı gelince gizleme ayarı yeniden uygulanmalı'
  );

  // 6) Uyarıdan sonra duraklatılırsa hata yerine bekleme rozeti gösterilmeli.
  calls.length = 0;
  warn.chunks = [];
  warn.liveWarned = true;
  warn.livePillSet = false;
  warn.video.paused = true;
  warn.checkLiveCaptions();
  assert.ok(calls.some((c) => c[0] === 'pill' && c[2] === 'live'), 'duraklatılınca bekleme rozeti gösterilmeli');
  assert.ok(calls.some((c) => c[0] === 'native' && c[1] === false), 'duraklatılınca altyazı görünür kalmalı');

  // 7) Duraklatma sonrası altyazı yakalanınca gizleme yeniden uygulanmalı
  //    (canlı rozeti zaten kurulu olsa bile).
  calls.length = 0;
  warn.chunks = [{ start: 0, end: 1e6, text: 'Hello again' }];
  warn.liveWarned = false;
  warn.livePillSet = true;
  warn.video.paused = false;
  warn.checkLiveCaptions();
  assert.ok(
    calls.some((c) => c[0] === 'native' && c[1] === true),
    'devam edince native altyazı yeniden gizlenmeli'
  );
  assert.equal(calls.filter((c) => c[0] === 'pill').length, 0, 'rozet yeniden basılmamalı');
}

ok('altyazı uyarısı yalnızca oynarken ve bir kez çıkıyor, altyazı gelince temizleniyor');

/* ------------------------------------------------------------------ */

console.log('önbellek anahtarları');

assert.equal(fnv('aynı metin'), fnv('aynı metin'));
assert.notEqual(fnv('a'), fnv('b'));
assert.equal(videoCacheKey('abc', 'Türkçe', geminiCfg), 'abc|Türkçe|gemini:gemini-2.5-flash');
ok('hash ve önbellek anahtarı kararlı');

/* ------------------------------------------------------------------ */

console.log('manifest');

const projectRoot = path.join(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);

const refs = [manifest.background?.service_worker, manifest.action?.default_popup].filter(Boolean);
for (const cs of manifest.content_scripts || []) {
  refs.push(...(cs.js || []), ...(cs.css || []));
}
const missing = refs.filter((rel) => !fs.existsSync(path.join(projectRoot, rel)));
assert.deepEqual(missing, [], `eksik dosyalar: ${missing.join(', ')}`);
assert.ok(refs.length >= 8);
ok('manifest referansları mevcut ve MV3');

/* ------------------------------------------------------------------ */

console.log('Firefox portu');

const { toFirefoxManifest, validateFirefoxManifest } = await import('../tools/firefox-manifest.mjs');

const ffManifest = toFirefoxManifest(manifest);
assert.deepEqual(validateFirefoxManifest(ffManifest, manifest), []);
assert.equal(ffManifest.background.service_worker, undefined);
assert.equal(ffManifest.minimum_chrome_version, undefined);
assert.equal(ffManifest.background.type, 'module');
assert.ok(ffManifest.browser_specific_settings.gecko.id);
assert.ok(Number(ffManifest.browser_specific_settings.gecko.strict_min_version) >= 128);
assert.ok(ffManifest.content_scripts.some((cs) => cs.world === 'MAIN'));
ok('Firefox manifesti geçerli (service_worker yok, gecko id var, MAIN world korunuyor)');

const ffRefs = [
  ...ffManifest.background.scripts,
  ffManifest.action.default_popup,
  ...ffManifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])])
];
const ffMissing = ffRefs.filter((rel) => !fs.existsSync(path.join(projectRoot, rel)));
assert.deepEqual(ffMissing, [], `eksik dosyalar: ${ffMissing.join(', ')}`);
ok('Firefox manifestinin gösterdiği tüm dosyalar mevcut');

/* ------------------------------------------------------------------ */

console.log('depolama sarmalayıcısı (Chrome + Firefox)');

const fakeStore = {};
const chromeCalls = [];
globalThis.chrome = {
  runtime: {},
  storage: {
    local: {
      get(keys, cb) {
        chromeCalls.push('get');
        const out = {};
        if (keys === null || keys === undefined) Object.assign(out, fakeStore);
        else if (typeof keys === 'string') {
          if (keys in fakeStore) out[keys] = fakeStore[keys];
        } else if (Array.isArray(keys)) {
          for (const k of keys) if (k in fakeStore) out[k] = fakeStore[k];
        } else {
          for (const [k, d] of Object.entries(keys)) out[k] = k in fakeStore ? fakeStore[k] : d;
        }
        cb(out);
      },
      set(items, cb) {
        chromeCalls.push('set');
        Object.assign(fakeStore, items);
        cb();
      },
      remove(keys, cb) {
        chromeCalls.push('remove');
        for (const k of [].concat(keys)) delete fakeStore[k];
        cb();
      }
    }
  }
};

const { storageGet, storageSet, storageRemove } = await import('../src/lib/storage.js');

await storageSet({ a: 1, b: 'iki' });
assert.deepEqual(await storageGet('a'), { a: 1 });
assert.deepEqual(await storageGet(null), { a: 1, b: 'iki' });
assert.deepEqual(await storageGet({ a: 0, c: 9 }), { a: 1, c: 9 }, 'eksik anahtar varsayılanla dolar');
await storageRemove('a');
assert.deepEqual(await storageGet(null), { b: 'iki' });
assert.deepEqual(chromeCalls, ['set', 'get', 'get', 'get', 'remove', 'get']);
delete globalThis.chrome;
ok('storage sarmalayıcısı callback biçimiyle çalışıyor');

/* ------------------------------------------------------------------ */

console.log('arka plan modülü');

globalThis.chrome = {
  runtime: {
    lastError: undefined,
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} }
  },
  commands: { onCommand: { addListener() {} } },
  tabs: {
    query(_q, cb) {
      cb([]);
    },
    sendMessage() {}
  },
  storage: {
    local: {
      get(_k, cb) {
        cb({});
      },
      set(_i, cb) {
        cb();
      },
      remove(_k, cb) {
        cb();
      }
    }
  }
};

const backgroundModule = await import('../src/background.js');
assert.equal(typeof backgroundModule, 'object');
delete globalThis.chrome;
ok('arka plan modülü hatasız yükleniyor (import grafiği tam)');

console.log(`\n${passed} test geçti.`);
