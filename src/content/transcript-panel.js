// YouTube'un kendi "Transkripti göster" panelinden tam altyazıyı okur.
// Innertube get_transcript uç noktası PoToken istediği için (400 FAILED_PRECONDITION)
// bu yol ana yedektir: YouTube'un kendi arayüzü veriyi nasıl alıyorsa öyle alır.

(() => {
  const AYC = window.__AYC;
  if (AYC.getTranscriptFromPanel) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SEG = 'ytd-transcript-segment-renderer';

  const panelElement = () =>
    document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');

  const isOpen = (el) =>
    Boolean(el) && el.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';

  const BUTTON_RE = /transcript|transkript|transcri|transkripci|транскрип|字幕|자막/i;

  function findTranscriptButton() {
    const direct = document.querySelector(
      'ytd-video-description-transcript-section-renderer button'
    );
    if (direct) return direct;

    const label = (b) =>
      `${b.textContent || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;

    for (const scope of ['ytd-watch-metadata', '#description', '#above-the-fold']) {
      const root = document.querySelector(scope);
      if (!root) continue;
      const found = Array.from(root.querySelectorAll('button')).find((b) =>
        BUTTON_RE.test(label(b))
      );
      if (found) return found;
    }

    return (
      Array.from(document.querySelectorAll('button')).find((b) => BUTTON_RE.test(label(b))) || null
    );
  }

  function toSeconds(text) {
    const clean = String(text || '')
      .trim()
      .replace(/[^\d:]/g, '');
    if (!clean || clean === ':') return NaN;
    const parts = clean.split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  function readSegments() {
    const nodes = Array.from(document.querySelectorAll(SEG));
    const raw = nodes
      .map((node) => {
        const tsEl = node.querySelector('.segment-timestamp');
        const textEl = node.querySelector('.segment-text');
        return {
          start: toSeconds(tsEl?.textContent),
          text: String(textEl?.textContent || '').replace(/\s+/g, ' ').trim()
        };
      })
      .filter((s) => Number.isFinite(s.start) && s.text);

    return raw.map((s, i) => ({
      start: s.start,
      end: raw[i + 1] && raw[i + 1].start > s.start ? raw[i + 1].start : s.start + 3,
      text: s.text
    }));
  }

  function closePanel() {
    const panel = panelElement();
    const closeBtn =
      panel?.querySelector('#visibility-button button') ||
      document.querySelector('ytd-engagement-panel-title-header-renderer #visibility-button button');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
  }

  /**
   * @param {{timeout?: number}} opts
   * @returns {Promise<Array<{start:number,end:number,text:string}>>}
   */
  AYC.getTranscriptFromPanel = async ({ timeout = 20000 } = {}) => {
    if (!AYC.videoId()) throw new Error('VIDEO_ID_YOK');

    const panel = panelElement();
    const alreadyOpen = isOpen(panel);
    let opened = false;

    if (!alreadyOpen) {
      // Açıklama kutusu kapalıysa aç
      const expand = document.querySelector('#expand');
      if (expand && expand.getBoundingClientRect().height > 0) {
        expand.click();
        await sleep(400);
      }

      const btn = findTranscriptButton();
      if (!btn) throw new Error('TRANSKRIPT_DUGMESI_YOK');
      btn.click();
      opened = true;
    }

    const deadline = Date.now() + timeout;
    let segments = [];
    let hiddenPanel = null;

    try {
      while (Date.now() < deadline) {
        const el = panelElement();
        if (el && isOpen(el)) {
          // Kullanıcı panelin açılıp kapanmasını görmesin
          if (!hiddenPanel) {
            hiddenPanel = el;
            hiddenPanel.style.visibility = 'hidden';
          }
          segments = readSegments();
          if (segments.length) break;
        }
        await sleep(250);
      }
    } finally {
      if (hiddenPanel) hiddenPanel.style.visibility = '';
      if (opened) closePanel();
    }

    if (!segments.length) throw new Error('TRANSKRIPT_BOS');
    return segments;
  };
})();
