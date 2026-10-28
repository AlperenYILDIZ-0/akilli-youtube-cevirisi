// Çeviri motoru: altyazıyı zamanla eşler, AI isteklerini planlar, katmana basar.

(() => {
  const AYC = window.__AYC;
  if (AYC.Engine) return;

  const LIVE_MAX_CHUNKS = 400;
  const TICK_MS = 200;

  // Canlı mod: satır büyürken yerinde güncelleme (progressive refinement).
  const LIVE_MIN_GROWTH = 16; // bu kadar yeni karakter birikmeden yeniden çevirme
  const LIVE_FIRST_WAIT_MS = 500; // yeni satırın ilk isteği için kısa bekleme
  const LIVE_FIRST_MIN_CHARS = 24; // satır bu kadar uzunsa ilk istekte bekleme
  const LIVE_DEFAULT_REFRESH_MS = 1200; // aynı satırın iki isteği arası en az süre
  const LIVE_DEFAULT_MAX_RPM = 24; // dakikada en fazla istek (429 fırtınasını önler)
  const LIVE_WARN_AFTER_MS = 8000; // bu kadar OYNAMA süresince altyazı gelmezse uyar
  const LIVE_PILL = 'Canlı mod · satır satır çeviri';
  const LIVE_WAIT_PILL = 'Canlı mod · altyazı bekleniyor…';

  class Engine {
    constructor(video, overlay) {
      this.video = video;
      this.overlay = overlay;

      this.videoId = '';
      this.videoTitle = '';
      this.settings = null;
      this.running = false;

      this.mode = 'transcript'; // 'transcript' (tam metin) | 'live' (DOM yakalama)
      this.chunks = [];
      this.tr = [];
      this.state = []; // 'idle' | 'inflight' | 'ok'
      this.retryAt = [];
      this.dirty = []; // metin değişti, yeniden çevrilmeli
      this.openChunk = null; // canlı modda ekranda büyümeye devam eden satır
      this.sentAt = []; // son 60 saniyede gönderilen isteklerin zamanları

      this.activeRequests = 0;
      this.fatal = null;
      this.watcher = null;
      this.timer = null;

      // Canlı mod uyarı durumu (yanlış/kalıcı "altyazı yakalanamadı" hatasını önler)
      this.playingSince = 0;
      this.liveWarned = false;
      this.livePillSet = false;
    }

    async start(videoId, settings) {
      this.videoId = videoId;
      this.videoTitle = typeof AYC.videoTitle === 'function' ? AYC.videoTitle() : '';
      this.settings = settings;
      this.running = true;

      this.overlay.applySettings(settings);
      this.overlay.setPill('AI çeviri hazırlanıyor…', 'busy');

      let segments = null;
      try {
        segments = await AYC.getTranscript(videoId);
      } catch (err) {
        AYC.log('innertube transcript alınamadı:', err.message);
      }
      if (!this.running) return;

      if (!segments || !segments.length) {
        try {
          this.overlay.setPill('Altyazı paneli okunuyor…', 'busy');
          segments = await AYC.getTranscriptFromPanel();
        } catch (err) {
          AYC.log('transcript paneli alınamadı:', err.message);
        }
        if (!this.running) return;
      }

      if (segments && segments.length) {
        this.chunks = AYC.buildChunks(segments);
      }

      this.tr = new Array(this.chunks.length).fill(null);
      this.state = new Array(this.chunks.length).fill('idle');
      this.retryAt = new Array(this.chunks.length).fill(0);
      this.dirty = new Array(this.chunks.length).fill(false);
      this.openChunk = null;
      this.sentAt = [];

      if (!this.chunks.length) {
        this.startLiveMode();
      } else {
        AYC.log(`transcript hazır: ${segments.length} parça → ${this.chunks.length} cümle`);
      }

      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }

    startLiveMode() {
      this.mode = 'live';
      this.playingSince = 0;
      this.liveWarned = false;
      this.livePillSet = false;
      // Yakalama başlayana kadar YouTube'un kendi altyazısını GÖRÜNÜR bırak:
      // kullanıcı ilk saniyelerde altyazısız kalmasın.
      this.overlay.setNativeHidden(false);
      this.overlay.setPill(LIVE_WAIT_PILL, 'live');

      this.watcher = AYC.createCaptionWatcher({
        video: this.video,
        autoEnable: this.settings.autoEnableCaptions !== false,
        onLine: (line) => this.upsertLive(line)
      });
      this.watcher.start();
    }

    stop() {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      if (this.watcher) this.watcher.stop();
      this.watcher = null;
    }

    /* ---------------- zaman eşleme ---------------- */

    currentIndex(t) {
      const chunks = this.chunks;
      if (!chunks.length) return -1;

      let lo = 0;
      let hi = chunks.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (chunks[mid].start <= t + 0.05) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (ans < 0) return -1;
      const c = chunks[ans];
      if (t > c.end + 1.2) return -1;
      return ans;
    }

    /** t anından sonra başlayan ilk parçanın indeksi (boşluklarda taramayı daraltır). */
    firstIndexFrom(t) {
      const chunks = this.chunks;
      let lo = 0;
      let hi = chunks.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (chunks[mid].start <= t) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(lo, Math.max(0, chunks.length - 1));
    }

    tick() {
      if (!this.running) return;
      const t = Number(this.video?.currentTime) || 0;

      const idx = this.currentIndex(t);
      if (idx >= 0) {
        const chunk = this.chunks[idx];
        const translated = this.tr[idx];
        if (translated) this.overlay.setText(chunk.text, translated, 'ok');
        else this.overlay.setText(chunk.text, '', 'pending');
      } else {
        this.overlay.clear();
      }

      this.pump(t);

      if (this.mode === 'live') {
        this.checkLiveCaptions();
      } else {
        let done = 0;
        for (let i = 0; i < this.tr.length; i++) if (this.tr[i]) done += 1;
        this.overlay.setProgress(done, this.chunks.length);
      }
    }

    /**
     * Canlı modda "altyazı yakalanamadı" uyarısını doğru zamanda verir ve
     * altyazı gelince KENDİLİĞİNDEN temizler. Video duraklatılmışken uyarı vermez
     * (duraklatılmış videoda altyazı da olmaz).
     */
    checkLiveCaptions() {
      const hasCaptions = this.chunks.length > 0;
      const paused = !this.video || Boolean(this.video.paused);

      if (hasCaptions) {
        this.playingSince = 0;
        // Altyazı yakalandı: gizleme ayarını (yeniden) uygula. Duraklatma
        // sırasında native altyazıyı gösterdiysek devam edince tekrar gizle.
        this.overlay.setNativeHidden(Boolean(this.settings?.hideYouTubeCaptions));
        if (!this.livePillSet) {
          this.livePillSet = true;
          this.liveWarned = false;
          this.overlay.setPill(LIVE_PILL, 'live');
        }
        return;
      }

      if (paused) {
        this.playingSince = 0;
        // Altyazı yakalanamıyorsa YouTube'un kendi altyazısı görünür kalsın.
        this.overlay.setNativeHidden(false);
        if (this.liveWarned) {
          this.liveWarned = false;
          this.livePillSet = true;
          this.overlay.setPill(LIVE_WAIT_PILL, 'live');
        }
        return;
      }

      // Henüz altyazı yakalanamadı: kullanıcıyı altyazısız bırakma.
      this.overlay.setNativeHidden(false);
      if (!this.playingSince) this.playingSince = Date.now();
      if (Date.now() - this.playingSince < LIVE_WARN_AFTER_MS) return;
      if (this.liveWarned) return;

      this.liveWarned = true;
      this.livePillSet = false;
      // Kullanıcı altyazısız kalmasın: YouTube'un kendi altyazısını geri göster.
      this.overlay.setNativeHidden(false);
      this.overlay.setError('Altyazı yakalanamadı. Oynatıcıda CC (altyazı) düğmesini açın.');
    }

    /* ---------------- istek planlama ---------------- */

    pump(t) {
      if (!this.running || this.fatal) return;
      if (!this.chunks.length) return;
      if (this.activeRequests >= this.maxParallel()) return;
      if (!this.canSend()) return;

      const now = Date.now();
      const ready = (i) => {
        if (!this.chunks[i]) return false;
        if (this.state[i] === 'inflight') return false;
        if ((this.retryAt[i] || 0) > now) return false;
        if (!this.tr[i]) return true;
        return Boolean(this.dirty[i]);
      };

      const picked = [];
      let chars = 0;
      const take = (i) => {
        const len = this.chunks[i].text.length;
        if (picked.length && chars + len > this.maxChars()) return false;
        picked.push(i);
        chars += len;
        return picked.length < this.maxItems();
      };

      if (this.mode === 'live') {
        // 1) Ekrandaki satırı TEK öğe olarak gönder: en düşük gecikme.
        const cur = this.currentIndex(t);
        if (cur >= 0 && ready(cur)) {
          this.fetchBatch([cur]);
          return;
        }
        // 2) Ekrandaki satır hazırsa, boşta kalan kapasiteyle en yenileri tamamla
        //    (DVR ile geri sarılan yerler, çeviri kaçıran satırlar).
        //    Son yuva ekrandaki satıra ayrılır: geri doldurma onu geciktirmesin.
        if (this.maxParallel() < 2) return;
        if (this.activeRequests >= this.maxParallel() - 1) return;
        const stopAt = Math.max(0, this.chunks.length - 12);
        for (let i = this.chunks.length - 1; i >= stopAt; i--) {
          if (i === cur) continue;
          if (!ready(i)) continue;
          if (!take(i)) break;
        }
        if (picked.length) this.fetchBatch(picked.sort((a, b) => a - b));
        return;
      }

      const lookahead = Math.max(15, Number(this.settings.lookahead) || 60);
      const horizon = t + lookahead;
      const at = this.currentIndex(t);
      const from = at >= 0 ? at : this.firstIndexFrom(t);

      // 1) Öncelik: ekrandaki cümle + ileri pencere. Kullanıcı asla beklemesin.
      for (let i = from; i < this.chunks.length; i++) {
        const c = this.chunks[i];
        if (c.end < t - 3) continue;
        if (c.start > horizon) break;
        if (!ready(i)) continue;
        if (!take(i)) break;
      }

      if (picked.length) {
        this.fetchBatch(picked);
        return;
      }

      // 2) Pencere hazırsa tüm videoyu arka planda sırayla doldur.
      //    Böylece kullanıcı ileri sardığında çeviri çoğunlukla hazır olur.
      if (this.settings.pretranslateAll === false) return;

      for (let i = from; i < this.chunks.length; i++) {
        if (this.chunks[i].start <= horizon) continue;
        if (!ready(i)) continue;
        if (!take(i)) break;
      }

      // İleriye dönük parça kalmadıysa geriye kalan boşlukları doldur
      // (ileri sarma sonrası başta çevrilmemiş yer kalmasın).
      if (!picked.length) {
        for (let i = 0; i < from; i++) {
          if (!ready(i)) continue;
          if (!take(i)) break;
        }
      }

      if (picked.length) this.fetchBatch(picked);
    }

    async fetchBatch(indices) {
      this.activeRequests += 1;

      // Canlı modda budama (prune) diziyi kaydırabildiği için indeks yerine parça
      // nesnesine göre çalışıyoruz. Gönderilen metnin kopyası da saklanır:
      // yanıt gelene kadar satır büyümüş olabilir.
      const targets = indices
        .map((i) => this.chunks[i])
        .filter(Boolean)
        .map((chunk) => ({ chunk, text: chunk.text }));

      if (!targets.length) {
        this.activeRequests -= 1;
        return;
      }

      targets.forEach(({ chunk }) => {
        const i = this.chunks.indexOf(chunk);
        if (i >= 0) this.state[i] = 'inflight';
        chunk.sentText = chunk.text;
        chunk.sentLen = chunk.text.length;
      });

      this.noteSend();

      const items = targets.map((t) => t.text);
      const firstIdx = this.chunks.indexOf(targets[0].chunk);
      const lastIdx = this.chunks.indexOf(targets[targets.length - 1].chunk);

      const before = [];
      for (let i = firstIdx - 1; i >= 0 && before.length < 3; i--) {
        if (this.tr[i]) before.unshift(this.tr[i]);
      }
      const after = this.chunks.slice(lastIdx + 1, lastIdx + 4).map((c) => c.text);

      try {
        const res = await AYC.send({
          type: 'translate',
          payload: {
            videoId: this.videoId,
            videoTitle: this.videoTitle,
            items,
            before,
            after,
            targetLang: this.settings.targetLang
          }
        });
        if (!this.running) return;

        const translations = res.translations || [];
        targets.forEach(({ chunk, text }, k) => {
          const i = this.chunks.indexOf(chunk);
          if (i < 0) return; // budanmış
          const value = translations[k];
          if (!value) {
            this.state[i] = 'idle';
            this.retryAt[i] = Date.now() + 20000;
            return;
          }

          if (chunk.text === text) {
            this.tr[i] = value;
            this.dirty[i] = false;
            this.state[i] = 'ok';
            return;
          }

          // Satır bu arada büyüdü: çeviri eski metne ait.
          // Boşsa geçici olarak göster, yeterince büyüdüyse yeniden çevir.
          if (!this.tr[i]) this.tr[i] = value;
          this.state[i] = 'idle';
          if (chunk.text.length - text.length >= this.liveMinGrowth()) {
            this.dirty[i] = true;
            this.scheduleLive(i, this.liveRefreshMs());
          }
        });
      } catch (err) {
        const wait = err?.retryAfter ? err.retryAfter * 1000 : 15000;
        targets.forEach(({ chunk }) => {
          const i = this.chunks.indexOf(chunk);
          if (i < 0) return;
          if (this.state[i] === 'inflight') {
            this.state[i] = 'idle';
            this.retryAt[i] = Date.now() + wait;
          }
        });

        if (err?.fatal) {
          this.fatal = err.message;
          this.overlay.setError(err.message);
        } else {
          const msg = String(err?.message || err);
          this.overlay.setPill(`AI isteği başarısız: ${msg.slice(0, 90)}`, 'error');
        }
      } finally {
        targets.forEach(({ chunk }) => {
          const i = this.chunks.indexOf(chunk);
          if (i >= 0 && this.state[i] === 'inflight') this.state[i] = 'idle';
        });
        this.activeRequests -= 1;
      }
    }

    /* ---------------- canlı mod ---------------- */

    /**
     * Canlı altyazı satırını işler. Aynı satır büyüdükçe metin yerinde güncellenir
     * (final:false), satır kapanınca son hâli gönderilir (final:true).
     */
    upsertLive(line) {
      if (!this.running) return;

      const text = String(line?.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return;

      const final = line?.final !== false;
      const start = Math.max(0, Number(line?.start) || 0);
      const end = Math.max(start, Number(line?.end) || start);
      const now = Date.now();

      const openIdx = this.openChunk ? this.chunks.indexOf(this.openChunk) : -1;
      const open = openIdx >= 0 ? this.chunks[openIdx] : null;

      if (open) {
        const changed = open.text !== text;
        open.text = text;

        if (final) {
          // Satır kapandı: gerçek bitiş zamanını yaz, son çeviriyi hemen iste.
          open.end = Math.max(start + 0.4, end);
          this.openChunk = null;
          if (changed || !this.tr[openIdx]) this.dirty[openIdx] = true;
          // Uzun 429 geri çekilmesini ezme; yalnızca kısa planlama gecikmesini sıfırla.
          if ((this.retryAt[openIdx] || 0) - now < 5000) this.retryAt[openIdx] = now;
        } else {
          open.end = start + 1e6; // süresi henüz bilinmiyor
          const grown = text.length - (open.sentLen || 0);
          if (changed && grown >= this.liveMinGrowth()) {
            this.dirty[openIdx] = true;
            if (!open.sentLen && text.length >= LIVE_FIRST_MIN_CHARS) {
              // Satır ilk istek için yeterince uzadı: 500 ms beklemesini iptal et.
              this.retryAt[openIdx] = now;
            } else {
              this.scheduleLive(openIdx, this.liveRefreshMs());
            }
          }
        }

        this.tick();
        return;
      }

      // Yeni satır
      const chunk = {
        start,
        end: final ? Math.max(start + 0.4, end) : start + 1e6,
        text,
        sentText: '',
        sentLen: 0
      };
      this.insertLiveChunk(
        chunk,
        final ? now : now + (text.length >= LIVE_FIRST_MIN_CHARS ? 0 : LIVE_FIRST_WAIT_MS)
      );
      if (!final) this.openChunk = chunk;

      this.prune();
      this.tick();
    }

    /**
     * Parçayı başlangıç zamanına göre sıralı yerleştirir (DVR ile geri sarma
     * ikili aramayı bozmasın) ve tüm yardımcı dizileri hizalı tutar.
     */
    insertLiveChunk(chunk, retryAt) {
      const chunks = this.chunks;
      let at = chunks.length;
      while (at > 0 && chunks[at - 1].start > chunk.start) at -= 1;

      chunks.splice(at, 0, chunk);
      this.tr.splice(at, 0, null);
      this.state.splice(at, 0, 'idle');
      this.retryAt.splice(at, 0, retryAt);
      this.dirty.splice(at, 0, true);
      return at;
    }

    /** Satır için yeniden çeviri zamanı; ileri bir plan varsa onu erkene çekmez. */
    scheduleLive(i, delayMs) {
      const now = Date.now();
      if ((this.retryAt[i] || 0) <= now) this.retryAt[i] = now + delayMs;
    }

    prune() {
      if (this.chunks.length <= LIVE_MAX_CHUNKS) return;
      const drop = this.chunks.length - LIVE_MAX_CHUNKS;
      const dropped = this.chunks.splice(0, drop);
      this.tr.splice(0, drop);
      this.state.splice(0, drop);
      this.retryAt.splice(0, drop);
      this.dirty.splice(0, drop);
      if (this.openChunk && dropped.includes(this.openChunk)) this.openChunk = null;
    }

    /* ---------------- sınırlar / hız ---------------- */

    liveMinGrowth() {
      return Math.max(1, Number(this.settings?.liveMinGrowth) || LIVE_MIN_GROWTH);
    }

    liveRefreshMs() {
      const v = Number(this.settings?.liveRefreshMs);
      return Number.isFinite(v) && v > 0 ? Math.max(200, v) : LIVE_DEFAULT_REFRESH_MS;
    }

    maxRpm() {
      const v = Number(this.settings?.liveMaxRpm);
      return Number.isFinite(v) ? Math.max(0, Math.min(120, v)) : LIVE_DEFAULT_MAX_RPM;
    }

    /** Dakikalık istek bütçesi (429 fırtınasını önler). 0 = sınırsız. */
    canSend() {
      const cap = this.maxRpm();
      if (!cap) return true;
      const now = Date.now();
      this.sentAt = this.sentAt.filter((at) => now - at < 60000);
      return this.sentAt.length < cap;
    }

    noteSend() {
      this.sentAt.push(Date.now());
      if (this.sentAt.length > 240) this.sentAt.splice(0, this.sentAt.length - 240);
    }

    maxParallel() {
      return Math.max(1, Math.min(4, Number(this.settings?.maxParallel) || 2));
    }

    maxChars() {
      return Math.max(400, Number(this.settings?.batchChars) || 2200);
    }

    maxItems() {
      return Math.max(1, Math.min(30, Number(this.settings?.maxBatchItems) || 12));
    }
  }

  AYC.Engine = Engine;
})();
