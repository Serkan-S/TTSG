const puppeteer = require('puppeteer-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// TTSG'nin PDF goruntuleme uc noktasi sadece GERCEK tarayici navigasyonlarini
// kabul ediyor; axios/fetch ile yapilan HER TURLU programatik istek (session
// cerezi dogru olsa bile) captcha ile engelleniyor - 10/10 denemede
// dogrulandi. Bu yuzden burada axios yerine, kullanicinin BILGISAYARINDA
// zaten kurulu olan Chrome'u puppeteer-core ile yonetip GERCEKTEN
// navigasyon yaptiriyoruz.
//
// ONEMLI KISIT: Chrome'un yerlesik PDF goruntuleyicisi bir navigasyonu
// kendi ic mekanizmasiyla (plugin/viewer) isledigi icin, Puppeteer'in normal
// "response.buffer()" ile ana frame'in gercek PDF baytlarini guvenilir
// sekilde yakalamasi MUMKUN DEGIL (bilinen bir Puppeteer/Chrome kisiti) -
// PDF ekranda dogru gorunse bile response body bos/farkli donebiliyor. Bu
// yuzden PDF'i "goruntuleme" degil, GERCEK BIR INDIRME (download) olarak
// almaya zorluyoruz: gecici bir Chrome profilinde
// `plugins.always_open_pdf_externally=true` tercihini onceden yazip Chrome'a
// PDF'leri viewer'da acmak yerine diske indirmesini soyluyoruz, sonra CDP
// Page.downloadProgress olayini izleyip inen dosyayi diskten okuyoruz. Bu
// sayede: gercek bir PDF gelirse indirme tetiklenir (basari); TTSG captcha/
// giris HTML sayfasi donduruyorsa hicbir indirme baslamaz (bekleme suresi
// dolar, captcha olarak isaretlenir).
function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('[browserPdfService] Chrome bulunamadi (beklenen konumlar: ' + candidates.join(', ') + ')');
  }
  return found;
}

/**
 * Verilen cookie header string'ini ("ad1=deger1; ad2=deger2") puppeteer'in
 * page.setCookie() bekledigi obje dizisine cevirir.
 */
function parseCookieHeader(cookieHeader, domain) {
  return cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      return {
        name: pair.slice(0, idx),
        value: pair.slice(idx + 1),
        domain,
        path: '/',
      };
    });
}

/**
 * Gecici bir Chrome profil klasoru olusturur ve PDF'lerin viewer yerine
 * dosya olarak indirilmesini saglayan tercihi onceden yazar.
 */
function createProfileWithDownloadPref(profileDir) {
  const defaultDir = path.join(profileDir, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({ plugins: { always_open_pdf_externally: true } })
  );
}

/**
 * TTSG oturum cerezini kullanarak, GERCEK bir Chrome ile PDF'i INDIRIR (viewer
 * yerine gercek dosya indirmesi olarak) ve ham PDF byte'larini dondurur.
 * Belirlenen surede hicbir indirme baslamazsa (TTSG captcha/giris HTML
 * sayfasi dondurdugu icin) isCaptcha=true olan bir hata firlatir ve
 * pencereyi ACIK BIRAKIR ki kullanici orada captchayi cozebilsin.
 *
 * @param {{ pdfUrl: string, cookie: string }} params
 * @returns {Promise<Buffer>}
 */
async function fetchPdfViaBrowser({ pdfUrl, cookie }) {
  const executablePath = findChromePath();
  const sessionId = crypto.randomUUID();
  const profileDir = path.join(os.tmpdir(), `ttsg-chrome-profile-${sessionId}`);
  const downloadDir = path.join(os.tmpdir(), `ttsg-chrome-downloads-${sessionId}`);
  fs.mkdirSync(downloadDir, { recursive: true });
  createProfileWithDownloadPref(profileDir);

  const browser = await puppeteer.launch({
    executablePath,
    headless: false, // gorunur pencere: otomasyon tespitini azaltir, captcha cikarsa kullanici orada cozebilir
    userDataDir: profileDir,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1024,768'],
  });

  try {
    const page = await browser.newPage();
    const cookies = parseCookieHeader(cookie, 'www.ticaretsicil.gov.tr');
    await page.setCookie(...cookies);

    const client = await page.target().createCDPSession();
    await client.send('Page.enable');
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    const downloaded = await new Promise((resolve) => {
      let activeGuid = null;
      const timer = setTimeout(() => resolve(false), 15000);

      client.on('Page.downloadWillBegin', (evt) => {
        activeGuid = evt.guid;
      });
      client.on('Page.downloadProgress', (evt) => {
        if (evt.guid !== activeGuid) return;
        if (evt.state === 'completed') {
          clearTimeout(timer);
          resolve(true);
        } else if (evt.state === 'canceled') {
          clearTimeout(timer);
          resolve(false);
        }
      });

      page.goto(pdfUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    });

    if (!downloaded) {
      // TTSG oturum basina belirli sayida PDF goruntulemesine izin veriyor,
      // sonra oturumu captcha gerektirir hale getiriyor - bu noktadan sonra
      // AYNI cerezle yapilan TUM istekler (gercek navigasyon dahil) captcha
      // sayfasi donduruyor, ta ki kullanici captchayi COZENE kadar. Bu
      // yuzden pencereyi KAPATMIYORUZ: kullanici hemen bu acik pencerede
      // captchayi cozebilsin diye birakiyoruz.
      const err = new Error(
        'TTSG bu oturumda captcha istiyor. Acik kalan Chrome penceresinde captchayi cozun, sonra tekrar deneyin.'
      );
      err.isCaptcha = true;
      throw err;
    }

    const files = await fsp.readdir(downloadDir);
    if (files.length === 0) {
      throw new Error('Indirme tamamlandi ancak dosya bulunamadi.');
    }
    const buffer = await fsp.readFile(path.join(downloadDir, files[0]));

    await browser.close();
    await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    return buffer;
  } catch (err) {
    if (!err.isCaptcha) {
      await browser.close().catch(() => {});
      await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

module.exports = { fetchPdfViaBrowser, findChromePath };
