const puppeteer = require('puppeteer-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { findChromePath } = require('./browserPdfService');

/**
 * PDF'in ilk sayfasini YEREL olarak (TTSG'ye hicbir istek gitmeden) PNG
 * goruntuye cevirir. TTSG'nin bazi ilan PDF'leri taranmis sayfalar oldugu
 * icin metin katmani icermiyor (pdf-parse bos metin donduruyor) - bu
 * PDF'ler icin AI ozetini gorsel okuma (vision) yoluyla cikarabilmek amaciyla
 * kullanilir. Islem tamamen yerel bir dosyaya (file://) navigasyon oldugundan
 * TTSG'ye ag istegi gitmez, dolayisiyla captcha riski yoktur.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} base64 PNG (data: onesiz)
 */
async function renderPdfFirstPageAsImage(pdfBuffer) {
  const executablePath = findChromePath();
  const tmpFile = path.join(os.tmpdir(), `ttsg-render-${crypto.randomUUID()}.pdf`);
  await fsp.writeFile(tmpFile, pdfBuffer);

  const browser = await puppeteer.launch({ executablePath, headless: false });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400 });
    await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const imageBuffer = await page.screenshot({ type: 'png' });
    return imageBuffer.toString('base64');
  } finally {
    await browser.close().catch(() => {});
    await fsp.unlink(tmpFile).catch(() => {});
  }
}

module.exports = { renderPdfFirstPageAsImage };
