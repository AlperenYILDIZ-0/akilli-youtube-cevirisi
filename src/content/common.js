// Ortak yardımcılar (içerik betiği dünyası).
// Diğer içerik dosyaları bu isim alanını kullanır.

(() => {
  const AYC = (window.__AYC = window.__AYC || {});
  if (AYC.common) return;

  AYC.DEBUG = false;
  AYC.log = (...a) => {
    if (AYC.DEBUG) console.log('[AYC]', ...a);
  };
  AYC.warn = (...a) => console.warn('[AYC]', ...a);

  AYC.videoId = () => {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      const m = u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{6,})/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  };

  /** Video başlığını temizler; modelin konu/terim bağlamı için kullanılır. */
  AYC.videoTitle = () => {
    try {
      const el = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1'
      );
      const raw = el?.textContent || document.title || '';
      return raw
        .replace(/\s*[-–—]\s*YouTube\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    } catch {
      return '';
    }
  };

  /** Koşul sağlanana kadar bekler; süre dolarsa null döner. */
  AYC.waitFor = (fn, timeout = 15000, interval = 150) =>
    new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        let value = null;
        try {
          value = fn();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(check, interval);
      };
      check();
    });

  /** Arka plana istek atar; hata veya zaman aşımında reddeder. */
  AYC.send = (msg, timeout = 120000) =>
    new Promise((resolve, reject) => {
      let done = false;
      let timer = null;

      const finish = (fn, value) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        fn(value);
      };

      if (timeout > 0) {
        timer = setTimeout(() => {
          finish(reject, Object.assign(new Error('Arka plan yanıtı zaman aşımına uğradı'), {
            code: 'TIMEOUT'
          }));
        }, timeout);
      }

      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            finish(reject, new Error(err.message || 'Arka plana ulaşılamadı'));
            return;
          }
          if (!res) {
            finish(reject, new Error('Arka plan yanıt vermedi'));
            return;
          }
          if (res.ok === false) {
            const e = new Error(res.error || 'Bilinmeyen hata');
            e.code = res.code;
            e.retryAfter = res.retryAfter || 0;
            e.fatal = Boolean(res.fatal);
            finish(reject, e);
            return;
          }
          finish(resolve, res);
        });
      } catch (e) {
        finish(reject, e);
      }
    });

  AYC.getSettings = async () => {
    const res = await AYC.send({ type: 'settings:get' });
    return res.settings;
  };

  AYC.onSettingsChanged = (cb) => {
    try {
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === 'local') cb();
      });
    } catch {
      /* yok say */
    }
  };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const endsSentence = (t) => /[.!?…]["'”’)\]]?$/.test(t.trim());

  /**
   * Kısa altyazı parçalarını cümle bütünlüğü olan çeviri birimlerine dönüştürür.
   * YouTube'un 2-3 kelimelik parçalarını tek tek çevirmek kaliteyi bozar.
   */
  AYC.buildChunks = (segments, { maxDuration = 14, maxChars = 300 } = {}) => {
    const chunks = [];
    let cur = null;

    for (const seg of segments) {
      const text = clean(seg.text);
      if (!text) continue;

      const start = Number(seg.start);
      if (!Number.isFinite(start) || start < 0) continue;
      const rawEnd = Number(seg.end);
      const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 3;

      const needNew =
        cur &&
        (cur.endsSentence ||
          cur.end - cur.start >= maxDuration ||
          cur.text.length + text.length > maxChars);

      if (needNew) {
        chunks.push(cur);
        cur = null;
      }

      if (!cur) {
        cur = { start, end, text, endsSentence: false };
      } else {
        cur.text = `${cur.text} ${text}`;
        cur.end = Math.max(cur.end, end);
      }
      cur.endsSentence = endsSentence(cur.text);
    }

    if (cur) chunks.push(cur);

    // Zaman damgası bozuk / çakışan parçaları ayıkla
    return chunks
      .filter((c) => Number.isFinite(c.start) && c.text)
      .map((c) => ({
        start: c.start,
        end: Number.isFinite(c.end) && c.end > c.start ? c.end : c.start + 3,
        text: c.text
      }));
  };

  AYC.common = true;
})();
