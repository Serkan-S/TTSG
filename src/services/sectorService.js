const { SECTOR_KEYWORDS, DEFAULT_SECTOR } = require('../data/keywords');
const { normalizeTr } = require('../utils/normalizeTr');

/**
 * Sirket unvaninda gecen anahtar kelimelere bakarak faaliyet sektorunu tahmin eder.
 * Tamamen sozluk/regex tabanlidir, herhangi bir LLM cagrisi yapmaz.
 *
 * @param {string} companyName - Sirket ticaret unvani (orn: "ABC Yazilim ve Insaat A.S.")
 * @returns {string} Eslesen sektor anahtari (orn: "Yazilim_Teknoloji") ya da "Diger"
 */
function detectSector(companyName) {
  try {
    if (!companyName || typeof companyName !== 'string') {
      return DEFAULT_SECTOR;
    }

    const normalizedName = normalizeTr(companyName);

    for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
      const isMatch = keywords.some((keyword) => normalizedName.includes(normalizeTr(keyword)));
      if (isMatch) {
        return sector;
      }
    }

    return DEFAULT_SECTOR;
  } catch (err) {
    // Sektor tespiti kritik olmayan bir zenginlestirme adimidir; hata pipeline'i durdurmamali.
    console.error(`[detectSector] Beklenmeyen hata: ${err.message}`);
    return DEFAULT_SECTOR;
  }
}

module.exports = { detectSector };
