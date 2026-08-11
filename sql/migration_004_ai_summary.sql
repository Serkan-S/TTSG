-- Migration 004: AI ozet metni icin kolon ekler.
alter table gazette_events add column if not exists ai_summary text;
