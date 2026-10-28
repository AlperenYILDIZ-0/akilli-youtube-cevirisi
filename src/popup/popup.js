import { DEFAULTS, GEMINI_MODELS, TARGET_LANGS } from '../lib/defaults.js';

const $ = (id) => document.getElementById(id);

const PRESETS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat:free']
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    models: ['llama-3.3-70b', 'llama3.1-8b']
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.2:3b', 'mistral:7b']
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    models: ['local-model']
  }
};

let settings = { ...DEFAULTS };
let saveTimer = null;

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!res) return reject(new Error('Arka plan yanıt vermedi'));
      if (res.ok === false) {
        const e = new Error(res.error || 'Bilinmeyen hata');
        e.fatal = Boolean(res.fatal);
        return reject(e);
      }
      resolve(res);
    });
  });
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function fillLangs() {
  const sel = $('targetLang');
  sel.innerHTML = '';
  for (const lang of TARGET_LANGS) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    sel.appendChild(opt);
  }
}

/** Select'i model listesiyle doldurur; kayıtlı özel model listede yoksa korunur. */
function fillSelect(select, models, selected, { keepUnknown = false } = {}) {
  const wanted = String(selected || '').trim();
  const list = [];
  for (const raw of models || []) {
    const id = String(raw || '').trim();
    if (id && !list.includes(id)) list.push(id);
  }
  if (keepUnknown && wanted && !list.includes(wanted)) list.unshift(wanted);

  select.innerHTML = '';
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— model bulunamadı —';
    select.appendChild(opt);
    return;
  }
  for (const id of list) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  }
  select.value = list.includes(wanted) ? wanted : list[0];
}

function presetByBase(baseUrl) {
  const url = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  return Object.values(PRESETS).find((p) => p.baseUrl === url) || null;
}

function renderGenericModels(selected) {
  const preset = presetByBase($('baseUrl').value);
  const current = selected || $('genericModel').value || DEFAULTS.genericModel;
  fillSelect($('genericModel'), preset ? preset.models : [], current, { keepUnknown: true });
}

function render() {
  $('enabled').checked = Boolean(settings.enabled);
  $('provider').value = settings.provider === 'openai' ? 'openai' : 'gemini';
  $('geminiApiKey').value = settings.geminiApiKey || '';
  fillSelect($('geminiModel'), GEMINI_MODELS, settings.geminiModel || DEFAULTS.geminiModel, {
    keepUnknown: true
  });
  $('baseUrl').value = settings.baseUrl || '';
  $('genericApiKey').value = settings.genericApiKey || '';
  renderGenericModels(settings.genericModel || DEFAULTS.genericModel);
  $('targetLang').value = settings.targetLang || DEFAULTS.targetLang;
  $('fontSize').value = String(settings.fontSize || DEFAULTS.fontSize);
  $('fontSizeVal').textContent = `${settings.fontSize || DEFAULTS.fontSize}px`;
  $('showOriginal').checked = Boolean(settings.showOriginal);
  $('hideYouTubeCaptions').checked = Boolean(settings.hideYouTubeCaptions);
  $('pretranslateAll').checked = settings.pretranslateAll !== false;
  $('position').value = settings.position || 'bottom';
  $('lookahead').value = String(settings.lookahead ?? DEFAULTS.lookahead);
  $('batchChars').value = String(settings.batchChars ?? DEFAULTS.batchChars);
  $('maxBatchItems').value = String(settings.maxBatchItems ?? DEFAULTS.maxBatchItems);
  $('maxParallel').value = String(settings.maxParallel ?? DEFAULTS.maxParallel);
  $('liveRefreshMs').value = String(settings.liveRefreshMs ?? DEFAULTS.liveRefreshMs);
  $('liveMaxRpm').value = String(settings.liveMaxRpm ?? DEFAULTS.liveMaxRpm);
  syncProviderBox();
}

function syncProviderBox() {
  const isGemini = $('provider').value === 'gemini';
  $('geminiBox').hidden = !isGemini;
  $('openaiBox').hidden = isGemini;
}

function collect() {
  return {
    enabled: $('enabled').checked,
    provider: $('provider').value,
    geminiApiKey: $('geminiApiKey').value.trim(),
    geminiModel: $('geminiModel').value.trim(),
    baseUrl: $('baseUrl').value.trim(),
    genericApiKey: $('genericApiKey').value.trim(),
    genericModel: $('genericModel').value.trim(),
    targetLang: $('targetLang').value,
    fontSize: Number($('fontSize').value),
    showOriginal: $('showOriginal').checked,
    hideYouTubeCaptions: $('hideYouTubeCaptions').checked,
    pretranslateAll: $('pretranslateAll').checked,
    position: $('position').value,
    lookahead: Number($('lookahead').value),
    batchChars: Number($('batchChars').value),
    maxBatchItems: Number($('maxBatchItems').value),
    maxParallel: Number($('maxParallel').value),
    liveRefreshMs: Number($('liveRefreshMs').value),
    liveMaxRpm: Number($('liveMaxRpm').value)
  };
}

async function save(showFeedback = true) {
  const next = collect();
  try {
    const res = await send({ type: 'settings:set', settings: next });
    settings = res.settings;
    if (showFeedback) setStatus('Kaydedildi · sayfayı yenilemeye gerek yok', 'ok');
  } catch (e) {
    if (showFeedback) setStatus(`Kaydedilemedi: ${e.message}`, 'err');
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('kaydediliyor…');
  saveTimer = setTimeout(() => save(true), 700);
}

async function runTest() {
  const out = $('testOut');
  out.hidden = false;
  out.className = 'test-out';
  out.textContent = 'Test ediliyor…';
  setStatus('');

  await save(false);

  try {
    const res = await send({ type: 'test' });
    out.className = 'test-out ok';
    out.textContent = `${res.provider}\nKaynak: ${res.sample}\nÇeviri: ${res.translation}`;
    setStatus('Bağlantı çalışıyor', 'ok');
  } catch (e) {
    out.className = 'test-out err';
    out.textContent = e.message;
    setStatus('Bağlantı başarısız', 'err');
  }
}

async function loadModels(provider = 'gemini') {
  const isGemini = provider === 'gemini';
  const geminiApiKey = $('geminiApiKey').value.trim();
  const baseUrl = $('baseUrl').value.trim();
  const genericApiKey = $('genericApiKey').value.trim();

  if (isGemini && !geminiApiKey) {
    setStatus('Önce Gemini API anahtarını girin', 'err');
    return;
  }
  if (!isGemini && !baseUrl) {
    setStatus('Önce sunucu adresini girin', 'err');
    return;
  }

  setStatus('modeller alınıyor…');
  try {
    const res = await send({
      type: 'models:list',
      provider,
      geminiApiKey,
      baseUrl,
      genericApiKey
    });
    const models = Array.isArray(res.models) ? res.models : [];
    if (!models.length) throw new Error('Sohbet/çeviri modeli bulunamadı.');

    const select = isGemini ? $('geminiModel') : $('genericModel');
    fillSelect(select, models, select.value);
    setStatus(`${models.length} model bulundu · listeden seçin`, 'ok');
    scheduleSave();
  } catch (e) {
    setStatus(`Modeller alınamadı: ${e.message}`, 'err');
  }
}

async function clearCache() {
  try {
    const res = await send({ type: 'cache:clear' });
    setStatus(`Önbellek temizlendi (${res.cleared || 0} kayıt)`, 'ok');
  } catch (e) {
    setStatus(`Temizlenemedi: ${e.message}`, 'err');
  }
}

async function showCacheStats() {
  try {
    const res = await send({ type: 'cache:stats' });
    if (res.videos) setStatus(`Önbellek: ${res.videos} video · ${res.items} cümle`);
  } catch {
    /* yok say */
  }
}

function bind() {
  for (const el of document.querySelectorAll('input, select')) {
    el.addEventListener('change', () => {
      if (el.id === 'provider') syncProviderBox();
      if (el.id === 'fontSize') $('fontSizeVal').textContent = `${el.value}px`;
      if (el.id === 'baseUrl') {
        const preset = presetByBase(el.value);
        renderGenericModels(preset ? preset.model : $('genericModel').value);
      }
      scheduleSave();
    });
  }

  $('fontSize').addEventListener('input', () => {
    $('fontSizeVal').textContent = `${$('fontSize').value}px`;
  });

  $('preset').addEventListener('change', () => {
    const preset = PRESETS[$('preset').value];
    if (!preset) return;
    $('baseUrl').value = preset.baseUrl;
    fillSelect($('genericModel'), preset.models, preset.model);
    scheduleSave();
  });

  $('test').addEventListener('click', runTest);
  $('save').addEventListener('click', () => save(true));
  $('loadModels').addEventListener('click', () => loadModels('gemini'));
  $('loadGenericModels').addEventListener('click', () => loadModels('openai'));
  $('clearCache').addEventListener('click', clearCache);
}

async function init() {
  fillLangs();
  bind();
  try {
    const res = await send({ type: 'settings:get' });
    settings = res.settings;
  } catch {
    settings = { ...DEFAULTS };
  }
  render();
  showCacheStats();
}

init();
