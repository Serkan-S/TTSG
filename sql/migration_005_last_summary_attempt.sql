-- Migration 005: "Eksik Ozetleri Getir" akisinin, TTSG'nin oturum basina
-- sinirli captcha'siz kotasini heba etmeden ilerleyebilmesi icin, her ozet
-- deneme zamanini kaydeden bir kolon ekler. Boylece liste artik hep ayni
-- sirada (en yeni ilk) gelmek yerine, hic denenmemis/en eski denenmis
-- ilanlari one alabilir.
alter table gazette_events add column if not exists last_summary_attempt_at timestamptz;
