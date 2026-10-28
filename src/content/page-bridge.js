// SAYFA DÜNYASI (MAIN world) köprüsü.
// YouTube'un kendi Innertube API'sini sayfanın oturumuyla çağırır ve tam altyazı metnini
// zaman damgalarıyla birlikte döndürür. İzole dünyadaki içerik betiği ile postMessage üzerinden konuşur.

(() => {
  const FLAG = '__AYC_BRIDGE_V1__';
  if (window[FLAG]) return;
  try {
    Object.defineProperty(window, FLAG, { value: true, enumerable: false });
  } catch {
    window[FLAG] = true;
  }

  const TAG = '__ayc';

  function ytcfgGet(key) {
    try {
      return window.ytcfg?.get?.(key);
    } catch {
      return undefined;
    }
  }

  function apiKey() {
    return (
      ytcfgGet('INNERTUBE_API_KEY') ||
      ytcfgGet('INNERTUBE_API_KEY_') ||
      ''
    );
  }

  function context() {
    const ctx = ytcfgGet('INNERTUBE_CONTEXT');
    if (ctx && typeof ctx === 'object') return ctx;
    return {
      client: {
        clientName: 'WEB',
        clientVersion: ytcfgGet('INNERTUBE_CLIENT_VERSION') || '2.20240101.00.00',
        hl: document.documentElement.lang || 'en',
        gl: 'US'
      }
    };
  }

  async function innertube(method, body) {
    const key = apiKey();
    if (!key) throw new Error('INNERTUBE_ANAHTAR_YOK');
    const url = `/youtubei/v1/${method}?prettyPrint=false&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ context: context(), ...body })
    });
    if (!res.ok) {
      throw new Error(`innertube ${method} HTTP ${res.status}`);
    }
    return await res.json();
  }

  function walk(node, visit, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    visit(node);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, visit, depth + 1);
    }
  }

  function runsToText(obj) {
    if (!obj) return '';
    if (typeof obj.simpleText === 'string') return obj.simpleText.replace(/\s+/g, ' ').trim();
    if (Array.isArray(obj.runs)) {
      return obj.runs
        .map((r) => (r && typeof r.text === 'string' ? r.text : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return '';
  }

  function findTranscriptParams(data) {
    let params = null;
    walk(data, (node) => {
      if (params) return;
      const p = node?.getTranscriptEndpoint?.params;
      if (typeof p === 'string' && p) params = p;
    });
    return params;
  }

  function parseSegments(data) {
    const segs = [];
    walk(data, (node) => {
      const s = node.transcriptSegmentRenderer;
      if (s) {
        const text = runsToText(s.snippet);
        const start = Number(s.startMs) / 1000;
        const end = Number(s.endMs) / 1000;
        if (text && Number.isFinite(start)) {
          segs.push({ start, end: Number.isFinite(end) && end > start ? end : start + 3, text });
        }
        return;
      }
      const c = node.transcriptCueRenderer;
      if (c) {
        const text = runsToText(c.cue);
        const start = Number(c.startOffsetMs) / 1000;
        const dur = Number(c.durationMs) / 1000;
        if (text && Number.isFinite(start)) {
          segs.push({
            start,
            end: start + (Number.isFinite(dur) && dur > 0.2 ? dur : 3),
            text
          });
        }
      }
    });

    segs.sort((a, b) => a.start - b.start);

    // Aynı başlangıç/zaman damgasına sahip tekrarları at
    const out = [];
    let lastKey = '';
    for (const s of segs) {
      const key = `${s.start.toFixed(2)}|${s.text}`;
      if (key === lastKey) continue;
      lastKey = key;
      out.push(s);
    }
    return out;
  }

  function videoIdFromLocation() {    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      const m = u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{6,})/);
      if (m) return m[1];
      return '';
    } catch {
      return '';
    }
  }

  async function getTranscript(videoId) {
    const id = videoId || videoIdFromLocation();
    if (!id) throw new Error('VIDEO_ID_YOK');

    const next = await innertube('next', { videoId: id });
    const params = findTranscriptParams(next);
    if (!params) throw new Error('ALTYAZI_YOK');

    const transcript = await innertube('get_transcript', { params });
    const segs = parseSegments(transcript);
    if (!segs.length) throw new Error('ALTYAZI_BOS');
    return segs;
  }

  /**
   * Oynatıcı API'siyle altyazı parçasını (track) orijinal dile sabitler.
   * Böylece YouTube'un "otomatik çeviri" ayarı açık olsa bile kaynak metin orijinal olur.
   */
  function setCaptionTrack(preferLang) {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') {
      return { ok: false, reason: 'PLAYER_API_YOK' };
    }

    const list = player.getOption('captions', 'tracklist') || [];
    if (!Array.isArray(list) || !list.length) {
      return { ok: false, reason: 'PARCA_YOK' };
    }

    const norm = (v) => String(v || '').toLowerCase();
    const prefer = norm(preferLang);
    const isAsr = (t) => String(t?.kind || '') === 'asr';
    const sameLang = (t) =>
      prefer &&
      (norm(t.languageCode) === prefer ||
        norm(t.languageCode).split('-')[0] === prefer.split('-')[0]);

    const pick =
      list.find((t) => sameLang(t) && !isAsr(t)) ||
      list.find((t) => sameLang(t)) ||
      list.find((t) => !isAsr(t)) ||
      list[0];

    if (!pick) return { ok: false, reason: 'PARCA_SECILEMEDI' };

    player.setOption('captions', 'track', pick);
    return {
      ok: true,
      languageCode: pick.languageCode || '',
      kind: pick.kind || '',
      displayName: pick.displayName || ''
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[TAG] !== 'request') return;

    const { id, action, payload } = data;
    if (!id) return;

    Promise.resolve()
      .then(() => {
        if (action === 'transcript') return getTranscript(payload?.videoId);
        if (action === 'captionTrack') return setCaptionTrack(payload?.preferLang);
        throw new Error('BILINMEYEN_ISLEM');
      })
      .then((result) => {
        window.postMessage({ [TAG]: 'response', id, ok: true, result }, '*');
      })
      .catch((err) => {
        window.postMessage(
          { [TAG]: 'response', id, ok: false, error: String(err?.message || err) },
          '*'
        );
      });
  });
})();
