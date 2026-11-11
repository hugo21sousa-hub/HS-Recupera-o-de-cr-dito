// Formatação e conversões. Dinheiro sempre em centavos inteiros.
export const brl = (c) => (c == null || Number.isNaN(c) ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const pct = (bps) => (bps == null ? '—' : `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

export function reaisParaCentavos(texto) {
  if (texto === '' || texto == null) return null;
  let s = String(texto).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [i, d = ''] = s.split('.');
  return Number(i) * 100 + Number(d.padEnd(2, '0'));
}
export const centavosParaTexto = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
export function pctParaBps(texto) {
  if (texto === '' || texto == null) return null;
  const n = Number(String(texto).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function data(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function dataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
export const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function mascaraDoc(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '—';
}
export function mascaraFone(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '—';
}

export function cpfValido(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}
export function cnpjValido(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = p.reduce((a, x, i) => a + +c[i] * x, 0) % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +c[12] && calc(13) === +c[13];
}

// Rótulos e tons dos status (verde = pago/recuperado, laranja = atenção, vermelho = crítico, azul = neutro)
const TONS = {
  ok: ['CONFIRMADO', 'QUITADA', 'RECUPERADO_INTEGRALMENTE', 'ATIVA', 'ATIVO', 'CUMPRIDO', 'PAGA', 'APROVADA_ALCADA', 'APROVADA_CREDOR', 'APROVADA', 'VALIDADA', 'CONCLUIDA', 'CONVERTIDA_EM_ACORDO'],
  alerta: ['INFORMADO', 'EM_CONFIRMACAO', 'AGUARDANDO_VALIDACAO', 'AGUARDANDO_AUTORIZACAO', 'AGUARDANDO_OPERADOR', 'PRONTO_PARA_COBRANCA', 'AGUARDANDO_APROVACAO_CREDOR', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'PARCIALMENTE_PAGA', 'EM_VALIDACAO', 'PENDENTE', 'PROPOSTO', 'SOLICITADO', 'CADASTRO_INCOMPLETO', 'AGUARDANDO_VALIDACAO', 'ABERTA', 'EM_ANALISE', 'EM_ACORDO', 'PRIMEIRO_CONTATO_PENDENTE'],
  critico: ['REJEITADO', 'REJEITADA', 'SUSPENSO', 'SUSPENSA', 'SEM_SUCESSO', 'CANCELADA', 'CANCELADO', 'ROMPIDO', 'CONTESTACAO', 'CONTESTADA', 'REVOGADA', 'REPROVADA', 'BLOQUEADO', 'INATIVO', 'ENCERRADO', 'NEGADA_FUNDAMENTADA'],
};
export function tom(status) {
  for (const [t, lista] of Object.entries(TONS)) if (lista.includes(status)) return t;
  return 'info';
}
const ROTULOS = {
  AUTOCONTRATADA: 'Própria', HS_GERENCIADA: 'HS gerenciada', EM_ABERTO: 'Em aberto', DEVEDOR_RESPONDEU: 'Devedor respondeu',
  RECUPERADO_INTEGRALMENTE: 'Recuperado', APROVADA_ALCADA: 'Aprovada (alçada)', APROVADA_CREDOR: 'Aprovada pelo credor',
  AGUARDANDO_APROVACAO_CREDOR: 'Aguardando credor', ACORDO_AGUARDANDO_PAGAMENTO: 'Acordo aguardando pagamento',
  SUPERADMIN_HS: 'Superadmin HS', GESTOR_OPERACOES_HS: 'Gestor de operações', OPERADOR_HS: 'Operador HS',
  ADMIN_EMPRESA: 'Administrador', FINANCEIRO_EMPRESA: 'Financeiro', VISUALIZADOR_EMPRESA: 'Visualizador',
  CONVERTIDA_EM_ACORDO: 'Virou acordo', PF: 'Pessoa física', PJ: 'Pessoa jurídica',
  AGUARDANDO_VALIDACAO: 'Aguardando validação', AGUARDANDO_AUTORIZACAO: 'Aguardando autorização', PRONTO_PARA_COBRANCA: 'Pronto para cobrança',
  AGUARDANDO_OPERADOR: 'Aguardando operador', ATRIBUIDO: 'Atribuído', PRIMEIRO_CONTATO_PENDENTE: '1º contato pendente', EM_NEGOCIACAO: 'Em negociação',
  PAGAMENTO_INFORMADO: 'Pagamento informado', PAGAMENTO_EM_CONFIRMACAO: 'Pagamento em conferência', CONTESTACAO: 'Contestação', CONTESTADA: 'Contestada',
  EM_CONFIRMACAO: 'Em conferência', EM_VALIDACAO: 'Em validação', NAO_VALIDADA: 'Não validada', VALIDADA: 'Validada', REPROVADA: 'Devolvida',
  CADASTRO_INCOMPLETO: 'Cadastro incompleto', EM_ANALISE: 'Em análise', CONCLUIDA: 'Concluída', NEGADA_FUNDAMENTADA: 'Negada (fundamentada)',
  PLATAFORMA: 'Plataforma (cobrança própria)', AMBOS: 'Plataforma + cobrança HS', CARTEIRA_SELECIONADA: 'Carteira selecionada', TODOS_ELEGIVEIS: 'Todos os elegíveis',
  PACOTE_CASOS: 'Pacote de casos', CARTEIRA_ESPECIFICA: 'Carteira específica', CARTEIRA_COMPLETA: 'Carteira completa', PERSONALIZADA: 'Proposta personalizada',
  SEM_RESPOSTA: 'Sem resposta', NUMERO_INVALIDO: 'Número inválido', PROMESSA_PAGAMENTO: 'Promessa de pagamento', SOLICITOU_INTERRUPCAO: 'Pediu para não ser contatado',
  LIGACAO: 'Ligação', TRANSFERENCIA: 'Transferência', CARTAO: 'Cartão', CONFISSAO_DIVIDA: 'Confissão de dívida', COMPROVANTE_ENTREGA: 'Comprovante de entrega',
  CORRECAO: 'Correção', ELIMINACAO: 'Eliminação', INFORMACAO_COMPARTILHAMENTO: 'Informação sobre compartilhamento', OPOSICAO: 'Oposição', REVOGACAO_CONSENTIMENTO: 'Revogação de consentimento',
  CORRECAO_VALOR_ORIGINAL: 'Correção do valor original', DESCONTO_ACORDO: 'Desconto do acordo', EXERCICIO_REGULAR_DIREITO_CREDITO: 'Exercício regular de direito / proteção do crédito',
  dashboard_basico: 'Dashboard básico', importacao: 'Importação de planilhas', negociacao: 'Negociação', relatorios: 'Relatórios', exportacao: 'Exportação', api_futura: 'API (futura)',
  WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', SMS: 'SMS', PIX: 'Pix',
  dividas: 'Dívidas', devedores: 'Devedores', pagamentos: 'Pagamentos', carteiras: 'Carteiras',
};
export function rotulo(s) {
  if (!s) return '—';
  if (ROTULOS[s]) return ROTULOS[s];
  const t = String(s).toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
