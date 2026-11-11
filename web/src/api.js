// Cliente da API. Toda leitura/gravação passa pelo backend, que valida permissões e empresa.
export class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

let aoExpirar = () => {};
export const onSessaoExpirada = (fn) => { aoExpirar = fn; };

async function req(path, body, extra = {}) {
  let r;
  try {
    r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'X-HS': '1', ...(body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0);
  }
  let data = null;
  try { data = await r.json(); } catch { /* resposta sem JSON */ }
  if (!r.ok || !data?.ok) {
    if (r.status === 401 && path === '/api/rpc') aoExpirar();
    throw new ApiError(data?.error || `Falha (${r.status})`, r.status, data?.details);
  }
  return data.data;
}

export const hs = (action, payload = {}) => req('/api/rpc', { action, payload });
export const auth = {
  login: (email, senha) => req('/api/auth/login', { email, senha }),
  cadastro: (dados) => req('/api/auth/cadastro', dados),
  logout: () => req('/api/auth/logout', {}),
  sessao: () => req('/api/auth/sessao'),
  verificar2fa: (desafio, codigo) => req('/api/auth/2fa/verificar', { desafio, codigo }),
  iniciar2fa: () => req('/api/auth/2fa/iniciar', {}),
  ativar2fa: (codigo) => req('/api/auth/2fa/ativar', { codigo }),
  desativar2fa: (senha, codigo) => req('/api/auth/2fa/desativar', { senha, codigo }),
  esqueci: (email) => req('/api/auth/esqueci', { email }),
  convite: (token) => req(`/api/auth/convite/${encodeURIComponent(token)}`),
  aceitarConvite: (token, senha, nome) => req('/api/auth/convite', { token, senha, nome }),
  trocarSenha: (atual, nova) => req('/api/auth/senha', { atual, nova }),
};

export async function enviarArquivo(file) {
  if (file.size > 10 * 1024 * 1024) throw new ApiError('Arquivo maior que 10 MB', 413);
  return req('/api/upload', file, { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) });
}

export async function abrirLink(promessa) {
  const janela = window.open('about:blank', '_blank');
  try {
    const { url } = await promessa;
    if (janela) janela.location = url; else window.location = url;
  } catch (e) {
    janela?.close();
    throw e;
  }
}

export function baixarArquivo(nome, conteudo, mime) {
  const blob = new Blob([conteudo], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
