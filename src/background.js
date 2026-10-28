// Arka plan servis çalışanı: ayarlar, model çağrıları, önbellek, kuyruk.

import { DEFAULTS, getProviderConfig } from './lib/defaults.js';
import { ApiError, translateBatch } from './lib/providers.js';
import { listModels } from './lib/models.js';
import { cacheClear, cacheGet, cachePut, cacheStats, fnv, videoCacheKey } from './lib/cache.js';
import { storageGet, storageSet } from './lib/storage.js';

const MAX_INFLIGHT = 2;
let inflight = 0;
const waiters = [];

function acquire() {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  inflight -= 1;
  const next = waiters.shift();
  if (next) {
    inflight += 1;
    next();
  }
}

/* ------------------------------------------------------------------ */
/* Ayarlar                                                            */
/* ------------------------------------------------------------------ */

const NUMERIC_KEYS = [
  'fontSize',
  'lookahead',
  'batchChars',
  'maxBatchItems',
  'maxParallel',
  'liveRefreshMs',
  'liveMaxRpm'
];
const BOOL_KEYS = ['enabled', 'showOriginal', 'hideYouTubeCaptions', 'pretranslateAll'];
const STRING_KEYS = [
  'targetLang',
  'provider',
  'geminiApiKey',
  'geminiModel',
  'baseUrl',
  'genericApiKey',
  'genericModel',
  'position'
];

function sanitize(input) {
  const out = {};
  for (const k of STRING_KEYS) {
    if (typeof input[k] === 'string') out[k] = input[k].slice(0, 400);
  }
  for (const k of NUMERIC_KEYS) {
    const n = Number(input[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  for (const k of BOOL_KEYS) {
    if (typeof input[k] === 'boolean') out[k] = input[k];
  }
  if (out.provider && !['gemini', 'openai'].includes(out.provider)) out.provider = 'gemini';
  if (out.position && !['bottom', 'top'].includes(out.position)) out.position = 'bottom';
  if (out.fontSize) out.fontSize = Math.min(56, Math.max(14, out.fontSize));
  if (out.lookahead) out.lookahead = Math.min(300, Math.max(10, out.lookahead));
  if (out.batchChars) out.batchChars = Math.min(6000, Math.max(400, out.batchChars));
  if (out.maxBatchItems) out.maxBatchItems = Math.min(30, Math.max(1, out.maxBatchItems));
  if (out.maxParallel) out.maxParallel = Math.min(4, Math.max(1, out.maxParallel));
  if (out.liveRefreshMs) out.liveRefreshMs = Math.min(5000, Math.max(200, out.liveRefreshMs));
  if (Number.isFinite(out.liveMaxRpm)) out.liveMaxRpm = Math.min(120, Math.max(0, out.liveMaxRpm));
  return out;
}

async function getSettings() {
  const stored = await storageGet(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await storageGet(DEFAULTS);
  await storageSet({ ...DEFAULTS, ...current });
});

/* ------------------------------------------------------------------ */
/* Çeviri                                                             */
/* ------------------------------------------------------------------ */

async function handleTranslate(payload) {
  const settings = await getSettings();
  const cfg = getProviderConfig(settings);
  if (!cfg.ok) throw new ApiError(cfg.error, { fatal: true, code: 'CONFIG' });

  const targetLang = String(payload.targetLang || settings.targetLang || DEFAULTS.targetLang);
  const items = (Array.isArray(payload.items) ? payload.items : []).map((t) =>
    String(t ?? '').replace(/\s+/g, ' ').trim()
  );
  if (!items.length) return { ok: true, translations: [], provider: cfg.label, cached: 0 };

  const cacheKey = videoCacheKey(String(payload.videoId || 'genel'), targetLang, cfg);
  const store = await cacheGet(cacheKey);

  const results = new Array(items.length).fill(null);
  const todo = [];

  items.forEach((text, i) => {
    if (!text) {
      results[i] = '';
      return;
    }
    const hit = store.get(fnv(text));
    if (hit) results[i] = hit;
    else todo.push(i);
  });

  if (todo.length) {
    await acquire();
    try {
      const translations = await translateBatch(cfg, {
        items: todo.map((i) => items[i]),
        targetLang,
        before: (payload.before || []).slice(-3).map(String).filter(Boolean),
        after: (payload.after || []).slice(0, 3).map(String).filter(Boolean),
        videoTitle: String(payload.videoTitle || '').slice(0, 200)
      });

      translations.forEach((value, k) => {
        const index = todo[k];
        if (value && String(value).trim()) {
          results[index] = String(value).trim();
          cachePut(cacheKey, fnv(items[index]), results[index]);
        }
      });
    } finally {
      release();
    }
  }

  return {
    ok: true,
    translations: results,
    provider: cfg.label,
    cached: items.length - todo.length
  };
}

async function handleTest() {
  const settings = await getSettings();
  const cfg = getProviderConfig(settings);
  if (!cfg.ok) throw new ApiError(cfg.error, { fatal: true, code: 'CONFIG' });

  const sample =
    "So the trick is to keep the whole sentence together, otherwise the meaning falls apart.";
  const [out] = await translateBatch(cfg, {
    items: [sample],
    targetLang: settings.targetLang
  });

  if (!out) throw new ApiError('Model boş çeviri döndürdü.', { code: 'EMPTY' });
  return { ok: true, provider: cfg.label, sample, translation: out };
}

/* ------------------------------------------------------------------ */
/* Mesaj yönlendirme                                                  */
/* ------------------------------------------------------------------ */

async function handleMessage(msg) {
  switch (msg?.type) {
    case 'ping':
      return { ok: true };

    case 'settings:get':
      return { ok: true, settings: await getSettings() };

    case 'settings:set': {
      const clean = sanitize(msg.settings || {});
      if (Object.keys(clean).length) await storageSet(clean);
      return { ok: true, settings: await getSettings() };
    }

    case 'translate':
      return await handleTranslate(msg.payload || {});

    case 'test':
      return await handleTest();

    case 'models:list': {
      // Anahtar yalnızca arka planda kullanılır; popup'a geri dönmez.
      const settings = await getSettings();
      const provider = msg.provider === 'openai' ? 'openai' : 'gemini';
      return await listModels({
        provider,
        geminiApiKey: String(msg.geminiApiKey || settings.geminiApiKey || '').trim(),
        baseUrl: String(msg.baseUrl || settings.baseUrl || '').trim(),
        genericApiKey: String(msg.genericApiKey ?? settings.genericApiKey ?? '').trim()
      });
    }

    case 'cache:clear':
      return { ok: true, ...(await cacheClear()) };

    case 'cache:stats':
      return { ok: true, ...(await cacheStats()) };

    default:
      return { ok: false, error: 'Bilinmeyen istek: ' + String(msg?.type), fatal: true };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then((res) => sendResponse(res || { ok: true }))
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err?.message || String(err),
        code: err?.code || 'UNKNOWN',
        retryAfter: err?.retryAfter || 0,
        fatal: Boolean(err?.fatal)
      });
    });
  return true; // async yanıt
});

/* ------------------------------------------------------------------ */
/* Kısayol: Alt+T                                                     */
/* ------------------------------------------------------------------ */

/** Etkin sekmeyi callback biçimiyle alır (Chrome ve Firefox uyumlu). */
function activeTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        void chrome.runtime?.lastError;
        resolve(Array.isArray(tabs) && tabs[0] ? tabs[0] : null);
      });
    } catch {
      resolve(null);
    }
  });
}

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== 'toggle-translation') return;
  try {
    const tab = await activeTab();
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'ui:toggle' }, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    /* YouTube sekmesi değilse yok say */
  }
});
