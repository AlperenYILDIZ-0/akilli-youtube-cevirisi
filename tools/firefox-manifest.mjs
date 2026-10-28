// Chrome manifest.json → Firefox manifest.json dönüşümü.
// Farklar:
//  - Firefox `background.service_worker` desteklemiyor; olay sayfası (event page) kullanır.
//  - `content_scripts[].world: "MAIN"` Firefox 128'den itibaren destekleniyor.
//  - `minimum_chrome_version` Firefox'ta anlamsız; `browser_specific_settings` gerekir.

export const FIREFOX_MIN_VERSION = '128.0';
export const FIREFOX_ID = 'youtube-ceviri@local';

/**
 * @param {object} chromeManifest
 * @returns {object} Firefox manifest nesnesi
 */
export function toFirefoxManifest(chromeManifest) {
  const m = JSON.parse(JSON.stringify(chromeManifest));

  delete m.minimum_chrome_version;
  delete m.background;

  m.background = {
    scripts: ['src/background.js'],
    type: 'module'
  };

  m.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ID,
      strict_min_version: FIREFOX_MIN_VERSION
    }
  };

  return m;
}

/** Dönüşümün doğruluğunu denetler; sorun listesi döndürür (boş = sorun yok). */
export function validateFirefoxManifest(firefoxManifest, chromeManifest) {
  const problems = [];
  const bg = firefoxManifest.background || {};

  if (bg.service_worker) problems.push('background.service_worker Firefox tarafından desteklenmiyor');
  if (!Array.isArray(bg.scripts) || !bg.scripts.length) problems.push('background.scripts eksik');
  if (bg.type !== 'module') problems.push('background.type "module" olmalı (import kullanılıyor)');
  if (!firefoxManifest.browser_specific_settings?.gecko?.id) problems.push('gecko id eksik');

  const min = Number(firefoxManifest.browser_specific_settings?.gecko?.strict_min_version);
  if (!Number.isFinite(min) || min < 128) {
    problems.push('strict_min_version en az 128 olmalı (content_scripts.world: MAIN)');
  }

  const mainWorld = (firefoxManifest.content_scripts || []).some((cs) => cs.world === 'MAIN');
  if (!mainWorld) problems.push('MAIN world içerik betiği kaybolmuş');

  const chromeScripts = (chromeManifest.content_scripts || []).flatMap((cs) => cs.js || []);
  const firefoxScripts = (firefoxManifest.content_scripts || []).flatMap((cs) => cs.js || []);
  if (chromeScripts.join('|') !== firefoxScripts.join('|')) {
    problems.push('content_scripts listesi Chrome sürümüyle aynı değil');
  }

  return problems;
}
