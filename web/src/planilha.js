// Leitura de planilhas no navegador: CSV (; ou ,) e Excel .xlsx (primeira aba), sem bibliotecas externas.
import { parseCSV } from '../../src/core/csvImport.js';

const chave = (h) => String(h ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');

async function inflar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lê os arquivos de dentro de um .xlsx (zip). */
async function lerZip(buf) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let fim = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo Excel inválido. Salve como .xlsx ou CSV e tente de novo.');
  const qtd = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const arquivos = {};
  for (let k = 0; k < qtd; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
    const n = v.getUint16(p + 28, true), e = v.getUint16(p + 30, true), c = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = dec.decode(u8.subarray(p + 46, p + 46 + n));
    arquivos[nome] = { metodo, tam, local };
    p += 46 + n + e + c;
  }
  return async (nome) => {
    const a = arquivos[nome];
    if (!a) return null;
    const ini = a.local + 30 + v.getUint16(a.local + 26, true) + v.getUint16(a.local + 28, true);
    const dados = u8.subarray(ini, ini + a.tam);
    return dec.decode(a.metodo === 0 ? dados : await inflar(dados));
  };
}

const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

async function lerXlsx(buf) {
  const ler = await lerZip(buf);
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const textos = [];
  const ss = await ler('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) textos.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  // primeira aba, pela ordem do workbook
  let caminho = 'xl/worksheets/sheet1.xml';
  const wb = await ler('xl/workbook.xml'), rels = await ler('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const primeira = xml(wb).getElementsByTagName('sheet')[0];
    const rid = primeira?.getAttribute('r:id') || primeira?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const alvo = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
  }
  const folha = await ler(caminho);
  if (!folha) throw new Error('Não encontrei a primeira aba da planilha.');
  const linhas = [];
  for (const row of xml(folha).getElementsByTagName('row')) {
    const linha = [];
    for (const c of row.getElementsByTagName('c')) {
      const tipo = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0];
      let val = '';
      if (tipo === 's') val = textos[Number(vEl?.textContent)] ?? '';
      else if (tipo === 'inlineStr') val = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
      else val = vEl?.textContent ?? '';
      linha[colIndex(c.getAttribute('r'))] = val;
    }
    linhas.push(Array.from(linha, (x) => String(x ?? '').trim()));
  }
  const dados = linhas.filter((l) => l.some(Boolean));
  if (!dados.length) return [];
  const [cab, ...resto] = dados;
  const chaves = cab.map(chave);
  return resto.map((l) => Object.fromEntries(chaves.map((k, i) => [k, l[i] ?? ''])));
}

async function lerCsv(file) {
  const buf = await file.arrayBuffer();
  let texto = new TextDecoder('utf-8').decode(buf);
  if (/\uFFFD/.test(texto)) texto = new TextDecoder('windows-1252').decode(buf); // Excel brasileiro salva CSV em ANSI
  return parseCSV(texto).map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [chave(k), v])));
}

/** Lê a planilha e devolve linhas como objetos (cabeçalhos normalizados: minúsculas, sem acento, "_" no lugar de espaço). */
export async function lerPlanilha(file) {
  if (/\.xls$/i.test(file.name)) throw new Error('Formato .xls antigo: salve como .xlsx ou CSV e envie de novo.');
  if (/\.xlsx$/i.test(file.name)) return lerXlsx(await file.arrayBuffer());
  return lerCsv(file);
}

const ALIASES = {
  email: ['email', 'e_mail', 'e_mail_do_contato', 'email_do_contato', 'correio_eletronico', 'mail'],
  empresa: ['empresa', 'razao_social', 'nome_fantasia', 'nome_da_empresa', 'companhia', 'escola', 'clinica', 'estabelecimento'],
  nome: ['nome', 'contato', 'nome_do_contato', 'responsavel', 'pessoa'],
  segmento: ['segmento', 'ramo', 'setor', 'categoria', 'atividade'],
  whatsapp: ['whatsapp', 'celular', 'telefone', 'fone', 'tel'],
};

/** Encontra as colunas pelo nome do cabeçalho e devolve contatos {email, empresa, nome, segmento, whatsapp, linha}. */
export function contatosDaPlanilha(linhas) {
  if (!linhas.length) return { contatos: [], colunas: {} };
  const cab = Object.keys(linhas[0]);
  const colunas = {};
  for (const [campo, nomes] of Object.entries(ALIASES)) colunas[campo] = nomes.find((n) => cab.includes(n)) || cab.find((h) => nomes.some((n) => h.startsWith(n))) || null;
  if (!colunas.email) colunas.email = cab.find((h) => linhas.slice(0, 20).some((l) => /@/.test(l[h] || ''))) || null;
  const contatos = linhas.map((l, i) => ({
    linha: i + 2, email: colunas.email ? l[colunas.email] : '', empresa: colunas.empresa ? l[colunas.empresa] : '',
    nome: colunas.nome ? l[colunas.nome] : '', segmento: colunas.segmento ? l[colunas.segmento] : '', whatsapp: colunas.whatsapp ? l[colunas.whatsapp] : '',
  })).filter((c) => Object.values(c).some((v, k) => k > 0 && String(v || '').trim()));
  return { contatos, colunas };
}

export const MODELO_PLANILHA_CAMPANHA = 'email;empresa;nome;segmento;whatsapp\ncontato@colegioexemplo.com.br;Colégio Exemplo;Maria Souza;Escola;71999990000\nfinanceiro@clinicaexemplo.com.br;Clínica Exemplo;;Saúde;\n';
