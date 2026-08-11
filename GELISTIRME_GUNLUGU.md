# TTSG İstihbarat Sistemi — Geliştirme Günlüğü

Bu doküman, "TTSG Pipeline" (Türkiye Ticaret Sicili Gazetesi Sektörel İstihbarat Sistemi) projesinin ne olduğunu, nasıl çalıştığını ve geliştirme sürecinde karşılaşılan sorunlarla bunların nasıl çözüldüğünü kronolojik olarak anlatır.

---

## 1. Uygulama Ne Yapıyor?

Kullanıcının takip etmek istediği şirketleri (örn. 20 tane) sisteme ekler. Uygulama düzenli olarak **Türkiye Ticaret Sicili Gazetesi**'ni (TTSG) tarar, bu şirketlerle ilgili yeni yayınlanmış ilan olup olmadığını tespit eder, ilanın türünü (genel kurul, sermaye artırımı, adres değişikliği, ortak değişikliği vb.) sınıflandırır ve mümkünse yapay zeka ile kısa bir özet çıkarır. Sonuçlar bir web dashboard'unda (panoda) listelenir.

---

## 2. Genel Mimari

```
[Kullanıcı]
   │
   │ 1) www.ticaretsicil.gov.tr'de kendi hesabıyla giriş yapar (captcha'yı kendisi çözer)
   │ 2) Chrome eklentisindeki "Taramayı Başlat" butonuna basar
   ▼
[Chrome Eklentisi]  (extension/)
   │  - background.js: TTSG oturum çerezini okur, backend'e arama isteği gönderir
   │  - Yeni ilan bulunursa, PDF'i KENDİSİ (gerçek tarayıcı bağlantısından) indirip
   │    backend'e AI özeti için gönderir (best-effort — başarısız olabilir)
   ▼
[Backend]  (src/, Node.js + Express)
   │  - src/services/ttsgService.js  → TTSG'de arama yapar (axios, captcha'sız)
   │  - src/services/scanService.js  → yeni ilanları tespit eder, kaydeder
   │  - src/services/eventParserService.js → ilan türünü olay kategorilerine sınıflandırır
   │  - src/services/summaryService.js → Claude Haiku 4.5 ile AI özeti üretir
   │  - src/services/pdfService.js   → PDF'i (eklentiden gelen) metne çevirir
   ▼
[Supabase (PostgreSQL)]
   │  - companies: takip edilen şirketler
   │  - gazette_events: tespit edilen ilanlar (tür, olaylar, AI özeti, PDF linki)
   ▼
[Dashboard]  (public/index.html)
   - Şirket ekleme formu, filtrelenebilir ilan tablosu, AI özeti sütunu
```

---

## 3. Karşılaşılan Sorunlar ve Çözümler (Kronolojik)

### 3.1 Ortam Kurulumu

**Sorun:** Redis'i (BullMQ kuyruk sistemi için) kurmak gerekiyordu. `winget` ile Memurai (Redis uyumlu Windows servisi) kurulumu, yönetici izni (UAC) otomatik onaylanamadığı için takıldı; ikinci denemede de MSI kurulumu "erişim engellendi" hatasıyla başarısız oldu (elevation/geçici dizin çakışması, bilinen bir winget+MSI sorunu).

**Çözüm:** Kurulum gerektirmeyen **taşınabilir Redis** (tporadowski/redis-windows, GitHub'dan zip) indirilip `redis-portable/` klasörüne çıkartıldı, `redis-server.exe` doğrudan arka planda başlatıldı. Admin hakkı gerekmedi.

**Yan sorun:** `.env`'e girilen `REDIS_PASSWORD` ile taşınabilir Redis'in şifresiz çalışması uyuşmuyordu → `redis.windows.conf`'a `requirepass` eklenip Redis yeniden başlatılarak çözüldü.

---

### 3.2 Supabase Bağlantı Sorunları

**Sorun 1:** `.env`'deki `SUPABASE_SERVICE_ROLE_KEY` alanına yanlışlıkla **publishable (public)** key girilmişti, gerçek **secret (service_role)** key değil. Bu, RLS (Row Level Security) bypass gerektiren backend yazma işlemlerinde sorun çıkarabilirdi.

**Çözüm:** Kullanıcı Supabase Dashboard → Project Settings → API Keys'ten doğru `sb_secret_...` anahtarını bulup girdi.

**Sorun 2:** `/api/events` endpoint'i "JWT issued at future" hatası veriyordu. Kök neden: **bilgisayarın sistem saati** gerçek zamandan ileri/yanlıştı, Windows Time servisi (`w32time`) durmuş durumdaydı.

**Çözüm:** `net start w32time && w32tm /resync /force` ile saat senkronize edildi.

**Sorun 3:** İlk şirket ekleme testinde Türkçe karakterler bozuk kaydedildi ("ASELSAN ELEKTRON�K...").

**Kök neden:** Kod hatası değil — Windows'ta bash üzerinden `curl -d` ile Türkçe karakter gönderilirken terminal encoding sorunu. Node.js `fetch` ile (shell'i devre dışı bırakarak) tekrar denenince sorunsuz çalıştı.

---

### 3.3 Vercel'e Uygun Olmayan Mimari

**Sorun:** Uygulama başlangıçta BullMQ (Redis kuyruğu) + node-cron (zamanlayıcı) ile tasarlanmıştı. Ancak bunlar **sürekli çalışan process** gerektirir — Vercel serverless fonksiyonları istek başına kısa ömürlü çalışır, sürekli process barındıramaz. Ayrıca eski anti-ban gecikme stratejisi (şirketler arası 3-5 dakika bekleme) Vercel'in fonksiyon süre sınırını (~60 saniye) aşıyordu.

**Çözüm:** BullMQ, ioredis ve node-cron tamamen kaldırıldı. Mimari, Chrome eklentisinin şirketleri küçük gruplar (batch) halinde backend'e gönderdiği, senkron/istek-bazlı bir modele çevrildi. Anti-ban gecikmesi dakikalar yerine saniyeler mertebesine indirildi (`SCAN_MIN/MAX_DELAY_MS`).

---

### 3.4 TTSG Girişi ve CAPTCHA Keşfi

**Sorun:** Uygulamanın "her hafta otomatik, insansız tarasın" hedefi ile TTSG'nin güvenlik önlemleri çelişiyordu:
- Siteye giriş (`GİRİŞ`) **CAPTCHA korumalı** — otomatik çözülemez (bilinçli olarak yapılmadı, güvenlik kuralı gereği).
- **Arama** (`ilangoruntuleme_ok.php`, POST) CAPTCHA istemiyor — backend'den (axios) güvenilir şekilde çalışıyor.
- **PDF görüntüleme** (`pdf_goster.php`) ise ara sıra CAPTCHA istiyor — hem backend'den hem de bazen tarayıcıdan.

**Çözüm (mimari):** Chrome eklentisi geliştirildi:
1. Kullanıcı kendi tarayıcısında TTSG'ye giriş yapıp CAPTCHA'yı kendisi çözer (haftada bir, birkaç saniye).
2. Eklenti, TTSG oturum çerezini (`chrome.cookies.getAll`) okuyup backend'e gönderir.
3. Backend bu çerezle **arama** yapar (CAPTCHA'sız, güvenilir).

---

### 3.5 "İlan Sıra No" Kalıcı Değilmiş

**Keşif:** Aynı ilanı farklı zamanlarda aratınca, TTSG'nin döndürdüğü "ilan sıra no" (SepeteEkle parametresi) **değişiyordu** — bu, veritabanında tekilleştirme (aynı ilanı iki kez kaydetmeme) için kullanılan anahtardı. Değişken bir anahtar kullanmak, sistemin aynı ilanı sürekli "yeni" sanıp tekrar tekrar işlemesine yol açardı.

**Çözüm:** Tekilleştirme anahtarı, PDF linkindeki **Guid** değerine taşındı (bu değer aynı ilan için her zaman sabit kalıyor). `sql/migration_003_pdf_guid.sql` ile veritabanı şeması güncellendi.

---

### 3.6 PDF İndirme CAPTCHA Sorunu — Derinlemesine Araştırma

Bu, projenin en çok zaman alan kısmıydı.

**1. Deneme — Backend'den axios ile PDF indirme:** Her zaman "oturum geçersiz" gibi bir HTML sayfası dönüyordu (aslında CAPTCHA sayfasıydı).

**2. Deneme — Referer/User-Agent header ekleme:** Sorunu çözmedi.

**3. Keşif — Debug loglama:** PDF yanıtının gerçek içeriği loglanınca, TTSG'nin bize sürekli bir **CAPTCHA doğrulama sayfası** (görsel kod + input alanı) döndürdüğü kesin olarak doğrulandı.

**4. Deneme — Kullanıcı CAPTCHA'yı manuel çözsün, sonra backend tekrar denesin:** Yine başarısız — kullanıcının browser'da çözdüğü CAPTCHA, backend'in (Node.js, ayrı bağlantı) isteğine yansımıyordu. Bu, TTSG'nin muhtemelen yük dengeleyici (load balancer) arkasında birden fazla sunucu kullandığını, her sunucunun "CAPTCHA çözüldü" durumunu kendi belleğinde tuttuğunu düşündürdü.

**5. Mimari değişiklik — PDF indirmeyi backend'den eklentiye taşı:** PDF'i artık backend (axios) değil, **Chrome eklentisinin kendisi** (kullanıcının gerçek tarayıcı bağlantısından, `fetch(url, {credentials:'include'})`) indiriyor, ham veriyi backend'e gönderiyor. Backend sadece metne çevirip analiz ediyor.

**6. Yine de CAPTCHA:** Eklenti tarafından yapılan indirme de CAPTCHA'ya takıldı — hatta kullanıcının **daha önce manuel olarak çözdüğü aynı belge** için bile. Bu, "bir kere çöz, kalıcı olsun" teorisini çürüttü.

**7. Doğru teşhis — Yoğun test trafiği:** Saatlerce süren yoğun test aktivitesi (onlarca arama + PDF denemesi) muhtemelen TTSG'nin bot/kötüye kullanım tespit sistemini tetikleyip hesabı/oturumu geçici olarak "şüpheli" işaretlemişti. Testler durdurulup normal kullanım temposuna dönülünce (birkaç saat sonra), **CAPTCHA sorunu kendiliğinden ortadan kalktı.**

---

### 3.7 Ücretli Alternatif Değerlendirmesi (Kullanılmadı ama Kayda Değer)

CAPTCHA sorunu devam ederken, TTSG'nin resmi **"Onaylı Suret"** (belge başına ücretli, resmi kopya) sistemi araştırıldı:
- E-imzalı: **75 TL/belge**
- Islak imzalı: **225 TL/belge**

Haftalık ~10 yeni ilan için ayda ~3.000 TL gibi bir maliyet çıkıyordu. Ayrıca bu akış da **ödeme onayı için insan müdahalesi** gerektiriyordu (ödeme bilgisi/işlemi hiçbir zaman otomatik yapılmaz). Yoğun test trafiğinin geçici olduğu anlaşılınca bu yola gidilmedi, ama gelecekte CAPTCHA sorunu kalıcı hale gelirse bir yedek plan olarak durmaktadır (`sql`/kod tarafında herhangi bir entegrasyon yapılmadı).

---

### 3.8 Nihai Mimari — İki Katmanlı Güvenilirlik

Kullanıcının "PDF'e captcha çıkmıyorsa AI'ı entegre edelim" onayı üzerine, sistem şu **iki katmanlı** modelde sabitlendi:

1. **Güvenilir katman (her zaman çalışır):** Arama sonucunda TTSG'nin zaten verdiği **"İlan Türü"** metni (ör. "GENEL KURUL TOPLANTIYA ÇAĞIRI") anahtar kelime eşleştirmesiyle (`classifyIlanTuru`, gevşek/substring bazlı — tam metin için yazılmış eski `extractEvents` regex'leri kısa başlıklarla eşleşmediği için ayrıca yazıldı) olay kategorisine çevrilip **hemen** kaydedilir. CAPTCHA'ya hiç bağımlı değildir.

2. **Zenginleştirme katmanı (best-effort):** Her yeni ilan için eklenti PDF'i indirmeyi dener; başarılı olursa backend PDF'in tam metnini `extractEvents` (tam metin regex'leri) ile daha kesin sınıflandırır ve **Claude Haiku 4.5** ile 2-3 cümlelik Türkçe özet çıkarıp aynı kaydı günceller (upsert). Başarısız olursa (nadiren CAPTCHA) ilan yine de 1. katmandan kaydedilmiş durumda kalır, sadece özet boş kalır.

---

## 4. Şu Anki Durum

- **Backend:** `src/` altında Express API, yerel makinede `npm start` ile çalışıyor (Vercel'e henüz deploy edilmedi).
- **Veritabanı:** Supabase (bulut), şema `sql/schema.sql` + `migration_002/003/004` ile güncel.
- **Chrome Eklentisi:** `extension/` klasöründe, "Paketlenmemiş öğe yükle" ile yerel olarak yüklü. Cihaz başına bir kere kurulum gerekir.
- **AI Özeti:** `ANTHROPIC_API_KEY` `.env`'e eklenmeyi bekliyor — eklenince otomatik devreye girecek (Claude Haiku 4.5, düşük maliyetli).
- **Kullanıcı akışı:** Haftada bir (ya da istenildiğinde) `ticaretsicil.gov.tr`'de giriş yap → eklentiden "Taramayı Başlat" → sonuçlar dashboard'da.

## 5. Bilinen Riskler / Gelecek İçin Notlar

- CAPTCHA davranışı **kullanım yoğunluğuna bağlı** görünüyor — çok sık/hızlı tarama tekrar tetikleyebilir. Mevcut gecikme ayarları (`SCAN_MIN/MAX_DELAY_MS`, `SCAN_PDF_MIN/MAX_DELAY_MS` mantığı) bunu azaltmak için var.
- Uygulama henüz Vercel'e (veya başka bir sunucuya) deploy edilmedi; şu an sadece yerel bilgisayarda çalışıyor.
- Eklenti Chrome Web Store'a yayınlanmadı (bilinçli tercih — kişisel/tek kullanıcılık araç için gereksiz maliyet+inceleme süreci).
