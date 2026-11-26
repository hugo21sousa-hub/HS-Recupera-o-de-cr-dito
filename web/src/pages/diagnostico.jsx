// Diagnóstico gratuito da carteira: formulário público do site.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { enviarDiagnostico, baixarArquivo } from '../api.js';
import { Marca } from '../layout.jsx';
import { WhatsAppFlutuante } from '../whatsapp.jsx';
import { anonimizarPlanilha } from '../planilha.js';
import { conferirPedidoDiagnostico, esperaAntiRobo } from '../../../src/core/diagnostico.js';

const SEGMENTOS = [['ESCOLA_CURSO', 'Escola ou curso'], ['SAUDE', 'Clínica, consultório ou laboratório'], ['ACADEMIA', 'Academia'], ['CONDOMINIO', 'Condomínio ou administradora'], ['VAREJO', 'Loja / varejo com crediário'], ['DISTRIBUIDORA', 'Distribuidora / atacado'], ['SERVICOS', 'Prestação de serviços'], ['IMOBILIARIA', 'Imobiliária'], ['OUTRO', 'Outro']];
const MODELO = 'valor;vencimento\n1.250,00;10/08/2026\n480,00;05/09/2026\n'

const paraBase64 = (arquivo) => new Promise((ok, falha) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => falha(new Error('Não foi possível ler o arquivo'));
  r.readAsDataURL(arquivo);
});

/** Código do parceiro que indicou (link acorly.com.br/...?ref=codigo), guardado por 90 dias neste navegador. */
function refIndicacao() {
  try {
    const daUrl = new URLSearchParams(window.location.search).get('ref');
    if (daUrl) return daUrl.slice(0, 40);
    const salvo = JSON.parse(localStorage.getItem('acorly_ref') || 'null');
    return salvo && Date.now() - salvo.t < 90 * 864e5 ? String(salvo.r).slice(0, 40) : undefined;
  } catch { return undefined; }
}

export function Diagnostico() {
  const inicio = useRef(Date.now());
  // Vindo da calculadora do site: já preenche a quantidade de inadimplentes e o valor estimado
  const daCalc = new URLSearchParams(window.location.search);
  const calcDev = (daCalc.get('devedores') || '').replace(/\D/g, '').slice(0, 6);
  const calcValor = (daCalc.get('valor') || '').replace(/\D/g, '').slice(0, 10);
  const [v, setV] = useState({ nome: '', empresa: '', email: '', whatsapp: '', cidade: '', segmento: calcDev ? 'ESCOLA_CURSO' : '', qtd_devedores: calcDev, valor_aberto: calcValor ? Number(calcValor).toLocaleString('pt-BR') + ',00' : '', mensagem: '', aceite_privacidade: false, site: '' });
  const [arquivo, setArquivo] = useState(null);
  const [anonimo, setAnonimo] = useState(null);
  const [lendo, setLendo] = useState(false);
  const escolherArquivo = async (e) => {
    const f = e.target.files?.[0] || null;
    setArquivo(null); setAnonimo(null); setErro(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setErro('Arquivo muito grande: envie até 5 MB.'); e.target.value = ''; return; }
    setLendo(true);
    try { setAnonimo(await anonimizarPlanilha(f)); setArquivo(f); } catch (err) { setErro(err.message); e.target.value = ''; } finally { setLendo(false); }
  };
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enviar = async (e) => {
    e.preventDefault();
    setErro(null);
    const problema = conferirPedidoDiagnostico(v);
    if (problema) { setErro(problema); return; }
    if (arquivo && arquivo.size > 5 * 1024 * 1024) { setErro('Arquivo muito grande: envie até 5 MB.'); return; }
    setEnviando(true);
    try {
      // quem preenche com o autopreenchimento do navegador pode ser rápido demais e cair no filtro de robôs: espera o mínimo
      const espera = esperaAntiRobo(inicio.current);
      if (espera) await new Promise((r) => setTimeout(r, espera));
      const payload = { ...v, tempo_ms: Date.now() - inicio.current, origem: (document.referrer || '').slice(0, 200), ref: refIndicacao() };
      // só a versão anônima (valor + vencimento) sai do computador; o arquivo original nunca é enviado
      if (anonimo) payload.arquivo = { nome: 'diagnostico-anonimo.csv', conteudo: await paraBase64(new Blob([anonimo.csv], { type: 'text/csv' })) };
      await enviarDiagnostico(payload);
      setFeito(true);
      window.scrollTo(0, 0);
    } catch (err) { setErro(err.message); } finally { setEnviando(false); }
  };
  const modelo = () => { try { baixarArquivo('modelo-carteira-acorly.csv', '﻿' + MODELO, 'text/csv;charset=utf-8'); } catch (err) { setErro(err.message); } };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }} className="stack">
      <div className="row between"><Link to="/" aria-label="Voltar ao site"><Marca escura /></Link><Link className="btn sm" to="/">Voltar ao site</Link></div>
      {feito ? (
        <div className="card stack" style={{ textAlign: 'center', padding: 32 }}>
          <h1 style={{ margin: 0 }}>Pedido recebido!</h1>
          <p style={{ margin: 0 }}>Em até <strong>2 dias úteis</strong> a nossa equipe entra em contato com a análise da sua carteira: quanto pode ser recuperado, em quanto tempo e como funcionaria a cobrança.</p>
          <p className="muted small" style={{ margin: 0 }}>Enviamos uma confirmação para o seu e-mail.</p>
          <div className="row" style={{ justifyContent: 'center' }}><a className="btn prim" href="/demonstracao">Ver a demonstração</a><Link className="btn" to="/cadastro">Criar conta grátis</Link></div>
        </div>
      ) : (
        <form className="card stack" onSubmit={enviar} noValidate>
          <div>
            <h1 style={{ margin: '0 0 6px' }}>Diagnóstico gratuito da sua carteira</h1>
            <p className="muted" style={{ margin: 0 }}>Em até 2 dias úteis você recebe <strong>quanto da sua carteira pode ser recuperado</strong>, em quanto tempo e quanto custaria. Sem compromisso e <strong>sem nenhum dado pessoal dos seus clientes</strong>: só o valor e o vencimento de cada atraso.</p>
          </div>
          <div className="form-grid">
            <div className="campo"><label htmlFor="d-nome">Seu nome *</label><input id="d-nome" value={v.nome} onChange={set('nome')} autoComplete="name" required /></div>
            <div className="campo"><label htmlFor="d-emp">Empresa *</label><input id="d-emp" value={v.empresa} onChange={set('empresa')} autoComplete="organization" required /></div>
            <div className="campo"><label htmlFor="d-email">E-mail *</label><input id="d-email" type="email" value={v.email} onChange={set('email')} autoComplete="email" required /></div>
            <div className="campo"><label htmlFor="d-whats">WhatsApp</label><input id="d-whats" inputMode="tel" value={v.whatsapp} onChange={set('whatsapp')} placeholder="(71) 99999-0000" autoComplete="tel" /></div>
            <div className="campo"><label htmlFor="d-seg">Segmento</label><select id="d-seg" value={v.segmento} onChange={set('segmento')}><option value="">Selecione…</option>{SEGMENTOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></div>
            <div className="campo"><label htmlFor="d-cid">Cidade</label><input id="d-cid" value={v.cidade} onChange={set('cidade')} placeholder="Salvador/BA" /></div>
            <div className="campo"><label htmlFor="d-qtd">Quantos clientes inadimplentes (aprox.)</label><input id="d-qtd" inputMode="numeric" value={v.qtd_devedores} onChange={set('qtd_devedores')} /></div>
            <div className="campo"><label htmlFor="d-val">Valor total em aberto (aprox.)</label><input id="d-val" inputMode="decimal" value={v.valor_aberto} onChange={set('valor_aberto')} placeholder="R$ 50.000,00" /></div>
          </div>
          <div className="campo">
            <label htmlFor="d-arq">Planilha dos atrasos (opcional: Excel .xlsx ou CSV, até 5 MB)</label>
            <input id="d-arq" type="file" accept=".csv,.xlsx" onChange={escolherArquivo} />
            <span className="small muted">Basta ter as colunas <strong>valor</strong> e <strong>vencimento</strong>. Se a sua planilha tiver nome, CPF, telefone ou outras colunas, elas são <strong>removidas aqui no seu computador</strong> e não são enviadas. <button type="button" className="btn link" onClick={modelo}>Baixar modelo</button></span>
            {lendo && <span className="small muted">Lendo a planilha…</span>}
            {anonimo && (
              <div className="aviso info small">
                Vamos enviar só <strong>{anonimo.dividas} linha(s) com valor e vencimento</strong> (colunas "{anonimo.colValor}" e "{anonimo.colVenc}").
                {anonimo.removidas.length > 0 && <> Ficam no seu computador, sem envio: {anonimo.removidas.join(', ')}.</>}
              </div>
            )}
          </div>
          <div className="campo"><label htmlFor="d-msg">Conte um pouco sobre a sua situação (opcional)</label><textarea id="d-msg" rows={3} value={v.mensagem} onChange={set('mensagem')} maxLength={2000} /></div>
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}><label>Site<input tabIndex={-1} autoComplete="off" value={v.site} onChange={set('site')} /></label></div>
          <label className="check small"><input type="checkbox" checked={v.aceite_privacidade} onChange={set('aceite_privacidade')} /> <span>Concordo com o uso destes dados para receber o diagnóstico e o contato comercial, conforme a <a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>. Da planilha, só valor e vencimento são enviados, usados apenas para a análise.</span></label>
          {erro && <div className="aviso critico">{erro}</div>}
          <div className="row between">
            <span className="small muted">Prefere conversar? <a href="mailto:contato@acorly.com.br">contato@acorly.com.br</a></span>
            <button className="btn prim" disabled={enviando}>{enviando ? 'Enviando…' : 'Quero meu diagnóstico gratuito'}</button>
          </div>
        </form>
      )}
      <WhatsAppFlutuante texto="Olá! Estou na página do diagnóstico gratuito da Acorly e tenho uma dúvida." />
    </div>
  );
}
