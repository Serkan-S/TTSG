const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.ticaretsicil.gov.tr/view/hizlierisim';
const SEARCH_URL = `${BASE_URL}/ilangoruntuleme_ok.php`;

/**
 * DD.MM.YYYY formatindaki TTSG tarihini ISO (YYYY-MM-DD) formatina cevirir.
 */
function parseTrDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Sirket unvani + sicil muduerluegue ile TTSG "Ilan Goeruentuleme" aramasini yapar.
 * Oturum girisli oldugundan cookie zorunludur (kullanicinin taraycidan alinan
 * TTSG oturum cerezi - sunucuda hicbir zaman kalici saklanmaz).
 *
 * @param {{ sicilMudurluguId: number, unvan: string, cookie: string }} params
 * @returns {Promise<Array<{ ilanSiraNo: number, pdfGuid: string, pdfUrl: string,
 *   gazetteNo: string, gazetteDate: string|null, ilanTuru: string, sicilNo: string }>>}
 */
async function searchAnnouncements({ sicilMudurluguId, unvan, cookie }) {
  if (!sicilMudurluguId) {
    throw new Error('[ttsgService.searchAnnouncements] sicilMudurluguId zorunludur.');
  }
  if (!unvan || unvan.trim().length < 5) {
    throw new Error('[ttsgService.searchAnnouncements] unvan en az 5 karakter olmalidir.');
  }
  if (!cookie) {
    throw new Error('[ttsgService.searchAnnouncements] TTSG oturum cerezi (cookie) zorunludur.');
  }

  const body = new URLSearchParams({
    SicilMudurluguId: String(sicilMudurluguId),
    TicSicNo: '',
    TicaretUnvani: unvan,
    Tarih1: '',
    Tarih2: '',
  });

  let html;
  try {
    const response = await axios.post(SEARCH_URL, body.toString(), {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: `${BASE_URL}/ilangoruntuleme.php`,
        Cookie: cookie,
      },
    });
    html = response.data;
  } catch (err) {
    throw new Error(`[ttsgService.searchAnnouncements] Arama istegi basarisiz: ${err.message}`);
  }

  if (typeof html === 'string' && /GİRİŞ YAPMALISINIZ|giris yapmalisiniz/i.test(html)) {
    throw new Error('TTSG oturumu gecersiz/suresi dolmus, tekrar giris yapip tekrar deneyin.');
  }

  const $ = cheerio.load(html);
  const rows = $('table tbody tr').toArray();

  return rows
    .map((row) => {
      const cells = $(row).find('td');
      const pdfHref = $(row).find('a[href*="pdf_goster"]').attr('href');
      const sepetOnclick = $(row).find('[onclick*="SepeteEkle"]').attr('onclick');
      const sepetMatch = sepetOnclick ? sepetOnclick.match(/SepeteEkle\((\d+)\)/) : null;

      if (!pdfHref || !sepetMatch) return null;

      const pdfGuidMatch = pdfHref.match(/Guid=([\w-]+)/);
      if (!pdfGuidMatch) return null;

      return {
        ilanSiraNo: Number(sepetMatch[1]),
        pdfGuid: pdfGuidMatch[1],
        pdfUrl: `${BASE_URL}/${pdfHref}`,
        sicilMudurlugu: $(cells[0]).text().trim(),
        sicilNo: $(cells[1]).text().trim(),
        unvan: $(cells[2]).text().trim(),
        gazetteDate: parseTrDate($(cells[3]).text().trim()),
        gazetteNo: $(cells[4]).text().trim(),
        sayfa: $(cells[5]).text().trim(),
        ilanTuru: $(cells[6]).text().replace(/\s+/g, ' ').trim(),
      };
    })
    .filter(Boolean);
}

module.exports = { searchAnnouncements, parseTrDate };
