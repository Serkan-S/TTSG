// Dashboard (public/index.html) sayfasi ile eklenti arka plani (background.js)
// arasinda koeprue. Dashboard duz bir web sayfasi oldugu icin TTSG oturum
// cerezine (ve chrome.* API'lerine) hicbir zaman dogrudan erisemez; bu dosya
// sayfadan gelen istekleri window.postMessage -> chrome.runtime.sendMessage
// olarak eklentiye, eklentiden gelen ilerleme/sonuc mesajlarini da
// chrome.runtime.onMessage -> window.postMessage olarak sayfaya tasir.
//
// Guvenlik: her iki yonde de mesaj "source" etiketiyle isaretlenir (kendi
// yankimizi tekrar islememek icin) ve sayfadan gelen mesajlarin gercekten bu
// pencereden (event.source === window) geldigi dogrulanir.
(function () {
  const PAGE_SOURCE = 'ttsg-dashboard';
  const EXT_SOURCE = 'ttsg-extension';

  function postToPage(payload) {
    window.postMessage({ source: EXT_SOURCE, ...payload }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== PAGE_SOURCE) return;

    if (msg.type === 'PING') {
      postToPage({ type: 'READY', requestId: msg.requestId });
      return;
    }

    chrome.runtime.sendMessage(
      { type: msg.type, title: msg.title, backendUrl: msg.backendUrl, requestId: msg.requestId },
      () => {
        // Yanit gerekmiyor: ilerleme/sonuc, background.js tarafindan ayrica
        // chrome.tabs.sendMessage ile bu taba (asagidaki listener'a) gelecek.
        // chrome.runtime.lastError'i sessizce yut (background hemen yanit
        // vermese de kanal acik kalmis olabilir).
        void chrome.runtime.lastError;
      }
    );
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || (msg.type !== 'DETECT_PROGRESS' && msg.type !== 'DETECT_RESULT')) return;
    postToPage(msg);
  });

  // Sayfa henuz "PING" gondermeden once yuklenmis olabilecegi ihtimaline
  // karsi bir kerelik proaktif duyuru (dashboard'un PING/READY el sikismasina
  // ek bir guvence, zarasiz).
  postToPage({ type: 'READY' });
})();
