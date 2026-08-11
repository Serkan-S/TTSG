const pdfParse = require('pdf-parse');

/**
 * PDF binary verisini (Buffer) sadece RAM uzerinde metne cevirir.
 * Onemli: fs.writeFileSync KULLANILMAZ, dosya diske hicbir sekilde yazilmaz.
 * PDF, TTSG'nin girisli+captcha korumali oldugu icin sunucu tarafindan
 * (axios ile) degil, Chrome eklentisinin kendisi tarafindan (kullanicinin
 * gercek tarayici oturumundan) indirilip buraya gonderilir.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} PDF icindeki ham metin
 */
async function parsePdfBuffer(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('[parsePdfBuffer] Gecerli bir PDF buffer gerekli.');
  }

  try {
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text || '';
  } catch (err) {
    throw new Error(`[parsePdfBuffer] PDF metne cevrilemedi: ${err.message}`);
  }
}

module.exports = { parsePdfBuffer };
