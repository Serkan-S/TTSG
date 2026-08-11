-- Migration 006: Bir sirketin ilanlari birden fazla Sicil Muduerluegue'nde
-- yayinlanabildigi icin, tek bir sicil_mudurlugu_id/adi yerine bir liste
-- (jsonb) tutuluyor. Mevcut kayitlar otomatik olarak listeye tasinir.
alter table companies add column if not exists sicil_mudurlukleri jsonb not null default '[]'::jsonb;

update companies
set sicil_mudurlukleri = jsonb_build_array(jsonb_build_object('id', sicil_mudurlugu_id, 'name', sicil_mudurlugu_adi))
where sicil_mudurlukleri = '[]'::jsonb and sicil_mudurlugu_id is not null;

alter table companies drop column if exists sicil_mudurlugu_id;
alter table companies drop column if exists sicil_mudurlugu_adi;
