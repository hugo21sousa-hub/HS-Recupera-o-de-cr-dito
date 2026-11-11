import { documentoValido, somenteDigitos, telefoneBR, emailValido } from './documento.js';
import { hojeISO } from './dates.js';

/**
 * Valida dívidas para encaminhamento à cobrança gerenciada.
 * itens: [{ divida, devedor, documentos: [], casoAtivo: bool }]
 * Retorna resumo + lista de elegíveis/inelegíveis com motivos.
 */
export function validarCarteira(itens, { exigirDocumento = true, hoje = hojeISO() } = {}) {
  const chaves = new Map();
  const resultado = [];
  for (const it of itens) {
    const { divida, devedor } = it;
    const problemas = [];   // impedem encaminhamento
    const pendencias = [];  // registro incompleto, mas corrigível
    if (!devedor) problemas.push('Devedor não encontrado');
    else {
      if (!devedor.nome?.trim()) pendencias.push('Nome do devedor ausente');
      if (!documentoValido(devedor.cpf_cnpj, devedor.tipo_pessoa)) pendencias.push('CPF/CNPJ inválido');
      const temCanal = telefoneBR(devedor.telefone) || telefoneBR(devedor.whatsapp) || emailValido(devedor.email);
      if (!temCanal) pendencias.push('Sem telefone, WhatsApp ou e-mail válido');
      if (devedor.nao_contatar) problemas.push('Devedor solicitou interrupção de contato');
      if (devedor.status === 'ANONIMIZADO' || devedor.status === 'INATIVO') problemas.push('Devedor inativo/anonimizado');
    }
    if (!Number.isSafeInteger(divida.valor_original_centavos) || divida.valor_original_centavos <= 0) pendencias.push('Valor original inválido');
    if (!Number.isSafeInteger(divida.saldo_atual_centavos) || divida.saldo_atual_centavos <= 0) problemas.push('Sem saldo em aberto');
    if (!divida.data_vencimento || !/^\d{4}-\d{2}-\d{2}$/.test(divida.data_vencimento)) pendencias.push('Data de vencimento inválida');
    else if (divida.data_vencimento >= hoje) problemas.push('Dívida ainda não vencida');
    if (exigirDocumento && !(it.documentos?.length > 0)) pendencias.push('Sem documentação mínima anexada');
    if (divida.status_financeiro === 'QUITADA' || divida.status_financeiro === 'CANCELADA') problemas.push(`Dívida ${divida.status_financeiro.toLowerCase()}`);
    if (divida.status_financeiro === 'CONTESTADA') problemas.push('Dívida em contestação');
    if (it.casoAtivo) problemas.push('Já existe caso de cobrança ativo');

    const chave = [somenteDigitos(devedor?.cpf_cnpj), (divida.documento_referencia || '').trim().toUpperCase(), divida.valor_original_centavos, divida.data_vencimento].join('|');
    if (chaves.has(chave)) problemas.push(`Possível duplicidade com a dívida ${chaves.get(chave)}`);
    else chaves.set(chave, divida.id);

    resultado.push({
      divida_id: divida.id,
      devedor_id: devedor?.id,
      devedor_nome: devedor?.nome ?? null,
      documento_referencia: divida.documento_referencia || null,
      elegivel: problemas.length === 0 && pendencias.length === 0,
      incompleto: pendencias.length > 0,
      problemas,
      pendencias,
      saldo_centavos: divida.saldo_atual_centavos || 0,
      vencido: divida.data_vencimento && divida.data_vencimento < hoje,
    });
  }
  const elegiveis = resultado.filter((r) => r.elegivel);
  return {
    resumo: {
      quantidade_devedores: new Set(resultado.map((r) => r.devedor_id).filter(Boolean)).size,
      quantidade_dividas: resultado.length,
      valor_total_centavos: resultado.reduce((a, r) => a + r.saldo_centavos, 0),
      valor_vencido_centavos: resultado.filter((r) => r.vencido).reduce((a, r) => a + r.saldo_centavos, 0),
      registros_incompletos: resultado.filter((r) => r.incompleto).length,
      registros_bloqueados: resultado.filter((r) => r.problemas.length > 0).length,
      elegiveis: elegiveis.length,
      valor_elegivel_centavos: elegiveis.reduce((a, r) => a + r.saldo_centavos, 0),
      devedores_elegiveis: new Set(elegiveis.map((r) => r.devedor_id)).size,
    },
    itens: resultado,
  };
}
