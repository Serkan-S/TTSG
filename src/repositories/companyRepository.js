const { supabase } = require('../config/db');

/**
 * Taranacak (aktif) hedef sirketleri sayfalanmis sekilde getirir.
 * @param {{ offset?: number, limit?: number }} [opts]
 */
async function getActiveCompanies({ offset = 0, limit = 1000 } = {}) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, title, tax_number, sicil_mudurlukleri, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`[companyRepository.getActiveCompanies] Supabase hatasi: ${error.message}`);
  }

  return data || [];
}

async function countActiveCompanies() {
  const { count, error } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (error) {
    throw new Error(`[companyRepository.countActiveCompanies] Supabase hatasi: ${error.message}`);
  }

  return count || 0;
}

/**
 * Yeni bir takip hedefi ekler.
 */
async function createCompany({ title, taxNumber, sicilMudurlukleri }) {
  const { data, error } = await supabase
    .from('companies')
    .insert({
      title,
      tax_number: taxNumber || null,
      sicil_mudurlukleri: sicilMudurlukleri,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[companyRepository.createCompany] Supabase hatasi: ${error.message}`);
  }

  return data;
}

/**
 * Bir sirket icin daha once kaydedilmis PDF Guid'lerini dondurur. Arama
 * sonuclarini bunlarla karsilastirarak sadece YENI ilanlar islenir.
 * Not: TTSG'nin "ilan sira no" degeri her arama sorgusunda YENIDEN
 * uretilebildigi (kalici olmadigi) tespit edildi; bu yuzden tekillestirme
 * icin PDF linkindeki Guid kullanilir (ayni ilan icin sabit kalir).
 * @returns {Promise<Set<string>>}
 */
async function getExistingPdfGuids(companyId) {
  const { data, error } = await supabase
    .from('gazette_events')
    .select('pdf_guid')
    .eq('company_id', companyId);

  if (error) {
    throw new Error(`[companyRepository.getExistingPdfGuids] Supabase hatasi: ${error.message}`);
  }

  return new Set((data || []).map((row) => row.pdf_guid));
}

/**
 * Sirketin tespit edilen sektorunu ve son tarama zamanini gunceller.
 */
async function updateCompanySector(companyId, sector) {
  const { error } = await supabase
    .from('companies')
    .update({ sector, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', companyId);

  if (error) {
    throw new Error(`[companyRepository.updateCompanySector] Supabase hatasi: ${error.message}`);
  }
}

async function touchLastCheckedAt(companyId) {
  const { error } = await supabase
    .from('companies')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('id', companyId);

  if (error) {
    throw new Error(`[companyRepository.touchLastCheckedAt] Supabase hatasi: ${error.message}`);
  }
}

/**
 * pdf_guid'e gore mevcut bir gazette_events satirini (ilgili sirket unvani ile
 * birlikte) bulur. Kullanici PDF linkine tikladiginda (arka planda otomatik
 * degil) o ilani zenginlestirmek icin kullanilir.
 */
async function getEventByPdfGuid(pdfGuid) {
  const { data, error } = await supabase
    .from('gazette_events')
    .select('id, company_id, pdf_guid, pdf_url, ilan_sira_no, gazette_no, gazette_date, ilan_turu, companies(title)')
    .eq('pdf_guid', pdfGuid)
    .maybeSingle();

  if (error) {
    throw new Error(`[companyRepository.getEventByPdfGuid] Supabase hatasi: ${error.message}`);
  }

  return data;
}

/**
 * Mevcut bir gazette_events satirinin SADECE ai_summary alanini gunceller.
 * Ekran goruntusunden cikarilan ozet icin kullanilir - diger alanlar (flags,
 * ilan_turu vb.) zaten arama asamasinda kaydedilmis oldugundan dokunulmaz.
 */
async function updateEventSummary(pdfGuid, aiSummary) {
  const { error } = await supabase
    .from('gazette_events')
    .update({ ai_summary: aiSummary })
    .eq('pdf_guid', pdfGuid);

  if (error) {
    throw new Error(`[companyRepository.updateEventSummary] Supabase hatasi: ${error.message}`);
  }
}

/**
 * extractEvents() ciktisini yapilandirilmis bir gazette_events satiri olarak kaydeder.
 * Ayni (company_id, pdf_guid) ciftinde tekrar isleme durumunda upsert yapar.
 */
async function saveGazetteEvent({
  companyId,
  pdfGuid,
  ilanSiraNo,
  pdfUrl,
  gazetteNo,
  gazetteDate,
  ilanTuru,
  flags,
  matches,
  rawExcerpt,
  aiSummary,
  lastSummaryAttemptAt,
}) {
  const payload = {
    company_id: companyId,
    pdf_guid: pdfGuid,
    ilan_sira_no: ilanSiraNo ?? null,
    pdf_url: pdfUrl,
    gazette_no: gazetteNo ?? null,
    gazette_date: gazetteDate ?? null,
    ilan_turu: ilanTuru ?? null,
    sermaye_artirimi: flags.sermaye_artirimi ?? false,
    adres_degisikligi: flags.adres_degisikligi ?? false,
    genel_kurul: flags.genel_kurul ?? false,
    unvan_degisikligi: flags.unvan_degisikligi ?? false,
    ortak_degisikligi: flags.ortak_degisikligi ?? false,
    tasfiye: flags.tasfiye ?? false,
    matched_keywords: matches ?? [],
    raw_text_excerpt: rawExcerpt ?? null,
    // Bos string ('') "ozet alinamadi" durumunu temsil eder; bunu null
    // olarak kaydetmezsek /api/events/missing-summary sorgusu (ai_summary
    // IS NULL) bu kaydi bir daha hic secmez ve kalici olarak ozetsiz
    // kalir - halbuki bir sonraki "Eksik Ozetleri Getir" denemesinde
    // tekrar denenebilir olmali.
    ai_summary: aiSummary && aiSummary.trim() ? aiSummary : null,
  };

  // Sadece gercek bir ozet denemesi yapildiginda (processPdfEntry akisinda)
  // gonderilir; arama-only kayitlarda dokunulmaz. Ayni ilan tekrar tekrar
  // basarisiz olsa bile "en son ne zaman denendi" bilgisi sayesinde
  // /api/events/missing-summary listesi hep denenmemis/en eski denenmis
  // kayitlari one alabilir - boylece TTSG'nin oturum basina sinirli
  // captcha'siz kotasi hep ayni sorunlu kayda harcanmaz.
  if (lastSummaryAttemptAt) {
    payload.last_summary_attempt_at = lastSummaryAttemptAt;
  }

  const { error } = await supabase
    .from('gazette_events')
    .upsert(payload, { onConflict: 'company_id,pdf_guid' });

  if (error) {
    throw new Error(`[companyRepository.saveGazetteEvent] Supabase hatasi: ${error.message}`);
  }
}

module.exports = {
  getActiveCompanies,
  countActiveCompanies,
  createCompany,
  getExistingPdfGuids,
  getEventByPdfGuid,
  updateEventSummary,
  updateCompanySector,
  touchLastCheckedAt,
  saveGazetteEvent,
};
