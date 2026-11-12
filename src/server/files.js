// Arquivos privados em disco. O cliente recebe apenas um file_uri opaco; o download usa link assinado e temporário.
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { armazenamentoDisco } from './armazenamento.js';

export const TIPOS_PERMITIDOS = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/csv': 'csv', 'text/plain': 'txt' };
export const TAMANHO_MAX = 10 * 1024 * 1024;

// Confere a assinatura do arquivo (não confia só no Content-Type enviado)
function conferirConteudo(buf, mime) {
  const h = buf.subarray(0, 12);
  if (mime === 'application/pdf') return h.toString('latin1', 0, 5) === '%PDF-';
  if (mime === 'image/png') return h[0] === 0x89 && h.toString('latin1', 1, 4) === 'PNG';
  if (mime === 'image/jpeg') return h[0] === 0xff && h[1] === 0xd8;
  if (mime === 'image/webp') return h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP';
  return !buf.includes(0); // texto
}

export function criarArquivos({ db, dir, segredo, agora = () => new Date(), armazenamento }) {
  const arm = armazenamento || armazenamentoDisco(dir);
  const assinar = (uri, exp) => createHmac('sha256', segredo).update(`${uri}.${exp}`).digest('base64url');

  return {
    async salvar({ buffer, mime, nome, email }) {
      if (!TIPOS_PERMITIDOS[mime]) return { erro: 'Tipo de arquivo não permitido (use PDF, PNG, JPG, WEBP, CSV ou TXT)' };
      if (!buffer.length || buffer.length > TAMANHO_MAX) return { erro: 'Arquivo vazio ou maior que 10 MB' };
      if (!conferirConteudo(buffer, mime)) return { erro: 'Conteúdo do arquivo não corresponde ao tipo informado' };
      const file_uri = `arq_${randomBytes(20).toString('hex')}`;
      await arm.put(file_uri, buffer, mime);
      await db.Arquivo.create({ file_uri, mime, nome: String(nome || 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 150), tamanho: buffer.length, enviado_por: email, enviado_em: agora().toISOString(), vinculado: false });
      return { file_uri };
    },

    /** Só quem enviou o arquivo pode vinculá-lo a um registro, e uma única vez. */
    async reivindicar(file_uri, email) {
      const a = (await db.Arquivo.filter({ file_uri: String(file_uri || '') }))[0];
      if (!a || a.enviado_por !== email || a.vinculado) return false;
      await db.Arquivo.update(a.id, { vinculado: true });
      return true;
    },

    async remover(file_uri) {
      if (!/^arq_[0-9a-f]{40}$/.test(String(file_uri))) return;
      await arm.del(file_uri);
      const meta = (await db.Arquivo.filter({ file_uri }))[0];
      if (meta) await db.Arquivo.delete(meta.id);
    },

    async signedUrl(file_uri, segundos = 300) {
      const exp = Math.floor(agora().getTime() / 1000) + segundos;
      return `/arquivos/${file_uri}?exp=${exp}&sig=${assinar(file_uri, exp)}`;
    },

    async ler(file_uri, exp, sig) {
      if (!/^arq_[0-9a-f]{40}$/.test(file_uri)) return null;
      if (!exp || Number(exp) < agora().getTime() / 1000) return null;
      const esperado = Buffer.from(assinar(file_uri, exp));
      const recebido = Buffer.from(String(sig || ''));
      if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
      const buffer = await arm.get(file_uri);
      if (!buffer) return null;
      const meta = (await db.Arquivo.filter({ file_uri }))[0];
      return { buffer, mime: meta?.mime || 'application/octet-stream', nome: meta?.nome || file_uri };
    },
  };
}
