// Video bazlı çeviri önbelleği (chrome.storage.local).
// Aynı videoyu tekrar izlerken API kotası harcanmaz.
// Bellekte tek doğruluk kaynağı tutulur; böylece eşzamanlı yazmalar birbirini ezmez.

import { storageGet, storageRemove, storageSet } from './storage.js';

const INDEX_KEY = 'ayc:index';
const MAX_VIDEOS = 40;
const WRITE_DEBOUNCE = 1500;

/** Kısa ve kararlı metin özeti (FNV-1a). */
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '-' + str.length.toString(36);
}

const memStore = new Map(); // videoKey -> Map(hash -> çeviri)
const loading = new Map(); // videoKey -> Promise
const writeTimers = new Map(); // videoKey -> timeout
const dirty = new Set(); // videoKey

export function videoCacheKey(videoId, targetLang, cfg) {
  return `${videoId}|${targetLang}|${cfg.provider}:${cfg.model}`;
}

async function load(videoKey) {
  if (memStore.has(videoKey)) return memStore.get(videoKey);

  const inflight = loading.get(videoKey);
  if (inflight) return await inflight;

  const promise = (async () => {
    const map = new Map();
    try {
      const key = 'ayc:v:' + videoKey;
      const stored = await storageGet(key);
      const entry = stored[key];
      if (entry && entry.items && typeof entry.items === 'object') {
        for (const [h, v] of Object.entries(entry.items)) {
          if (typeof v === 'string' && v) map.set(h, v);
        }
      }
    } catch {
      /* önbellek okunamazsa sorun değil */
    }
    memStore.set(videoKey, map);
    loading.delete(videoKey);
    return map;
  })();

  loading.set(videoKey, promise);
  return await promise;
}

/** @returns {Promise<Map<string,string>>} hash -> çeviri */
export async function cacheGet(videoKey) {
  return await load(videoKey);
}

export function cachePut(videoKey, hash, translation) {
  const map = memStore.get(videoKey);
  if (!map) return; // cacheGet çağrılmadan yazma denenmez
  map.set(hash, translation);
  dirty.add(videoKey);

  clearTimeout(writeTimers.get(videoKey));
  writeTimers.set(
    videoKey,
    setTimeout(() => {
      flush(videoKey).catch(() => {});
    }, WRITE_DEBOUNCE)
  );
}

async function flush(videoKey) {
  writeTimers.delete(videoKey);
  if (!dirty.has(videoKey)) return;
  dirty.delete(videoKey);

  const map = memStore.get(videoKey);
  if (!map) return;

  const items = {};
  for (const [h, v] of map) items[h] = v;

  const key = 'ayc:v:' + videoKey;
  try {
    await storageSet({ [key]: { ts: Date.now(), items } });
  } catch {
    return; // kota dolarsa sessizce vazgeç, çeviri yine çalışır
  }

  const index = (await loadIndex()).filter((e) => e.key !== videoKey);
  index.push({ key: videoKey, ts: Date.now() });
  index.sort((a, b) => b.ts - a.ts);

  if (index.length > MAX_VIDEOS) {
    const drop = index.splice(MAX_VIDEOS);
    await storageRemove(drop.map((e) => 'ayc:v:' + e.key));
    for (const e of drop) memStore.delete(e.key);
  }
  await storageSet({ [INDEX_KEY]: index });
}

async function loadIndex() {
  const stored = await storageGet(INDEX_KEY);
  const idx = stored[INDEX_KEY];
  return Array.isArray(idx) ? idx : [];
}

export async function cacheClear() {
  for (const t of writeTimers.values()) clearTimeout(t);
  writeTimers.clear();
  dirty.clear();
  memStore.clear();

  const index = await loadIndex();
  const keys = index.map((e) => 'ayc:v:' + e.key);
  if (keys.length) await storageRemove(keys);
  await storageRemove(INDEX_KEY);

  // index dışında kalmış olabilecek anahtarları da temizle
  const all = await storageGet(null);
  const stray = Object.keys(all).filter((k) => k.startsWith('ayc:v:'));
  if (stray.length) await storageRemove(stray);

  return { cleared: keys.length + stray.length };
}

export async function cacheStats() {
  const index = await loadIndex();
  const all = await storageGet(null);
  let items = 0;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ayc:v:') && v?.items) items += Object.keys(v.items).length;
  }
  return { videos: index.length, items };
}
