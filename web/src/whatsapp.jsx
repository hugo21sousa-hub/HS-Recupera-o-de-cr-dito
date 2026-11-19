// Botão flutuante de WhatsApp da Acorly nas páginas públicas (site e diagnóstico).
import { useEffect, useState } from 'react';
import { publico } from './api.js';
import { registrarVisita } from './visitas.js';

let cache = null;
const dadosPublicos = () => (cache ??= publico().catch(() => { cache = null; return {}; }));

/** Link wa.me com DDI 55 quando o número vier só com DDD. */
export function linkWhatsApp(numero, texto = '') {
  const d = String(numero || '').replace(/\D/g, '');
  const n = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

export function WhatsAppFlutuante({ texto = 'Olá! Vim pelo site da Acorly e gostaria de saber mais.' }) {
  const [numero, setNumero] = useState(null);
  useEffect(() => { let vivo = true; dadosPublicos().then((d) => { if (vivo) setNumero(d?.contato?.whatsapp || null); }); return () => { vivo = false; }; }, []);
  if (!numero) return null;
  return (
    <a className="whats-flutuante" onClick={() => registrarVisita('WHATSAPP')} href={linkWhatsApp(numero, texto)} target="_blank" rel="noreferrer" aria-label="Falar com a Acorly pelo WhatsApp" title="Fale com a gente no WhatsApp">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="currentColor">
        <path d="M16.004 3C8.832 3 3.004 8.82 3.004 15.98c0 2.29.6 4.53 1.74 6.5L3 29l6.7-1.71a13 13 0 0 0 6.3 1.6h.004c7.17 0 13-5.82 13-12.98C29.004 8.82 23.174 3 16.004 3Zm0 23.7h-.004a10.8 10.8 0 0 1-5.5-1.5l-.4-.24-3.98 1.02 1.06-3.86-.26-.4a10.7 10.7 0 0 1-1.66-5.74c0-5.95 4.85-10.79 10.8-10.79 5.94 0 10.78 4.84 10.78 10.79 0 5.95-4.84 10.79-10.84 10.79Zm5.92-8.08c-.32-.16-1.92-.95-2.22-1.06-.3-.11-.51-.16-.73.16-.21.32-.84 1.06-1.03 1.27-.19.21-.38.24-.7.08-.32-.16-1.36-.5-2.6-1.6-.96-.85-1.6-1.9-1.79-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.38.48-.56.16-.19.21-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.62c-.21 0-.56.08-.86.4-.3.32-1.13 1.1-1.13 2.69 0 1.58 1.16 3.12 1.32 3.33.16.21 2.28 3.48 5.53 4.88.77.33 1.37.53 1.84.68.77.25 1.48.21 2.03.13.62-.09 1.92-.78 2.19-1.54.27-.75.27-1.4.19-1.54-.08-.13-.29-.21-.62-.37Z" />
      </svg>
      <span>Fale conosco</span>
    </a>
  );
}
