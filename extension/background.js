// TESPIT EDILEN GERCEK: TTSG'nin PDF goruntuleme uc noktasi (pdf_goster.php)
// tarayicidan yapilan fetch/webRequest tabanli programatik istekleri captcha
// ile engelliyordu. Cozum: PDF'i artik EKRAN GORUNTUSU ALMADAN, backend'de
// puppeteer-core ile kullanicinin kendi Chrome'unu yoneterek GERCEK bir
// navigasyon yaptirip aliyoruz (bkz. src/services/browserPdfService.js).
// Eklentinin gorevi sadece TTSG oturum cerezini backend'e iletmek; PDF
// indirme, metin cikarma, olay tespiti ve AI ozeti tamamen sunucu
// tarafinda, kullanici mudahalesi olmadan tamamlanir.
//
// Iki tetikleyici var:
// 1) START_SCAN: arama+kayit (captcha gerektirmez).
// 2) FETCH_MISSING_SUMMARIES: ozeti eksik ilanlari backend'e sirayla
//    gonderir; backend her biri icin gercek Chrome navigasyonu yapip ozeti
//    cikarir. Ekran goruntusu YOK, sekme acma YOK.
const TTSG_DOMAIN = 'ticaretsicil.gov.tr';
const BATCH_LIMIT = 5;
// TTSG'nin captcha esiginin sayi mi yoksa hiz mi bazli oldugunu test etmek
// icin bilerek uzun tutuldu (onceki deger 1500-3000ms idi). Deneyle sinirin
// degisip degismedigini gorup buna gore ayarlayacagiz.
const SUMMARY_MIN_DELAY_MS = 10000;
const SUMMARY_MAX_DELAY_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// MV3 service worker'i ~30sn hareketsizlikte Chrome tarafindan sonlandiriliyor.
// runScan/fetchMissingSummaries icindeki sleep() bekleme adimlari (10-20sn)
// sirasinda tek basina setTimeout bu kapanmayi ENGELLEMEZ; worker o sirada
// oldurulurse bekleyen timeout hicbir zaman tetiklenmez ve dongu sonsuza
// kadar "…alınıyor" durumunda takili kalir. chrome.alarms periyodik
// tetiklemesi gercek bir extension event'i oldugu icin worker'i canli tutar.
const KEEP_ALIVE_ALARM = 'ttsg-keep-alive';

function startKeepAlive() {
  try {
    chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });
  } catch (err) {
    console.error('[TTSG Takip] keep-alive alarm baslatilamadi:', err.message);
  }
}

function stopKeepAlive() {
  try {
    chrome.alarms.clear(KEEP_ALIVE_ALARM);
  } catch (err) {
    console.error('[TTSG Takip] keep-alive alarm durdurulamadi:', err.message);
  }
}

try {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
      // no-op: sadece tetiklenmesi worker'in inaktivite sayacini sifirlar.
    }
  });
} catch (err) {
  // Bu satir eskiden try/catch DISINDAYDI: chrome.alarms herhangi bir
  // sebeple tanimsizsa (ör. "alarms" izni yuklenmemis bir eklenti
  // reload'unda gecici olarak eksikse) burada firlatilan hata TUM
  // background.js'in geri kalanini (asagidaki chrome.runtime.onMessage
  // kaydi DAHIL) calismadan birakiyordu - sonuc: content.js'ten gelen
  // HICBIR mesaja (START_SCAN, DETECT_AND_ADD_COMPANY, ...) yanit
  // gelmiyor, "message port closed before a response was received"
  // disinda hicbir iz kalmiyordu.
  console.error('[TTSG Takip] chrome.alarms.onAlarm dinleyicisi eklenemedi:', err.message);
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: TTSG_DOMAIN });
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  console.log('[TTSG Takip] cookie sayisi:', cookies.length, 'toplam header uzunlugu:', header.length);
  return header;
}

function setProgress(state) {
  return chrome.storage.local.set({ scanState: state });
}

// "Sirket Ekle" otomatik tespiti dashboard'dan (content.js koeprusu
// uezerinden) tetiklenir; popup'in scanState'inden bagimsizdir - ilerleme
// chrome.storage.local yerine dogrudan istegi baslatan taba yollanir. Tab
// bu sirada kapanmis/baska sayfaya gitmis olabilir, o yuzden sessizce yutulur.
function sendToTab(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.error('[TTSG Takip] mesaj tab\'a iletilemedi:', err.message);
  }
}

function pushDetectProgress(tabId, requestId, state) {
  sendToTab(tabId, { type: 'DETECT_PROGRESS', requestId, ...state });
}

function pushDetectResult(tabId, requestId, state) {
  sendToTab(tabId, { type: 'DETECT_RESULT', requestId, ...state });
}

async function getBackendUrl() {
  const stored = await chrome.storage.local.get('backendUrl');
  return (stored.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
}

async function runScan(backendUrl) {
  const cookie = await getCookieHeader();
  if (!cookie) {
    await setProgress({ status: 'error', text: 'TTSG oturum çerezi bulunamadı.' });
    return;
  }

  let offset = 0;
  let done = false;
  let totalActive = '?';
  const summaryLines = [];

  await setProgress({ status: 'running', text: 'Şirketler taranıyor…', lines: [] });

  startKeepAlive();
  try {
    while (!done) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${backendUrl}/api/scan/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie, offset, limit: BATCH_LIMIT }),
      });
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Sunucu hatasi (${res.status})`);
      }

      totalActive = json.totalActive;
      offset += json.processed;
      done = json.done || json.processed === 0;

      json.results.forEach((r) => {
        if (r.error) {
          summaryLines.push(`⚠ ${r.companyTitle}: ${r.error}`);
        } else if (r.savedCount > 0) {
          const backlog = r.remainingBacklog ? ` (+${r.remainingBacklog} sonraki taramada)` : '';
          const turler = r.entries.map((e) => `${e.gazetteDate || ''} ${e.ilanTuru || ''}`.trim()).join(' | ');
          summaryLines.push(`✓ ${r.companyTitle}: ${r.savedCount} yeni ilan${backlog}\n   ${turler}`);
        }
      });

      // eslint-disable-next-line no-await-in-loop
      await setProgress({ status: 'running', text: `Taranıyor… ${offset}/${totalActive}`, lines: summaryLines.slice() });
    }

    await setProgress({
      status: 'done',
      text: `Tamamlandı (${totalActive}/${totalActive}).`,
      lines: summaryLines.length > 0 ? summaryLines : ['Yeni bir gelişme bulunamadı.'],
    });
  } catch (err) {
    await setProgress({ status: 'error', text: `Hata: ${err.message}`, lines: summaryLines.slice() });
  } finally {
    stopKeepAlive();
  }
}

async function sendGuidForBrowserSummary(backendUrl, pdfGuid, cookie) {
  const res = await fetch(`${backendUrl}/api/scan/enrich-by-guid-browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfGuid, cookie }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || `Sunucu hatasi (${res.status})`);
    err.isCaptcha = !!json.captcha;
    throw err;
  }
  return json.data;
}

// --- "Eksik Özetleri Getir" butonu ---
// Ekran goruntusu YOK, sekme acma YOK: backend, gonderilen TTSG oturum
// cerezini kullanarak kendi yonettigi gercek bir Chrome ile PDF'e
// navigasyon yapar ve tam otomatik isler.
async function fetchMissingSummaries(backendUrl) {
  const lines = [];
  await setProgress({ status: 'running', text: 'Eksik özetler getiriliyor…', lines: [] });

  startKeepAlive();
  try {
    const cookie = await getCookieHeader();
    if (!cookie) {
      throw new Error('TTSG oturum çerezi bulunamadı.');
    }

    const listRes = await fetch(`${backendUrl}/api/events/missing-summary?limit=10`);
    const listJson = await listRes.json();
    if (!listRes.ok) {
      throw new Error(listJson.error || `Sunucu hatasi (${listRes.status})`);
    }

    const items = listJson.data || [];
    if (items.length === 0) {
      await setProgress({ status: 'done', text: 'Özeti eksik ilan yok.', lines: [] });
      return;
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      // eslint-disable-next-line no-await-in-loop
      await setProgress({ status: 'running', text: `Özet alınıyor… ${i + 1}/${items.length}`, lines: lines.slice() });

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await sendGuidForBrowserSummary(backendUrl, item.pdf_guid, cookie);

        if (result.aiSummary) {
          const preview = ` — "${result.aiSummary.slice(0, 70)}${result.aiSummary.length > 70 ? '…' : ''}"`;
          lines.push(`✓ ${item.pdf_guid.slice(0, 8)}…: özet alındı${preview}`);
        } else {
          lines.push(`⚠ ${item.pdf_guid.slice(0, 8)}…: özet çıkarılamadı`);
        }
      } catch (err) {
        if (err.isCaptcha) {
          // TTSG bu oturumu captcha gerektirir hale getirdi; kalan
          // istekleri gondermeye devam etmek sadece zaman kaybi (hepsi ayni
          // sekilde reddedilir). Acik kalan Chrome penceresinde kullanici
          // captchayi cozdukten sonra butona tekrar basmasi yeterli.
          lines.push(`⏸ ${item.pdf_guid.slice(0, 8)}…: captcha istendi — açık kalan pencerede çözüp tekrar deneyin.`);
          await setProgress({
            status: 'error',
            text: `Durduruldu: TTSG captcha istedi (${i + 1}/${items.length}). Açık pencerede çözüp tekrar deneyin.`,
            lines,
          });
          return;
        }
        lines.push(`⚠ ${item.pdf_guid.slice(0, 8)}…: ${err.message}`);
      }

      if (i < items.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(randomDelay(SUMMARY_MIN_DELAY_MS, SUMMARY_MAX_DELAY_MS));
      }
    }

    await setProgress({ status: 'done', text: `Tamamlandı (${items.length} ilan denendi).`, lines });
  } catch (err) {
    await setProgress({ status: 'error', text: `Hata: ${err.message}`, lines });
  } finally {
    stopKeepAlive();
  }
}

// --- Dashboard'daki "Şirket Ekle" formunun otomatik sicil müdürlüğü tespiti ---
// content.js koeprusu uezerinden tetiklenir. TTSG'de unvanin TUM sicil
// muduerluklerinde aranmasi (backend'in /api/scan/detect-company'i offset
// bazli parcalar halinde donmesi) tek seferde bitmeyecegi icin runScan()'daki
// gibi bir dongude cagirilir; sonuc birikimli toplanir.
async function detectAndAddCompany({ title, backendUrl, tabId, requestId }) {
  const cookie = await getCookieHeader();
  if (!cookie) {
    pushDetectResult(tabId, requestId, { status: 'error', text: 'TTSG oturum çerezi bulunamadı.' });
    return;
  }

  let offset = 0;
  let done = false;
  let totalRegistries = '?';
  const exactMatches = [];
  const partialMatches = [];

  startKeepAlive();
  try {
    while (!done) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${backendUrl}/api/scan/detect-company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unvan: title, cookie, offset, limit: 10 }),
      });
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Sunucu hatasi (${res.status})`);
      }

      totalRegistries = json.totalRegistries;
      offset += json.processed;
      done = json.done || json.processed === 0;
      exactMatches.push(...json.exactMatches);
      partialMatches.push(...json.partialMatches);

      pushDetectProgress(tabId, requestId, {
        status: 'running',
        text: `Sicil müdürlükleri taranıyor… ${offset}/${totalRegistries}`,
      });
    }

    if (exactMatches.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const createRes = await fetch(`${backendUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, sicilMudurlukleri: exactMatches.map((m) => m.id) }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createJson.error || `Sunucu hatasi (${createRes.status})`);
      }

      pushDetectResult(tabId, requestId, {
        status: 'done',
        found: true,
        company: createJson.data,
        registries: exactMatches,
      });
    } else if (partialMatches.length > 0) {
      pushDetectResult(tabId, requestId, { status: 'done', found: false, partialMatches });
    } else {
      pushDetectResult(tabId, requestId, { status: 'done', found: false, partialMatches: [] });
    }
  } catch (err) {
    pushDetectResult(tabId, requestId, { status: 'error', text: `Hata: ${err.message}` });
  } finally {
    stopKeepAlive();
  }
}

// Service worker her (yeniden) baslatildiginda bellekteki her turlu calisma
// kaybolur; bu yuzden storage'da "running" olarak kalmis bir durum kesinlikle
// bayattir (ör. eklenti reload edildiginde onceki calisma yarida kesildi) ve
// butonlarin sonsuza kadar devre disi kalmasina neden olur. Baslangicta
// temizleyip kullaniciya tekrar deneme imkani veriyoruz.
chrome.storage.local.get('scanState', (stored) => {
  if (stored.scanState && stored.scanState.status === 'running') {
    setProgress({
      status: 'error',
      text: 'Önceki işlem uzantı yeniden yüklendiği için yarıda kesildi. Tekrar deneyin.',
      lines: stored.scanState.lines || [],
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'START_SCAN') {
    runScan(msg.backendUrl);
  } else if (msg && msg.type === 'FETCH_MISSING_SUMMARIES') {
    fetchMissingSummaries(msg.backendUrl);
  } else if (msg && msg.type === 'DETECT_AND_ADD_COMPANY' && sender.tab) {
    // Sadece content.js koeprusunden (dashboard sekmesinden) gelen istekler
    // kabul edilir - sender.tab yoksa (ör. popup) bu akis anlamsizdir.
    // detectAndAddCompany() reddederse (ör. getCookieHeader() try/catch
    // disinda oldugu icin) .catch() olmadan bu bir "unhandled rejection"
    // olarak sessizce kaybolur ve sayfa sonsuza kadar "Tespit ediliyor…"
    // durumunda takili kalir - kullaniciya hicbir hata gostermez.
    detectAndAddCompany({
      title: msg.title,
      backendUrl: msg.backendUrl,
      tabId: sender.tab.id,
      requestId: msg.requestId,
    }).catch((err) => {
      console.error('[TTSG Takip] detectAndAddCompany beklenmeyen hata:', err);
      pushDetectResult(sender.tab.id, msg.requestId, {
        status: 'error',
        text: `Beklenmeyen hata: ${err.message}`,
      });
    });
  }
});
