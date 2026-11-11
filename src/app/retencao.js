// Rotina de retenção (LGPD): anonimiza titulares cujas dívidas estão encerradas há mais tempo
// que o prazo configurado pela empresa, e remove os anexos dessas dívidas.
import { casoAtivo } from '../core/caseStatus.js';
import { auditar, find } from './context.js';

export async function executarRetencao(ctx, { padraoMeses = 60 } = {}) {
  const agora = ctx.now();
  const resumo = { titulares_anonimizados: 0, documentos_removidos: 0 };
  for (const empresa of await find(ctx, 'Empresa')) {
    const cfg = (await find(ctx, 'ConfiguracaoEmpresa', { empresa_id: empresa.id }))[0];
    const meses = Number.isInteger(cfg?.retencao_meses_apos_quitacao) ? cfg.retencao_meses_apos_quitacao : padraoMeses;
    const limite = new Date(agora);
    limite.setUTCMonth(limite.getUTCMonth() - meses);
    const limiteISO = limite.toISOString();
    const dividas = await find(ctx, 'Divida', { empresa_id: empresa.id });
    const casos = await find(ctx, 'CasoCobranca', { empresa_id: empresa.id });
    for (const dev of await find(ctx, 'Devedor', { empresa_id: empresa.id })) {
      if (dev.status === 'ANONIMIZADO') continue;
      const dele = dividas.filter((d) => d.devedor_id === dev.id);
      if (!dele.length) continue;
      if (!dele.every((d) => ['QUITADA', 'CANCELADA'].includes(d.status_financeiro))) continue;
      if (casos.some((c) => c.devedor_id === dev.id && casoAtivo(c))) continue;
      const ultima = dele.map((d) => d.updated_date || d.data_cadastro || '').sort().pop();
      if (!ultima || ultima > limiteISO) continue;
      for (const d of dele) {
        for (const doc of await find(ctx, 'DocumentoDivida', { divida_id: d.id })) {
          if (doc.arquivo && ctx.files?.remover) await ctx.files.remover(doc.arquivo);
          await ctx.db.DocumentoDivida.delete(doc.id);
          resumo.documentos_removidos++;
        }
      }
      await ctx.db.Devedor.update(dev.id, {
        nome: 'TITULAR ANONIMIZADO', cpf_cnpj: `ANON-${dev.id.slice(-6)}`, telefone: '', whatsapp: '', email: '', endereco: '', observacoes: '',
        status: 'ANONIMIZADO', nao_contatar: true, data_anonimizacao: agora.toISOString(),
      });
      await auditar(ctx, { acao: 'RETENCAO_ANONIMIZACAO', entidade: 'Devedor', registro_id: dev.id, empresa_id: empresa.id, depois: { prazo_meses: meses, ultima_movimentacao: ultima } });
      resumo.titulares_anonimizados++;
    }
  }
  return resumo;
}
