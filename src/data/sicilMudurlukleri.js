// TTSG (ticaretsicil.gov.tr) "İlan Görüntüleme" arama formundaki Sicil Müdürlüğü
// dropdown'ından alinmis id -> isim eslesmesi. Kaynak sayfa girisli oldugundan
// bu liste manuel olarak (giris yapilmis bir oturumda) cikartilmistir.
const SICIL_MUDURLUKLERI = [
  [232, 'İSTANBUL'], [18, 'ANKARA'], [233, 'İZMİR'], [1, 'ACIPAYAM'], [2, 'ADANA'],
  [3, 'ADIYAMAN'], [4, 'AFYONKARAHİSAR'], [5, 'AFŞİN'], [6, 'AKHİSAR'], [7, 'AKSARAY'],
  [8, 'AKYAZI'], [9, 'AKÇAKOCA'], [10, 'AKŞEHİR'], [11, 'ALACA'], [12, 'ALANYA'],
  [13, 'ALAPLI'], [14, 'ALAŞEHİR'], [15, 'ALİAĞA'], [16, 'AMASYA'], [17, 'ANAMUR'],
  [19, 'ANTALYA'], [20, 'ARDAHAN'], [21, 'ARDEŞEN'], [22, 'ARHAVİ'], [23, 'ARTVİN'],
  [24, 'AYDIN'], [25, 'AYVALIK'], [26, 'AĞRI'], [27, 'BABADAĞ'], [28, 'BABAESKİ'],
  [29, 'BAFRA'], [30, 'BALIKESİR'], [31, 'BANDIRMA'], [32, 'BARTIN'], [33, 'BATMAN'],
  [34, 'BAYBURT'], [35, 'BAYINDIR'], [36, 'BERGAMA'], [37, 'BEYPAZARI'], [38, 'BEYŞEHİR'],
  [39, 'BODRUM'], [40, 'BOLU'], [41, 'BOLVADİN'], [42, 'BOR'], [43, 'BORÇKA'],
  [44, 'BOYABAT'], [45, 'BOZÜYÜK'], [46, 'BOĞAZLIYAN'], [47, 'BUCAK'], [48, 'BULANCAK'],
  [49, 'BULDAN'], [50, 'BURDUR'], [51, 'BURHANİYE'], [52, 'BURSA'], [53, 'BÜNYAN'],
  [54, 'BİGA'], [55, 'BİLECİK'], [56, 'BİNGÖL'], [57, 'BİRECİK'], [58, 'BİTLİS'],
  [59, 'CEYHAN'], [60, 'CİZRE'], [61, 'DEMİRCİ'], [62, 'DENİZLİ'], [63, 'DEVELİ'],
  [64, 'DEVREK'], [65, 'DOĞANHİSAR'], [66, 'DOĞUBAYAZIT'], [67, 'DÖRTYOL'], [68, 'DÜZCE'],
  [69, 'DİDİM'], [70, 'DİNAR'], [71, 'DİYARBAKIR'], [72, 'EDREMİT'], [73, 'EDİRNE'],
  [74, 'ELAZIĞ'], [75, 'ELBİSTAN'], [76, 'EMİRDAĞ'], [77, 'ERBAA'], [78, 'ERCİŞ'],
  [79, 'ERDEK'], [80, 'ERDEMLİ'], [81, 'ERZURUM'], [82, 'ERZİN'], [83, 'ERZİNCAN'],
  [84, 'ESKİŞEHİR'], [85, 'FATSA'], [86, 'FETHİYE'], [87, 'GAZİANTEP'], [88, 'GEBZE'],
  [89, 'GEDİZ'], [90, 'GELİBOLU'], [91, 'GEMLİK'], [92, 'GEREDE'], [93, 'GÖNEN'],
  [94, 'GÖRDES'], [95, 'GÜMÜŞHACIKÖY'], [96, 'GÜMÜŞHANE'], [97, 'GİRESUN'], [98, 'HAKKARİ'],
  [99, 'HATAY'], [100, 'HAVZA'], [101, 'HAYMANA'], [102, 'HAYRABOLU'], [103, 'HOPA'],
  [104, 'ILGIN'], [105, 'ISPARTA'], [106, 'IĞDIR'], [107, 'KAHRAMANMARAŞ'], [108, 'KADİRLİ'],
  [109, 'KAMAN'], [110, 'KARABÜK'], [111, 'KARACABEY'], [113, 'KARAHALLI'], [114, 'KARAMAN'],
  [115, 'KARAPINAR'], [116, 'KARS'], [117, 'KASTAMONU'], [118, 'KAYSERİ'], [120, 'KELKİT'],
  [121, 'KEŞAN'], [122, 'KIRIKHAN'], [123, 'KIRIKKALE'], [124, 'KIRKLARELİ'], [125, 'KIRŞEHİR'],
  [126, 'KIZILTEPE'], [127, 'KOCAELİ'], [128, 'KONYA EREĞLİ'], [129, 'KONYA'], [130, 'KOZAN'],
  [131, 'KUMLUCA'], [132, 'KUŞADASI'], [133, 'KÖRFEZ'], [134, 'KÜTAHYA'], [135, 'KİLİS'],
  [136, 'LÜLEBURGAZ'], [137, 'MALATYA'], [138, 'MALKARA'], [139, 'MANAVGAT'], [140, 'MANİSA'],
  [141, 'MARDİN'], [142, 'MARMARİS'], [143, 'MENEMEN'], [144, 'MERSİN'], [145, 'MERZİFON'],
  [146, 'MUCUR'], [147, 'MUSTAFAKEMALPAŞA'], [148, 'MUT'], [149, 'MUĞLA'], [150, 'MUŞ'],
  [151, 'MİLAS'], [152, 'NAZİLLİ'], [153, 'NEVŞEHİR'], [154, 'NUSAYBİN'], [155, 'NİKSAR'],
  [156, 'NİZİP'], [157, 'NİĞDE'], [158, 'OLTU'], [159, 'ORDU'], [160, 'ORHANGAZİ'],
  [161, 'OSMANİYE'], [162, 'PASİNLER'], [163, 'PAZAR'], [164, 'POLATLI'], [165, 'REYHANLI'],
  [167, 'RİZE'], [168, 'SAFRANBOLU'], [169, 'SAKARYA'], [170, 'SALİHLİ'], [171, 'SAMSUN'],
  [172, 'SANDIKLI'], [173, 'SARAYKÖY'], [174, 'SELÇUK'], [175, 'SEYDİŞEHİR'], [176, 'SOMA'],
  [177, 'SULUOVA'], [178, 'SUNGURLU'], [179, 'SUSURLUK'], [180, 'SÖKE'], [181, 'SİLİFKE'],
  [182, 'SİMAV'], [183, 'SİNOP'], [184, 'SİVAS'], [185, 'SİVEREK'], [186, 'SİİRT'],
  [187, 'TARSUS'], [188, 'TATVAN'], [189, 'TAVAS'], [190, 'TAVŞANLI'], [191, 'TAŞKÖPRÜ'],
  [192, 'TEKİRDAĞ'], [193, 'TERME'], [194, 'TOKAT'], [195, 'TORBALI'], [196, 'TOSYA'],
  [197, 'TRABZON'], [198, 'TUNCELİ'], [199, 'TURGUTLU'], [200, 'TURHAL'], [201, 'TİRE'],
  [202, 'UZUNKÖPRÜ'], [203, 'UŞAK'], [204, 'VAN'], [205, 'VEZİRKÖPRÜ'], [206, 'YAHYALI'],
  [207, 'YALOVA'], [208, 'YALVAÇ'], [209, 'YENİŞEHİR'], [210, 'YERKÖY'], [211, 'YOZGAT'],
  [212, 'YÜKSEKOVA'], [213, 'ZONGULDAK'], [214, 'ZİLE'], [215, 'ÇANAKKALE'], [216, 'ÇANKIRI'],
  [217, 'ÇARŞAMBA'], [218, 'ÇAY'], [219, 'ÇAYCUMA'], [220, 'ÇAYELİ'], [221, 'ÇERKEZKÖY'],
  [222, 'ÇORLU'], [223, 'ÇORUM'], [224, 'ÇUMRA'], [225, 'ÖDEMİŞ'], [226, 'ÜNYE'],
  [227, 'ÜRGÜP'], [228, 'İNEBOLU'], [229, 'İNEGÖL'], [230, 'İSKENDERUN'], [231, 'İSLAHİYE'],
  [234, 'İZNİK'], [235, 'ŞANLIURFA'], [236, 'ŞEREFLİKOÇHİSAR'], [237, 'ŞIRNAK'], [241, 'SORGUN'],
  [242, 'OF'], [243, 'ŞEFAATLİ'], [246, 'KARADENİZ EREĞLİ'],
].map(([id, name]) => ({ id, name }));

const BY_ID = new Map(SICIL_MUDURLUKLERI.map((m) => [m.id, m.name]));
const BY_NAME = new Map(SICIL_MUDURLUKLERI.map((m) => [m.name.toLocaleUpperCase('tr-TR'), m.id]));

function sicilMudurluguAdi(id) {
  return BY_ID.get(Number(id)) || null;
}

function sicilMudurluguId(name) {
  if (!name) return null;
  return BY_NAME.get(String(name).toLocaleUpperCase('tr-TR')) || null;
}

module.exports = { SICIL_MUDURLUKLERI, sicilMudurluguAdi, sicilMudurluguId };
