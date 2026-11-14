// Lembretes automáticos (rodados de hora em hora, das 9h às 18h de Brasília; cada aviso sai uma única vez):
// - mensalidade perto do vencimento e último dia da tolerância (empresa, no sistema e por e-mail);
// - fim do teste grátis (empresa);
// - parcelas de acordos perto do vencimento (devedor, por e-mail, quando o envio de cobrança está ligado).
import { find, getById, notificar } from './context.js';
import { situacaoAcesso } from './acesso.js';
import { casoAtivo } from '../core/caseStatus.js';
import { emailValido } from '../core/documento.js';
import { formatBRL } from '../core/money.js';
import { LIMITE_CONTATOS_DIA } from '../core/compliance.js';
import { prestacoesDoMes, mesAnterior } from './actions/relatorios.js';

export const DIAS_ANTES_MENSALIDADE = 3;
export const AVISOS_PARCELA = [{ dias: 3, chave: 'D-3' }, { dias: 0, chave: 'D0' }];
const SAIDA = new Set(['TENTATIVA_CONTATO', 'MENSAGEM_ENVIADA', 'LIGACAO']);
const somaDias = (iso, d) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
const dataBR = (iso) => iso.slice(0, 10).split('-').reverse().join('/');

export async function lembretesMensalidade(ctx) {
  const hoje = ctx.now().toISOString().slice(0, 10);
  let n = 0;
  for (const a of await find(ctx, 'Assinatura', { status: 'ATIVA' })) {
    if (a.data_vencimento !== somaDias(hoje, DIAS_ANTES_MENSALIDADE) || a.lembrete_vencimento_para === a.data_vencimento) continue;
    await notificar(ctx, a.empresa_id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'ASSINATURA', titulo: `Sua mensalidade do Acorly vence em ${dataBR(a.data_vencimento)}`, mensagem: 'A fatura (Pix, boleto ou cartão) está em Assinatura. Se já pagou, desconsidere.', link: '/assinatura' });
    await ctx.db.Assinatura.update(a.id, { lembrete_vencimento_para: a.data_vencimento });
    n++;
  }
  // Último dia da tolerância: amanhã o acesso fica somente para consulta
  for (const e of await find(ctx, 'Empresa', {})) {
    if (e.status === 'CANCELADA') continue;
    const s = await situacaoAcesso(ctx, e.id);
    if (s.modo !== 'TOLERANCIA' || s.pagar_ate !== hoje || e.aviso_bloqueio_para === hoje) continue;
    await notificar(ctx, e.id, { perfis: ['ADMIN_EMPRESA', 'FINANCEIRO_EMPRESA'], tipo: 'ASSINATURA', titulo: 'Último dia para pagar a mensalidade do Acorly', mensagem: 'A partir de amanhã o acesso fica somente para consulta até o pagamento.', link: '/assinatura' });
    await ctx.db.Empresa.update(e.id, { aviso_bloqueio_para: hoje });
    n++;
  }
  return n;
}

export async function lembretesTeste(ctx) {
  let n = 0;
  for (const e of await find(ctx, 'Empresa', {})) {
    if (e.status === 'CANCELADA') continue;
    const s = await situacaoAcesso(ctx, e.id);
    if (s.modo !== 'TESTE' || s.dias_restantes > 2) continue;
    const chave = s.dias_restantes === 1 ? 'ULTIMO_DIA' : 'D-2';
    const enviados = e.avisos_teste || [];
    if (enviados.includes(chave)) continue;
    await notificar(ctx, e.id, { perfis: ['ADMIN_EMPRESA'], tipo: 'ASSINATURA', titulo: s.dias_restantes === 1 ? 'Hoje é o último dia do seu teste grátis do Acorly' : `Seu teste grátis do Acorly termina em ${dataBR(s.teste_ate)}`, mensagem: 'Assine um plano para continuar cadastrando e cobrando. Seus dados ficam guardados.', link: '/assinatura' });
    await ctx.db.Empresa.update(e.id, { avisos_teste: [...enviados, chave] });
    n++;
  }
  return n;
}

/** E-mail ao devedor sobre a parcela do acordo (3 dias antes e no dia do vencimento). */
export async function lembretesParcelas(ctx) {
  if (!ctx.email?.cobrancaDisponivel) return 0;
  const agora = ctx.now().toISOString();
  const hoje = agora.slice(0, 10);
  let n = 0;
  for (const acordo of await find(ctx, 'Acordo', { status: 'ATIVO' })) {
    const caso = await getById(ctx, 'CasoCobranca', acordo.caso_id);
    if (!caso || !casoAtivo(caso) || caso.status_operacional === 'SUSPENSO') continue;
    const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
    if (!devedor || devedor.nao_contatar || devedor.nao_contatar_email || !emailValido(String(devedor.email || ''))) continue;
    if (caso.modalidade_cobranca === 'HS_GERENCIADA') {
      const aut = await getById(ctx, 'AutorizacaoCobranca', caso.autorizacao_id);
      if (aut?.status !== 'ATIVA' || !(aut.canais_autorizados || []).includes('EMAIL')) continue;
    }
    const parcelas = (await find(ctx, 'Parcela', { acordo_id: acordo.id })).filter((p) => p.saldo_centavos > 0 && !['PAGA', 'CANCELADA', 'SUBSTITUIDA'].includes(p.status));
    for (const p of parcelas) {
      const aviso = AVISOS_PARCELA.find((x) => somaDias(hoje, x.dias) === p.vencimento);
      if (!aviso || (p.lembretes_enviados || []).includes(aviso.chave)) continue;
      const doDia = (await find(ctx, 'Interacao', { caso_id: caso.id })).filter((i) => SAIDA.has(i.tipo_interacao) && i.data_hora.slice(0, 10) === hoje);
      if (doDia.length >= LIMITE_CONTATOS_DIA) continue;
      const empresa = await getById(ctx, 'Empresa', caso.empresa_id);
      const credor = empresa.nome_fantasia || empresa.razao_social;
      const gerenciada = caso.modalidade_cobranca === 'HS_GERENCIADA';
      const responsavel = await getById(ctx, 'UsuarioPlataforma', caso.operador_id || caso.responsavel_empresa_id);
      const qual = p.numero === 0 ? 'a entrada' : `a parcela ${p.numero}`;
      const quando = aviso.dias === 0 ? 'vence hoje' : `vence em ${dataBR(p.vencimento)}`;
      const texto = `Olá, ${devedor.nome.split(' ')[0]}.\n\nEste é um lembrete do seu acordo com a ${credor}: ${qual}, no valor de ${formatBRL(p.saldo_centavos)}, ${quando}.\n\nO pagamento é feito diretamente à ${credor}, pelos meios combinados no acordo. Se você já pagou, por favor desconsidere esta mensagem.\n\nQualquer dúvida, é só responder este e-mail.`;
      const assunto = `Lembrete: ${qual} do seu acordo com ${credor} ${quando}`;
      const cnpj = String(empresa.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      const r = await ctx.email.paraDevedor({
        para: devedor.email.trim(), nomeRemetente: gerenciada ? 'HS Recuperação de Crédito' : `${credor} via Acorly`,
        responderPara: responsavel?.email || empresa.email || null, assunto, texto,
        rodape: gerenciada ? `Cobrança realizada pela HS Recuperação de Crédito em nome de ${empresa.razao_social} (CNPJ ${cnpj}).` : `Mensagem enviada por ${empresa.razao_social} (CNPJ ${cnpj}).`,
        descadastrar: ctx.descadastro?.link(devedor.id) || null,
      });
      if (!r.ok) continue;
      await ctx.db.Interacao.create({
        empresa_id: caso.empresa_id, caso_id: caso.id, operador_id: 'sistema', canal: 'EMAIL', data_hora: agora, tipo_interacao: 'MENSAGEM_ENVIADA',
        mensagem: `Assunto: ${assunto}\n\n${texto}`, resposta: '', resultado: null, proxima_acao: '', observacoes: 'Lembrete automático de parcela do acordo',
        envio_automatico: true, email_destino: devedor.email.trim(), status_entrega: 'sent', mensagem_externa_id: r.id || null,
      });
      await ctx.db.Parcela.update(p.id, { lembretes_enviados: [...(p.lembretes_enviados || []), aviso.chave] });
      n++;
    }
  }
  return n;
}

/** Dia 1º (horário de Brasília): gera e envia a prestação de contas do mês anterior de cada contrato (uma vez só). */
export async function prestacoesAutomaticas(ctx) {
  const local = new Date(ctx.now().getTime() - 3 * 3600e3);
  if (local.getUTCDate() !== 1) return 0;
  return (await prestacoesDoMes(ctx, mesAnterior(local))).geradas;
}

/** Roda todos os lembretes (só em horário comercial de Brasília). */
export async function rodarLembretes(ctx, { ignorarHorario = false } = {}) {
  const horaBrasilia = (ctx.now().getUTCHours() + 21) % 24;
  if (!ignorarHorario && (horaBrasilia < 9 || horaBrasilia >= 18)) return null;
  return { mensalidade: await lembretesMensalidade(ctx), teste: await lembretesTeste(ctx), parcelas: await lembretesParcelas(ctx), prestacoes: await prestacoesAutomaticas(ctx) };
}
