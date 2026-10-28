// Sağlayıcı çağrıları: Gemini (generateContent) ve OpenAI uyumlu (chat/completions).
// Üstesinden gelinen durumlar: 429 hız limiti, 5xx, kesik/bozuk JSON, eksik öğe.

import { GEMINI_MODELS } from './defaults.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

export class ApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status || 0;
    this.code = opts.code || 'API';
    this.retryAfter = opts.retryAfter || 0;
    this.fatal = Boolean(opts.fatal);
    this.retryable = Boolean(opts.retryable);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e) {
  if (!(e instanceof ApiError)) return false;
  if (e.fatal) return false;
  if (e.status === 429) return true;
  if (e.status >= 500) return true;
  return Boolean(e.retryable);
}

async function withRetry(fn, tries = 4) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      attempt += 1;
      if (attempt >= tries || !isRetryable(e)) throw e;
      const wait =
        e.retryAfter > 0
          ? Math.min(60, e.retryAfter) * 1000
          : Math.min(30000, 1500 * Math.pow(2, attempt - 1));
      await sleep(wait);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Yanıt ayrıştırma                                                    */
/* ------------------------------------------------------------------ */

function parseJsonLoose(text) {
  if (!text || !String(text).trim()) {
    throw new ApiError('Model boş yanıt döndü.', { code: 'EMPTY', retryable: true });
  }
  let t = String(text).trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  try {
    return JSON.parse(t);
  } catch {
    /* devam */
  }

  const ob = t.indexOf('{');
  const oe = t.lastIndexOf('}');
  if (ob >= 0 && oe > ob) {
    try {
      return JSON.parse(t.slice(ob, oe + 1));
    } catch {
      /* devam */
    }
  }

  const ab = t.indexOf('[');
  const ae = t.lastIndexOf(']');
  if (ab >= 0 && ae > ab) {
    try {
      return JSON.parse(t.slice(ab, ae + 1));
    } catch {
      /* devam */
    }
  }

  throw new ApiError('Model yanıtı JSON olarak çözümlenemedi.', { code: 'PARSE', retryable: true });
}

function normalizeArray(parsed) {
  let arr = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && Array.isArray(parsed.translations)) arr = parsed.translations;
  else if (parsed && Array.isArray(parsed.ceviriler)) arr = parsed.ceviriler;
  else if (parsed && typeof parsed === 'object') {
    const vals = Object.values(parsed).filter((v) => typeof v === 'string');
    if (vals.length) arr = vals;
  }

  if (!arr) {
    throw new ApiError('Model beklenen listede çeviri döndürmedi.', { code: 'SHAPE', retryable: true });
  }

  return arr.map((v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return String(v.text ?? v.translation ?? v.ceviri ?? '');
    return '';
  }).map((s) => s.replace(/\s*\n+\s*/g, ' ').trim());
}

/* ------------------------------------------------------------------ */
/* Gemini                                                             */
/* ------------------------------------------------------------------ */

/* Google modelleri sık sık emekliye ayrılıyor (örn. gemini-2.5-flash 2026'da kullanımdan
   kalktı). "Model bulunamadı" alırsak bilinen güncel ücretsiz modellere düşüyoruz. */
const GEMINI_FALLBACK_MODELS = GEMINI_MODELS;

async function callGemini(cfg, payload) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(payload) }] }],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          translations: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['translations']
      },
      maxOutputTokens: 8192
    }
  };

  const chain = [cfg.model, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== cfg.model)];
  let lastError = null;

  for (let attempt = 0; attempt < chain.length; attempt++) {
    const model = chain[attempt];
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(body)
    });

    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const msg = json?.error?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
      lastError = new ApiError(geminiErrorText(res.status, msg, model), {
        status: res.status,
        fatal:
          res.status === 404 ||
          (res.status === 400 && /api[\s_-]?key/i.test(msg) && !/quota/i.test(msg)),
        retryAfter: retryAfterFrom(res, json),
        code: 'GEMINI'
      });
      // Yalnızca "model yok" hatasında sıradaki modele geç; anahtar/kota hatasında dur.
      if (res.status === 404 && attempt < chain.length - 1) continue;
      throw lastError;
    }

    const cand = json?.candidates?.[0];
    const finish = cand?.finishReason;
    const parts = cand?.content?.parts || [];
    const text = parts.map((p) => p?.text || '').join('');

    if (finish === 'MAX_TOKENS') {
      throw new ApiError('Yanıt token sınırına takıldı.', { code: 'TRUNCATED', retryable: true });
    }
    if (!text && finish && finish !== 'STOP') {
      throw new ApiError(`Model yanıtı üretilemedi (${finish}).`, { code: 'BLOCKED', retryable: true });
    }

    if (model !== cfg.model) {
      // Hangi modelin gerçekten yanıt verdiğini rapora yansıt.
      cfg.model = model;
      if (typeof cfg.label === 'string') cfg.label = `Gemini · ${model}`;
    }

    return normalizeArray(parseJsonLoose(text));
  }

  throw lastError || new ApiError('Gemini modeli bulunamadı.', { code: 'GEMINI', fatal: true });
}

function geminiErrorText(status, msg, model) {
  if (status === 429) return `Hız limiti aşıldı (Gemini). ${msg}`;
  if (status === 403) return `Gemini erişimi reddedildi. Anahtarı ve model iznini kontrol edin. ${msg}`;
  if (status === 404) {
    return (
      `Model bulunamadı${model ? ` (${model})` : ''}. Güncel ücretsiz modeller: ` +
      `gemini-3.8-flash, gemini-3.5-flash-lite. "Modelleri listele" düğmesiyle anahtarınıza ` +
      `açık modelleri görebilirsiniz.`
    );
  }
  if (status === 400 && /api[\s_-]?key/i.test(msg)) return `Gemini API anahtarı geçersiz. ${msg}`;
  return `Gemini hatası (${status}): ${msg}`;
}

function retryAfterFrom(res, json) {
  const header = res.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) return Number(header);
  const details = json?.error?.details || [];
  for (const d of details) {
    const secs = d?.retryDelay;
    if (typeof secs === 'string' && secs.endsWith('s')) {
      const n = Number(secs.slice(0, -1));
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* OpenAI uyumlu (Groq, OpenRouter, Cerebras, LM Studio, Ollama)       */
/* ------------------------------------------------------------------ */

async function callOpenAiLike(cfg, payload, useJsonMode = true) {
  const url = `${cfg.baseUrl}/chat/completions`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(payload) }
  ];

  const body = {
    model: cfg.model,
    messages,
    temperature: 0.3,
    max_tokens: 3000
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (/openrouter\.ai$/i.test(cfg.baseUrl)) {
    headers['HTTP-Referer'] = 'https://github.com/local/akilli-youtube-cevirisi';
    headers['X-Title'] = 'Akilli YouTube Cevirisi';
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await res.text();

  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json?.error?.message || raw.slice(0, 300) || `HTTP ${res.status}`;

    // Bazı sunucular response_format / max_tokens alanlarını reddeder: bir kez sade deneyelim.
    if (res.status === 400 && /response_format|json_object|max_tokens|temperature/i.test(msg)) {
      if (useJsonMode) return callOpenAiLike(cfg, payload, false);
      const slim = { model: cfg.model, messages };
      const res2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify(slim) });
      const raw2 = await res2.text();
      if (res2.ok) {
        const j2 = JSON.parse(raw2);
        return normalizeArray(parseJsonLoose(j2?.choices?.[0]?.message?.content || ''));
      }
    }

    throw new ApiError(openAiErrorText(res.status, msg), {
      status: res.status,
      fatal: res.status === 401 || res.status === 403,
      retryAfter: retryAfterFrom(res, json),
      code: 'OPENAI'
    });
  }

  const choice = json?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === 'length') {
    throw new ApiError('Yanıt token sınırına takıldı.', { code: 'TRUNCATED', retryable: true });
  }
  return normalizeArray(parseJsonLoose(typeof content === 'string' ? content : JSON.stringify(content || '')));
}

function openAiErrorText(status, msg) {
  if (status === 429) return `Hız limiti aşıldı. ${msg}`;
  if (status === 401) return `API anahtarı geçersiz (${status}). ${msg}`;
  if (status === 404) return `Adres veya model bulunamadı (404). Base URL'i kontrol edin. ${msg}`;
  return `Sağlayıcı hatası (${status}): ${msg}`;
}

/* ------------------------------------------------------------------ */
/* Dışa açılan: tek çağrı + bölme/onarma mantığı                       */
/* ------------------------------------------------------------------ */

async function callOnce(cfg, payload) {
  return cfg.provider === 'gemini' ? callGemini(cfg, payload) : callOpenAiLike(cfg, payload);
}

/** Uzunluk uyuşmazlığı veya kesik yanıtta isteği ikiye bölerek tekrar dener. */
async function translateDeep(cfg, payload, depth = 0) {
  const items = payload.items;
  let arr;
  try {
    arr = await withRetry(() => callOnce(cfg, payload));
  } catch (e) {
    if (items.length > 1 && depth < 5 && isRetryable(e)) {
      return await split(cfg, payload, depth);
    }
    throw e;
  }

  if (arr.length === items.length && arr.every((x) => x && x.trim())) return arr;

  if (items.length > 1 && depth < 5) {
    return await split(cfg, payload, depth);
  }

  // Tek öğe: en iyi çabayı döndür (boşsa null)
  return items.map((_, i) => {
    const v = arr[i];
    return v && v.trim() ? v : null;
  });
}

async function split(cfg, payload, depth) {
  const items = payload.items;
  const mid = Math.ceil(items.length / 2);
  const head = items.slice(0, mid);
  const tail = items.slice(mid);

  const a = await translateDeep(
    cfg,
    { ...payload, items: head, after: tail.slice(0, 2) },
    depth + 1
  );
  const b = await translateDeep(
    cfg,
    { ...payload, items: tail, before: (payload.before || []).slice(-1) },
    depth + 1
  );
  return [...a, ...b];
}

/**
 * Toplu çeviri. Dönen dizi, `items` ile aynı uzunluktadır; başarısız öğeler null olabilir.
 * @param {object} cfg getProviderConfig() çıktısı
 * @param {{items: string[], targetLang: string, before?: string[], after?: string[]}} payload
 */
export async function translateBatch(cfg, payload) {
  if (!payload.items.length) return [];
  return translateDeep(cfg, payload);
}
