// Video üstü çeviri katmanı.

(() => {
  const AYC = window.__AYC;
  if (AYC.createOverlay) return;

  AYC.createOverlay = (settings) => {
    const root = document.createElement('div');
    root.className = 'ayc-layer';
    root.setAttribute('data-pos', settings.position === 'top' ? 'top' : 'bottom');
    root.innerHTML = `
      <div class="ayc-card">
        <div class="ayc-src"></div>
        <div class="ayc-tr"></div>
      </div>
      <div class="ayc-pill" hidden></div>
    `;

    const card = root.querySelector('.ayc-card');
    const srcEl = root.querySelector('.ayc-src');
    const trEl = root.querySelector('.ayc-tr');
    const pill = root.querySelector('.ayc-pill');

    let lastKey = '';
    let shown = false;
    let visible = true;
    let pillTimer = null;
    let attachTimer = null;
    let opts = settings;
    let nativeHidden = Boolean(settings.hideYouTubeCaptions);

    // YouTube'un kendi altyazısını gizle/göster. Canlı mod altyazı yakalayamazsa
    // motor bunu false yaparak kullanıcının altyazısız kalmasını engeller.
    const setNativeHidden = (hidden) => {
      nativeHidden = Boolean(hidden);
      document.body?.classList.toggle('ayc-hide-native', nativeHidden);
    };

    const applySettings = (s) => {
      opts = s;
      root.style.setProperty('--ayc-fs', `${Number(s.fontSize) || 30}px`);
      root.setAttribute('data-pos', s.position === 'top' ? 'top' : 'bottom');
      root.setAttribute('data-hide-src', s.showOriginal ? '0' : '1');
      setNativeHidden(Boolean(s.hideYouTubeCaptions));
      lastKey = ''; // ayar değişince metni yeniden çiz
    };

    const hostElement = () =>
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.body;

    const attach = () => {
      const host = hostElement();
      if (host && root.parentElement !== host) host.appendChild(root);
    };

    const setText = (src, tr, state) => {
      const key = `${state}\u0001${src}\u0001${tr}`;
      if (key === lastKey) return;
      lastKey = key;
      shown = true;

      const pending = state === 'pending';
      const showSrc = Boolean(opts.showOriginal) && Boolean(src);

      card.classList.toggle('is-pending', pending);
      card.classList.toggle('is-empty', !src && !tr);
      card.classList.toggle('is-fallback', pending && !showSrc);
      root.setAttribute('data-hide-src', showSrc ? '0' : '1');

      srcEl.textContent = showSrc ? src : '';
      if (tr) trEl.textContent = tr;
      // Canlı modda çeviri gelene kadar ekran boş kalmasın.
      // "Orijinali göster" kapalıysa İngilizce metni çeviri alanına basma:
      // kullanıcı bu ayarı İngilizce görmemek için kapatmış olabilir.
      else if (pending) trEl.textContent = showSrc ? '· · ·' : 'çevriliyor…';
      else trEl.textContent = '';
    };

    const clear = () => {
      if (!shown) return;
      shown = false;
      lastKey = '';
      card.classList.remove('is-pending');
      card.classList.remove('is-fallback');
      card.classList.add('is-empty');
      srcEl.textContent = '';
      trEl.textContent = '';
    };

    let pillText = '';
    let pillKind = '';

    const setPill = (text, kind = 'info') => {
      clearTimeout(pillTimer);
      if (!text) {
        pill.hidden = true;
        pillText = '';
        pillKind = '';
        return;
      }
      if (text === pillText && kind === pillKind && !pill.hidden) return;
      pillText = text;
      pillKind = kind;
      pill.hidden = false;
      pill.textContent = text;
      pill.setAttribute('data-kind', kind);
      if (kind === 'info') {
        pillTimer = setTimeout(() => {
          pill.hidden = true;
        }, 4500);
      }
    };

    applySettings(settings);
    attach();
    // YouTube oynatıcıyı yeniden çizerse katmanı geri tak
    attachTimer = setInterval(() => {
      if (!root.isConnected) attach();
    }, 2000);

    return {
      root,
      setText,
      clear,
      setPill,
      setNativeHidden,
      applySettings,
      setVisible(v) {
        visible = Boolean(v);
        root.style.display = visible ? '' : 'none';
      },
      isVisible: () => visible,
      setProgress(done, total) {
        if (!total) return;
        if (done >= total) {
          if (pill.getAttribute('data-kind') === 'busy') setPill('', 'busy');
          return;
        }
        const pct = Math.floor((done / total) * 100);
        setPill(`AI çeviri hazırlanıyor · %${pct} (${done}/${total})`, 'busy');
      },
      setError(message) {
        setPill(message, 'error');
      },
      destroy() {
        clearInterval(attachTimer);
        clearTimeout(pillTimer);
        document.body?.classList.remove('ayc-hide-native');
        root.remove();
      }
    };
  };
})();
