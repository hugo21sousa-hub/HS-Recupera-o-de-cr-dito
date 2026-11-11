import { telefoneBR, somenteDigitos } from '../../core/documento.js';
import { verificarMensagem, preencherModelo } from '../../core/compliance.js';
import { transicao, podeTransitar, casoAtivo } from '../../core/caseStatus.js';
import { formatBRL } from '../../core/money.js';
import { AccessError, ValidationError, getById, find, exigir, carregarCaso, auditar, notificar, paginar, requirePerm } from '../context.js';
import { actions as operacoes } from './operacoes.js';

const OPT_OUT = /^\s*(parar|pare|sair|stop|cancelar|descadastrar|nao quero mais|não quero mais)\s*[.!]*\s*$/i;

export const actions = {
  /** Envio pela API oficial (somente casos HS, quando a integração está configurada). */
  enviarWhatsApp: {
    perm: 'interacao.registrar',
    async run(ctx, input) {
      if (!ctx.whatsapp?.disponivel) throw new ValidationError('Integração do WhatsApp Business indisponível. Use o envio manual.');
      const caso = await carregarCaso(ctx, input.caso_id);
      exigir(caso.modalidade_cobranca === 'HS_GERENCIADA' && ctx.user.perfil !== 'ADMIN_EMPRESA', 'O envio pela API é usado nos casos conduzidos pela equipe HS');
      const devedor = await getById(ctx, 'Devedor', caso.devedor_id);
      const fone = telefoneBR(devedor.whatsapp) || telefoneBR(devedor.telefone);
      exigir(fone, 'Devedor sem WhatsApp válido');
      const limite24h = new Date(ctx.now().getTime() - 24 * 3600e3).toISOString();
      const janelaAberta = (await find(ctx, 'Interacao', { caso_id: caso.id })).some((i) => i.canal === 'WHATSAPP' && i.tipo_interacao === 'RESPOSTA_DEVEDOR' && i.data_hora >= limite24h);
      let texto = input.mensagem || '';
      let modelo = null;
      if (input.modelo_id) {
        modelo = await getById(ctx, 'ModeloMensagem', input.modelo_id);
        exigir(modelo && modelo.status === 'ATIVO' && (!modelo.empresa_id || modelo.empresa_id === caso.empresa_id), 'Modelo indisponível');
      }
      const div = await getById(ctx, 'Divida', caso.divida_id);
      const emp = await getById(ctx, 'Empresa', caso.empresa_id);
      const vars = { nome: devedor.nome.split(' ')[0], credor: emp.nome_fantasia || emp.razao_social, valor: formatBRL(div.saldo_atual_centavos), vencimento: div.data_vencimento.split('-').reverse().join('/') };
      const usarModeloMeta = modelo && modelo.aprovado_meta && modelo.nome_template_meta;
      if (modelo) texto = preencherModelo(modelo.conteudo, vars);
      exigir(texto.trim(), 'Mensagem vazia');
      if (!usarModeloMeta && !janelaAberta) throw new ValidationError('Fora da janela de 24 horas da última resposta do devedor: o WhatsApp só permite modelos aprovados pela Meta.');
      verificarMensagem(texto);
      // Registra (com todas as validações de canal, horário, limite diário e não contatar) e só então envia.
      const inter = await operacoes.registrarInteracao.run(ctx, { caso_id: caso.id, canal: 'WHATSAPP', tipo_interacao: 'MENSAGEM_ENVIADA', mensagem: texto });
      const parametros = usarModeloMeta ? [...modelo.conteudo.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => vars[m[1]] ?? '') : [];
      const id = usarModeloMeta
        ? await ctx.whatsapp.enviarModelo(fone, modelo.nome_template_meta, modelo.idioma_template || 'pt_BR', parametros)
        : await ctx.whatsapp.enviarTexto(fone, texto);
      await ctx.db.Interacao.update(inter.id, { envio_automatico: true, mensagem_externa_id: id, telefone_destino: fone, status_entrega: 'sent' });
      return { ok: true, mensagem_externa_id: id, modo: usarModeloMeta ? 'MODELO_META' : 'TEXTO' };
    },
  },

  listarMensagensSemCaso: {
    perm: 'caso.distribuir',
    async run(ctx, input = {}) {
      const rows = (await find(ctx, 'LogIntegracao', { integracao: 'WHATSAPP', status: 'TRIAGEM' })).map((l) => ({ ...l, ...JSON.parse(l.payload_resumo || '{}') }));
      return paginar(rows, { ...input, ordenarPor: 'data_hora' });
    },
  },

  vincularMensagem: {
    perm: 'caso.distribuir',
    async run(ctx, { log_id, caso_id, descartar }) {
      const log = await getById(ctx, 'LogIntegracao', log_id);
      if (!log || log.status !== 'TRIAGEM') throw new AccessError('Mensagem não encontrada', 404);
      if (descartar) { await ctx.db.LogIntegracao.update(log.id, { status: 'DESCARTADA' }); return { ok: true }; }
      const caso = await carregarCaso(ctx, caso_id);
      const m = JSON.parse(log.payload_resumo);
      await registrarResposta(ctx, caso, m.texto, m.recebido_em);
      await ctx.db.LogIntegracao.update(log.id, { status: 'VINCULADA', caso_id: caso.id });
      return { ok: true };
    },
  },
};

async function registrarResposta(ctx, caso, texto, quando) {
  const optOut = OPT_OUT.test(texto || '');
  const inter = await ctx.db.Interacao.create({
    empresa_id: caso.empresa_id, caso_id: caso.id, operador_id: null, canal: 'WHATSAPP', data_hora: quando || ctx.now().toISOString(),
    tipo_interacao: 'RESPOSTA_DEVEDOR', mensagem: '', resposta: texto, resultado: optOut ? 'SOLICITOU_INTERRUPCAO' : 'RESPONDEU',
    proxima_acao: '', observacoes: 'Recebida pela integração WhatsApp Business', envio_automatico: false, recebida_por_integracao: true,
  });
  const patch = { ultima_interacao: ctx.now().toISOString() };
  if (['ATRIBUIDO', 'PRIMEIRO_CONTATO_PENDENTE', 'EM_CONTATO'].includes(caso.status_operacional) && podeTransitar(caso.status_operacional, 'DEVEDOR_RESPONDEU')) Object.assign(patch, transicao(caso, 'DEVEDOR_RESPONDEU'));
  await ctx.db.CasoCobranca.update(caso.id, patch);
  if (optOut) {
    await ctx.db.Devedor.update(caso.devedor_id, { nao_contatar: true, motivo_nao_contatar: `Pediu pelo WhatsApp em ${ctx.now().toISOString().slice(0, 10)}: "${String(texto).slice(0, 60)}"` });
    await notificar(ctx, caso.empresa_id, { perfis: ['ADMIN_EMPRESA'], tipo: 'INTERRUPCAO_CONTATO', titulo: 'Devedor pediu interrupção de contato', mensagem: 'Pedido recebido pelo WhatsApp', link: `/casos/${caso.id}` });
  }
  if (caso.operador_id) await ctx.db.Notificacao.create({ empresa_id: null, usuario_id: caso.operador_id, tipo: 'RESPOSTA_WHATSAPP', titulo: 'Devedor respondeu no WhatsApp', mensagem: String(texto).slice(0, 140), lida: false, data_criacao: ctx.now().toISOString(), link: `/casos/${caso.id}` });
  await auditar(ctx, { acao: 'WHATSAPP_RECEBIDO', entidade: 'Interacao', registro_id: inter.id, empresa_id: caso.empresa_id });
  return inter;
}

/** Processa o webhook da Meta: status de entrega e mensagens recebidas. ctx é de sistema. */
export async function processarWebhookWhatsApp(ctx, payload) {
  const r = { mensagens: 0, triagem: 0, status: 0, duplicadas: 0 };
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const st of v.statuses || []) {
        const inter = (await find(ctx, 'Interacao', { mensagem_externa_id: st.id }))[0];
        if (inter) { await ctx.db.Interacao.update(inter.id, { status_entrega: st.status }); r.status++; }
      }
      for (const m of v.messages || []) {
        if ((await find(ctx, 'EventoWebhook', { origem: 'WHATSAPP', externo_id: m.id })).length) { r.duplicadas++; continue; }
        await ctx.db.EventoWebhook.create({ origem: 'WHATSAPP', externo_id: m.id, recebido_em: ctx.now().toISOString() });
        const tel = somenteDigitos(m.from);
        const texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || `[${m.type}]`;
        const quando = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : ctx.now().toISOString();
        // 1) caso da última mensagem enviada pela API para este número
        const enviadas = (await find(ctx, 'Interacao', { telefone_destino: tel })).filter((i) => i.envio_automatico).sort((a, b) => (a.data_hora < b.data_hora ? 1 : -1));
        let caso = null;
        for (const i of enviadas) { const c = await getById(ctx, 'CasoCobranca', i.caso_id); if (c && casoAtivo(c)) { caso = c; break; } }
        // 2) único caso ativo de devedor com esse número
        if (!caso) {
          const devs = (await find(ctx, 'Devedor')).filter((d) => telefoneBR(d.whatsapp) === tel || telefoneBR(d.telefone) === tel);
          const casos = [];
          for (const d of devs) casos.push(...(await find(ctx, 'CasoCobranca', { devedor_id: d.id })).filter((c) => casoAtivo(c) && c.modalidade_cobranca === 'HS_GERENCIADA'));
          if (casos.length === 1) caso = casos[0];
        }
        if (caso) { await registrarResposta(ctx, caso, texto, quando); r.mensagens++; }
        else {
          await ctx.db.LogIntegracao.create({ empresa_id: null, integracao: 'WHATSAPP', direcao: 'ENTRADA', status: 'TRIAGEM', data_hora: quando, payload_resumo: JSON.stringify({ de: tel, texto: String(texto).slice(0, 2000), recebido_em: quando }) });
          r.triagem++;
        }
      }
    }
  }
  return r;
}
