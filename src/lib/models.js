// Model listeleme: Gemini ve OpenAI uyumlu sunucuların `/models` uç noktası.
// API anahtarı yalnızca arka planda kalır; açılır pencere yalnızca sonuç listesini görür.

/** Sohbet/çeviri dışı modeller (embedding, ses, görsel, video, moderasyon...). */
const NON_CHAT_MODEL = /(embed|embedding|whisper|transcri|tts|speech|audio|imagen|image|veo|video|rerank|moderation|dall-e|realtime|aqa)/i;

/** Model kimliği sohbet modeli olarak kullanılabilir mi? */
export function isChatModel(id) {
  const value = String(id || '').trim();
  if (!value) return false;
  return !NON_CHAT_MODEL.test(value);
}

function pushUnique(out, seen, value) {
  const id = String(value || '')
    .replace(/^models\//, '')
    .trim();
  if (!id || seen.has(id) || !isChatModel(id)) return;
  seen.add(id);
  out.push(id);
}

/** Gemini `models` yanıtını sade kimlik listesine çevirir. */
export function normalizeGeminiModels(json) {
  const list = Array.isArray(json?.models) ? json.models : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const methods = item?.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
    pushUnique(out, seen, item?.name);
  }
  return out;
}

/** OpenAI uyumlu `data` / `models` yanıtını sade kimlik listesine çevirir. */
export function normalizeOpenAiModels(json) {
  const list = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json)
        ? json
        : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id || item?.name || item?.model;
    pushUnique(out, seen, id);
  }
  return out;
}

async function readJson(res) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Sağlayıcının erişilebilir sohbet modellerini listeler.
 * @param {{provider?: string, geminiApiKey?: string, baseUrl?: string, genericApiKey?: string}} opts
 * @param {typeof fetch} fetchImpl testlerde ağı taklit etmek için
 * @returns {Promise<{ok: true, provider: string, models: string[]}>}
 */
export async function listModels(opts = {}, fetchImpl = globalThis.fetch) {
  const provider = opts.provider === 'openai' ? 'openai' : 'gemini';

  if (provider === 'gemini') {
    const apiKey = String(opts.geminiApiKey || '').trim();
    if (!apiKey) throw new Error('Önce Gemini API anahtarını girin.');

    const res = await fetchImpl(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
      { headers: { 'x-goog-api-key': apiKey } }
    );
    const json = await readJson(res);
    if (!res.ok) {
      throw new Error(json?.error?.message || `Gemini model listesi alınamadı (HTTP ${res.status}).`);
    }

    return { ok: true, provider, models: normalizeGeminiModels(json) };
  }

  const baseUrl = String(opts.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Sunucu adresi (base URL) boş.');

  const headers = {};
  const apiKey = String(opts.genericApiKey || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchImpl(`${baseUrl}/models`, { headers });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(json?.error?.message || `Model listesi alınamadı (HTTP ${res.status}).`);
  }

  return { ok: true, provider, models: normalizeOpenAiModels(json) };
}
