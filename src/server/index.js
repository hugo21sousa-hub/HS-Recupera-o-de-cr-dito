import { criarApp } from './app.js';

const porta = Number(process.env.PORT) || 3000;
const producao = process.env.NODE_ENV === 'production';
const { server } = criarApp({
  dataDir: process.env.DATA_DIR || './data',
  urlBase: process.env.URL_BASE || `http://localhost:${porta}`,
  producao,
  webDir: process.env.WEB_DIR || './web/dist',
});
server.listen(porta, () => console.log(`HS Recuperação de Crédito rodando em http://localhost:${porta}`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
