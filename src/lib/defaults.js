// Varsayılan ayarlar ve sağlayıcı yapılandırması.
// Tek doğruluk kaynağı burasıdır; içerik betiği ayarları arka plandan ister.

export const DEFAULTS = {
  // Genel
  enabled: true,
  targetLang: 'Türkçe',

  // Sağlayıcı seçimi: 'gemini' | 'openai'
  provider: 'gemini',

  // Gemini (Google AI Studio ücretsiz katman)
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',

  // OpenAI uyumlu sunucular: Groq, OpenRouter, Cerebras, LM Studio, Ollama (/v1)
  baseUrl: 'https://api.groq.com/openai/v1',
  genericApiKey: '',
  genericModel: 'llama-3.3-70b-versatile',

  // Görünüm
  fontSize: 30,
  showOriginal: true,
  hideYouTubeCaptions: true,
  position: 'bottom',

  // Performans
  lookahead: 60,
  batchChars: 2200,
  maxBatchItems: 12,
  maxParallel: 2,
  // Kaydedilmiş videolarda önce mevcut konum + ileri pencere, sonra tüm video
  // arka planda sırayla çevrilir. Böylece ileri sarma beklemesiz olur.
  pretranslateAll: true,

  // Canlı mod (canlı yayın / anlık altyazı, satır satır çeviri)
  liveRefreshMs: 1200, // aynı satırın yeniden çevrilmesi arası en az süre
  liveMaxRpm: 24 // dakikada en fazla AI isteği (429 fırtınasını önler)
};

/** Gemini'nin bilinen güncel sohbet modelleri (ağ yoksa/lista alınamazsa select bunlarla dolar). */
export const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
];

export const TARGET_LANGS = [
  'Türkçe',
  'İngilizce',
  'Almanca',
  'Fransızca',
  'İspanyolca',
  'İtalyanca',
  'Portekizce',
  'Rusça',
  'Arapça',
  'Farsça',
  'Hollandaca',
  'Lehçe',
  'Ukraynaca',
  'Yunanca',
  'Japonca',
  'Korece',
  'Çince (Basitleştirilmiş)',
  'Hintçe',
  'Endonezce',
  'Azerice'
];

/**
 * Etkin sağlayıcının istek bilgilerini üretir.
 * Hata durumunda { ok: false, error } döner; bu hatalar kullanıcı kaynaklıdır (tekrar denemek anlamsız).
 */
export function getProviderConfig(s) {
  const provider = s.provider === 'openai' ? 'openai' : 'gemini';

  if (provider === 'gemini') {
    const apiKey = String(s.geminiApiKey || '').trim();
    const model = String(s.geminiModel || DEFAULTS.geminiModel).trim();
    if (!apiKey) {
      return {
        ok: false,
        error: 'Gemini API anahtarı girilmemiş. Eklenti simgesine tıklayıp ücretsiz anahtarınızı ekleyin.'
      };
    }
    return { ok: true, provider, apiKey, model, label: `Gemini · ${model}` };
  }

  const baseUrl = String(s.baseUrl || '').trim().replace(/\/+$/, '');
  const model = String(s.genericModel || '').trim();
  const apiKey = String(s.genericApiKey || '').trim();
  if (!baseUrl) return { ok: false, error: 'Sunucu adresi (base URL) boş.' };
  if (!model) return { ok: false, error: 'Model adı boş.' };
  return { ok: true, provider, baseUrl, model, apiKey, label: `${hostOf(baseUrl)} · ${model}` };
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
