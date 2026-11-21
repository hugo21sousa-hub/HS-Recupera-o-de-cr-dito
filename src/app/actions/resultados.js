// Diagnóstico enviado ao cliente, Piloto Sem Risco como contrato e resultados reais da cobrança gerenciada.
import { formatBRL } from '../../core/money.js';
import { diasAtraso } from '../../core/dates.js';
import { AccessError, getById, find, exigir, notificar, alterar } from '../context.js';
import { enviarComercial, montar } from './prospeccao.js';
import { empresasDeTeste } from './negocio.js';

const pctBR = (bps) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0).replace('.', ',')}%`;
export const hojeBR = (ctx) => new Date(ctx.now().getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const somaDias = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);

// ---------------- 1. Diagnóstico enviado ao cliente ----------------

/** Números do diagnóstico: da planilha analisada ou, sem planilha, do que o cliente informou (ou do que a equipe digitar). */
function numerosDiagnostico(lead, input) {
  const a = lead.analise ? (typeof lead.analise === 'string' ? JSON.parse(lead.analise) : lead.analise) : null;
  const manualValor = Math.round(Number(String(input.valor_em_atraso ?? '').replace(/\./g, '').replace(',', '.')) * 100) || 0;
  if (a && a.vencido_centavos > 0 && !manualValor) {
    return { fonte: 'PLANILHA', vencido_centavos: a.vencido_centavos, dividas: a.por_faixa.reduce((s, f) => s + f.quantidade, 0), atraso_medio_dias: a.atraso_medio_dias, faixas: a.por_faixa.filter((f) => f.quantidade).map((f) => ({ faixa: f.faixa, quantidade: f.quantidade, valor_centavos: f.valor_centavos, bps: f.bps })) };
  }
  const valor = manualValor || lead.valor_aberto_centavos || 0;
  exigir(valor > 0, 'Sem números para o diagnóstico: informe o valor total em atraso.');
  const qtd = Number(input.qtd_dividas) || lead.qtd_devedores || null;
  return { fonte: manualValor ? 'INFORMADO_EQUIPE' : 'INFORMADO_CLIENTE', vencido_centavos: valor, dividas: qtd, atraso_medio_dias: null, faixas: [] };
}

function corpoDiagnostico(lead, n, { taxa_bps, prazo_dias, mensagem, whatsapp }) {
  const estimado = Math.round((n.vencido_centavos * taxa_bps) / 10000);
  const bpsMedio = n.faixas.length ? Math.round(n.faixas.reduce((s, f) => s + f.bps * f.valor_centavos, 0) / Math.max(1, n.faixas.reduce((s, f) => s + f.valor_centavos, 0))) : 1000;
  const comissao = Math.round((estimado * bpsMedio) / 10000);
  const linhas = [
    'Olá, {{nome}}, tudo bem?',
    '',
    `Conforme combinado, segue o diagnóstico gratuito da carteira em atraso: ${lead.empresa}.`,
    '',
    '## O que encontramos',
    `- **Total em atraso:** ${formatBRL(n.vencido_centavos)}${n.dividas ? ` em ${n.dividas} dívida(s)` : ''}`,
    ...(n.atraso_medio_dias ? [`- **Atraso médio:** ${n.atraso_medio_dias} dias`] : []),
    ...n.faixas.map((f) => `- **${f.faixa.charAt(0).toUpperCase() + f.faixa.slice(1)} de atraso:** ${formatBRL(f.valor_centavos)} (${f.quantidade} dívida(s)), comissão de ${pctBR(f.bps)} só sobre o que entrar`),
    ...(n.fonte !== 'PLANILHA' ? ['- Estes números vêm do valor informado. Com a planilha (só valor e vencimento), o diagnóstico fica mais preciso.'] : []),
    '',
    '## Nossa estimativa conservadora',
    `Com base no perfil da carteira, estimamos recuperar cerca de **${formatBRL(estimado)}** (${pctBR(taxa_bps)} do total em atraso) em até ${prazo_dias} dias.`,
    `Nesse cenário, a comissão seria de cerca de **${formatBRL(comissao)}**, e voltariam para o seu caixa **${formatBRL(estimado - comissao)}** que hoje estão parados.`,
    'É uma estimativa, não uma garantia de resultado: o recuperado depende de cada devedor. Por isso você só paga sobre o que efetivamente entrar na sua conta.',
    '',
    '## Próximo passo: Piloto Sem Risco',
    '- **30 dias com até 20 devedores escolhidos por você** (sugerimos começar pelos que já saíram ou que você deu como perdidos).',
    '- Você vê as mensagens antes e define uma única vez os limites de desconto e parcelamento.',
    '- O devedor paga **direto na conta da sua empresa**, e você paga **10% só do que entrar nos 30 dias**. Se nada entrar, não paga nada. Depois do piloto, se você continuar, vale a tabela normal por tempo de atraso.',
    '- Se algum cliente seu reclamar, paramos o contato com ele na hora.',
    '',
    ...(String(mensagem || '').trim() ? [String(mensagem).trim(), ''] : []),
    ...(whatsapp ? [`[[botao:Quero começar o piloto|https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Recebi o diagnóstico (${lead.empresa}) e quero começar o Piloto Sem Risco.`)}]]`] : []),
    '[[link:Ver as mensagens que o devedor recebe|https://acorly.com.br/mensagens]]',
    '',
    'Abraço,',
    '**{{remetente}}**',
    'HS Recuperação de Crédito · Acorly',
    'contato@acorly.com.br{{whatsapp_linha}}',
  ];
  return { corpo: linhas.join('\n'), estimado, comissao };
}

function prepararDiagnostico(ctx, lead, input) {
  const taxa = Math.round(Number(String(input.taxa_recuperacao ?? '20').replace(',', '.')) * 100);
  exigir(taxa > 0 && taxa <= 8000, 'Informe a estimativa de recuperação entre 1% e 80%');
  const prazo = Math.max(30, Math.min(365, Number(input.prazo_dias) || 90));
  const n = numerosDiagnostico(lead, input);
  const w = String(ctx.contato?.whatsapp || '').replace(/\D/g, '');
  const whatsapp = w ? (w.length <= 11 ? `55${w}` : w) : '';
  const c = corpoDiagnostico(lead, n, { taxa_bps: taxa, prazo_dias: prazo, mensagem: input.mensagem, whatsapp });
  return { ...c, numeros: n, taxa_bps: taxa, prazo_dias: prazo, assunto: `${lead.empresa}: diagnóstico gratuito, ${formatBRL(c.estimado)} podem voltar para o seu caixa` };
}

// ---------------- 3. Piloto Sem Risco ----------------

export const PILOTO = { casos: 20, dias: 30, faixas: [{ ate_dias: null, bps: 1000 }] };

/** Dados padrão de um contrato de piloto (o que não vier preenchido). */
export function padraoPiloto(input) {
  const inicio = input.data_inicio;
  return {
    quantidade_casos_contratada: Math.min(Number(input.quantidade_casos_contratada) || PILOTO.casos, PILOTO.casos),
    data_fim: input.data_fim || somaDias(inicio, PILOTO.dias - 1),
    valor_contratado_centavos: 0,
    forma_cobranca_servico: 'Sem mensalidade: comissão só sobre o que for recuperado',
    comissao_faixas: input.comissao_faixas?.length ? input.comissao_faixas : PILOTO.faixas,
    escopo: input.escopo || `Piloto Sem Risco: cobrança gerenciada de até ${PILOTO.casos} devedores escolhidos pela CONTRATANTE, por ${PILOTO.dias} dias. Comissão de 10% somente sobre os valores pagos dentro do período do piloto e confirmados; sem recebimento, nada é devido. Pagamentos feitos depois do fim do piloto seguem a tabela padrão de comissão por tempo de atraso.`,
  };
}

async function resultadoContrato(ctx, contrato) {
  const casos = await find(ctx, 'CasoCobranca', { contrato_servico_id: contrato.id });
  const ids = new Set(casos.map((c) => c.id));
  const pags = (await find(ctx, 'Pagamento', { empresa_id: contrato.empresa_id })).filter((p) => ids.has(p.caso_id) && p.status_confirmacao === 'CONFIRMADO');
  return {
    casos: casos.length,
    recuperado_centavos: pags.reduce((s, p) => s + (p.valor_confirmado_centavos || 0), 0),
    comissao_centavos: pags.reduce((s, p) => s + (p.comissao_hs_centavos || 0), 0),
    acordos: casos.filter((c) => ['ACORDO_AGUARDANDO_PAGAMENTO', 'PAGAMENTO_INFORMADO', 'PAGAMENTO_EM_CONFIRMACAO', 'PARCIALMENTE_RECUPERADO', 'RECUPERADO_INTEGRALMENTE'].includes(c.status_operacional)).length,
  };
}

/** Avisos do piloto: 5 dias antes do fim e no encerramento (uma vez cada), para a empresa e para o superadmin. */
export async function avisosPilotos(ctx) {
  const hoje = hojeBR(ctx);
  let enviados = 0;
  for (const c of await find(ctx, 'ContratoServico', { modalidade: 'PILOTO', status: 'ATIVO' })) {
    if (!c.data_fim) continue;
    const empresa = await getById(ctx, 'Empresa', c.empresa_id);
    const nome = empresa?.nome_fantasia || empresa?.razao_social || 'empresa';
    if (!c.piloto_aviso_5d_em && hoje >= somaDias(c.data_fim, -5) && hoje <= c.data_fim) {
      const r = await resultadoContrato(ctx, c);
      const msg = `${r.casos} devedor(es) no piloto, ${r.acordos} com acordo, ${formatBRL(r.recuperado_centavos)} já recuperado e confirmado.`;
      await notificar(ctx, c.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'PILOTO', titulo: `Seu Piloto Sem Risco termina em ${data(c.data_fim)}`, mensagem: `${msg} Os 10% valem para o que for pago até o fim do piloto; depois, vale a tabela padrão. Para continuar, fale com a equipe Acorly.`, link: '/contratos' });
      await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'PILOTO', titulo: `Piloto de ${nome} termina em ${data(c.data_fim)}`, mensagem: `${msg} Hora de propor a continuidade (gerenciada ou plataforma).`, link: '/hs/contratos' });
      await ctx.db.ContratoServico.update(c.id, { piloto_aviso_5d_em: hoje });
      enviados++;
    }
    if (!c.piloto_aviso_fim_em && hoje > c.data_fim) {
      const r = await resultadoContrato(ctx, c);
      const msg = `Resultado: ${r.casos} devedor(es), ${r.acordos} com acordo, ${formatBRL(r.recuperado_centavos)} recuperado e confirmado (comissão ${formatBRL(r.comissao_centavos)}). Os acordos em andamento continuam sendo acompanhados.`;
      await notificar(ctx, c.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'PILOTO', titulo: 'Seu Piloto Sem Risco terminou', mensagem: `${msg} Pagamentos feitos a partir de agora seguem a tabela padrão de comissão. Você pode continuar com a cobrança gerenciada ou cobrar com a sua equipe na plataforma.`, link: '/contratos' });
      await notificar(ctx, null, { perfis: ['SUPERADMIN_HS'], tipo: 'PILOTO', titulo: `Piloto de ${nome} terminou`, mensagem: `${msg} Proponha o contrato de continuidade em Contratos de cobrança.`, link: '/hs/contratos' });
      await ctx.db.ContratoServico.update(c.id, { piloto_aviso_fim_em: hoje });
      enviados++;
    }
  }
  return enviados;
}
const data = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

// ---------------- 4. Resultados da cobrança gerenciada ----------------

const FAIXAS_ANALISE = [[90, 'até 90 dias'], [180, '91 a 180 dias'], [365, '181 a 365 dias'], [Infinity, 'acima de 365 dias']];
const faixaDe = (dias) => FAIXAS_ANALISE.find(([lim]) => (dias || 0) <= lim)[1];

export const actions = {
  /** Prévia do e-mail de diagnóstico (nada é enviado). */
  previaDiagnosticoLead: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const lead = await getById(ctx, 'Lead', input.id);
      if (!lead) throw new AccessError('Pedido não encontrado', 404);
      const d = prepararDiagnostico(ctx, lead, input);
      const m = await montar(ctx, { nome: lead.nome, empresa: lead.empresa, segmento: lead.segmento, assunto: d.assunto, corpo: d.corpo }, `${ctx.urlBase || ''}/sair/exemplo`);
      return { assunto: m.assunto, html: m.html, numeros: d.numeros, estimado_centavos: d.estimado, comissao_centavos: d.comissao, taxa_bps: d.taxa_bps, prazo_dias: d.prazo_dias };
    },
  },

  /** Envia o diagnóstico ao cliente por e-mail e marca o pedido como "Diagnóstico enviado". */
  enviarDiagnosticoLead: {
    perm: 'lead.gerenciar',
    async run(ctx, input) {
      const lead = await getById(ctx, 'Lead', input.id);
      if (!lead) throw new AccessError('Pedido não encontrado', 404);
      exigir(lead.email && !lead.nao_receber_comercial, 'Este contato não tem e-mail ou pediu para não receber e-mails.');
      const d = prepararDiagnostico(ctx, lead, input);
      await enviarComercial(ctx, { lead_id: lead.id, para: lead.email, nome: lead.nome, empresa: lead.empresa, segmento: lead.segmento, assunto: d.assunto, corpo: d.corpo });
      const atual = await getById(ctx, 'Lead', lead.id);
      const resumo = { enviado_em: ctx.now().toISOString(), vencido_centavos: d.numeros.vencido_centavos, estimado_centavos: d.estimado, taxa_bps: d.taxa_bps, prazo_dias: d.prazo_dias, fonte: d.numeros.fonte };
      const nota = `${hojeBR(ctx)}: diagnóstico enviado (${formatBRL(d.numeros.vencido_centavos)} em atraso; estimativa ${formatBRL(d.estimado)}).`;
      await alterar(ctx, 'Lead', atual, {
        status: ['CONVERTIDO', 'PERDIDO'].includes(atual.status) ? atual.status : 'DIAGNOSTICO_ENVIADO', diagnostico_enviado_em: resumo.enviado_em, diagnostico_resumo: resumo,
        proximo_followup: null, cadencia_fim: 'Diagnóstico enviado', observacoes: `${atual.observacoes ? `${atual.observacoes}\n` : ''}${nota}`,
      }, 'ENVIAR_DIAGNOSTICO');
      return resumo;
    },
  },

  /** Resultados reais da cobrança gerenciada: recuperação por faixa, tempo até o 1º pagamento, reclamações, funil e pilotos. */
  resultadosCobranca: {
    perm: 'plano.gerenciar',
    async run(ctx) {
      const hoje = hojeBR(ctx);
      const teste = await empresasDeTeste(ctx);
      const casos = (await find(ctx, 'CasoCobranca', {})).filter((c) => c.modalidade_cobranca === 'HS_GERENCIADA' && c.contrato_servico_id && !teste.has(c.empresa_id));
      const pags = (await find(ctx, 'Pagamento', { status_confirmacao: 'CONFIRMADO' })).filter((p) => p.caso_id);
      const porCaso = new Map();
      for (const p of pags) (porCaso.get(p.caso_id) || porCaso.set(p.caso_id, []).get(p.caso_id)).push(p);
      const dividas = new Map((await find(ctx, 'Divida', {})).map((d) => [d.id, d]));
      const faixas = new Map(FAIXAS_ANALISE.map(([, f]) => [f, { faixa: f, casos: 0, encaminhado_centavos: 0, recuperado_centavos: 0, com_pagamento: 0 }]));
      const tempos = [];
      for (const c of casos) {
        const ps = porCaso.get(c.id) || [];
        const recuperado = ps.reduce((s, p) => s + (p.valor_confirmado_centavos || 0), 0);
        const div = dividas.get(c.divida_id);
        const base = div ? Math.max(div.valor_original_centavos || 0, (div.saldo_atual_centavos || 0) + recuperado) : recuperado;
        const dias = c.dias_atraso_no_envio ?? (div ? diasAtraso(div.data_vencimento, (c.data_recebimento || hoje).slice(0, 10)) : 0);
        const f = faixas.get(faixaDe(dias));
        f.casos++; f.encaminhado_centavos += base; f.recuperado_centavos += recuperado; if (ps.length) f.com_pagamento++;
        if (ps.length && c.data_recebimento) {
          const primeiro = ps.map((p) => p.data_informada || p.data_confirmacao?.slice(0, 10)).filter(Boolean).sort()[0];
          if (primeiro) tempos.push(Math.max(0, Math.round((Date.parse(primeiro) - Date.parse(c.data_recebimento.slice(0, 10))) / 864e5)));
        }
      }
      const linhas = [...faixas.values()].map((f) => ({ ...f, taxa_bps: f.encaminhado_centavos ? Math.round((f.recuperado_centavos / f.encaminhado_centavos) * 10000) : null }));
      const total = linhas.reduce((t, f) => ({ casos: t.casos + f.casos, encaminhado_centavos: t.encaminhado_centavos + f.encaminhado_centavos, recuperado_centavos: t.recuperado_centavos + f.recuperado_centavos, com_pagamento: t.com_pagamento + f.com_pagamento }), { casos: 0, encaminhado_centavos: 0, recuperado_centavos: 0, com_pagamento: 0 });
      tempos.sort((a, b) => a - b);
      // reclamações e pedidos para parar
      const devIds = new Set(casos.map((c) => c.devedor_id));
      const naoContatar = (await find(ctx, 'Devedor', {})).filter((d) => devIds.has(d.id) && d.nao_contatar).length;
      const suspensos = casos.filter((c) => c.status_operacional === 'SUSPENSO').length;
      const contestacoes = casos.filter((c) => c.status_operacional === 'CONTESTACAO').length;
      // funil comercial
      const leads = await find(ctx, 'Lead', {});
      const contratos = (await find(ctx, 'ContratoServico', {})).filter((c) => !teste.has(c.empresa_id));
      const pilotos = contratos.filter((c) => c.modalidade === 'PILOTO');
      const empresasPiloto = new Set(pilotos.filter((c) => c.aceite).map((c) => c.empresa_id));
      const continuaram = new Set(contratos.filter((c) => c.modalidade !== 'PILOTO' && c.aceite && empresasPiloto.has(c.empresa_id)).map((c) => c.empresa_id));
      const listaPilotos = [];
      for (const p of pilotos.sort((a, b) => ((a.data_inicio || '') < (b.data_inicio || '') ? 1 : -1))) {
        const emp = await getById(ctx, 'Empresa', p.empresa_id);
        const r = await resultadoContrato(ctx, p);
        listaPilotos.push({
          id: p.id, empresa: emp?.nome_fantasia || emp?.razao_social || '—', status: p.status, aceite: !!p.aceite, data_inicio: p.data_inicio, data_fim: p.data_fim,
          dias_restantes: p.data_fim && p.status === 'ATIVO' ? Math.round((Date.parse(p.data_fim) - Date.parse(hoje)) / 864e5) : null,
          limite: p.quantidade_casos_contratada, continuou: continuaram.has(p.empresa_id), ...r,
        });
      }
      return {
        por_faixa: linhas,
        total: { ...total, taxa_bps: total.encaminhado_centavos ? Math.round((total.recuperado_centavos / total.encaminhado_centavos) * 10000) : null },
        tempo_primeiro_pagamento: tempos.length ? { mediana_dias: tempos[Math.floor(tempos.length / 2)], media_dias: Math.round(tempos.reduce((s, x) => s + x, 0) / tempos.length), casos: tempos.length } : null,
        reclamacoes: { nao_contatar: naoContatar, suspensos, contestacoes },
        funil: {
          pedidos_diagnostico: leads.filter((l) => l.origem !== 'PROSPECCAO').length,
          diagnosticos_enviados: leads.filter((l) => l.diagnostico_enviado_em).length,
          pilotos_propostos: pilotos.length, pilotos_iniciados: empresasPiloto.size, continuaram: continuaram.size,
        },
        pilotos: listaPilotos,
      };
    },
  },
};
