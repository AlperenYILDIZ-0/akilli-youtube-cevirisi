// Tam altyazı metnini MAIN-world köprüsünden alır.

(() => {
  const AYC = window.__AYC;
  if (AYC.transcript) return;

  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__ayc !== 'response' || !data.id) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(String(data.error || 'köprü hatası')));
  });

  function callBridge(action, payload, timeout) {
    return new Promise((resolve, reject) => {
      const id = `ayc-${++seq}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('KÖPRÜ_ZAMAN_AŞIMI'));
      }, timeout);

      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });

      window.postMessage({ __ayc: 'request', id, action, payload }, '*');
    });
  }

  const FRIENDLY = {
    ALTYAZI_YOK: 'Bu videoda altyazı/transcript yok.',
    ALTYAZI_BOS: 'Altyazı metni boş geldi.',
    VIDEO_ID_YOK: 'Video kimliği bulunamadı.',
    KÖPRÜ_ZAMAN_AŞIMI: 'Altyazı isteği zaman aşımına uğradı.'
  };

  /**
   * @param {string} videoId
   * @returns {Promise<Array<{start:number,end:number,text:string}>>}
   */
  AYC.getTranscript = async (videoId, timeout = 20000) => {
    let raw;
    try {
      raw = await callBridge('transcript', { videoId }, timeout);
    } catch (e) {
      const code = String(e?.message || '');
      const err = new Error(FRIENDLY[code] || `Altyazı alınamadı: ${code}`);
      err.code = code;
      throw err;
    }

    if (!Array.isArray(raw) || !raw.length) {
      const err = new Error(FRIENDLY.ALTYAZI_BOS);
      err.code = 'ALTYAZI_BOS';
      throw err;
    }

    const out = raw
      .map((s) => {
        const start = Number(s?.start);
        const end = Number(s?.end);
        const text = String(s?.text || '')
          .replace(/\s+/g, ' ')
          .trim();
        return { start, end, text };
      })
      .filter((s) => Number.isFinite(s.start) && s.start >= 0 && s.text)
      .map((s) => ({
        start: s.start,
        end: Number.isFinite(s.end) && s.end > s.start ? s.end : s.start + 3,
        text: s.text
      }))
      .sort((a, b) => a.start - b.start);

    if (!out.length) {
      const err = new Error(FRIENDLY.ALTYAZI_BOS);
      err.code = 'ALTYAZI_BOS';
      throw err;
    }
    return out;
  };

  AYC.transcript = true;

  /** Genel köprü çağrısı (diğer modüller kullanır). */
  AYC.bridgeCall = (action, payload, timeout = 8000) => callBridge(action, payload, timeout);
})();
