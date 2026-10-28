# Akıllı YouTube Çevirisi

YouTube videolarının altyazısını **kendi AI hesabınla** (Gemini ücretsiz katman, Groq, OpenRouter,
Ollama…) canlı olarak hedef dile çeviren bir Chrome/Edge + Firefox eklentisi (Manifest V3, derleme
adımı yok).

YouTube'un kendi otomatik çevirisi kelime kelime çalışır; bu eklenti **cümle bütünlüğü + bağlam**
ile çalışır. Aynı video, aynı anda, belirgin biçimde daha okunur bir çeviri verir.

Canlı yayında ve anlık altyazıda ise **satır satır** çalışır: cümlenin bitmesini beklemez, satır
oluşurken çevirir ve satır büyüdükçe çeviriyi yerinde iyileştirir.

Kaydedilmiş videolarda eklenti yalnızca izlediğin yeri değil, **tüm videoyu arka planda sırayla**
çevirir. İlk saniyeler hemen hazırlanır; kalanı sen videoyu izlerken tamamlanır. Böylece ileri
sardığında çeviri çoğunlukla hazır olur. Video başlığı da modele konu/terim bağlamı olarak verilir.

---

## Neden daha iyi çeviriyor?

| YouTube otomatik çeviri | Bu eklenti |
| --- | --- |
| 2–3 kelimelik parçaları tek tek çevirir | Parçaları **tam cümle** olarak birleştirip çevirir |
| Bağlamı bilmez | Önceki 3 çevrilmiş + sonraki 3 kaynak cümleyi modele bağlam olarak verir |
| Cümle ortasında kopar | Cümleyi bütün olarak çevirir; canlı modda satır biter bitmez basar |
| Terim tutarlılığı yok | Video bazlı önbellek sayesinde aynı terim aynı şekilde çevrilir |
| Model seçilemez | Gemini 3.8 Flash / Llama 3.3 70B / yerel model — sen seçersin |
| Sadece o anı çevirir | 60 saniye ileriyi önceden çevirir, takılma olmaz |
| Canlı yayında 3–5 sn geride kalır | Satır satır çeviri: ilk çeviri ~1 sn'de ekranda |

---

## Kurulum

### Chrome / Edge (2 dakika)

1. `chrome://extensions` adresini aç.
2. Sağ üstten **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** → şu klasörü seç:
   `cikti\youtube-ceviri-eklentisi`
4. Araç çubuğundaki eklenti simgesine tıkla.
5. **API anahtarı** alanına ücretsiz Gemini anahtarını yaz:
   - <https://aistudio.google.com/apikey> → *Create API key* → kopyala.
   - Anahtarı yapıştır, **Bağlantıyı test et** düğmesine bas. Yeşil sonuç görürsen hazırsın.
6. Herhangi bir YouTube videosunu aç. Altyazı, videonun üstünde belirir.

### Firefox (Firefox 128 veya üzeri)

Firefox, Chrome'un `background.service_worker` yapısını desteklemediği için ayrı bir paket
üretiliyor. `cikti\youtube-ceviri-firefox\` klasörü bu pakettir; kaynak kodu aynıdır.

**Geçici kurulum (en hızlı, 1 dakika):**

1. Firefox'ta `about:debugging#/runtime/this-firefox` adresini aç.
2. **Geçici eklenti yükle…** (*Load Temporary Add-on…*) düğmesine bas.
3. `cikti\youtube-ceviri-firefox\manifest.json` dosyasını seç.
4. Araç çubuğundaki eklenti simgesine tıkla → Gemini anahtarını gir → **Kaydet**.
5. YouTube'da bir video aç.

> Geçici eklenti **Firefox kapanınca silinir**; her açılışta 1–3. adımları tekrarlaman
> gerekir. Kalıcı kurulum için aşağıya bak.
>
> Kaynak dosyaları güncelledikten sonra `about:debugging` sayfasındaki eklenti kartında
> **Yeniden Yükle** (*Reload*) düğmesine bas; yoksa Firefox eski kodu çalıştırmaya devam eder.

**Kalıcı kurulum (imzalama):**

Firefox normal sürümü, imzalanmamış eklentileri kalıcı olarak yüklemez. Üç seçenek var:

| Yol | Ne yapmalı |
| --- | --- |
| AMO'da imzalat (ücretsiz, önerilen) | <https://addons.mozilla.org/developers/> → *Submit a New Add-on* → **On your own** (unlisted) → `cikti\youtube-ceviri-firefox.zip` dosyasını yükle → onay e-postasından `.xpi` indir → Firefox'ta aç |
| Firefox Developer Edition / Nightly | `about:config` → `xpinstall.signatures.required` = `false` → `.zip`i `.xpi` yapıp `about:addons` → dişli → *Dosyadan eklenti yükle* |
| Her oturumda geçici yükle | Yukarıdaki 3 adım (30 saniye) |

> Anahtar yalnızca tarayıcının yerel depolamasında (`storage.local`) durur. İçerik betiğine hiç
> verilmez; istekler arka plan sayfasından çıkar.

Kısayol: **Alt+Shift+T** → çeviri katmanını aç/kapat. (Firefox'ta Alt+T menüyü açar; bu yüzden
Shift eklendi. Tuş çakışırsa `about:addons` → dişli → *Kısayolları yönet* ile değiştir.)

---

## Sağlayıcılar

### 1) Google Gemini (önerilen, ücretsiz katman)
- Varsayılan model: **`gemini-3.8-flash`** (Ekim 2026 itibarıyla ücretsiz katmanın güncel Flash
  modeli). Alternatifler: `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`
  (daha hızlı/ucuz). Pro modelleri artık ücretli katmanda.
- Google modelleri sık emekliye ayrılıyor (`gemini-2.5-flash` 2026'da kullanımdan kalktı). Eklenti
  "Model bulunamadı" alırsa sırayla `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash`
  modellerini dener; biri yanıt verirse çeviriye devam eder.
- Model adı elle yazılmaz: **Model** açılır listesinden seçilir. **modelleri listele** düğmesi,
  anahtarının erişebildiği güncel sohbet modellerini getirir ve listeyi tazeler. Kesin liste her
  zaman burasıdır; kayıtlı özel bir model listede yoksa korunur.
- Ücretsiz katman limitleri model ve tarihe göre değişir (tipik olarak dakikada ~10 istek,
  günde ~1.500 istek). Eklenti istekleri toplar: 12 cümle tek istekte gider.
- Not: ücretsiz katmanda gönderilen metinler Google'ın model geliştirmesinde kullanılabilir.
  Gizli içerik çeviriyorsan ücretli katmana geç veya yerel model kullan.

### 2) OpenAI uyumlu sunucular
Hazır ayarlar: **Groq**, **OpenRouter**, **Cerebras**, **Ollama**, **LM Studio**.
- Groq ücretsiz katmanı çok hızlıdır: `llama-3.3-70b-versatile`.
- Yerel model (Ollama): `http://localhost:11434/v1`, anahtar boş bırakılabilir, tamamen çevrimdışı.

### 3) Bu makinedeki OmniRoute kurulumu
Halihazırda çalışan OmniRoute proxy'si OpenAI uyumluysa doğrudan kullanılabilir:
- Sağlayıcı: **OpenAI uyumlu**
- Sunucu adresi: `http://localhost:20128/v1`
- Model: OmniRoute panelindeki kimlik (örn. `no-think/claude-haiku-4-5-20251001`)

> Uyarı: Claude Web bağlantıları `rpm=1` ile sınırlı. Bu yol çalışır ama **yavaştır** (istek başına
> ~60 sn kuyruk). Günlük kullanım için Gemini ücretsiz API anahtarı çok daha akıcı sonuç verir.
> ChatGPT'nin ücretsiz web hesabı API erişimi vermez; bu yüzden doğrudan bağlanamaz.

---

## Ayarlar

| Ayar | Ne yapar |
| --- | --- |
| Hedef dil | 20 dil hazır; çeviri bu dile yapılır |
| Yazı boyutu / Konum | Altyazı katmanının boyutu ve yeri (alt/üst) |
| Orijinal metni de göster | Çevirinin üstünde kaynak cümleyi gösterir |
| YouTube'un kendi altyazısını gizle | İki altyazı üst üste binmesin |
| İleri çeviri (sn) | Kaç saniye ilerisinin önceden çevrileceği (varsayılan 60) |
| İstek başına karakter / cümle | Model isteğinin boyutu (kalite ↔ hız dengesi) |
| Eşzamanlı istek | Aynı anda kaç AI isteği (429 alırsan 1 yap) |
| Canlı yenileme (ms) | Canlı modda aynı satırın yeniden çevrilmesi arası en az süre (varsayılan 1200). Gecikme yüksekse 600'e düşür |
| Dakikada istek sınırı | Dakikada en fazla AI isteği (varsayılan 24, `0` = sınırsız). 429 fırtınasını önler |
| Tüm videoyu arka planda çevir | Kaydedilmiş videoda önce izlenen yer, sonra tüm video sırayla çevrilir (varsayılan açık). İleri sarma beklemesini kaldırır |

---

## Altyazı nereden geliyor? (üç kademeli zincir)

1. **Innertube `get_transcript`** — sayfanın kendi oturumuyla, tam metin + zaman damgaları.
   En hızlı yol; hiçbir arayüz açılmaz.
2. **Transkript paneli** — YouTube son dönemde bu uç noktaya PoToken şartı koyduğu için
   `400 FAILED_PRECONDITION` dönebiliyor. Bu durumda eklenti, YouTube'un kendi
   *"Transkripti göster"* panelini kısa süreliğine (görünmez şekilde) açıp segmentleri okur.
3. **Canlı altyazı yakalama** — canlı yayınlarda ve transkripti olmayan videolarda oynatıcının
   altyazı penceresi izlenir; CC kapalıysa eklenti açar ve altyazı parçasını orijinal dile sabitler.

Hiçbiri çalışmazsa, video **oynarken** 8 saniye boyunca altyazı yakalanamazsa katmanda
"Altyazı yakalanamadı" uyarısı çıkar. Uyarı kalıcı değildir: altyazı yakalanmaya başlayınca
kendiliğinden kaybolur ve YouTube'un kendi altyazısı yeniden görünür. Video duraklatılmışken
uyarı çıkmaz (duraklatılmış videoda altyazı da üretilmez).

---

## Canlı mod neden artık gecikmiyor?

Eski sürüm, altyazı satırını **cümle bitene kadar** tamponluyordu; ardından 2,2 saniyelik
sessizlik bekliyor ve ancak ondan sonra AI'a gönderiyordu. Sonuç: konuşmacı cümlesini bitiriyor,
çeviri 3–5 saniye sonra geliyordu.

Yeni davranış:

1. YouTube'un altyazı penceresi **150 ms**'de bir okunur; satır ilk göründüğü anda kaynak metin
   ekranda belirir (soluk), böylece ekran hiç boş kalmaz. "Orijinali göster" kapalıysa İngilizce
   metin basılmaz; çeviri gelene kadar `çevriliyor…` görünür.
2. Satır büyüdükçe çeviri **yerinde güncellenir**: satır zaten yeterince uzunsa ilk istek
   beklemeden, kısa parçalarda ~0,5 sn sonra yapılır; yanıt gelene kadar satır daha da
   büyüdüyse yeni metin için yeniden çevrilir (progressive refinement).
3. Satır kapanınca son hâli bir kez daha çevrilir; bu çeviri kalıcıdır.
4. İstekler dakikalık bütçeye (varsayılan 24/dk) ve satır başına yenileme aralığına (varsayılan
   1200 ms) göre ölçeklenir; böylece ücretsiz katmanda 429 fırtınası oluşmaz.

Tipik sonuç: **ilk çeviri ~1 sn**, cümle sonunda tam ve akıcı çeviri. Kota darsa
"Canlı yenileme" değerini yükseltmek gecikmeyi artırır ama 429'u engeller.

---

## Tüm videoyu önceden çevirme (kaydedilmiş videolar)

Eklenti, transkripti olan videolarda yalnızca 60 saniyelik pencereyi değil, **tüm videoyu** çevirir:

1. **Önce izlediğin yer + ileri pencere** çevrilir; video beklemeden başlar.
2. Pencere hazır olunca **kalan cümleler sırayla arka planda** çevrilir (varsayılan 2 eşzamanlı
   istek, dakikada 24 istek bütçesi).
3. Katmanda **`AI çeviri hazırlanıyor · %42 (38/90)`** ilerlemesi görünür.
4. Tamamlanınca videonun herhangi bir yerine sarma anında çevrilmiş olur; çeviri önbellekte kalır.

Bu, toplam istek sayısını azaltmaz (metin aynı), ama **algılanan gecikmeyi** kaldırır: ilk saniyeler
hazır olduğu için video beklemez, ileri sardığında ise çeviri çoğunlukla hazırdır.

İstekleri erken harcamak istemiyorsan ayarlardan **Tüm videoyu arka planda çevir** seçeneğini
kapatabilirsin; o zaman yalnızca izlediğin yer + ileri pencere çevrilir.

**Video başlığı bağlamı:** Başlık, çeviri istemine konu/terminoloji ipucu olarak eklenir (ör.
"Transformer Mimarisi" videosunda terimlerin doğru karşılığı seçilir). Başlık alıntı olarak
işaretlenir; içindeki talimatlar uygulanmaz. Canlı yayında gelecek metin olmadığı için önceden
çeviri mümkün değildir; orada satır satır mod geçerlidir.

YouTube'a girmeden denemek için `demo\canli-test.html` dosyasını tarayıcıda aç: altyazı penceresini
taklit eder, gerçek yakalayıcı/motor/katmanı çalıştırır ve ilk çeviri gecikmesini milisaniye olarak
gösterir (çeviri sahtedir, model gecikmesi ~600 ms ile taklit edilir).

---

## Bilinen sınırlar

- **Altyazısı olmayan videolar** (CC yok, transkript yok) henüz çevrilemiyor. Ses tanıma
  (Groq Whisper) yol haritasında.
- Transkript paneli yolu, paneli 1–2 saniye görünmez şekilde açıp kapatır; sayfa düzeni değişmez.
- Canlı modda ilk çeviri ~1 sn'de gelir; cümle sonundaki kesin çeviri model yanıt süresi kadar
  (genelde 1–2 sn) gecikir. Kota darsa istek bütçesi devreye girer, yenileme seyrekler.
- Canlı modda satır çevirisi, o satır için tek istek olarak gönderilir (en düşük gecikme); boşta
  kalan kapasite en yeni satırları tamamlamak için kullanılır.
- YouTube arayüz seçicileri değişirse panel yolu güncelleme isteyebilir; 1. ve 3. kademe etkilenmez.
- Çok uzun videolarda (2 saat+) ön çeviri arka planda sürer; ücretsiz kota veya internet yetmezse
  ileri kısımlar izledikçe hazırlanır. Canlı yayında önceden çeviri mümkün değildir.
- Firefox desteği **Firefox 128+** ister (MAIN world içerik betiği bu sürümde geldi). Daha eski
  sürümlerde altyazı API köprüsü çalışmaz.
- Firefox'ta imzasız eklenti kalıcı yüklenemez; geçici yükleme her oturumda tekrarlanır
  (yukarıdaki tabloya bak).
- Bu araç kişisel kullanım içindir. YouTube Hizmet Şartları'nı ve içeriğin lisansını gözet;
  çeviri metnini yeniden yayınlama.

---

## Hata giderme

| Belirti | Çözüm |
| --- | --- |
| "API anahtarı yok" | Simgeye tıkla, anahtarı gir, **Kaydet** |
| Altyazı geç geliyor (canlı mod) | Canlı yenileme = 600, dakikada istek sınırı = 40; 429 alırsan değerleri geri yükselt |
| "Hız limiti aşıldı (429)" | Gelişmiş ayarlarda **Eşzamanlı istek = 1**, **Dakikada istek sınırı = 12**, **İleri çeviri = 120** |
| "Model bulunamadı (404)" | **modelleri listele** ile doğru model adını seç |
| "Altyazı yakalanamadı" | Video oynarken 8 sn altyazı gelmezse çıkar; altyazı gelince kendiliğinden kaybolur. Oynatıcıda CC düğmesinin basılı olduğundan emin ol (eklenti CC'yi kapatmaz, yalnızca görünmez yapar) |
| Geçici eklenti dosya seçici yanlış klasörde açılıyor | Firefox, Türkçe karakterli yolu bazen `Varsay1lan` diye kaydeder. Seçicide yolu elle `<proje klasörü>\cikti\youtube-ceviri-firefox\manifest.json` olarak gir |
| Altyazı görünmüyor ama ses var | **Alt+Shift+T** ile katmanı aç; yazı boyutunu artır |
| Çeviri yanlış dilde | Hedef dili kontrol et (YouTube otomatik çevirisi açıksa kapat) |

---

## Geliştirme

```powershell
cd cikti\youtube-ceviri-eklentisi
node tests\self-test.mjs        # 44 birim testi (ağ taklit edilir)
node tools\build-firefox.mjs    # cikti\youtube-ceviri-firefox\ + .zip üretir
```

Chrome için derleme yok: klasör doğrudan yüklenir. Firefox paketi aynı kaynaktan
`tools\build-firefox.mjs` ile üretilir (tek fark: `background.scripts` + gecko kimliği).

```
manifest.json
tools/
  firefox-manifest.mjs   # Chrome manifest → Firefox manifest dönüşümü + doğrulama
  build-firefox.mjs      # Firefox klasörü + imzalanabilir .zip üretir
src/
  background.js          # arka plan (Chrome: servis çalışanı, Firefox: olay sayfası)
  lib/
    defaults.js          # varsayılanlar + sağlayıcı yapılandırması
    prompt.js            # sistem/istem metinleri (video başlığı bağlamı dahil)
    providers.js         # Gemini + OpenAI uyumlu çağrılar, 429/bölme onarımı
    models.js            # anahtar sızdırmadan model listeleme (Gemini/OpenAI)
    cache.js             # video bazlı çeviri önbelleği
    storage.js           # chrome.storage sarmalayıcı (Chrome + Firefox)
  content/
    page-bridge.js       # MAIN world: innertube + oynatıcı API köprüsü
    common.js            # yardımcılar + cümle gruplama
    transcript.js        # köprü istemcisi
    transcript-panel.js  # "Transkripti göster" paneli okuyucu
    dom-captions.js      # canlı altyazı yakalayıcı
    engine.js            # zaman senkronu + istek planlayıcı
    overlay.js/css       # video üstü katman
    main.js              # sayfa denetleyicisi (SPA gezinme)
  popup/                 # ayar penceresi
tests/self-test.mjs
```

---

## Yol haritası

- [ ] Whisper (Groq) ile altyazısız videolarda ses tanıma
- [ ] Kullanıcı sözlüğü: "transformer = transformatör" gibi sabit terimler
- [x] Kaydedilmiş videoyu arka planda baştan sona çevirme + ilerleme göstergesi
- [ ] Akış (SSE) ile çeviriyi kelime kelime gösterme
- [ ] İki dilli altyazı düzeni ve altyazı dışa aktarma (`.srt`)
- [x] Firefox desteği (Firefox 128+, `tools\build-firefox.mjs`)
- [ ] Edge mağaza paketi
