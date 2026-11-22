const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.argv[2], { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, displayHeaderFooter: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8px;color:#6b7280;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial"><span>Manual do Cliente Acorly · acorly.com.br</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
  await b.close();
})();
