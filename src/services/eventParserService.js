const { EVENT_PATTERNS, ILAN_TURU_KEYWORDS } = require('../data/keywords');
const { normalizeTr } = require('../utils/normalizeTr');

const EXCERPT_RADIUS = 80; // eslesen ifadenin etrafindan kac karakter alintilanacak

/**
 * Ham TTSG ilan metnini regex kaliplariyla tarayip hukuki/idari gelismeleri tespit eder.
 * Tamamen kural tabanlidir (LLM kullanilmaz).
 *
 * @param {string} text - fetchAndParsePDF() tarafindan dondurulen ham metin
 * @returns {{
 *   flags: Record<string, boolean>,
 *   matches: Array<{ key: string, label: string, excerpt: string }>
 * }}
 */
function extractEvents(text) {
  const flags = {};
  const matches = [];

  // Sozlukteki her olay anahtari icin varsayilan olarak false donulur; boylece
  // cagiran taraf her zaman ayni sekli garanti eder.
  for (const pattern of EVENT_PATTERNS) {
    flags[pattern.key] = false;
  }

  if (!text || typeof text !== 'string') {
    return { flags, matches };
  }

  try {
    const normalizedText = normalizeTr(text);

    for (const pattern of EVENT_PATTERNS) {
      const match = normalizedText.match(pattern.regex);
      if (match) {
        flags[pattern.key] = true;

        const start = Math.max(0, match.index - EXCERPT_RADIUS);
        const end = Math.min(normalizedText.length, match.index + match[0].length + EXCERPT_RADIUS);

        matches.push({
          key: pattern.key,
          label: pattern.label,
          excerpt: normalizedText.slice(start, end).trim(),
        });
      }
    }

    return { flags, matches };
  } catch (err) {
    console.error(`[extractEvents] Metin ayristirilirken hata: ${err.message}`);
    // Hata durumunda bile tutarli sekil (shape) dondururuz; caller crash olmaz.
    return { flags, matches };
  }
}

/**
 * TTSG arama sonucundaki KISA "Ilan Turu" basligina gore gevsek (substring
 * bazli) olay siniflandirmasi yapar. extractEvents()'in aksine PDF'in tam
 * metnini degil, arama sonucunda zaten ucretsiz/captcha'siz gelen kisa
 * basligi kullanir - bu yuzden daha az kesin ama tamamen guvenilirdir.
 *
 * @param {string} ilanTuru
 * @returns {{ flags: Record<string, boolean>, matches: Array<{ key: string, label: string, excerpt: string }> }}
 */
function classifyIlanTuru(ilanTuru) {
  const flags = {};
  const matches = [];

  for (const pattern of EVENT_PATTERNS) {
    flags[pattern.key] = false;
  }

  if (!ilanTuru || typeof ilanTuru !== 'string') {
    return { flags, matches };
  }

  const normalized = normalizeTr(ilanTuru);
  const labelByKey = new Map(EVENT_PATTERNS.map((p) => [p.key, p.label]));

  for (const [key, keywords] of Object.entries(ILAN_TURU_KEYWORDS)) {
    const hit = keywords.some((kw) => normalized.includes(normalizeTr(kw)));
    if (hit) {
      flags[key] = true;
      matches.push({ key, label: labelByKey.get(key) || key, excerpt: ilanTuru });
    }
  }

  return { flags, matches };
}

module.exports = { extractEvents, classifyIlanTuru };
