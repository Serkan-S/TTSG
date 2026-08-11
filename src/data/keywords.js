// Rule-based (LLM'siz) tespit icin anahtar kelime sozlukleri.
// Tum karsilastirmalar servis katmaninda kucuk harfe cevrilip Turkce karakter
// normalizasyonundan (normalizeTr) sonra yapilir.

// Sektor sozlugu: her sektor icin, sirket unvaninda gecebilecek anahtar kelimeler.
// Siralama onemlidir; ilk eslesen sektor donulur (data/keywords.js icinde daha
// spesifik olanlar ustte tutulmalidir).
const SECTOR_KEYWORDS = {
  Yazilim_Teknoloji: ['yazilim', 'teknoloji', 'bilisim', 'yapay zeka', 'siber', 'blockchain', 'oyun', 'app', 'software', 'saas'],
  Insaat_Gayrimenkul: ['insaat', 'gayrimenkul', 'muteahhit', 'yapi denetim', 'emlak', 'proje yonetim'],
  Lojistik_Tasimacilik: ['lojistik', 'tasimacilik', 'nakliyat', 'kargo', 'depoculuk', 'gumruk'],
  Enerji: ['enerji', 'elektrik uretim', 'gunes enerjisi', 'ges', 'res', 'petrol', 'dogalgaz'],
  Tekstil: ['tekstil', 'konfeksiyon', 'giyim', 'iplik', 'dokuma'],
  Gida_Tarim: ['gida', 'tarim', 'hayvancilik', 'yem sanayi', 'ambalaj'],
  Saglik: ['saglik', 'medikal', 'eczacilik', 'hastane', 'klinik', 'ilac'],
  Finans_Sigorta: ['finans', 'sigorta', 'faktoring', 'leasing', 'yatirim danismanligi', 'portfoy yonetimi'],
  Turizm_Otelcilik: ['turizm', 'otelcilik', 'seyahat acentasi', 'konaklama'],
  Otomotiv: ['otomotiv', 'oto yedek parca', 'arac kiralama', 'galeri'],
};

const DEFAULT_SECTOR = 'Diger';

// Hukuki/idari gelisme olaylari icin regex desenleri.
// Her desen TTSG ilan metninde sik gecen kaliplarin varyasyonlarini kapsar.
// `flags: 'i'` kullanilacagindan buyuk/kucuk harf onemsizdir; normalizeTr sonrasi
// Turkce karakterler ASCII karsiliklarina cevrilmis olarak eslesir.
const EVENT_PATTERNS = [
  {
    key: 'sermaye_artirimi',
    label: 'Sermaye Artirimi',
    regex: /sermaye(sinin|si)?.{0,40}?(artirilmasina|artirilmis|arttirilmasina|artirimina|artirimi)/i,
  },
  {
    key: 'sermaye_azaltimi',
    label: 'Sermaye Azaltimi',
    regex: /sermaye(sinin|si)?.{0,40}?(azaltilmasina|azaltilmis|azaltimina|azaltimi)/i,
  },
  {
    key: 'adres_degisikligi',
    label: 'Adres Degisikligi',
    regex: /(sirket|merkez)?\s*adresi(nin)?.{0,40}?(degistirilmesine|degistirilmis|nakline|tasinmasina)/i,
  },
  {
    key: 'genel_kurul',
    label: 'Genel Kurul',
    regex: /genel\s*kurul(un)?.{0,40}?(toplantisi|toplanmasina|karari|karar)/i,
  },
  {
    key: 'unvan_degisikligi',
    label: 'Unvan Degisikligi',
    regex: /(ticaret\s*)?unvani(nin)?.{0,40}?(degistirilmesine|degistirilmis)/i,
  },
  {
    key: 'ortak_degisikligi',
    label: 'Ortak / Hisse Devri',
    regex: /(hisse(lerin|nin)?\s*devr|ortaklik\s*payi(nin)?\s*devr|yeni\s*ortak\s*alinmasina)/i,
  },
  {
    key: 'tasfiye',
    label: 'Tasfiye / Fesih',
    regex: /(tasfiye(sine|si)?\s*karar|sirketin\s*feshine|infisah)/i,
  },
  {
    key: 'mudur_atama',
    label: 'Mudur / Yonetim Kurulu Atamasi',
    regex: /(mudur(u)?\s*olarak\s*atanmasina|yonetim\s*kurulu\s*uyeligine\s*secilmesine)/i,
  },
];

// TTSG arama sonucundaki KISA "Ilan Turu" basligina (ör. "GENEL KURUL
// TOPLANTIYA CAGIRI") gore gevsek siniflandirma icin anahtar kelimeler.
// EVENT_PATTERNS'daki regex'ler UZUN PDF metni icin tasarlandigindan
// ("...karar verildi" gibi tam ifadeler bekler) kisa basliklarla eslesmez;
// bu yuzden basit "iceriyor mu" kontrolu yeterlidir.
const ILAN_TURU_KEYWORDS = {
  sermaye_artirimi: ['sermaye artir', 'sermaye arttir'],
  sermaye_azaltimi: ['sermaye azalt'],
  adres_degisikligi: ['adres degisikligi', 'merkez nakli', 'adres nakli'],
  genel_kurul: ['genel kurul'],
  unvan_degisikligi: ['unvan degisikligi'],
  ortak_degisikligi: ['hisse devri', 'ortak degisikligi', 'pay devri'],
  tasfiye: ['tasfiye', 'fesih', 'infisah'],
  mudur_atama: ['yonetim', 'mudur', 'temsil'],
};

module.exports = { SECTOR_KEYWORDS, DEFAULT_SECTOR, EVENT_PATTERNS, ILAN_TURU_KEYWORDS };
