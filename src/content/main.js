// YouTube sayfa denetleyicisi: video değişimini izler, motoru kurar/kaldırır.

(() => {
  const AYC = window.__AYC;
  if (AYC.booted) return;
  AYC.booted = true;

  let engine = null;
  let overlay = null;
  let activeVideoId = null;
  let activeLang = null;
  let starting = false;
  let lastHref = location.href;

  const hasApiKey = (s) => (s.provider === 'openai' ? Boolean(s.baseUrl && s.genericModel) : Boolean(s.geminiApiKey));

  function teardown() {
    if (engine) {
      try {
        engine.stop();
      } catch {
        /* yok say */
      }
    }
    if (overlay) {
      try {
        overlay.destroy();
      } catch {
        /* yok say */
      }
    }
    engine = null;
    overlay = null;
    activeVideoId = null;
    activeLang = null;
    window.__AYC_ENGINE = null;
  }

  async function start() {
    if (starting) return;
    if (!AYC.videoId()) {
      teardown();
      return;
    }
    if (activeVideoId === AYC.videoId() && engine?.running) return;

    starting = true;
    try {
      let settings;
      try {
        settings = await AYC.getSettings();
      } catch {
        return;
      }
      if (!settings || !settings.enabled) {
        teardown();
        return;
      }

      const video = await AYC.waitFor(
        () => document.querySelector('video.html5-main-video') || document.querySelector('video'),
        20000
      );
      if (!video) return;

      teardown();

      overlay = AYC.createOverlay(settings);
      engine = new AYC.Engine(video, overlay);
      window.__AYC_ENGINE = engine;

      activeVideoId = AYC.videoId();
      activeLang = settings.targetLang;

      if (!hasApiKey(settings)) {
        overlay.setError('API anahtarı yok. Eklenti simgesine tıklayıp ücretsiz Gemini anahtarınızı girin.');
      }

      await engine.start(activeVideoId, settings);
    } finally {
      starting = false;
    }
  }

  function toggle() {
    if (overlay) {
      overlay.setVisible(!overlay.isVisible());
      return;
    }
    start();
  }

  /* --- video değişimi --- */

  document.addEventListener('yt-navigate-finish', () => {
    lastHref = location.href;
    teardown();
    setTimeout(start, 500);
  });

  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      teardown();
      setTimeout(start, 500);
      return;
    }
    if (starting) return;
    if (!engine || !engine.running) start();
  }, 1200);

  /* --- ayar değişiklikleri --- */

  AYC.onSettingsChanged(async () => {
    let settings;
    try {
      settings = await AYC.getSettings();
    } catch {
      return;
    }
    if (!settings.enabled) {
      teardown();
      return;
    }
    if (!overlay) {
      start();
      return;
    }

    const restartNeeded =
      settings.targetLang !== activeLang || engine?.fatal || (engine?.mode === 'live' && !engine?.watcher);

    overlay.applySettings(settings);
    if (engine) engine.settings = settings;

    if (restartNeeded) {
      teardown();
      setTimeout(start, 200);
    } else if (engine?.fatal && hasApiKey(settings)) {
      engine.fatal = null;
    }
  });

  /* --- kısayol / açılır pencere mesajları --- */

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ui:toggle') toggle();
    else if (msg?.type === 'ui:reload') {
      teardown();
      setTimeout(start, 100);
    }
  });

  start();
})();
