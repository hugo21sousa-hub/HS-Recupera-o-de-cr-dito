import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { hs, abrirLink, baixarArquivo, DEMO } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Tabela, Badge, Cabecalho, FormModal, useApi, useToast, useConfirm, Vazio, Abas, useExecutar, Stat } from '../ui.jsx';
import { brl, data, dataHora, rotulo, pct, mascaraDoc, hojeISO } from '../format.js';

/** Botões de conferência/confirmação/rejeição — somente o credor. */
export function AcoesPagamento({ pagamento: p, onFeito }) {
  const [confirmar, setConfirmar] = useState(false);
  const pedir = useConfirm();
  const { executar } = useExecutar();
  if (!['INFORMADO', 'EM_CONFIRMACAO'].includes(p.status_confirmacao)) return null;
  return (
    <>
      {p.status_confirmacao === 'INFORMADO' && <button className="btn sm" onClick={async () => { await executar('iniciarConferencia', { pagamento_id: p.id }, 'Marcado como em conferência'); onFeito(); }}>Conferir</button>}
      <button className="btn sm ok" onClick={() => setConfirmar(true)}>Confirmar</button>
      <button className="btn sm perigo" onClick={async () => { const r = await pedir({ titulo: 'Rejeitar pagamento informado', perigo: true, pedirMotivo: true, botao: 'Rejeitar', mensagem: `O valor de ${brl(p.valor_centavos)} não será abatido do saldo. A equipe responsável será avisada.` }); if (r) { await executar('rejeitarPagamento', { pagamento_id: p.id, motivo: r.motivo }, 'Pagamento rejeitado'); onFeito(); } }}>Rejeitar</button>
      {confirmar && <FormModal titulo="Confirmar recebimento" botao="Confirmar recebimento" onClose={() => setConfirmar(false)} inicial={{ valor_confirmado_centavos: p.valor_centavos }}
        aviso={<div className="aviso alerta">Confirme apenas se o valor <strong>entrou na conta da empresa</strong>. O comprovante enviado pelo devedor não é prova definitiva. Esta ação abate o saldo e não pode ser desfeita.</div>}
        campos={[
          { nome: 'valor_confirmado_centavos', rotulo: 'Valor efetivamente recebido', tipo: 'dinheiro', obrigatorio: true, ajuda: `Informado: ${brl(p.valor_centavos)} em ${data(p.data_informada)}` },
          { nome: 'evidencia', rotulo: 'Evidência da conferência', obrigatorio: true, placeholder: 'Ex.: extrato Banco X, 10/11, ID da transação', full: true },
          { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea' },
        ]} onSubmit={async (v) => { await executar('confirmarPagamento', { pagamento_id: p.id, ...v }, 'Recebimento confirmado. Saldo atualizado.'); onFeito(); }} />}
    </>
  );
}

/** Aprovar/rejeitar proposta fora da alçada — credor. */
export function DecisaoNegociacao({ negociacao: n, onFeito }) {
  const pedir = useConfirm();
  const { executar } = useExecutar();
  const resumo = <div className="stack"><p>Proposta de <strong>{brl(n.valor_proposto_centavos)}</strong> (desconto {pct(n.desconto_bps)}{n.entrada_centavos ? `, entrada ${brl(n.entrada_centavos)}` : ''}{n.quantidade_parcelas ? `, ${n.quantidade_parcelas}x de ${brl(n.valor_parcela_centavos)}` : ', à vista'}).</p>{n.violacoes_alcada?.length > 0 && <div className="aviso alerta">{n.violacoes_alcada.join('; ')}</div>}{n.condicoes && <p className="small">Condições: {n.condicoes}</p>}</div>;
  return (
    <>
      <button className="btn sm ok" onClick={async () => { const r = await pedir({ titulo: 'Aprovar proposta', mensagem: resumo, botao: 'Aprovar' }); if (r) { await executar('decidirNegociacao', { negociacao_id: n.id, decisao: 'APROVAR', justificativa: r.motivo || undefined }, 'Proposta aprovada'); onFeito(); } }}>Aprovar</button>
      <button className="btn sm perigo" onClick={async () => { const r = await pedir({ titulo: 'Rejeitar proposta', mensagem: resumo, pedirMotivo: true, rotuloMotivo: 'Justificativa', perigo: true, botao: 'Rejeitar' }); if (r) { await executar('decidirNegociacao', { negociacao_id: n.id, decisao: 'REJEITAR', justificativa: r.motivo }, 'Proposta rejeitada'); onFeito(); } }}>Rejeitar</button>
    </>
  );
}

const linkCaso = (r) => (r.caso_id ? <Link to={`/casos/${r.caso_id}`}>{r.devedor_nome || 'Abrir caso'}</Link> : r.devedor_nome || '—');

export function Negociacoes() {
  const s = useSessao();
  const [aba, setAba] = useState(!s.ehHS && s.pode('negociacao.aprovar_empresa') ? 'pendentes' : 'todas');
  const [r, setR] = useState(0);
  const colunas = [
    ...(s.ehHS ? [{ titulo: 'Credor', campo: 'credor' }] : []),
    { titulo: 'Devedor', render: linkCaso },
    { titulo: 'Data', render: (n) => dataHora(n.data_proposta) },
    { titulo: 'Saldo base', num: true, render: (n) => brl(n.saldo_base_centavos) },
    { titulo: 'Proposto', num: true, render: (n) => brl(n.valor_proposto_centavos) },
    { titulo: 'Desconto', num: true, render: (n) => pct(n.desconto_bps) },
    { titulo: 'Condição', render: (n) => <>{n.entrada_centavos ? `Entrada ${brl(n.entrada_centavos)} + ` : ''}{n.quantidade_parcelas ? `${n.quantidade_parcelas}x ${brl(n.valor_parcela_centavos)}` : 'à vista'}{n.violacoes_alcada?.length ? <div className="small" style={{ color: 'var(--alerta)' }}>{n.violacoes_alcada.join('; ')}</div> : null}</> },
    { titulo: 'Status', render: (n) => <Badge status={n.status} /> },
    ...(!s.ehHS && s.pode('negociacao.aprovar_empresa') ? [{ titulo: '', render: (n) => n.status === 'AGUARDANDO_APROVACAO_CREDOR' && <div className="row"><DecisaoNegociacao negociacao={n} onFeito={() => setR(r + 1)} /></div> }] : []),
  ];
  return (
    <div className="stack">
      <Cabecalho titulo="Negociações" sub="Propostas não são dinheiro recuperado. Fora da alçada, a decisão é sempre do credor." />
      {!s.ehHS && s.pode('negociacao.aprovar_empresa') && <Abas ativa={aba} onChange={setAba} abas={[{ id: 'pendentes', rotulo: 'Aguardando minha aprovação' }, { id: 'todas', rotulo: 'Todas' }]} />}
      {aba === 'pendentes'
        ? <Tabela key="p" acao="listarAprovacoesPendentes" busca={false} recarregar={r} colunas={colunas} vazio={<Vazio titulo="Nenhuma proposta aguardando aprovação" />} />
        : <Tabela key="t" acao="listarNegociacoes" busca={false} recarregar={r} colunas={colunas} filtros={[{ nome: 'status', rotulo: 'Status', opcoes: ['APROVADA_ALCADA', 'AGUARDANDO_APROVACAO_CREDOR', 'APROVADA_CREDOR', 'REJEITADA', 'CANCELADA', 'CONVERTIDA_EM_ACORDO'] }]} vazio={<Vazio titulo="Nenhuma negociação" />} />}
    </div>
  );
}

export function Acordos() {
  const s = useSessao();
  return (
    <div className="stack">
      <Cabecalho titulo="Acordos" sub="Acordos formalizados com os devedores. O saldo só cai com pagamentos confirmados." />
      <Tabela acao="listarAcordos" busca={false} filtros={[{ nome: 'status', rotulo: 'Status', opcoes: ['ATIVO', 'CUMPRIDO', 'ROMPIDO', 'CANCELADO'] }]} colunas={[
        ...(s.ehHS ? [{ titulo: 'Credor', campo: 'credor' }] : []),
        { titulo: 'Devedor', render: linkCaso },
        { titulo: 'Aceite', render: (a) => `${data(a.data_aceite)} · ${rotulo(a.meio_aceite)}` },
        { titulo: 'Valor acordado', num: true, render: (a) => brl(a.valor_acordado_centavos) },
        { titulo: 'Desconto', num: true, render: (a) => brl(a.desconto_centavos) },
        { titulo: 'Entrada', num: true, render: (a) => brl(a.entrada_centavos) },
        { titulo: 'Parcelas', num: true, campo: 'quantidade_parcelas' },
        { titulo: 'Status', render: (a) => <Badge status={a.status} /> },
      ]} vazio={<Vazio titulo="Nenhum acordo" />} />
    </div>
  );
}

export function Pagamentos() {
  const s = useSessao();
  const toast = useToast();
  const [qs] = useSearchParams();
  const [aba, setAba] = useState(qs.get('aba') || (s.ehHS ? 'INFORMADO' : 'INFORMADO'));
  const [r, setR] = useState(0);
  const filtro = aba === 'TODOS' ? {} : { status_confirmacao: aba };
  return (
    <div className="stack">
      <Cabecalho titulo={s.ehHS ? 'Pagamentos em confirmação' : 'Pagamentos'} sub={s.ehHS ? 'Pagamentos informados pela equipe, aguardando a conferência do credor. O Acorly não confirma pagamentos.' : 'O devedor paga direto à sua empresa. Confira no extrato e confirme ou rejeite cada pagamento informado.'}>
        {!s.ehHS && s.pode('pagamento.informar') && <Link className="btn ok" to="/dividas">Registrar pagamento (pela dívida)</Link>}
      </Cabecalho>
      <Abas ativa={aba} onChange={setAba} abas={[{ id: 'INFORMADO', rotulo: 'Informados' }, { id: 'EM_CONFIRMACAO', rotulo: 'Em conferência' }, { id: 'CONFIRMADO', rotulo: 'Confirmados' }, { id: 'REJEITADO', rotulo: 'Rejeitados' }, { id: 'TODOS', rotulo: 'Todos' }]} />
      <Tabela key={aba} acao="listarPagamentos" payload={{ filtros: filtro }} busca={false} recarregar={r} colunas={[
        ...(s.ehHS ? [{ titulo: 'Credor', campo: 'credor' }] : []),
        { titulo: 'Devedor', render: (p) => (s.ehHS ? linkCaso(p) : <Link to={`/dividas/${p.divida_id}`}>{p.devedor_nome}</Link>) },
        { titulo: 'Data informada', render: (p) => data(p.data_informada) },
        { titulo: 'Valor informado', num: true, render: (p) => brl(p.valor_centavos) },
        { titulo: 'Confirmado', num: true, render: (p) => brl(p.valor_confirmado_centavos) },
        { titulo: 'Comissão Acorly', num: true, render: (p) => (p.comissao_hs_centavos ? <span title={pct(p.comissao_bps)}>{brl(p.comissao_hs_centavos)}</span> : '—') },
        { titulo: 'Forma', render: (p) => rotulo(p.forma_pagamento) },
        { titulo: 'Transação', render: (p) => p.identificador_transacao || '—' },
        { titulo: 'Status', render: (p) => <><Badge status={p.status_confirmacao} />{p.motivo_rejeicao && <div className="small muted">{p.motivo_rejeicao}</div>}{p.confirmar_ate && <div className="small" style={{ color: 'var(--alerta)' }} title="Contrato de cobrança, cláusula 3.3: sem recusa até essa data, o pagamento é considerado confirmado.">Conferir até {dataHora(p.confirmar_ate)}</div>}{p.confirmado_por_decurso && <div className="small muted">Confirmado por decurso de prazo</div>}</> },
        { titulo: '', render: (p) => <div className="row" style={{ justifyContent: 'flex-end' }}>
          {p.comprovante && <button className="btn sm" onClick={() => abrirLink(hs('urlComprovante', { pagamento_id: p.id })).catch(toast.erro)}>Comprovante</button>}
          {!s.ehHS && s.pode('pagamento.confirmar') && <AcoesPagamento pagamento={p} onFeito={() => setR(r + 1)} />}
        </div> },
      ]} vazio={<Vazio titulo="Nenhum pagamento nesta situação" />} />
    </div>
  );
}

function gerarPDF(p) {
  if (DEMO) throw new Error('Prestação de contas gerada. O download do PDF fica desativado na demonstração.');
  const rel = JSON.parse(p.relatorio);
  const doc = new jsPDF();
  doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Acorly', 14, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('Prestação de contas — cobrança gerenciada', 14, 21);
  doc.setTextColor(31, 41, 55); doc.setFontSize(11);
  doc.text(`Credor: ${rel.credor}  ·  CNPJ ${mascaraDoc(rel.cnpj)}`, 14, 38);
  doc.text(`Período: ${data(p.periodo_inicio)} a ${data(p.periodo_fim)}  ·  Gerado em ${dataHora(p.data_geracao)}`, 14, 45);
  autoTable(doc, {
    startY: 52, head: [['Indicador', 'Valor']], headStyles: { fillColor: [29, 95, 167] }, styles: { fontSize: 10 },
    body: [
      ['Casos recebidos no período', rel.casos_recebidos], ['Casos trabalhados', rel.casos_trabalhados], ['Contatos realizados', rel.contatos_realizados],
      ['Respostas recebidas', rel.respostas_recebidas], ['Negociações iniciadas', rel.negociacoes_iniciadas], ['Valor negociado', brl(rel.valor_negociado_centavos)],
      ['Acordos realizados', rel.acordos_realizados], ['Pagamentos informados', `${rel.pagamentos_informados} (${brl(rel.valor_informado_centavos)})`],
      ['Pagamentos confirmados pelo credor', rel.pagamentos_confirmados], ['Valores recuperados (confirmados)', brl(rel.valor_recuperado_centavos)],
      ['Casos suspensos', rel.casos_suspensos], ['Casos sem sucesso', rel.casos_sem_sucesso],
      ['Comissão do Acorly no período (sobre valores confirmados)', brl(rel.comissao_hs_centavos || 0)],
    ],
  });
  if (rel.comissoes?.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8, head: [['Confirmado em', 'Devedor', 'Valor recebido', 'Comissão', 'Valor da comissão']], headStyles: { fillColor: [29, 95, 167] }, styles: { fontSize: 9 },
      body: rel.comissoes.map((c) => [data(c.data), c.devedor, brl(c.valor_centavos), pct(c.comissao_bps), brl(c.comissao_centavos)]),
    });
  }
  doc.setFontSize(8); doc.setTextColor(107, 114, 128);
  doc.text('Valores recuperados consideram somente pagamentos confirmados pelo credor. Os pagamentos são feitos diretamente à empresa credora.', 14, doc.lastAutoTable.finalY + 10, { maxWidth: 182 });
  doc.save(`prestacao-contas-${p.periodo_inicio}-${p.periodo_fim}.pdf`);
}

export function Relatorios() {
  const s = useSessao();
  const toast = useToast();
  const { executar } = useExecutar();
  const contratos = useApi(s.ehHS ? (s.podeAlgum('contrato.gerenciar', 'prestacao.gerar') ? 'listarContratos' : null) : 'listarContratos', { pageSize: 200 });
  const empresas = useApi(s.ehHS ? (s.pode('empresa.gerenciar_todas') ? 'listarEmpresas' : 'listarEmpresasAtendidas') : null, { pageSize: 200 });
  const prestacoes = useApi('listarPrestacoes', {});
  const [gerar, setGerar] = useState(false);
  const inicioMes = hojeISO().slice(0, 8) + '01';
  const nomesEmp = new Map((Array.isArray(empresas.data) ? empresas.data : empresas.data?.itens || []).map((e) => [e.id, e.nome_fantasia || e.razao_social]));
  const listaContratos = (contratos.data?.itens || []).filter((c) => c.status !== 'PROPOSTO' && c.status !== 'SOLICITADO');
  const exportar = async (tipo) => {
    try { const r = await hs('exportarCSV', { tipo }); baixarArquivo(r.nome_arquivo, r.conteudo, r.mime); } catch (e) { toast.erro(e); }
  };
  return (
    <div className="stack">
      <Cabecalho titulo="Relatórios" sub="Prestação de contas por contrato e período, e exportação de dados em planilha.">
        {(s.ehHS ? s.pode('prestacao.gerar') : s.pode('relatorio.empresa')) && <button className="btn prim" onClick={() => setGerar(true)} disabled={!listaContratos.length}>Gerar prestação de contas</button>}
      </Cabecalho>
      {!s.ehHS && s.pode('relatorio.exportar') && (
        <div className="card stack">
          <h2>Exportar planilha (CSV)</h2>
          <div className="row"><button className="btn" onClick={() => exportar('dividas')}>Dívidas</button><button className="btn" onClick={() => exportar('pagamentos')}>Pagamentos</button><button className="btn" onClick={() => exportar('casos')}>Casos de cobrança</button></div>
          <p className="small muted">Arquivos em CSV (separador ;), compatíveis com Excel e Google Planilhas. Toda exportação fica registrada na auditoria.</p>
        </div>
      )}
      <div className="card p0">
        <div style={{ padding: '12px 16px 0' }}><h2>Prestações de contas geradas</h2></div>
        <div className="tabela-wrap"><table>
          <thead><tr>{s.ehHS && <th>Credor</th>}<th>Período</th><th className="num">Casos</th><th className="num">Negociado</th><th className="num">Recuperado (confirmado)</th><th>Gerado em</th><th></th></tr></thead>
          <tbody>{(prestacoes.data || []).slice().sort((a, b) => (a.data_geracao < b.data_geracao ? 1 : -1)).map((p) => (
            <tr key={p.id}>{s.ehHS && <td>{nomesEmp.get(p.empresa_id) || JSON.parse(p.relatorio).credor}</td>}<td>{data(p.periodo_inicio)} – {data(p.periodo_fim)}</td><td className="num">{p.quantidade_casos}</td><td className="num">{brl(p.valor_negociado_centavos)}</td><td className="num">{brl(p.valor_confirmado_centavos)}</td><td>{dataHora(p.data_geracao)}</td>
              <td className="right"><button className="btn sm" onClick={() => { try { gerarPDF(p); } catch (e) { toast.erro(e); } }}>Baixar PDF</button></td></tr>
          ))}</tbody>
        </table>{!prestacoes.data?.length && <Vazio titulo="Nenhuma prestação de contas gerada">{listaContratos.length ? 'Gere a primeira escolhendo um contrato e um período.' : 'Disponível para empresas com contrato de cobrança gerenciada.'}</Vazio>}</div>
      </div>
      {gerar && <FormModal titulo="Gerar prestação de contas" onClose={() => setGerar(false)} botao="Gerar" campos={[
        { nome: 'contrato_servico_id', rotulo: 'Contrato', tipo: 'select', obrigatorio: true, full: true, opcoes: listaContratos.map((c) => ({ valor: c.id, rotulo: `${s.ehHS ? `${nomesEmp.get(c.empresa_id) || 'Empresa'} · ` : ''}${rotulo(c.modalidade)} · desde ${data(c.data_inicio)} · ${rotulo(c.status)}` })) },
        { nome: 'periodo_inicio', rotulo: 'Início', tipo: 'data', obrigatorio: true, padrao: inicioMes },
        { nome: 'periodo_fim', rotulo: 'Fim', tipo: 'data', obrigatorio: true, padrao: hojeISO() },
      ]} onSubmit={async (v) => { const p = await executar('gerarPrestacaoContas', v, 'Prestação de contas gerada'); prestacoes.recarregar(); gerarPDF(p); }} />}
    </div>
  );
}

export { Stat };
