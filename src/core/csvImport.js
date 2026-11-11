import { parseReais, ValidationError } from './money.js';
import { somenteDigitos, documentoValido } from './documento.js';
import { parseDataISO } from './dates.js';

/** Parser CSV (RFC 4180, separador ; ou ,). Retorna array de objetos pelo cabeçalho. */
export function parseCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/, 1)[0];
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...dados] = linhas.filter((l) => l.some((v) => v.trim()));
  if (!cab) return [];
  const chaves = cab.map((h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  return dados.map((l) => Object.fromEntries(chaves.map((k, i) => [k, (l[i] ?? '').trim()])));
}

function dataBR(s) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; }
  return s;
}

export const LIMITE_LINHAS_IMPORTACAO = 5000;

/**
 * Converte linhas da planilha em {devedor, divida} normalizados, com erros por linha.
 * Colunas: nome, tipo_pessoa, cpf_cnpj, telefone, whatsapp, email, endereco,
 *          origem, descricao, documento_referencia, valor_original, data_vencimento, encargos
 */
export function normalizarLinhasImportacao(linhas) {
  if (linhas.length > LIMITE_LINHAS_IMPORTACAO) throw new ValidationError(`Máximo de ${LIMITE_LINHAS_IMPORTACAO} linhas por importação`);
  return linhas.map((l, idx) => {
    const erros = [];
    const doc = somenteDigitos(l.cpf_cnpj);
    const tipo = (l.tipo_pessoa || (doc.length === 14 ? 'PJ' : 'PF')).toUpperCase();
    if (!l.nome) erros.push('nome obrigatório');
    if (!documentoValido(doc, tipo)) erros.push('cpf_cnpj inválido');
    let valor = null, encargos = 0, venc = null;
    try { valor = parseReais(l.valor_original); if (valor <= 0) erros.push('valor_original deve ser positivo'); } catch { erros.push('valor_original inválido'); }
    try { encargos = l.encargos ? parseReais(l.encargos) : 0; if (encargos < 0) erros.push('encargos negativos'); } catch { erros.push('encargos inválidos'); }
    try { venc = parseDataISO(dataBR(l.data_vencimento), 'data_vencimento'); } catch (e) { erros.push(e.message); }
    return {
      linha: idx + 2,
      erros,
      devedor: { nome: l.nome, tipo_pessoa: tipo, cpf_cnpj: doc, telefone: l.telefone || '', whatsapp: l.whatsapp || '', email: l.email || '', endereco: l.endereco || '' },
      divida: {
        origem: l.origem || 'IMPORTACAO', descricao: l.descricao || '', documento_referencia: l.documento_referencia || '',
        valor_original_centavos: valor, encargos_centavos: encargos, data_vencimento: venc,
      },
    };
  });
}
