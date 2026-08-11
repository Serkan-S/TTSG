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
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'START_SCAN') {
    runScan(msg.backendUrl);
  } else if (msg && msg.type === 'FETCH_MISSING_SUMMARIES') {
    fetchMissingSummaries(msg.backendUrl);
  }
});
