// Canlı yayınlar ve transcript'i olmayan videolar için DOM altyazı yakalayıcı.
// YouTube'un kendi altyazı penceresini izler ve satırı OLUŞURKEN iletir:
// cümle sonu beklenmez, satır büyüdükçe "final:false" ile yerinde güncellenir.

(() => {
  const AYC = window.__AYC;
  if (AYC.createCaptionWatcher) return;

  const SEL_WINDOW = '.ytp-caption-window-container .caption-window';
  const SEL_SEGMENT = '.ytp-caption-segment';
  const POLL_MS = 150; // canlı his için sık örnekle
  const MIN_EMIT_GAP = 180; // aynı satırın güncellemeleri arası en az süre
  const MISSING_GRACE_MS = 250; // altyazı bir kare kayboldu diye satırı kapatma
  const STUCK_MS = 6000; // ekranda hiç değişmeyen satırı kapat
  const MAX_LINE_CHARS = 320;

  const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const commonPrefix = (a, b) => {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i += 1;
    return i;
  };

  /**
   * YouTube konuşma tanıma aynı satırı yeniden yazabiliyor ("their" → "there",
   * "we're" → "were"). Uzun ortak önek varsa yeni satır değil, düzeltme say.
   */
  const sameLine = (a, b) => {
    if (!a || !b) return false;
    if (a.startsWith(b) || b.startsWith(a)) return true;
    const shared = commonPrefix(a, b);
    return shared >= Math.max(6, Math.min(a.length, b.length) * 0.6);
  };

  function readVisibleText() {
    const windows = Array.from(document.querySelectorAll(SEL_WINDOW)).filter((w) => {
      const r = w.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && getComputedStyle(w).visibility !== 'hidden';
    });
    if (!windows.length) return '';

    return windows
      .map((w) => {
        const segs = Array.from(w.querySelectorAll(SEL_SEGMENT));
        const text = segs.length
          ? segs.map((s) => s.textContent || '').join(' ')
          : w.textContent || '';
        return normalize(text);
      })
      .filter(Boolean)
      .join(' ');
  }

  function subtitlesButton() {
    return document.querySelector('.ytp-subtitles-button, button[aria-keyshortcuts="c"]');
  }

  function ensureCaptionsOn(preferLang) {
    let tries = 0;
    let trackSet = false;

    const applyTrack = () => {
      if (trackSet || !AYC.bridgeCall) return;
      AYC.bridgeCall('captionTrack', { preferLang: preferLang || '' }, 5000)
        .then((res) => {
          if (res && res.ok) {
            trackSet = true;
            AYC.log('altyazı parçası:', res.languageCode, res.kind || 'manuel');
          }
        })
        .catch(() => {});
    };

    const timer = setInterval(() => {
      tries += 1;
      const btn = subtitlesButton();
      if (!btn || tries > 20) {
        clearInterval(timer);
        return;
      }
      if (btn.getAttribute('aria-pressed') === 'false') btn.click();
      applyTrack();
      if (document.querySelector(SEL_WINDOW)) {
        setTimeout(() => {
          applyTrack();
          clearInterval(timer);
        }, 600);
      }
    }, 1500);

    return timer;
  }

  /**
   * @param {{video: HTMLVideoElement, onLine: (line:{text:string,start:number,end:number,final:boolean})=>void, autoEnable?: boolean, preferLang?: string}} opts
   */
  AYC.createCaptionWatcher = ({ video, onLine, autoEnable = true, preferLang = '' }) => {
    let timer = null;
    let ccTimer = null;

    let current = ''; // ekranda görünen satır
    let currentStart = 0; // satırın başladığı video zamanı
    let lastSeen = 0; // satırın en son görüldüğü video zamanı
    let lastChange = 0; // metnin son değiştiği gerçek zaman
    let missingSince = 0; // satırın kaybolmaya başladığı gerçek zaman
    let lastEmit = 0; // son onLine çağrısı (gerçek zaman)
    let emittedText = ''; // en son iletilen metin
    let stopped = false;

    const emit = (text, end, final) => {
      const clean = normalize(text);
      if (!clean) return;
      lastEmit = Date.now();
      if (!final) emittedText = clean;
      onLine({ text: clean, start: currentStart, end: Math.max(end, currentStart), final });
    };

    const finalize = (end) => {
      const text = normalize(current);
      current = '';
      emittedText = '';
      if (!text) return;
      emit(text, end, true);
    };

    const tick = () => {
      if (stopped) return;
      const now = Number(video?.currentTime) || 0;
      const text = readVisibleText();

      if (text) {
        missingSince = 0;
        if (current && !sameLine(text, current)) {
          // Yeni satır: öncekini kapat, yenisini başlat.
          finalize(lastSeen || now);
          currentStart = now;
        } else if (!current) {
          currentStart = now;
        }
        if (text !== current) lastChange = Date.now();
        current = text.length > MAX_LINE_CHARS ? text.slice(-MAX_LINE_CHARS) : text;
        lastSeen = now;
      } else if (current) {
        // Kısa kaybolmalar (oynatıcı yeniden çizimi) satırı bölmesin.
        if (!missingSince) missingSince = Date.now();
        if (Date.now() - missingSince >= MISSING_GRACE_MS) finalize(lastSeen || now);
      }

      // Video duraklatıldı ya da altyazı takıldı: açık satırı kapat.
      if (current && Date.now() - lastChange > STUCK_MS) finalize(lastSeen || now);

      // Satır büyüdükçe YERİNDE güncelle: cümle sonunu bekleme.
      if (current && current !== emittedText && Date.now() - lastEmit >= MIN_EMIT_GAP) {
        emit(current, lastSeen || now, false);
      }
    };

    return {
      start() {
        stopped = false;
        if (autoEnable) ccTimer = ensureCaptionsOn(preferLang);
        timer = setInterval(tick, POLL_MS);
        tick();
      },
      stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        if (ccTimer) clearInterval(ccTimer);
        timer = null;
        ccTimer = null;
      },
      hasCaptions() {
        return Boolean(document.querySelector(SEL_WINDOW));
      }
    };
  };
})();
