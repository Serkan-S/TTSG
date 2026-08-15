const express = require('express');
const { supabase } = require('../../config/db');
const { createCompany } = require('../../repositories/companyRepository');
const {
  searchBatch,
  detectCompanyRegistries,
  processPdfEntry,
  enrichEventByGuid,
  enrichEventByGuidFromImage,
  enrichEventByGuidViaBrowser,
} = require('../../services/scanService');
const { SICIL_MUDURLUKLERI } = require('../../data/sicilMudurlukleri');
const { EVENT_PATTERNS, SECTOR_KEYWORDS, DEFAULT_SECTOR } = require('../../data/keywords');

const EVENT_TYPE_KEYS = EVENT_PATTERNS.map((p) => p.key);
const router = express.Router();

// GET /api/companies - takip edilen tum sirketleri listeler
router.get('/companies', async (req, res) => {
  try {
    const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    console.error(`[GET /api/companies] ${err.message}`);
    res.status(500).json({ error: 'Sirketler getirilirken bir hata olustu.' });
  }
});

// POST /api/companies - yeni bir takip hedefi ekler. Bir sirketin ilanlari
// birden fazla Sicil Muduerluegue'nde yayinlanabildigi icin sicilMudurlukleri
// bir id dizisi olarak gonderilir (geriye donuk uyumluluk icin tek bir
// sicilMudurluguId de kabul edilir).
router.post('/companies', async (req, res) => {
  try {
    const { title, taxNumber, sicilMudurlukleri: bodyIds, sicilMudurluguId: singleId } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      return res.status(400).json({ error: 'title alani zorunludur (en az 5 karakter).' });
    }

    const rawIds = Array.isArray(bodyIds) && bodyIds.length > 0 ? bodyIds : singleId ? [singleId] : [];
    const ids = [...new Set(rawIds.map(Number))].filter((n) => !Number.isNaN(n));

    if (ids.length === 0) {
      return res.status(400).json({ error: 'En az bir sicilMudurlukleri (id listesi) zorunludur.' });
    }

    const resolved = ids.map((id) => SICIL_MUDURLUKLERI.find((m) => m.id === id));
    const invalidIndex = resolved.findIndex((m) => !m);
    if (invalidIndex !== -1) {
      return res.status(400).json({ error: `Gecersiz sicilMudurluguId: ${ids[invalidIndex]}` });
    }

    const company = await createCompany({
      title: title.trim(),
      taxNumber: taxNumber ? String(taxNumber).trim() : null,
      sicilMudurlukleri: resolved.map((m) => ({ id: m.id, name: m.name })),
    });

    res.status(201).json({ data: company });
  } catch (err) {
    console.error(`[POST /api/companies] ${err.message}`);
    res.status(500).json({ error: 'Sirket eklenirken bir hata olustu.' });
  }
});

// DELETE /api/companies/:id - bir takip hedefini kalici olarak kaldirir.
// gazette_events tablosu company_id uzerinde "on delete cascade" oldugundan
// (bkz. sql/schema.sql), o sirkete ait tum gelisme kayitlari da otomatik
// silinir.
router.delete('/companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('companies').delete().eq('id', id).select('id, title');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Sirket bulunamadi.' });
    }

    res.json({ data: data[0] });
  } catch (err) {
    console.error(`[DELETE /api/companies/:id] ${err.message}`);
    res.status(500).json({ error: 'Sirket kaldirilirken bir hata olustu.' });
  }
});

// GET /api/companies/:id/events - bir sirkete ait tespit edilen gelismeler
router.get('/companies/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('gazette_events')
      .select('*')
      .eq('company_id', id)
      .order('gazette_date', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    console.error(`[GET /api/companies/:id/events] ${err.message}`);
    res.status(500).json({ error: 'Sirket gelismeleri getirilirken bir hata olustu.' });
  }
});

// GET /api/events - tum tespit edilen gelismeler; sektor, olay turu, sirket adi
// ve tarih araligina gore filtrelenebilir, sayfalanmis (limit/offset) sonuc doner.
router.get('/events', async (req, res) => {
  try {
    const { sector, eventType, company, dateFrom, dateTo, limit, offset } = req.query;

    if (eventType && !EVENT_TYPE_KEYS.includes(eventType)) {
      return res.status(400).json({ error: `Gecersiz eventType. Beklenen degerlerden biri: ${EVENT_TYPE_KEYS.join(', ')}` });
    }

    let query = supabase
      .from('gazette_events')
      .select('*, companies!inner(id, title, sector)', { count: 'exact' });

    if (sector) query = query.eq('companies.sector', sector);
    if (company) query = query.ilike('companies.title', `%${company}%`);
    if (eventType) query = query.eq(eventType, true);
    if (dateFrom) query = query.gte('gazette_date', dateFrom);
    if (dateTo) query = query.lte('gazette_date', dateTo);

    const lim = Math.min(Number(limit) || 50, 200);
    const off = Math.max(Number(offset) || 0, 0);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(off, off + lim - 1);

    if (error) throw error;
    res.json({ data, count, limit: lim, offset: off });
  } catch (err) {
    console.error(`[GET /api/events] ${err.message}`);
    res.status(500).json({ error: 'Gelismeler getirilirken bir hata olustu.' });
  }
});

// GET /api/meta - dashboard filtre secenekleri (sektorler, olay turleri, sicil muduerlukleri)
router.get('/meta', (req, res) => {
  res.json({
    sectors: [...Object.keys(SECTOR_KEYWORDS), DEFAULT_SECTOR],
    eventTypes: EVENT_PATTERNS.map((p) => ({ key: p.key, label: p.label })),
    sicilMudurlukleri: SICIL_MUDURLUKLERI,
  });
});

// GET /api/stats - dashboard KPI satiri icin ozet sayilar
router.get('/stats', async (req, res) => {
  try {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [companiesCount, eventsCount, weekCount] = await Promise.all([
      supabase.from('companies').select('id', { count: 'exact', head: true }),
      supabase.from('gazette_events').select('id', { count: 'exact', head: true }),
      supabase
        .from('gazette_events')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfWeek.toISOString()),
    ]);

    if (companiesCount.error) throw companiesCount.error;
    if (eventsCount.error) throw eventsCount.error;
    if (weekCount.error) throw weekCount.error;

    res.json({
      totalCompanies: companiesCount.count ?? 0,
      totalEvents: eventsCount.count ?? 0,
      eventsThisWeek: weekCount.count ?? 0,
    });
  } catch (err) {
    console.error(`[GET /api/stats] ${err.message}`);
    res.status(500).json({ error: 'Istatistikler getirilirken bir hata olustu.' });
  }
});

// POST /api/scan/search - Chrome eklentisinin gonderdigi TTSG oturum cerezini
// kullanarak aktif sirketlerden bir grubunu (offset/limit) arar ve daha once
// islenmemis (yeni) ilanlarin listesini doner. PDF INDIRMEZ - PDF'ler TTSG'nin
// girisli+captcha korumasi nedeniyle eklenti tarafindan ayrica indirilip
// /api/scan/process-pdf'e gonderilmelidir. Cerez sunucuda saklanmaz, sadece bu
// istek suresince kullanilir.
router.post('/scan/search', async (req, res) => {
  try {
    const { cookie, offset, limit } = req.body || {};

    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'cookie alani zorunludur (TTSG oturum cerezi).' });
    }

    const result = await searchBatch({
      cookie,
      offset: Number(offset) || 0,
      limit: Math.min(Number(limit) || 5, 20),
    });

    res.json(result);
  } catch (err) {
    console.error(`[POST /api/scan/search] ${err.message}`);
    res.status(500).json({ error: `Arama sirasinda hata olustu: ${err.message}` });
  }
});

// POST /api/scan/detect-company - bir unvanin TTSG'deki hangi sicil
// muduerluklerinde kayitli oldugunu (ve hic kayitli olup olmadigini) tespit
// eder. Sirket eklerken kullaniciyi ~140 sicil muduerluegue arasindan elle
// secim yapmaya zorlamak yerine dashboard/eklenti tarafindan cagirilir.
// Tek istekte TUM liste degil, offset/limit ile bir dilim taranir; cagiran
// taraf `done: true` donene kadar bir sonraki offset ile tekrar cagirmalidir.
router.post('/scan/detect-company', async (req, res) => {
  try {
    const { unvan, cookie, offset, limit } = req.body || {};

    if (!unvan || typeof unvan !== 'string') {
      return res.status(400).json({ error: 'unvan alani zorunludur.' });
    }
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'cookie alani zorunludur (TTSG oturum cerezi).' });
    }

    const result = await detectCompanyRegistries({
      unvan,
      cookie,
      offset: Number(offset) || 0,
      limit: Math.min(Number(limit) || 10, 20),
    });

    res.json(result);
  } catch (err) {
    console.error(`[POST /api/scan/detect-company] ${err.message}`);
    res.status(500).json({ error: `Sicil muduerluegue tespiti sirasinda hata olustu: ${err.message}` });
  }
});

// POST /api/scan/process-pdf - eklentinin kendi tarayici oturumundan indirip
// base64 olarak gonderdigi bir PDF'i metne cevirir, olay tespiti yapar ve
// kaydeder. PDF hicbir zaman diske yazilmaz, sadece bellekte islenir.
router.post('/scan/process-pdf', async (req, res) => {
  try {
    const {
      companyId,
      companyTitle,
      pdfGuid,
      pdfUrl,
      ilanSiraNo,
      gazetteNo,
      gazetteDate,
      ilanTuru,
      pdfBase64,
    } = req.body || {};

    if (!companyId || !companyTitle || !pdfGuid || !pdfUrl || !pdfBase64) {
      return res.status(400).json({
        error: 'companyId, companyTitle, pdfGuid, pdfUrl ve pdfBase64 alanlari zorunludur.',
      });
    }

    const result = await processPdfEntry({
      companyId,
      companyTitle,
      pdfGuid,
      pdfUrl,
      ilanSiraNo: ilanSiraNo ?? null,
      gazetteNo,
      gazetteDate,
      ilanTuru,
      pdfBuffer: Buffer.from(pdfBase64, 'base64'),
    });

    res.json({ data: result });
  } catch (err) {
    console.error(`[POST /api/scan/process-pdf] ${err.message}`);
    res.status(500).json({ error: `PDF islenirken hata olustu: ${err.message}` });
  }
});

// GET /api/events/missing-summary - AI ozeti henuz cikarilmamis ilanlarin
// listesini doner (eklentideki "Eksik Ozetleri Getir" butonu icin).
router.get('/events/missing-summary', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    // Hic denenmemis (last_summary_attempt_at IS NULL) kayitlar once, sonra
    // en eski denenenler gelir - boylece TTSG'nin oturum basina sinirli
    // captcha'siz kotasi hep ayni (tekrar tekrar basarisiz olan) kayda
    // harcanmaz, liste her denemede gercekten ilerler.
    const { data, error } = await supabase
      .from('gazette_events')
      .select('pdf_guid, pdf_url')
      .is('ai_summary', null)
      .order('last_summary_attempt_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err) {
    console.error(`[GET /api/events/missing-summary] ${err.message}`);
    res.status(500).json({ error: 'Ozeti eksik ilanlar getirilirken bir hata olustu.' });
  }
});

// POST /api/scan/enrich-by-guid - kullanicinin acikca tetikledigi bir eylemle
// (ör. eklentideki "Eksik Ozetleri Getir" butonu) eklentinin kendi tarayici
// oturumundan indirip gonderdigi PDF'i pdf_guid uzerinden mevcut kayda
// eslestirir, tam metin analizi + AI ozeti ile gunceller. companyId onceden
// bilinmesine gerek yoktur.
router.post('/scan/enrich-by-guid', async (req, res) => {
  try {
    const { pdfGuid, pdfBase64 } = req.body || {};

    if (!pdfGuid || !pdfBase64) {
      return res.status(400).json({ error: 'pdfGuid ve pdfBase64 alanlari zorunludur.' });
    }

    const result = await enrichEventByGuid({ pdfGuid, pdfBuffer: Buffer.from(pdfBase64, 'base64') });
    res.json({ data: result });
  } catch (err) {
    console.error(`[POST /api/scan/enrich-by-guid] ${err.message}`);
    res.status(500).json({ error: `PDF islenirken hata olustu: ${err.message}` });
  }
});

// POST /api/scan/enrich-by-guid-image - kullanicinin taraycida GERCEKTEN
// gordugu bir PDF'in ekran goruntusunden (screenshot) AI ozeti cikarir.
// TTSG'ye HICBIR agdan istegi gitmez - PDF tekrar indirilmez, sadece
// eklentinin chrome.tabs.captureVisibleTab() ile aldigi goruntu kullanilir.
router.post('/scan/enrich-by-guid-image', async (req, res) => {
  try {
    const { pdfGuid, imageBase64 } = req.body || {};

    if (!pdfGuid || !imageBase64) {
      return res.status(400).json({ error: 'pdfGuid ve imageBase64 alanlari zorunludur.' });
    }

    const result = await enrichEventByGuidFromImage({ pdfGuid, imageBase64 });
    res.json({ data: result });
  } catch (err) {
    console.error(`[POST /api/scan/enrich-by-guid-image] ${err.message}`);
    res.status(500).json({ error: `Ozet cikarilirken hata olustu: ${err.message}` });
  }
});

// POST /api/scan/enrich-by-guid-browser - eklentinin gonderdigi TTSG oturum
// cerezini kullanarak sunucu tarafinda GERCEK bir Chrome (puppeteer-core) ile
// PDF'e navigasyon yaptirir ve tam otomatik isler (ekran goruntusu YOK,
// kullanicinin PDF'i elle acmasina gerek YOK).
router.post('/scan/enrich-by-guid-browser', async (req, res) => {
  try {
    const { pdfGuid, cookie } = req.body || {};

    if (!pdfGuid || !cookie) {
      return res.status(400).json({ error: 'pdfGuid ve cookie alanlari zorunludur.' });
    }

    const result = await enrichEventByGuidViaBrowser({ pdfGuid, cookie });
    res.json({ data: result });
  } catch (err) {
    console.error(`[POST /api/scan/enrich-by-guid-browser] ${err.message}`);
    res.status(err.isCaptcha ? 409 : 500).json({
      error: `PDF islenirken hata olustu: ${err.message}`,
      captcha: !!err.isCaptcha,
    });
  }
});

module.exports = router;
