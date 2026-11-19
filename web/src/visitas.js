// Contador anônimo de visitas do site (sem cookies): avisa o servidor da página vista e das conversões.
import { DEMO } from './api.js';

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

/** evento: VISITA (página vista), WHATSAPP, CADASTRO. Falhas são ignoradas: estatística nunca atrapalha o site. */
export function registrarVisita(evento = 'VISITA', pagina = window.location.pathname) {
  if (DEMO || navigator.doNotTrack === '1' || navigator.webdriver) return;
  try {
    fetch('/api/publico/visita', {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-HS': '1' },
      body: JSON.stringify({ evento, pagina, ...origemDaSessao() }),
    }).catch(() => {});
  } catch { /* sem rede */ }
}
