-- TTSG Sektorel Istihbarat Platformu - Supabase (PostgreSQL) Semasi
-- Not: Auth katmani yoktur (MVP). RLS bilincli olarak devre disi birakilmistir;
-- servis rolu (service_role) anahtari sadece backend tarafinda kullanilmalidir.

create extension if not exists "pgcrypto";

-- Takip edilen sirketler / hedefler
create table if not exists companies (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,                 -- Ticaret unvani (orn: "ABC Yazilim ve Teknoloji A.S.")
  tax_number           text unique,                    -- Vergi No / Mersis No (opsiyonel)
  sector               text,                            -- detectSector() tarafindan doldurulur
  sicil_mudurlukleri   jsonb not null default '[]'::jsonb, -- [{id, name}, ...] - bir sirketin ilanlari birden
                                                       -- fazla Sicil Muduerluegue'nde yayinlanabildigi icin liste
  is_active            boolean not null default true,   -- pasife alinan hedefler taranmaz
  last_checked_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_companies_active on companies (is_active);
create index if not exists idx_companies_sector on companies (sector);

-- Her gazete ilanindan cikarilan yapilandirilmis olaylar
create table if not exists gazette_events (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies (id) on delete cascade,
  pdf_guid           text not null,                  -- PDF linkindeki Guid (kalici tekillestirme anahtari;
                                                       -- TTSG'nin "ilan sira no" degeri her aramada degisebildigi
                                                       -- icin ONA GUVENILMEZ)
  ilan_sira_no       bigint,                          -- referans amacli, TTSG arama anindaki gecici sira no
  pdf_url            text not null,                 -- kaynak PDF (diske kaydedilmez, referans olarak tutulur)
  gazette_no         text,
  gazette_date       date,
  ilan_turu          text,                            -- TTSG'nin ilan turu metni (orn: "GENEL KURUL TOPLANTIYA CAGIRI")
  sermaye_artirimi   boolean not null default false,
  adres_degisikligi  boolean not null default false,
  genel_kurul        boolean not null default false,
  unvan_degisikligi  boolean not null default false,
  ortak_degisikligi  boolean not null default false,
  tasfiye            boolean not null default false,
  matched_keywords   jsonb not null default '[]',   -- extractEvents() ham eslesme detaylari
  raw_text_excerpt   text,                            -- kisa alinti (denetim/gozden gecirme icin)
  ai_summary         text,                            -- Claude Haiku 4.5 ile uretilen kisa Turkce ozet
  created_at         timestamptz not null default now(),

  unique (company_id, pdf_guid)
);

create index if not exists idx_events_company on gazette_events (company_id);
create index if not exists idx_events_date on gazette_events (gazette_date);

-- Ornek satir
-- insert into companies (title, tax_number, sicil_mudurlugu_id, sicil_mudurlugu_adi)
-- values ('ASELSAN ELEKTRONİK SANAYİ VE TİCARET ANONİM ŞİRKETİ', null, 18, 'ANKARA');
