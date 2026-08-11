# TTSG İstihbarat Sistemi - Kurulum Rehberi

Bu belge iki parçadan oluşur: **(1) Uygulama (backend + dashboard) kurulumu** ve
**(2) Chrome eklentisi kurulumu**. İkisi birlikte çalışır: eklenti TTSG oturum
çerezinizi backend'e iletir, backend arama/PDF indirme/AI özetleme işini yapar,
sonuç dashboard'da görünür.

## Gereksinimler

- [Node.js](https://nodejs.org/) 18 veya üzeri
- [Google Chrome](https://www.google.com/chrome/) — **varsayılan konuma kurulu
  olmalı** (`C:\Program Files\Google\Chrome\Application\chrome.exe`). Backend,
  PDF indirme ve captcha adımları için gerçek Chrome'u yönetir (puppeteer-core).
- Bir [Supabase](https://supabase.com) projesi (ücretsiz plan yeterli)
- Bir [Gemini API anahtarı](https://aistudio.google.com/apikey) (ücretsiz kota
  yeterli) — istenirse ileride OpenAI'a da geçilebilir
- ticaretsicil.gov.tr üzerinde geçerli bir kullanıcı hesabı (arama ve PDF
  görüntüleme için giriş yapılmış olması gerekir)

---

## 1) Uygulama (Backend + Dashboard) Kurulumu

### 1.1 Bağımlılıkları kur

```bash
npm install
```

### 1.2 Supabase veritabanını hazırla

Supabase projenizin **SQL Editor**'ünde, sırasıyla aşağıdaki dosyaların
içeriğini çalıştırın (`sql/` klasöründe):

1. `schema.sql` — ana tabloları oluşturur (`companies`, `gazette_events`)
2. `migration_002_ttsg_arama.sql`
3. `migration_003_pdf_guid.sql`
4. `migration_004_ai_summary.sql`
5. `migration_005_last_summary_attempt.sql`
6. `migration_006_multi_sicil_mudurlugu.sql`

Sırayı değiştirmeyin — her migration bir öncekinin üzerine kolon ekler.

### 1.3 Ortam değişkenlerini ayarla

`.env.example` dosyasını kopyalayıp `.env` olarak kaydedin, sonra doldurun:

```bash
cp .env.example .env
```

| Değişken | Nereden alınır |
|---|---|
| `SUPABASE_URL` | Supabase projesi → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase projesi → Settings → API (gizli anahtar, **paylaşmayın**) |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `AI_PROVIDER` | `gemini` (varsayılan) veya `openai` |

`.env` dosyası `.gitignore` ile hariç tutulmuştur, asla GitHub'a gönderilmez.

### 1.4 Sunucuyu başlat

```bash
npm start
```

Dashboard: **http://localhost:3000**

---

## 2) Chrome Eklentisi Kurulumu

Eklenti, TTSG oturum çerezinizi (siz giriş yapıp captcha'yı çözdükten sonra)
backend'e iletmekten sorumludur. Chrome Web Mağazası'na yüklenmemiştir,
"geliştirici modu" ile paketlenmemiş olarak yüklenir.

1. Chrome'da `chrome://extensions` adresine gidin.
2. Sağ üstten **Geliştirici modu**'nu açın.
3. **Paketlenmemiş öğe yükle** butonuna tıklayın.
4. Bu depodaki `extension/` klasörünü seçin.
5. Eklenti simgesine sabitleyin (opsiyonel, kolay erişim için).

### Kullanım

1. `www.ticaretsicil.gov.tr` adresine gidip normal şekilde giriş yapın
   (captcha dahil — bunu siz çözüyorsunuz).
2. Eklenti simgesine tıklayın, açılan pencerede **Backend URL** alanının
   `http://localhost:3000` olduğunu doğrulayın (sunucuyu farklı bir yerde
   çalıştırıyorsanız burayı güncelleyin).
3. **Taramayı Başlat** — takip edilen şirketleri TTSG'de arar, yeni ilanları
   dashboard'a kaydeder (captcha gerektirmez).
4. **Eksik Özetleri Getir** — henüz AI özeti çıkarılmamış ilanların PDF'lerini
   gerçek bir Chrome penceresiyle indirir ve özetler. TTSG bir noktada
   captcha isteyebilir; bu durumda açık kalan pencerede captcha'yı siz çözüp
   butona tekrar basmanız yeterlidir.

---

## Sorun Giderme

- **"Chrome bulunamadi" hatası**: Chrome varsayılan konuma kurulu değil.
  `src/services/browserPdfService.js` içindeki `findChromePath()`
  fonksiyonuna kurulu olduğunuz yolu ekleyin.
- **"TTSG oturum çerezi bulunamadı"**: `ticaretsicil.gov.tr`'de giriş
  yapılmamış veya oturum düşmüş; siteye gidip tekrar giriş yapın.
- **Sürekli captcha isteniyor**: TTSG oturum başına sınırlı sayıda
  captcha'sız PDF görüntülemeye izin veriyor; bu normal, açık kalan
  pencerede çözüp devam edin.
