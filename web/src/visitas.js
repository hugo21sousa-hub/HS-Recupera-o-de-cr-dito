// Contador anônimo de visitas do site (sem cookies): avisa o servidor da página vista e das conversões.
import { DEMO } from './api.js';
import { anuncioConversao } from './anuncios.js';

function origemDaSessao() {
  try {
    const salvo = sessionStorage.getItem('acorly_origem');
    if (salvo) return JSON.parse(salvo);
    const q = new URLSearchParams(window.location.search);
    const o = { referrer: document.referrer || '', utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '' };
    sessionStorage.setItem('acorly_origem', JSON.stringify(o));
    return o;
  } catch {
    return { referrer: document.referrer || '' };
  }
}

const CHAVE_NAO_CONTAR = 'acorly_nao_contar';

/** Este aparelho é da equipe Acorly? Então as visitas dele não entram na estatística (nem depois de sair da conta). */
export function aparelhoIgnorado() {
  try { return localStorage.getItem(CHAVE_NAO_CONTAR) === '1'; } catch { return false; }
}
export function ignorarEsteAparelho(sim = true) {
  try { if (sim) localStorage.setItem(CHAVE_NAO_CONTAR, '1'); else localStorage.removeItem(CHAVE_NAO_CONTAR); } catch { /* navegador sem armazenamento */ }
}

/** evento: VISITA (página vista), WHATSAPP, CADASTRO. Falhas são ignoradas: estatística nunca atrapalha o site. */
export function registrarVisita(evento = 'VISITA', pagina = window.location.pathname) {
  if (evento !== 'VISITA') anuncioConversao(evento);
  if (DEMO || navigator.doNotTrack === '1' || navigator.webdriver || aparelhoIgnorado()) return;
  try {
    fetch('/api/publico/visita', {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-HS': '1' },
      body: JSON.stringify({ evento, pagina, ...origemDaSessao() }),
    }).catch(() => {});
  } catch { /* sem rede */ }
}
