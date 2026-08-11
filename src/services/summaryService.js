// Saglayici .env'deki AI_PROVIDER ile secilir ("gemini" | "openai"), boylece
// gece OpenAI aktif edilince sadece .env degistirmek yeterli olur, kod
// degismez. Ikisi de kisa/orta uzunluktaki TTSG ilan metinlerini ozetlemek
// gibi basit bir gorev icin en ucuz/hizli model kademesini kullanir.
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const SYSTEM_PROMPT =
  'Türkiye Ticaret Sicili Gazetesi ilanlarını sade, anlaşılır Türkçe ile özetleyen bir asistansın. ' +
  'Sadece 2-3 cümlelik, önemli noktaları (ne değişti, kim etkilendi) içeren düz metin bir özet ver. ' +
  'Selamlama, giriş cümlesi veya "işte özet" gibi ifadeler kullanma, doğrudan özetle başla.';

const IMAGE_SYSTEM_PROMPT =
  'Türkiye Ticaret Sicili Gazetesi ilanlarının ekran görüntülerini okuyup sade, anlaşılır Türkçe ile ' +
  'özetleyen bir asistansın. Görseldeki ilan metnini oku, sadece 2-3 cümlelik, önemli noktaları ' +
  '(ne değişti, kim etkilendi) içeren düz metin bir özet ver. Selamlama, giriş cümlesi veya ' +
  '"işte özet" gibi ifadeler kullanma, doğrudan özetle başla. Görselde okunabilir bir ilan metni yoksa ' +
  '(ör. boş sayfa, hata ekranı) sadece "OKUNAMADI" yaz.';

function buildUserPrompt(rawText, companyTitle) {
  return `Şirket: ${companyTitle}\n\nİlan metni:\n${rawText.slice(0, 8000)}`;
}

let geminiClient = null;
async function summarizeWithGemini(rawText, companyTitle) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('[summaryService] GEMINI_API_KEY .env icinde tanimli degil.');
  }
  if (!geminiClient) {
    const { GoogleGenAI } = require('@google/genai');
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await geminiClient.models.generateContent({
    model,
    contents: buildUserPrompt(rawText, companyTitle),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 500,
      // Basit bir ozetleme gorevi icin "thinking" gereksizdir; kapatilmazsa
      // varsayilan dusunme butcesi maxOutputTokens'i asil metinden once
      // tuketip yaniti MAX_TOKENS ile erken kesebiliyor.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return (response.text || '').trim();
}

let openaiClient = null;
async function summarizeWithOpenAI(rawText, companyTitle) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('[summaryService] OPENAI_API_KEY .env icinde tanimli degil.');
  }
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await openaiClient.chat.completions.create({
    model,
    max_tokens: 300,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(rawText, companyTitle) },
    ],
  });

  return (response.choices[0]?.message?.content || '').trim();
}

/**
 * TTSG ilan metnini 2-3 cumlelik sade bir Turkce ozete cevirir.
 * @param {string} rawText - PDF'den cikarilan ham metin
 * @param {string} companyTitle
 * @returns {Promise<string>}
 */
async function summarizeAnnouncement(rawText, companyTitle) {
  if (!rawText || rawText.trim().length === 0) {
    return '';
  }

  if (PROVIDER === 'openai') {
    return summarizeWithOpenAI(rawText, companyTitle);
  }
  if (PROVIDER === 'gemini') {
    return summarizeWithGemini(rawText, companyTitle);
  }
  throw new Error(`[summaryService] Bilinmeyen AI_PROVIDER: "${PROVIDER}" (gemini | openai olmali)`);
}

async function summarizeImageWithGemini(imageBase64, companyTitle) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('[summaryService] GEMINI_API_KEY .env icinde tanimli degil.');
  }
  if (!geminiClient) {
    const { GoogleGenAI } = require('@google/genai');
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await geminiClient.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
          { text: `Şirket: ${companyTitle}` },
        ],
      },
    ],
    config: {
      systemInstruction: IMAGE_SYSTEM_PROMPT,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return (response.text || '').trim();
}

async function summarizeImageWithOpenAI(imageBase64, companyTitle) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('[summaryService] OPENAI_API_KEY .env icinde tanimli degil.');
  }
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await openaiClient.chat.completions.create({
    model,
    max_tokens: 300,
    messages: [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Şirket: ${companyTitle}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
  });

  return (response.choices[0]?.message?.content || '').trim();
}

/**
 * Bir PDF sayfasinin EKRAN GORUNTUSUNU (screenshot) okuyup 2-3 cumlelik sade
 * bir Turkce ozete cevirir. TTSG'nin PDF goruntuleme uc noktasi sadece
 * GERCEK tarayici navigasyonlarini kabul edip her turlu programatik istegi
 * (fetch, arka plan indirme) captcha ile engelledigi tespit edildiginden,
 * PDF'i AGDAN TEKRAR INDIRMEK YERINE kullanicinin zaten gordugu ekranin
 * goruntusu kullanilir - TTSG'ye hicbir ek istek gitmez.
 * @param {string} imageBase64 - PNG ekran goruntusu (base64, "data:" onesiz)
 * @param {string} companyTitle
 * @returns {Promise<string>}
 */
async function summarizeAnnouncementFromImage(imageBase64, companyTitle) {
  if (!imageBase64) return '';

  if (PROVIDER === 'openai') {
    return summarizeImageWithOpenAI(imageBase64, companyTitle);
  }
  if (PROVIDER === 'gemini') {
    return summarizeImageWithGemini(imageBase64, companyTitle);
  }
  throw new Error(`[summaryService] Bilinmeyen AI_PROVIDER: "${PROVIDER}" (gemini | openai olmali)`);
}

module.exports = { summarizeAnnouncement, summarizeAnnouncementFromImage };
