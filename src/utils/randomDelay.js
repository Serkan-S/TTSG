// Anti-ban: hedef sunucuya ardisik istekler arasinda rastgele bekleme suresi (ms) uretir.
function randomDelayMs(minMs, maxMs) {
  if (minMs > maxMs) throw new Error('[randomDelayMs] minMs, maxMs degerinden buyuk olamaz.');
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

module.exports = { randomDelayMs };
