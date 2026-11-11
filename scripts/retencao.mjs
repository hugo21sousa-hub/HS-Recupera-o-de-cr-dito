// Executa a rotina de retenção manualmente (o servidor já roda automaticamente a cada 24 h).
import { join } from 'node:path';
import { abrirBanco } from '../src/server/db.js';
import { executarRetencao } from '../src/app/retencao.js';
import { criarArquivos } from '../src/server/files.js';

const dataDir = process.env.DATA_DIR || './data';
const { db, exclusivo, fechar } = abrirBanco(join(dataDir, 'hs.sqlite'));
const files = criarArquivos({ db, dir: join(dataDir, 'arquivos'), segredo: 'n/a' });
const r = await exclusivo(() => executarRetencao({ db, files, now: () => new Date(), user: { id: 'sistema', email: 'sistema', perfil: 'SISTEMA' }, authEmail: 'sistema' }));
console.log(r);
fechar();
