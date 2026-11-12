import { criarApp } from './app.js';

const porta = Number(process.env.PORT) || 3000;
const producao = process.env.NODE_ENV === 'production';
const { server, agendarRetencao, primeiroAcesso } = criarApp({
  dataDir: process.env.DATA_DIR || './data',
  urlBase: process.env.URL_BASE || process.env.RENDER_EXTERNAL_URL || `http://localhost:${porta}`,
  producao,
  webDir: process.env.WEB_DIR || './web/dist',
  confiarProxy: process.env.TRUST_PROXY === 'true',
});
const host = process.env.HOST || '0.0.0.0';
server.listen(porta, host, () => console.log(`HS Recuperação de Crédito rodando em http://${host}:${porta}`));
agendarRetencao();
primeiroAcesso().catch((e) => console.error('[primeiro acesso] aguardando o banco:', e.code || e.message));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
