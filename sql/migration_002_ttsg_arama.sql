-- Migration 002: statik gazette_search_url yerine "unvan + sicil muduerluegue" ile
-- arama yapan mimariye gecis. sql/schema.sql'i ilk kez calistiranlar bu dosyayi
-- calistirmaya GEREK DUYMAZ; sadece eski semayi zaten kurmus olanlar icindir.
-- Supabase SQL Editor'de calistirin.

alter table companies
  add column if not exists sicil_mudurlugu_id integer,
  add column if not exists sicil_mudurlugu_adi text;

alter table companies drop column if exists gazette_search_url;

-- Yeni kayitlar icin zorunlu hale getir (mevcut satirlar varsa once elle doldurulmali).
alter table companies alter column sicil_mudurlugu_id set not null;
alter table companies alter column sicil_mudurlugu_adi set not null;

alter table gazette_events
  add column if not exists ilan_sira_no bigint,
  add column if not exists ilan_turu text;

alter table gazette_events drop constraint if exists gazette_events_company_id_pdf_url_key;
alter table gazette_events alter column ilan_sira_no set not null;
alter table gazette_events add constraint gazette_events_company_id_ilan_sira_no_key unique (company_id, ilan_sira_no);
