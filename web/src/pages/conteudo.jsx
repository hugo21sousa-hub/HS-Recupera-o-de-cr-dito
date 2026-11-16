// Central de conteúdo: posts sugeridos (LinkedIn e Instagram) a cada 2 dias, com arte gerada,
// aprovação do superadmin e publicação manual pelo Marketing. Também os links das redes sociais.
import { useEffect, useState } from 'react';
import { hs, baixarArquivo } from '../api.js';
import { useSessao } from '../sessao.jsx';
import { Badge, Cabecalho, Modal, Abas, Vazio, Carregando, ErroCarga, useApi, useExecutar, useToast, useConfirm } from '../ui.jsx';
import { data, dataHora } from '../format.js';
import logoBranco from '../assets/acorly-logo-branco.png';

const REDE = { LINKEDIN: 'LinkedIn', INSTAGRAM: 'Instagram' };
const STATUS = { SUGERIDO: 'Sugerido', APROVADO: 'Aprovado · com o marketing', PUBLICADO: 'Publicado', DESCARTADO: 'Descartado' };
const TOM = { SUGERIDO: 'PENDENTE', APROVADO: 'info', PUBLICADO: 'ATIVA', DESCARTADO: 'CANCELADA' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/* ---------- Arte (canvas) ---------- */
let logoPronto = null;
const carregarLogo = () => (logoPronto ??= new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = logoBranco; }));

function quebrar(ctx, texto, largura) {
  const linhas = [];
  for (const par of String(texto || '').split('\n')) {
    let atual = '';
    for (const p of par.split(' ')) {
      const t = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(t).width > largura && atual) { linhas.push(atual); atual = p; } else atual = t;
    }
    linhas.push(atual);
  }
  return linhas;
}

/** Desenha um card da marca. Instagram 1080x1350 (4:5); LinkedIn 1200x1200. */
export async function desenharArte({ rede, titulo, texto, indice = 0, total = 1 }) {
  const W = rede === 'INSTAGRAM' ? 1080 : 1200, H = rede === 'INSTAGRAM' ? 1350 : 1200;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#001452'); grad.addColorStop(1, '#0043ff');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const brilho = g.createRadialGradient(W - 120, H * 0.28, 0, W - 120, H * 0.28, W * 0.45); brilho.addColorStop(0, 'rgba(49,214,255,0.35)'); brilho.addColorStop(1, 'rgba(49,214,255,0)');
  g.fillStyle = brilho; g.fillRect(0, 0, W, H);
  const faixa = g.createLinearGradient(0, 0, W, 0); ['#0043ff', '#31d6ff', '#31ff5e', '#ff31ff', '#ff8c00'].forEach((cor, i) => faixa.addColorStop(i / 4, cor));
  g.fillStyle = faixa; g.fillRect(0, H - 18, W, 18);
  const logo = await carregarLogo();
  if (logo) { const lh = 64, lw = (logo.width / logo.height) * lh; g.drawImage(logo, 80, 80, lw, lh); }
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '600 32px Inter, Arial, sans-serif'; g.textAlign = 'right';
  if (total > 1) g.fillText(`${indice + 1}/${total}`, W - 80, 125);
  g.textAlign = 'left';
  const largura = W - 160;
  let tam = 92;
  g.font = `800 ${tam}px Inter, Arial, sans-serif`;
  let lt = quebrar(g, titulo, largura);
  while (lt.length > 4 && tam > 56) { tam -= 6; g.font = `800 ${tam}px Inter, Arial, sans-serif`; lt = quebrar(g, titulo, largura); }
  g.font = '400 42px Inter, Arial, sans-serif';
  const ls = quebrar(g, texto, largura);
  const alturaBloco = lt.length * tam * 1.12 + (ls.length ? 40 + ls.length * 56 : 0);
  let y = Math.max(260, (H - alturaBloco) / 2);
  g.fillStyle = '#ff8c00'; g.fillRect(80, y - 40, 120, 10);
  g.fillStyle = '#ffffff'; g.font = `800 ${tam}px Inter, Arial, sans-serif`;
  for (const l of lt) { y += tam * 1.12; g.fillText(l, 80, y); }
  if (ls.length) {
    y += 40; g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '400 42px Inter, Arial, sans-serif';
    for (const l of ls) { y += 56; g.fillText(l, 80, y); }
  }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - 120, W, 120);
  g.fillStyle = '#ffffff'; g.font = '700 38px Inter, Arial, sans-serif'; g.fillText('acorly.com.br', 80, H - 48);
  g.textAlign = 'right'; g.font = '400 30px Inter, Arial, sans-serif'; g.fillText('HS Recuperação de Crédito', W - 80, H - 50);
  return c;
}

const slidesDo = (p) => (p.arte?.slides?.length ? p.arte.slides : [{ titulo: p.arte?.titulo || p.titulo, texto: p.arte?.subtitulo || '' }]);
const textoCompleto = (p) => `${p.texto}\n\n${(p.hashtags || []).join(' ')}`.trim();

function Previas({ post }) {
  const [imgs, setImgs] = useState([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const s = slidesDo(post);
      const urls = [];
      for (let i = 0; i < s.length; i++) urls.push((await desenharArte({ rede: post.rede, titulo: s[i].titulo, texto: s[i].texto, indice: i, total: s.length })).toDataURL('image/png'));
      if (vivo) setImgs(urls);
    })();
    return () => { vivo = false; };
  }, [post]);
  return <div className="conteudo-previas">{imgs.map((u, i) => <img key={i} src={u} alt={`Arte ${i + 1}`} />)}</div>;
}

async function baixarArtes(post, toast) {
  try {
    const s = slidesDo(post);
    for (let i = 0; i < s.length; i++) {
      const c = await desenharArte({ rede: post.rede, titulo: s[i].titulo, texto: s[i].texto, indice: i, total: s.length });
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      baixarArquivo(`acorly-${post.rede.toLowerCase()}-${post.data_prevista}${s.length > 1 ? `-${i + 1}` : ''}.png`, blob, 'image/png');
    }
  } catch (e) { toast.erro(e); }
}

function baixarTexto(post, toast) {
  const conteudo = [`${REDE[post.rede]} · ${data(post.data_prevista)} (${diaSemana(post.data_prevista)})`, `Tema: ${post.tema}`, `Formato: ${post.formato || '—'}`, '', 'TEXTO / LEGENDA', post.texto, '', (post.hashtags || []).join(' '), '', 'ROTEIRO', post.roteiro || '—',
    ...(post.arte?.slides?.length ? ['', 'CARDS DA ARTE', ...post.arte.slides.map((s, i) => `${i + 1}. ${s.titulo} — ${s.texto}`)] : [])].join('\n');
  try { baixarArquivo(`acorly-${post.rede.toLowerCase()}-${post.data_prevista}.txt`, '﻿' + conteudo, 'text/plain;charset=utf-8'); } catch (e) { toast.erro(e); }
}

/* ---------- Edição ---------- */
function EditarPost({ post, onClose, onFeito }) {
  const ehInsta = (post?.rede || 'INSTAGRAM') === 'INSTAGRAM';
  const [v, setV] = useState({
    rede: post?.rede || 'INSTAGRAM', data_prevista: post?.data_prevista || new Date().toISOString().slice(0, 10), tema: post?.tema || '', titulo: post?.titulo || '',
    formato: post?.formato || '', texto: post?.texto || '', roteiro: post?.roteiro || '', hashtags: (post?.hashtags || []).join(' '),
    arte_titulo: post?.arte?.titulo || '', arte_subtitulo: post?.arte?.subtitulo || '',
    slides: (post?.arte?.slides || []).map((s) => `${s.titulo} | ${s.texto}`).join('\n'),
  });
  const { executar, enviando } = useExecutar();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const salvar = async () => {
    const insta = v.rede === 'INSTAGRAM';
    const arte = insta
      ? { slides: v.slides.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [t, ...r] = l.split('|'); return { titulo: t.trim(), texto: r.join('|').trim() }; }) }
      : { titulo: v.arte_titulo, subtitulo: v.arte_subtitulo };
    try { await executar('salvarPost', { id: post?.id, rede: v.rede, data_prevista: v.data_prevista, tema: v.tema, titulo: v.titulo, formato: v.formato, texto: v.texto, roteiro: v.roteiro, hashtags: v.hashtags, arte }, 'Post salvo'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal grande titulo={post?.id ? 'Editar post' : 'Novo post'} onClose={onClose} rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn prim" disabled={enviando} onClick={salvar}>Salvar</button></>}>
      <div className="stack">
        <div className="form-grid">
          <div className="campo"><label>Rede</label><select value={v.rede} onChange={set('rede')} disabled={!!post?.id}><option value="INSTAGRAM">Instagram</option><option value="LINKEDIN">LinkedIn</option></select></div>
          <div className="campo"><label>Data prevista</label><input type="date" value={v.data_prevista} onChange={set('data_prevista')} /></div>
          <div className="campo"><label>Tema</label><input value={v.tema} onChange={set('tema')} /></div>
          <div className="campo"><label>Formato</label><input value={v.formato} onChange={set('formato')} placeholder={ehInsta ? 'Carrossel, Reels, Imagem única…' : 'Imagem + texto, documento…'} /></div>
        </div>
        <div className="campo"><label>Título / gancho</label><input value={v.titulo} onChange={set('titulo')} /></div>
        <div className="campo"><label>{v.rede === 'INSTAGRAM' ? 'Legenda' : 'Texto do post'}</label><textarea rows={8} value={v.texto} onChange={set('texto')} /></div>
        <div className="campo"><label>Hashtags (separadas por espaço)</label><input value={v.hashtags} onChange={set('hashtags')} /></div>
        <div className="campo"><label>Roteiro e orientações para o marketing</label><textarea rows={4} value={v.roteiro} onChange={set('roteiro')} /></div>
        {v.rede === 'INSTAGRAM'
          ? <div className="campo"><label>Cards da arte (um por linha: Título | texto)</label><textarea rows={5} value={v.slides} onChange={set('slides')} placeholder={'Chegou o Acorly | Recuperação de crédito para empresas\nTudo em um lugar | Devedores, dívidas e acordos organizados'} /></div>
          : <div className="form-grid"><div className="campo"><label>Título da arte</label><input value={v.arte_titulo} onChange={set('arte_titulo')} /></div><div className="campo"><label>Subtítulo da arte</label><input value={v.arte_subtitulo} onChange={set('arte_subtitulo')} /></div></div>}
      </div>
    </Modal>
  );
}

/* ---------- Detalhe ---------- */
function DetalhePost({ post, onClose, onFeito, onEditar }) {
  const s = useSessao();
  const toast = useToast();
  const pedir = useConfirm();
  const { executar, enviando } = useExecutar();
  const gerente = s.pode('conteudo.gerenciar');
  const copiar = async () => { try { await navigator.clipboard.writeText(textoCompleto(post)); toast.ok('Texto copiado'); } catch { toast.erro(new Error('Não foi possível copiar; use "Baixar texto".')); } };
  const aprovar = async () => {
    const r = await pedir({ titulo: 'Aprovar e enviar ao marketing', botao: 'Aprovar e enviar', pedirMotivo: true, motivoOpcional: true, rotuloMotivo: 'Observação para o marketing (opcional)', mensagem: 'O marketing recebe um aviso no sistema e por e-mail para baixar a arte e o texto e publicar na data prevista.' });
    if (!r) return;
    try { await executar('aprovarPost', { id: post.id, observacao: r.motivo }, 'Aprovado e enviado ao marketing'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  const publicado = async () => {
    const r = await pedir({ titulo: 'Marcar como publicado', botao: 'Confirmar', pedirMotivo: true, motivoOpcional: true, rotuloMotivo: 'Link do post publicado (opcional)', mensagem: 'Informe o link do post na rede social, se tiver.' });
    if (!r) return;
    try { await executar('marcarPostPublicado', { id: post.id, link: r.motivo || undefined }, 'Marcado como publicado'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  const descartar = async () => {
    const r = await pedir({ titulo: 'Descartar post', perigo: true, botao: 'Descartar', pedirMotivo: true, motivoOpcional: true, mensagem: 'O post sai da lista de próximos.' });
    if (!r) return;
    try { await executar('descartarPost', { id: post.id, motivo: r.motivo }, 'Post descartado'); onFeito(); onClose(); } catch { /* aviso já mostrado */ }
  };
  return (
    <Modal grande titulo={`${REDE[post.rede]} · ${data(post.data_prevista)} (${diaSemana(post.data_prevista)})`} onClose={onClose} rodape={<>
      <button className="btn" onClick={() => baixarArtes(post, toast)}>Baixar arte{slidesDo(post).length > 1 ? 's' : ''}</button>
      <button className="btn" onClick={() => baixarTexto(post, toast)}>Baixar texto e roteiro</button>
      <button className="btn" onClick={copiar}>Copiar texto</button>
      {gerente && post.status !== 'PUBLICADO' && <button className="btn" onClick={() => { onClose(); onEditar(post); }}>Editar</button>}
      {gerente && post.status === 'SUGERIDO' && <button className="btn prim" disabled={enviando} onClick={aprovar}>Aprovar e enviar ao marketing</button>}
      {s.pode('conteudo.publicar') && post.status === 'APROVADO' && <button className="btn prim" disabled={enviando} onClick={publicado}>Marcar como publicado</button>}
      {gerente && !['PUBLICADO', 'DESCARTADO'].includes(post.status) && <button className="btn perigo" onClick={descartar}>Descartar</button>}
    </>}>
      <div className="stack">
        <div className="row small"><Badge status={TOM[post.status]}>{STATUS[post.status]}</Badge><span className="muted">{post.formato}</span><span className="muted">Tema: {post.tema}</span></div>
        {post.observacao_aprovacao && <div className="aviso info small">Observação para o marketing: {post.observacao_aprovacao}</div>}
        {post.status === 'PUBLICADO' && <div className="aviso ok small">Publicado em {dataHora(post.publicado_em)}{post.link_publicacao && <> · <a href={post.link_publicacao} target="_blank" rel="noreferrer">ver post</a></>}</div>}
        <Previas post={post} />
        <div className="grid g2">
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>{post.rede === 'INSTAGRAM' ? 'Legenda' : 'Texto do post'}</h3>
            <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{post.texto}{'\n\n'}<span style={{ color: 'var(--azul)' }}>{(post.hashtags || []).join(' ')}</span></div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>Roteiro</h3>
            <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{post.roteiro || '—'}</div>
            {post.arte?.slides?.length > 1 && <><h3 style={{ margin: 0 }}>Cards</h3><ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{post.arte.slides.map((sl, i) => <li key={i}><strong>{sl.titulo}</strong> — {sl.texto}</li>)}</ol></>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CardPost({ post, onAbrir }) {
  return (
    <button type="button" className="card conteudo-card" onClick={() => onAbrir(post)}>
      <div className="row between"><Badge status={post.rede === 'LINKEDIN' ? 'info' : 'PENDENTE'}>{REDE[post.rede]}</Badge><Badge status={TOM[post.status]}>{STATUS[post.status]}</Badge></div>
      <strong>{post.titulo}</strong>
      <span className="small muted">{post.formato}</span>
      <span className="small">{post.texto.slice(0, 170)}{post.texto.length > 170 ? '…' : ''}</span>
    </button>
  );
}

function Lista({ ver, recarregar, onAbrir }) {
  const { data: d, carregando, erro, recarregar: rec } = useApi('listarPosts', { ver }, [recarregar]);
  if (erro) return <ErroCarga erro={erro} onRetry={rec} />;
  if (carregando && !d) return <Carregando linhas={6} />;
  const porData = new Map();
  for (const p of d.itens) { if (!porData.has(p.data_prevista)) porData.set(p.data_prevista, []); porData.get(p.data_prevista).push(p); }
  return (
    <div className="stack">
      {ver === 'proximos' && d.restantes_no_banco <= 3 && <div className="aviso alerta small">Restam {d.restantes_no_banco} tema(s) no banco de posts automáticos. Cadastre novos posts ou peça novos temas.</div>}
      {porData.size ? [...porData.entries()].map(([dia, posts]) => (
        <div key={dia} className="stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>{data(dia)} <span className="muted small">({diaSemana(dia)})</span></h3>
          <div className="grid g2">{posts.map((p) => <CardPost key={p.id} post={p} onAbrir={onAbrir} />)}</div>
        </div>
      )) : <Vazio titulo={ver === 'proximos' ? 'Nenhum post previsto' : 'Nada no histórico ainda'} />}
    </div>
  );
}

function RedesSociais() {
  const { data: d, carregando } = useApi('listarPosts', { ver: 'proximos' });
  const [v, setV] = useState(null);
  const { executar, enviando } = useExecutar();
  useEffect(() => { if (d && !v) setV({ instagram: '', linkedin: '', facebook: '', youtube: '', tiktok: '', ...d.redes }); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (carregando || !v) return <Carregando />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <p className="small muted" style={{ margin: 0 }}>Os links aparecem no rodapé do site acorly.com.br. Use o endereço completo do perfil, começando com https://.</p>
      {[['instagram', 'Instagram', 'https://www.instagram.com/acorly'], ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/acorly'], ['facebook', 'Facebook', 'https://www.facebook.com/acorly'], ['youtube', 'YouTube', 'https://www.youtube.com/@acorly'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@acorly']].map(([k, r, ph]) => (
        <div key={k} className="campo"><label>{r}</label><input value={v[k] || ''} onChange={set(k)} placeholder={ph} /></div>
      ))}
      <div><button className="btn prim" disabled={enviando} onClick={async () => { try { await executar('salvarRedesSociais', v, 'Redes sociais salvas'); } catch { /* aviso já mostrado */ } }}>Salvar</button></div>
    </div>
  );
}

export function Conteudo() {
  const s = useSessao();
  const [aba, setAba] = useState(s.pode('conteudo.gerenciar') ? 'proximos' : 'proximos');
  const [r, setR] = useState(0);
  const [aberto, setAberto] = useState(null);
  const [editar, setEditar] = useState(null);
  const abas = [{ id: 'proximos', rotulo: 'Próximos posts' }, { id: 'historico', rotulo: 'Histórico' }, ...(s.pode('config.sistema') ? [{ id: 'redes', rotulo: 'Redes sociais' }] : [])];
  return (
    <div className="stack">
      <Cabecalho titulo="Conteúdo e redes sociais" sub={s.pode('conteudo.gerenciar') ? 'Um post para o LinkedIn e um para o Instagram a cada 2 dias, com texto, roteiro e arte. Nada é publicado automaticamente: revise, aprove e o marketing publica.' : 'Posts aprovados para publicar: baixe a arte e o texto, publique na data prevista e marque como publicado.'}>
        {s.pode('conteudo.gerenciar') && <button className="btn prim" onClick={() => setEditar({})}>Novo post</button>}
      </Cabecalho>
      <div className="card">
        <Abas ativa={aba} onChange={setAba} abas={abas} />
        {aba === 'redes' ? <RedesSociais /> : <Lista key={aba} ver={aba} recarregar={r} onAbrir={setAberto} />}
      </div>
      {aberto && <DetalhePost post={aberto} onClose={() => setAberto(null)} onFeito={() => setR(r + 1)} onEditar={(p) => setEditar(p)} />}
      {editar && <EditarPost post={editar.id ? editar : null} onClose={() => setEditar(null)} onFeito={() => setR(r + 1)} />}
    </div>
  );
}
