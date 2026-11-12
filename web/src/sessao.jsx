import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { hs, auth, onSessaoExpirada } from './api.js';

const Ctx = createContext(null);
const PERFIS_HS = ['SUPERADMIN_HS', 'GESTOR_OPERACOES_HS', 'OPERADOR_HS'];

export function SessaoProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, logado: false, perfil: null });
  const carregar = useCallback(async () => {
    try {
      const { logado } = await auth.sessao();
      if (!logado) { setEstado({ carregando: false, logado: false, perfil: null }); return; }
      const perfil = await hs('meuPerfil');
      setEstado({ carregando: false, logado: true, perfil });
    } catch (e) {
      setEstado({ carregando: false, logado: false, perfil: null, erro: e.status === 401 ? null : e });
    }
  }, []);
  useEffect(() => {
    carregar();
    onSessaoExpirada(() => setEstado({ carregando: false, logado: false, perfil: null }));
    const recarregar = () => { setEstado({ carregando: true, logado: false, perfil: null }); carregar(); };
    window.addEventListener('hs-sessao', recarregar);
    return () => window.removeEventListener('hs-sessao', recarregar);
  }, [carregar]);
  const permissoes = estado.perfil?.permissoes || [];
  const valor = {
    ...estado,
    recarregar: carregar,
    usuario: estado.perfil?.usuario,
    empresa: estado.perfil?.empresa,
    ehHS: PERFIS_HS.includes(estado.perfil?.usuario?.perfil),
    pode: (p) => permissoes.includes(p),
    podeAlgum: (...ps) => ps.some((p) => permissoes.includes(p)),
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
export const useSessao = () => useContext(Ctx);
