// Grava o vídeo de apresentação do site a partir da demonstração (Playwright).
// Uso: npm run build:demo && node scripts-video-tour.cjs <pasta-de-saida>
// Trilha: python3 scripts-video-trilha.py trilha.wav <duração em segundos>
// Montagem (logo no canto entre 5s e o fim-6s, trilha):
//   ffmpeg -i <saida>/video/*.webm -i scripts-video-marca.png -i trilha.wav -filter_complex "[0:v]fps=30[v];[v][1:v]overlay=x=W-w-22:y=H-h-22:enable='between(t,5,FIM)',format=yuv420p[vo];[2:a]volume=0.85[ao]" -map "[vo]" -map "[ao]" -c:v libx264 -crf 26 -c:a aac -b:a 128k -movflags +faststart -shortest public/video/acorly-demo.mp4
const { chromium } = require('playwright');
const LOGO = 'data:image/png;base64,' + require('fs').readFileSync(require('path').resolve(__dirname, 'src/assets/acorly-logo-branco.png')).toString('base64');
const SP = process.argv[2] || '.';
const URL = process.argv[3] || 'file://' + require('path').resolve(__dirname, 'dist-demo/hs-demo.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: SP + '/video', size: { width: 1280, height: 720 } } });
  await ctx.addInitScript((logo) => {
    const css = `#leg{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99999;background:rgba(11,37,69,.94);color:#fff;font:600 21px/1.35 Inter,Arial,sans-serif;padding:14px 22px;border-radius:12px;max-width:82%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.3);transition:opacity .3s}
#capa{position:fixed;inset:0;z-index:100000;background:linear-gradient(135deg,#001452,#0043ff);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,Arial,sans-serif;text-align:center;padding:40px}
#capa h1{font-size:54px;margin:0 0 12px;letter-spacing:-1px}#capa p{font-size:26px;margin:6px 0;opacity:.92}
.realce{outline:4px solid #ff8c00 !important;outline-offset:3px;border-radius:8px;transition:outline .2s}`;
    window.__leg = (t) => { let d = document.getElementById('leg'); if (!t) { d && d.remove(); return; } if (!d) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); d = document.createElement('div'); d.id = 'leg'; document.body.appendChild(d); } d.textContent = t; };
    window.__capa = (h, linhas) => { let c = document.getElementById('capa'); if (h === null) { c && c.remove(); return; } if (!document.getElementById('legcss')) { const st = document.createElement('style'); st.id = 'legcss'; st.textContent = css; document.head.appendChild(st); } if (!c) { c = document.createElement('div'); c.id = 'capa'; document.body.appendChild(c); } c.innerHTML = '<img src="' + logo + '" style="height:120px;margin-bottom:28px">' + (h ? '<h1>' + h + '</h1>' : '') + linhas.map((l) => '<p>' + l + '</p>').join(''); };
  }, LOGO);
  const p = await ctx.newPage();
  const t0 = Date.now();
  const marcas = [];
  const espera = (ms) => p.waitForTimeout(ms);
  const leg = (t) => { marcas.push({ t: (Date.now() - t0) / 1000, tipo: 'legenda', texto: t }); return p.evaluate((x) => window.__leg(x), t); };
  const capa = (h, l = []) => { marcas.push({ t: (Date.now() - t0) / 1000, tipo: 'capa', texto: h }); return p.evaluate(([a, b]) => window.__capa(a, b), [h, l]); };
  const clicar = async (sel) => { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.evaluate((e) => e.classList.add('realce')); await espera(900); await el.evaluate((e) => e.classList.remove('realce')); await el.click(); };
  const rolar = async (y) => { await p.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y); await espera(1200); };

  await p.goto(URL); await espera(1500);
  await capa('', ['Recuperação de crédito para empresas', 'HS Recuperação de Crédito']); await espera(3500);
  await capa(null);
  await leg('O Acorly organiza toda a cobrança da sua empresa em um só lugar.'); await espera(4000);

  await leg('Na demonstração, você escolhe um perfil. Vamos entrar como a empresa credora.');
  await clicar('a:has-text("Entrar")'); await espera(2500);
  await clicar('button:has-text("Empresa: administrador")'); await espera(1200);
  await leg('Painel com números reais: só conta como recuperado o que você confirmou.'); await espera(4000);
  await rolar(420); await espera(2500); await rolar(0);

  await leg('Cadastre devedores e dívidas, uma a uma ou importando uma planilha.');
  await clicar('a:has-text("Dívidas")'); await espera(4500);

  await leg('Quer que a equipe Acorly cobre por você? Encaminhe as dívidas com os seus limites de negociação.');
  await clicar('a:has-text("Cobranças Acorly")'); await espera(5000);

  await leg('Quando o devedor aceita um acordo, você recebe um aviso para enviar o boleto ou o Pix.');
  await clicar('a:has-text("Dashboard")'); await espera(3500);
  if (await p.locator('a:has-text("Informar")').count()) {
    await clicar('a:has-text("Informar")'); await espera(1200);
    await leg('Informe o boleto (PDF ou linha digitável) ou o Pix de cada parcela. O dinheiro cai direto na sua conta.');
    await clicar('button[role=tab]:has-text("Acordos")'); await espera(800);
    await rolar(760); await espera(2500);
    await clicar('button:has-text("Informar boleto/Pix")'); await espera(4000);
    await p.keyboard.press('Escape'); await espera(600);
  }

  await leg('Todo mês, a prestação de contas chega por e-mail: recuperado, acordos e valores a receber.');
  await clicar('a:has-text("Relatórios")'); await espera(5000);

  await leg('Agora, o lado da equipe Acorly, que faz a cobrança gerenciada.');
  await clicar('button:has-text("Sair")'); await espera(1200);
  const ent = p.locator('a:has-text("Entrar")').first(); if (await ent.count()) { await ent.click(); await espera(1200); }
  await clicar('button:has-text("Acorly: operadora")'); await espera(1000);
  await leg('A fila do dia mostra quem contatar: retornos, parcelas vencendo e primeiros contatos.');
  await clicar('a:has-text("Central de mensagens")'); await espera(4500);
  await leg('Mensagens respeitosas, com os dados preenchidos. Um clique abre o WhatsApp e tudo fica registrado.');
  await clicar('button:has-text("WhatsApp")'); await espera(1000);
  await p.selectOption('.modal select', { label: 'Primeiro contato' }); await espera(5500);
  await p.keyboard.press('Escape'); await espera(600);
  await leg(null);

  await capa('Teste grátis por 7 dias', ['Sem cartão · o devedor paga direto para a sua empresa', 'acorly.com.br']); await espera(5000);
  await ctx.close(); await b.close();
  require('fs').writeFileSync(require('path').join(SP, 'marcas.json'), JSON.stringify(marcas, null, 1));
})();
