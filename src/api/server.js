const path = require('path');
const express = require('express');
const cors = require('cors');
const companiesRoutes = require('./routes/companies.routes');

function createServer() {
  const app = express();

  // Chrome eklentisi (chrome-extension:// origin'i) ve dashboard'dan gelen
  // isteklere izin vermek icin CORS aciktir; herkese acik olsa da API
  // uzerinde kimlik/veri kaybettiren bir islem yoktur (tarama icin gereken
  // TTSG oturum cerezi zaten sadece istemcide tutulur).
  app.use(cors());
  // PDF'ler eklentiden base64 olarak JSON govdesinde geldigi icin limit
  // yukseltilmistir (base64 kodlama boyutu ~%33 artirir).
  app.use(express.json({ limit: '15mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api', companiesRoutes);

  // Filtrelenebilir gelismeler dashboard'u (public/index.html) - build adimi gerektirmez
  app.use(express.static(path.join(__dirname, '../../public')));

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Uc nokta bulunamadi.' });
  });

  // Merkezi hata yakalayici (beklenmedik hatalar icin son güvenlik agi)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`[server] Beklenmeyen hata: ${err.message}`);
    res.status(500).json({ error: 'Sunucu hatasi olustu.' });
  });

  return app;
}

module.exports = { createServer };
