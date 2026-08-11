-- Migration 003: TTSG'nin "ilan sira no" (SepeteEkle parametresi) her arama
-- sorgusunda YENIDEN URETILEN gecici bir deger oldugu (kalici bir ilan kimligi
-- OLMADIGI) tespit edildi. Tekillestirme icin bunun yerine PDF linkindeki Guid
-- kullanilir (ayni ilan icin her zaman ayni Guid donuyor).

alter table gazette_events add column if not exists pdf_guid text;

-- Henuz veri yoksa (ilk kurulumlarda) dogrudan not null yapilabilir; veri varsa
-- once elle pdf_url icinden Guid cikarilip doldurulmalidir.
update gazette_events set pdf_guid = substring(pdf_url from 'Guid=([\w-]+)') where pdf_guid is null;
alter table gazette_events alter column pdf_guid set not null;

alter table gazette_events drop constraint if exists gazette_events_company_id_ilan_sira_no_key;
alter table gazette_events add constraint gazette_events_company_id_pdf_guid_key unique (company_id, pdf_guid);

alter table gazette_events alter column ilan_sira_no drop not null;
