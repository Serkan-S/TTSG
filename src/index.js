require('dotenv').config();
const { createServer } = require('./api/server');

const PORT = process.env.PORT || 3000;

function main() {
  const app = createServer();

  app.listen(PORT, () => {
    console.log(`[index] API sunucusu http://localhost:${PORT} adresinde calisiyor.`);
  });
}

main();
