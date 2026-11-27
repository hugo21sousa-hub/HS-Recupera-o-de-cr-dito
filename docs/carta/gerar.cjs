const { chromium } = require('playwright');
(async () => {
  const d = process.argv[2]; const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + d + '/carta.html', { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.pdf({ path: d + '/Carta-de-Apresentacao-Acorly.pdf', format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await b.close();
})();
