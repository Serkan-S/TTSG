// PDF metinlerinde ve sirket unvanlarinda Turkce karakter/kasa tutarsizliklarindan
// (OCR kaynakli buyuk harf, noktalama vb.) kaynaklanan kacirilan eslesmeleri
// azaltmak icin regex/sozluk karsilastirmasindan once metni sadelestirir.
function normalizeTr(text) {
  if (!text) return '';

  const charMap = {
    ç: 'c', Ç: 'c',
    ğ: 'g', Ğ: 'g',
    ı: 'i', I: 'i', İ: 'i',
    ö: 'o', Ö: 'o',
    ş: 's', Ş: 's',
    ü: 'u', Ü: 'u',
  };

  return text
    .split('')
    .map((ch) => charMap[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeTr };
