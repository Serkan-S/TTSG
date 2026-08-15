const { searchAnnouncements } = require('./ttsgService');
const { parsePdfBuffer } = require('./pdfService');
const { detectSector } = require('./sectorService');
const { extractEvents, classifyIlanTuru } = require('./eventParserService');
const { summarizeAnnouncement, summarizeAnnouncementFromImage } = require('./summaryService');
const { fetchPdfViaBrowser } = require('./browserPdfService');
const { renderPdfFirstPageAsImage } = require('./pdfRenderService');
const { SICIL_MUDURLUKLERI } = require('../data/sicilMudurlukleri');
const {
  getActiveCompanies,
  countActiveCompanies,
  getExistingPdfGuids,
  getEventByPdfGuid,
  updateEventSummary,
  updateCompanySector,
  touchLastCheckedAt,
  saveGazetteEvent,
} = require('../repositories/companyRepository');
const { randomDelayMs } = require('../utils/randomDelay');

// Vercel'in tek istek suresi sinirina uymak icin sirketler arasi kisa (saniyeler
// mertebesinde) bir bekleme.
const MIN_DELAY_MS = Number(process.env.SCAN_MIN_DELAY_MS) || 1500;
const MAX_DELAY_MS = Number(process.env.SCAN_MAX_DELAY_MS) || 3000;

// Bir sirket ilk kez taraniyorsa TTSG'deki TUM gecmis ilanlari "yeni" sayilir.
// Onlarca/yuzlerce PDF'i tek seferde indirmeye calismak (ozellikle TTSG'nin
// PDF goruntuleme icin ara sira captcha istemesi nedeniyle) pratik degildir.
// Bunun yerine her taramada en cok bu kadar YENI ilan islenir; geri kalani bir
// sonraki taramada islenmeye devam eder.
const MAX_NEW_ENTRIES_PER_COMPANY = Number(process.env.SCAN_MAX_NEW_ENTRIES_PER_COMPANY) || 5;

// TTSG'nin bazi ilan PDF'leri taranmis (goruntu) sayfalar oldugu icin
// pdf-parse'in cikardigi metin cok kisa/bos olabilir. Bu esigin altinda
// kalan metinler icin, PDF'i yerel olarak goruntuye cevirip AI'nin gorsel
// okuma ozelligiyle ozetletiyoruz.
const MIN_TEXT_LENGTH_FOR_SUMMARY = 40;

// Bir sirket sisteme eklendiginde TTSG'deki YILLAR onceki ilanlar "yeni"
// sayilip kuyruga girmesin diye, sadece sirketin eklendigi (izlenmeye
// baslandigi) tarihten bu kadar oncesine kadar olan ilanlar dikkate alinir.
const HISTORY_WINDOW_DAYS = Number(process.env.SCAN_HISTORY_WINDOW_DAYS) || 7;

// Sicil muduerluegue tespiti (detectCompanyRegistries) tek bir sirket icin TUM
// sicil muduerluklerini (~140) tarar. Bu, SCAN_MIN/MAX_DELAY_MS'nin hedeflendigi
// "onlarca sirket, haftalik tekrar eden" senaryosundan farkli: kullanici tetikli,
// TEK seferlik, TEK sirket icin calisir - o yuzden daha kisa bir gecikme kullanilir
// (yoksa 140 istek x 2sn ~ 5 dk surer).
const DETECT_MIN_DELAY_MS = Number(process.env.DETECT_MIN_DELAY_MS) || 300;
const DETECT_MAX_DELAY_MS = Number(process.env.DETECT_MAX_DELAY_MS) || 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bir sirketi TTSG'de arar ve daha once kaydedilmemis (yeni) ilanlari kaydeder.
 * PDF INDIRMEZ - TTSG'nin PDF goruntuleme akisi ara sira captcha istedigi icin
 * (yogun kullanimda tetiklenen bir bot/kotuye kullanim korumasi) bu adim
 * atlanir. Bunun yerine, arama sonucunda TTSG'nin ZATEN verdigi "Ilan Turu"
 * metni (ör. "GENEL KURUL TOPLANTIYA CAGIRI") kullanilarak olay tespiti
 * yapilir - bu arama endpoint'i captcha istemedigi icin tamamen guvenilirdir.
 * Ilanin tam metnini (ve AI ozetini) daha sonra istege bagli olarak, kullanici
 * PDF linkine tikladiginda processPdfEntry() ile ayrica alinabilir.
 */
async function findNewEntriesForCompany(company, cookie) {
  // Bir sirketin ilanlari birden fazla Sicil Muduerluegue'nde yayinlanabildigi
  // icin, sirkete atanmis her sicil muduerluegue ayri ayri aranip sonuclar
  // birlestirilir.
  const registries = company.sicil_mudurlukleri || [];
  let searchResults = [];
  for (let i = 0; i < registries.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const results = await searchAnnouncements({
      sicilMudurluguId: registries[i].id,
      unvan: company.title,
      cookie,
    });
    searchResults = searchResults.concat(results);

    if (i < registries.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(randomDelayMs(MIN_DELAY_MS, MAX_DELAY_MS));
    }
  }

  // Unvan arama sonuclari prefix eslesmesi oldugundan (ör. "ASELSAN" onekiyle
  // baslayan birden fazla ayri tuzel kisi donebilir) mumkunse tam eslesenlere
  // daralt; hicbiri tam eslesmiyorsa (unvan kaydi TTSG'deki ile birebir ayni
  // yazilmamis olabilir) tum sonuclari kullan.
  const normalizedTitle = company.title.toLocaleUpperCase('tr-TR').trim();
  const exactMatches = searchResults.filter(
    (r) => r.unvan.toLocaleUpperCase('tr-TR').trim() === normalizedTitle
  );
  const candidates = exactMatches.length > 0 ? exactMatches : searchResults;

  const existingPdfGuids = await getExistingPdfGuids(company.id);

  // Sirketin izlenmeye baslama tarihinden HISTORY_WINDOW_DAYS kadar oncesine
  // giden bir esik: bundan daha eski ilanlar hicbir zaman "yeni" sayilmaz,
  // kuyruga girmez - boylece yillar onceki gecmis ilanlar dashboard'da
  // gorunmez, sadece izlemeye baslandiktan az once/sonraki gelismeler gelir.
  const historyThreshold = new Date(company.created_at);
  historyThreshold.setDate(historyThreshold.getDate() - HISTORY_WINDOW_DAYS);
  const withinHistoryWindow = candidates.filter(
    (entry) => !entry.gazetteDate || new Date(entry.gazetteDate) >= historyThreshold
  );

  // Arama sonuclari en yeni ilandan en eskiye siralidir; ilk taramada buyuk bir
  // gecmis birikmisse bile once en guncel gelismeler islensin diye ayni sirada
  // ilk N tanesi alinir. Kalanlar bir sonraki taramada tekrar "yeni" olarak
  // degerlendirilip kademeli islenir.
  const allNewEntries = withinHistoryWindow.filter((entry) => !existingPdfGuids.has(entry.pdfGuid));
  const newEntries = allNewEntries.slice(0, MAX_NEW_ENTRIES_PER_COMPANY);

  const savedEntries = [];
  for (const entry of newEntries) {
    try {
      const { flags, matches } = classifyIlanTuru(entry.ilanTuru || '');
      // eslint-disable-next-line no-await-in-loop
      await saveGazetteEvent({
        companyId: company.id,
        pdfGuid: entry.pdfGuid,
        ilanSiraNo: entry.ilanSiraNo,
        pdfUrl: entry.pdfUrl,
        gazetteNo: entry.gazetteNo,
        gazetteDate: entry.gazetteDate,
        ilanTuru: entry.ilanTuru,
        flags,
        matches,
      });
      savedEntries.push({
        ...entry,
        events: Object.entries(flags).filter(([, isSet]) => isSet).map(([key]) => key),
      });
    } catch (err) {
      console.error(`[scanService] "${company.title}" / ${entry.pdfGuid} kaydedilemedi: ${err.message}`);
    }
  }

  if (savedEntries.length > 0) {
    // eslint-disable-next-line no-await-in-loop
    await updateCompanySector(company.id, detectSector(company.title));
  } else {
    await touchLastCheckedAt(company.id);
  }

  return {
    companyId: company.id,
    companyTitle: company.title,
    totalFound: searchResults.length,
    remainingBacklog: allNewEntries.length - newEntries.length,
    savedCount: savedEntries.length,
    entries: savedEntries,
  };
}

/**
 * Bir unvanin TTSG'deki TUM sicil muduerluklerinden hangilerinde kayitli
 * oldugunu tespit eder. Sirket eklenirken kullaniciyi elle ~140 sicil
 * muduerluegue arasindan secim yapmaya zorlamak yerine, unvani her muduerlukte
 * ayri ayri aratip (searchAnnouncements() - CAPTCHA'siz, guvenilir arama
 * uc noktasi) nerede sonuc ciktigini toplar. Ayni zamanda "TTSG'de boyle bir
 * sirket var mi" sorusunu da cevaplar: hicbir muduerlukte sonuc yoksa unvan
 * TTSG'de kayitli degildir.
 *
 * Vercel'in tek istek suresi sinirina uymak icin (bkz. searchBatch), tum
 * liste tek seferde degil offset/limit ile parcalar halinde taranir; cagiran
 * taraf (extension/background.js) `done: true` donene kadar tekrar cagirir.
 *
 * @param {{ unvan: string, cookie: string, offset?: number, limit?: number }} params
 */
async function detectCompanyRegistries({ unvan, cookie, offset = 0, limit = 10 }) {
  if (!unvan || unvan.trim().length < 5) {
    throw new Error('[scanService.detectCompanyRegistries] unvan en az 5 karakter olmalidir.');
  }
  if (!cookie) {
    throw new Error('[scanService.detectCompanyRegistries] TTSG oturum cerezi (cookie) zorunludur.');
  }

  const normalizedTitle = unvan.toLocaleUpperCase('tr-TR').trim();
  const slice = SICIL_MUDURLUKLERI.slice(offset, offset + limit);

  const exactMatches = [];
  const partialMatches = [];

  for (let i = 0; i < slice.length; i += 1) {
    const registry = slice[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const results = await searchAnnouncements({ sicilMudurluguId: registry.id, unvan, cookie });

      if (results.length > 0) {
        const exactCount = results.filter(
          (r) => r.unvan.toLocaleUpperCase('tr-TR').trim() === normalizedTitle
        ).length;

        if (exactCount > 0) {
          exactMatches.push({ id: registry.id, name: registry.name, sampleCount: exactCount });
        } else {
          const foundTitles = [...new Set(results.map((r) => r.unvan))].slice(0, 5);
          partialMatches.push({ id: registry.id, name: registry.name, foundTitles });
        }
      }
    } catch (err) {
      console.error(`[scanService] "${unvan}" / ${registry.name} tespiti basarisiz: ${err.message}`);
    }

    if (i < slice.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(randomDelayMs(DETECT_MIN_DELAY_MS, DETECT_MAX_DELAY_MS));
    }
  }

  return {
    offset,
    limit,
    processed: slice.length,
    totalRegistries: SICIL_MUDURLUKLERI.length,
    done: offset + slice.length >= SICIL_MUDURLUKLERI.length,
    exactMatches,
    partialMatches,
  };
}

/**
 * Bir grup (batch) sirket icin arama+dedup akisini calistirir. Vercel'in tek
 * istek suresi sinirina uymak icin cagiran taraf (Chrome eklentisi) tum aktif
 * sirketleri tek seferde degil, offset/limit ile kucuk gruplar halinde
 * gonderir; `done: true` donene kadar bir sonraki offset ile tekrar cagirmasi
 * beklenir.
 *
 * @param {{ cookie: string, offset?: number, limit?: number }} params
 */
async function searchBatch({ cookie, offset = 0, limit = 5 }) {
  if (!cookie) {
    throw new Error('[scanService.searchBatch] TTSG oturum cerezi (cookie) zorunludur.');
  }

  const [companies, totalActive] = await Promise.all([
    getActiveCompanies({ offset, limit }),
    countActiveCompanies(),
  ]);

  const results = [];
  for (let i = 0; i < companies.length; i += 1) {
    const company = companies[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(await findNewEntriesForCompany(company, cookie));
    } catch (err) {
      console.error(`[scanService] "${company.title}" taranamadi: ${err.message}`);
      results.push({ companyId: company.id, companyTitle: company.title, error: err.message, entries: [] });
    }

    if (i < companies.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(randomDelayMs(MIN_DELAY_MS, MAX_DELAY_MS));
    }
  }

  return {
    offset,
    limit,
    processed: companies.length,
    totalActive,
    done: offset + companies.length >= totalActive,
    results,
  };
}

/**
 * Chrome eklentisinin kendi tarayici oturumundan indirip gonderdigi bir PDF'i
 * metne cevirir, olay tespiti yapar ve kaydeder.
 *
 * @param {{ companyId: string, companyTitle: string, pdfGuid: string, pdfUrl: string,
 *   ilanSiraNo?: number, gazetteNo?: string, gazetteDate?: string, ilanTuru?: string,
 *   pdfBuffer: Buffer }} params
 */
async function processPdfEntry({
  companyId,
  companyTitle,
  pdfGuid,
  pdfUrl,
  ilanSiraNo,
  gazetteNo,
  gazetteDate,
  ilanTuru,
  pdfBuffer,
}) {
  const rawText = await parsePdfBuffer(pdfBuffer);
  const sector = detectSector(companyTitle);
  const { flags, matches } = extractEvents(rawText);

  let aiSummary = '';
  try {
    if (rawText && rawText.trim().length >= MIN_TEXT_LENGTH_FOR_SUMMARY) {
      aiSummary = await summarizeAnnouncement(rawText, companyTitle);
    } else {
      // Metin katmani yok/cok kisa (taranmis sayfa olabilir): TTSG'ye tekrar
      // istek atmadan, zaten elimizdeki PDF'i yerelde goruntuye cevirip
      // gorsel okuma ile ozetliyoruz.
      const imageBase64 = await renderPdfFirstPageAsImage(pdfBuffer);
      const visionSummary = await summarizeAnnouncementFromImage(imageBase64, companyTitle);
      aiSummary = visionSummary && visionSummary.trim().toUpperCase() !== 'OKUNAMADI' ? visionSummary : '';
    }
  } catch (err) {
    // AI ozeti kritik olmayan bir zenginlestirme adimidir; hata kaydi
    // engellememeli (ör. API anahtari eksikse dahi ilan kaydedilebilmeli).
    console.error(`[scanService] AI ozeti alinamadi (${companyTitle}): ${err.message}`);
  }

  await updateCompanySector(companyId, sector);
  await saveGazetteEvent({
    companyId,
    pdfGuid,
    ilanSiraNo,
    pdfUrl,
    gazetteNo,
    gazetteDate,
    ilanTuru,
    flags,
    matches,
    rawExcerpt: rawText.slice(0, 500),
    aiSummary,
    lastSummaryAttemptAt: new Date().toISOString(),
  });

  return {
    pdfGuid,
    sector,
    aiSummary,
    events: Object.entries(flags).filter(([, isSet]) => isSet).map(([key]) => key),
  };
}

/**
 * Kullanici bir PDF linkine GERCEKTEN tikladiginda (yeni bir tarayici sekmesi
 * gercek navigasyonla acildiginda) eklenti bunu farkedip PDF'i indirir ve
 * buraya gonderir. Bu, arka planda otomatik/art arda yapilan indirmelerin
 * aksine TTSG'nin captcha korumasini tetiklemez (gercek kullanici navigasyonu
 * gibi gorunur). companyId/companyTitle onceden bilinmedigi icin pdf_guid
 * uzerinden mevcut kayit bulunur.
 */
async function enrichEventByGuid({ pdfGuid, pdfBuffer }) {
  const existing = await getEventByPdfGuid(pdfGuid);
  if (!existing) {
    throw new Error(`pdf_guid=${pdfGuid} icin kayitli bir ilan bulunamadi (once tarama yapilmali).`);
  }

  const companyTitle = existing.companies?.title || 'Bilinmeyen sirket';

  return processPdfEntry({
    companyId: existing.company_id,
    companyTitle,
    pdfGuid: existing.pdf_guid,
    pdfUrl: existing.pdf_url,
    ilanSiraNo: existing.ilan_sira_no,
    gazetteNo: existing.gazette_no,
    gazetteDate: existing.gazette_date,
    ilanTuru: existing.ilan_turu,
    pdfBuffer,
  });
}

/**
 * Kullanicinin taraycida GERCEKTEN acip gordugu bir PDF'in ekran goruntusunden
 * AI ozeti cikarir ve mevcut kaydi gunceller. TTSG'nin PDF goruntuleme uc
 * noktasi sadece gercek tarayici navigasyonlarini kabul edip her turlu
 * programatik agdan indirmeyi (fetch, arka plan indirme - session/timing
 * fark etmeksizin) captcha ile engelledigi kesin olarak tespit edildiginden,
 * bu yol PDF'i AGDAN TEKRAR INDIRMEZ - sadece ekran goruntusunu kullanir,
 * TTSG'ye hicbir ek istek gitmez.
 */
async function enrichEventByGuidFromImage({ pdfGuid, imageBase64 }) {
  const existing = await getEventByPdfGuid(pdfGuid);
  if (!existing) {
    throw new Error(`pdf_guid=${pdfGuid} icin kayitli bir ilan bulunamadi (once tarama yapilmali).`);
  }

  const companyTitle = existing.companies?.title || 'Bilinmeyen sirket';
  const aiSummary = await summarizeAnnouncementFromImage(imageBase64, companyTitle);

  if (aiSummary && aiSummary.trim().toUpperCase() !== 'OKUNAMADI') {
    await updateEventSummary(pdfGuid, aiSummary);
  }

  return { pdfGuid, aiSummary };
}

/**
 * Kullanicinin TTSG oturum cerezini kullanarak, sunucu tarafinda GERCEK bir
 * Chrome (puppeteer-core) ile pdf_goster.php'ye navigasyon yaptirir ve
 * donen PDF'i tam otomatik olarak isler (metin cikarma + olay tespiti + AI
 * ozeti). Ekran goruntusune veya kullanicinin PDF'i elle acmasina gerek
 * kalmadan, "Eksik Ozetleri Getir" akisinin arka planda TAM otomatik
 * calismasini saglar - cerez zaten /api/scan/search icin eklentiden
 * gonderiliyor, ayni cerez burada da kullanilir.
 */
async function enrichEventByGuidViaBrowser({ pdfGuid, cookie }) {
  const existing = await getEventByPdfGuid(pdfGuid);
  if (!existing) {
    throw new Error(`pdf_guid=${pdfGuid} icin kayitli bir ilan bulunamadi (once tarama yapilmali).`);
  }

  const companyTitle = existing.companies?.title || 'Bilinmeyen sirket';
  const pdfBuffer = await fetchPdfViaBrowser({ pdfUrl: existing.pdf_url, cookie });

  return processPdfEntry({
    companyId: existing.company_id,
    companyTitle,
    pdfGuid: existing.pdf_guid,
    pdfUrl: existing.pdf_url,
    ilanSiraNo: existing.ilan_sira_no,
    gazetteNo: existing.gazette_no,
    gazetteDate: existing.gazette_date,
    ilanTuru: existing.ilan_turu,
    pdfBuffer,
  });
}

module.exports = {
  searchBatch,
  detectCompanyRegistries,
  processPdfEntry,
  enrichEventByGuid,
  enrichEventByGuidFromImage,
  enrichEventByGuidViaBrowser,
};
