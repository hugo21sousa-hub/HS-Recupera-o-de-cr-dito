// Tag do Google Ads, só no site público (nunca no sistema logado, na página Pix do devedor nem em convites).
// Modo de consentimento com tudo negado: o Google não grava cookies; conta cliques e conversões sem identificar o visitante.
import { DEMO } from './api.js';
import { aparelhoIgnorado } from './visitas.js';

export const ID_GOOGLE_ADS = 'AW-946674321';
const CONVERSOES = { DIAGNOSTICO: 'diagnostico', CADASTRO: 'cadastro', WHATSAPP: 'whatsapp' };

let carregado = false;
const desligado = () => DEMO || typeof window === 'undefined' || navigator.doNotTrack === '1' || navigator.webdriver || aparelhoIgnorado();

function gtag() { window.dataLayer.push(arguments); } // eslint-disable-line prefer-rest-params

function carregar() {
  if (carregado) return true;
  if (desligado()) return false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;
  gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('set', 'url_passthrough', true);
  gtag('js', new Date());
  gtag('config', ID_GOOGLE_ADS, { send_page_view: false, allow_ad_personalization_signals: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ID_GOOGLE_ADS}`;
  document.head.appendChild(s);
  carregado = true;
  return true;
}

/** Página vista no site público. */
export function anuncioPaginaVista(pagina) {
  if (!carregar()) return;
  gtag('event', 'page_view', { send_to: ID_GOOGLE_ADS, page_path: pagina });
}

/** Conversão (DIAGNOSTICO, CADASTRO, WHATSAPP): só se a tag já foi carregada pelo site público. */
export function anuncioConversao(evento) {
  if (!carregado || !CONVERSOES[evento] || desligado()) return;
  gtag('event', evento === 'WHATSAPP' ? 'contact' : evento === 'CADASTRO' ? 'sign_up' : 'generate_lead', { send_to: ID_GOOGLE_ADS, conversao: CONVERSOES[evento] });
}
