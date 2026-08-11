(function () {
  const TTSG_DOMAIN = 'ticaretsicil.gov.tr';

  const loginStatus = document.getElementById('loginStatus');
  const backendUrlInput = document.getElementById('backendUrl');
  const scanBtn = document.getElementById('scanBtn');
  const summaryBtn = document.getElementById('summaryBtn');
  const progress = document.getElementById('progress');

  function setLoginStatus(cookies) {
    if (cookies && cookies.length > 0) {
      loginStatus.textContent = 'TTSG oturumu bulundu, tarama başlatılabilir.';
      loginStatus.className = 'status ok';
      scanBtn.disabled = false;
      summaryBtn.disabled = false;
    } else {
      loginStatus.textContent = 'TTSG oturumu bulunamadı. Önce www.ticaretsicil.gov.tr adresinde giriş yapın.';
      loginStatus.className = 'status warn';
      scanBtn.disabled = true;
      summaryBtn.disabled = true;
    }
  }

  async function refreshLoginStatus() {
    try {
      const cookies = await chrome.cookies.getAll({ domain: TTSG_DOMAIN });
      setLoginStatus(cookies);
    } catch (err) {
      loginStatus.textContent = `Çerez okunamadı: ${err.message}`;
      loginStatus.className = 'status warn';
    }
  }

  async function loadBackendUrl() {
    const stored = await chrome.storage.local.get('backendUrl');
    backendUrlInput.value = stored.backendUrl || 'http://localhost:3000';
  }

  backendUrlInput.addEventListener('change', () => {
    chrome.storage.local.set({ backendUrl: backendUrlInput.value.trim() });
  });

  function renderProgress(state) {
    if (!state) {
      progress.textContent = '';
      return;
    }
    const lines = state.lines || [];
    progress.textContent = [state.text || '', ...lines].join('\n').trim();
    const running = state.status === 'running';
    scanBtn.disabled = running;
    summaryBtn.disabled = running;
  }

  scanBtn.addEventListener('click', async () => {
    const backendUrl = backendUrlInput.value.trim().replace(/\/$/, '');
    scanBtn.disabled = true;
    progress.textContent = 'Başlatılıyor…';
    // Arka planda calisir; popup kapansa bile devam eder.
    chrome.runtime.sendMessage({ type: 'START_SCAN', backendUrl });
  });

  summaryBtn.addEventListener('click', async () => {
    const backendUrl = backendUrlInput.value.trim().replace(/\/$/, '');
    summaryBtn.disabled = true;
    progress.textContent = 'Başlatılıyor…';
    chrome.runtime.sendMessage({ type: 'FETCH_MISSING_SUMMARIES', backendUrl });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.scanState) {
      renderProgress(changes.scanState.newValue);
    }
  });

  (async function init() {
    await loadBackendUrl();
    await refreshLoginStatus();
    const stored = await chrome.storage.local.get('scanState');
    renderProgress(stored.scanState);
  })();
})();
