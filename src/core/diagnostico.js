// Regras do pedido de diagnóstico gratuito, usadas no navegador (antes de enviar) e no servidor (ao receber).
import { emailValido, somenteDigitos } from './documento.js';

/** Envios mais rápidos que isso, contados da abertura da página, são tratados como robô pelo servidor. */
export const TEMPO_MINIMO_MS = 2500;

/** Primeiro problema do pedido, em português, ou null se está tudo certo. */
export function conferirPedidoDiagnostico(d = {}) {
  const t = (v) => String(v ?? '').trim();
  if (t(d.nome).length < 2) return 'Informe o seu nome';
  if (t(d.empresa).length < 2) return 'Informe o nome da empresa';
  if (!emailValido(t(d.email).toLowerCase())) return 'Informe um e-mail válido';
  const w = somenteDigitos(d.whatsapp);
  if (w && w.length < 10) return 'WhatsApp inválido: informe DDD e número';
  if (d.aceite_privacidade !== true) return 'É preciso concordar com a Política de Privacidade';
  return null;
}

/** Quanto o navegador ainda precisa esperar para o envio não ser descartado como robô (com folga de 200 ms). */
export function esperaAntiRobo(abertoEm, agora = Date.now()) {
  return Math.max(0, TEMPO_MINIMO_MS + 200 - (agora - abertoEm));
}
