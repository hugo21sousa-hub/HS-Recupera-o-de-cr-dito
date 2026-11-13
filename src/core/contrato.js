// Contrato de prestação de serviços de cobrança extrajudicial (cobrança gerenciada).
// O texto é montado com os dados da empresa e guardado exatamente como foi aceito.

export const VERSAO_CONTRATO = 'cobranca-v2'; // v2: e-mail da contratada passou a ser contato@acorly.com.br

export const CONTRATADA = {
  nome: 'HS RECUPERAÇÃO DE CRÉDITO',
  cnpj: '37.573.934/0001-22',
  endereco: 'Rua Júlia Fetal, 05, casa 02, Nazaré, Salvador/BA, CEP 40040-350',
  email: 'contato@acorly.com.br',
  foro: 'Salvador/BA',
};

// Prazos combinados no contrato (usados também pelas regras do sistema)
export const DIAS_UTEIS_CONFIRMAR_PAGAMENTO = 5;
export const DIAS_COMISSAO_APOS_SAIDA = 90;

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (bps) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const cnpjFmt = (v) => String(v || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

/**
 * Monta o texto do contrato.
 * @param {object} d { contrato, empresa, faixas:[{bps, faixa}], aceite?: {nome, email, data_hora, ip}, contratada? }
 * @returns {{ titulo: string, secoes: {titulo: string, paragrafos: string[]}[], texto: string }}
 */
export function montarContrato({ contrato, empresa, faixas, aceite = null, contratada = CONTRATADA }) {
  const numero = String(contrato.id || '').toUpperCase();
  const valorFixo = contrato.valor_contratado_centavos > 0
    ? `${brl(contrato.valor_contratado_centavos)}${contrato.forma_cobranca_servico ? ` (${String(contrato.forma_cobranca_servico).toLowerCase().replace(/_/g, ' ')})` : ''}`
    : 'não há valor fixo; a remuneração é somente a comissão';
  const tabela = (faixas || []).map((f) => `• ${String(f.faixa).charAt(0).toUpperCase()}${String(f.faixa).slice(1)} de atraso: ${pct(f.bps)}`);
  const secoes = [
    { titulo: 'Partes', paragrafos: [
      `CONTRATADA: ${contratada.nome}, CNPJ ${contratada.cnpj}, com sede na ${contratada.endereco}, e-mail ${contratada.email}, responsável pela plataforma Acorly.`,
      `CONTRATANTE: ${empresa.razao_social}, CNPJ ${cnpjFmt(empresa.cnpj)}, com sede em ${empresa.endereco || '(endereço não informado)'}, representada por ${empresa.responsavel_legal || '(representante não informado)'}, e-mail ${empresa.email || '(não informado)'}.`,
      'As partes acima identificadas firmam este contrato, que se rege pelas cláusulas seguintes.',
    ] },
    { titulo: '1. Objeto', paragrafos: [
      '1.1. A CONTRATADA fará a cobrança extrajudicial e administrativa das dívidas que a CONTRATANTE encaminhar pela plataforma Acorly, por telefone, WhatsApp, e-mail e outros canais autorizados.',
      '1.2. Os limites de negociação ficam registrados na autorização dada pela CONTRATANTE em cada encaminhamento: desconto máximo, número de parcelas, entrada mínima e canais. Propostas fora desses limites dependem da aprovação da CONTRATANTE no sistema.',
      '1.3. Não fazem parte deste contrato a cobrança judicial, o protesto e a negativação, salvo contratação à parte.',
    ] },
    { titulo: '2. Obrigação de meio, sem garantia de resultado', paragrafos: [
      '2.1. A CONTRATADA se obriga a empregar seus melhores esforços nas tentativas de recuperação. Ela não garante o recebimento, total ou parcial, de nenhuma dívida.',
      '2.2. A falta de pagamento pelo devedor, por qualquer motivo, não gera à CONTRATADA dever de indenizar, devolver valores ou compensar. Exemplos de motivo: falta de recursos, contestação, falecimento, paradeiro desconhecido ou prescrição.',
    ] },
    { titulo: '3. Pagamentos dos devedores', paragrafos: [
      '3.1. Os devedores pagam diretamente à CONTRATANTE. A CONTRATADA não recebe, não guarda e não repassa valores das dívidas.',
      `3.2. A CONTRATANTE deve confirmar ou recusar na plataforma, em até ${DIAS_UTEIS_CONFIRMAR_PAGAMENTO} (cinco) dias úteis, cada pagamento informado.`,
      '3.3. O pagamento informado com comprovante e não recusado nesse prazo, com justificativa, será considerado confirmado para o cálculo da comissão.',
    ] },
    { titulo: '4. Remuneração', paragrafos: [
      '4.1. A CONTRATANTE pagará à CONTRATADA uma comissão sobre os valores recebidos das dívidas encaminhadas. O percentual segue a tabela abaixo, conforme o atraso da dívida na data do encaminhamento:',
      ...tabela,
      `4.2. A comissão é devida sobre qualquer valor recebido da dívida encaminhada, inclusive: (a) quando o devedor pagar ou negociar diretamente com a CONTRATANTE; (b) quando o pagamento ocorrer em até ${DIAS_COMISSAO_APOS_SAIDA} (noventa) dias após a retirada da dívida ou o fim deste contrato, se houve contato ou proposta da CONTRATADA no período.`,
      `4.3. Valor fixo combinado: ${valorFixo}.`,
      '4.4. A CONTRATADA envia o demonstrativo mensal (prestação de contas) e a fatura. A CONTRATANTE paga em até 5 (cinco) dias do recebimento.',
      '4.5. O atraso no pagamento gera multa de 2%, juros de 1% ao mês e correção pelo IPCA. A CONTRATADA poderá suspender a cobrança até a regularização.',
    ] },
    { titulo: '5. Obrigações da CONTRATANTE', paragrafos: [
      '5.1. A CONTRATANTE garante que os créditos são legítimos, existentes, exigíveis e não pagos, e que é a titular deles ou tem poderes para cobrá-los.',
      '5.2. Ela deve enviar documentos e dados corretos e atualizados, além de informar em até 2 dias úteis qualquer pagamento, acordo, contestação ou cancelamento de que tiver conhecimento.',
      '5.3. Ela deve ter base legal (LGPD) para tratar e compartilhar os dados dos devedores.',
      '5.4. A CONTRATANTE responde sozinha e indenizará a CONTRATADA por qualquer prejuízo, condenação ou despesa decorrente de cobrança de dívida inexistente, já paga, prescrita ou com dados incorretos fornecidos por ela.',
    ] },
    { titulo: '6. Obrigações da CONTRATADA', paragrafos: [
      '6.1. A CONTRATADA deve cobrar com respeito ao devedor, conforme o Código de Defesa do Consumidor. Ela não pode expor o devedor ao ridículo nem usar ameaça ou constrangimento.',
      '6.2. Ela deve respeitar os limites autorizados e os pedidos de não contato, e manter sigilo sobre os dados recebidos.',
      '6.3. Ela deve registrar na plataforma os contatos, as propostas e os acordos, que ficam disponíveis para acompanhamento em tempo real.',
    ] },
    { titulo: '7. Limitação de responsabilidade', paragrafos: [
      '7.1. A responsabilidade total da CONTRATADA por este contrato fica limitada ao valor das comissões recebidas nos 3 (três) meses anteriores ao fato. Ficam excluídos danos indiretos e lucros cessantes.',
      '7.2. A CONTRATADA não responde por indisponibilidade temporária de serviços de terceiros, como internet, WhatsApp, e-mail e hospedagem.',
    ] },
    { titulo: '8. Proteção de dados (LGPD)', paragrafos: [
      '8.1. A CONTRATANTE é a controladora dos dados dos devedores. A CONTRATADA atua como operadora, tratando os dados apenas para a cobrança.',
      '8.2. Ao fim do contrato, os dados são mantidos pelo prazo legal e depois eliminados ou anonimizados.',
    ] },
    { titulo: '9. Vigência e encerramento', paragrafos: [
      '9.1. Este contrato vale por prazo indeterminado a partir do aceite.',
      '9.2. Qualquer parte pode encerrá-lo com aviso de 30 (trinta) dias pela plataforma ou por e-mail.',
      '9.3. Acordos e parcelamentos já formalizados continuam gerando comissão até a quitação.',
      '9.4. A CONTRATADA poderá encerrar o contrato de imediato se a CONTRATANTE descumprir as cláusulas 4 ou 5.',
    ] },
    { titulo: '10. Disposições gerais', paragrafos: [
      '10.1. Não há vínculo de emprego, sociedade ou representação entre as partes.',
      '10.2. O aceite eletrônico na plataforma Acorly vale como assinatura (MP 2.200-2/2001, art. 10, §2º). Ele é registrado com nome e e-mail do usuário, data, hora e endereço IP.',
      `10.3. Fica eleito o foro da comarca de ${contratada.foro}.`,
    ] },
    { titulo: 'Aceite eletrônico', paragrafos: [aceite
      ? `${aceite.nome} (${aceite.email}), em nome de ${empresa.razao_social}, em ${dataHoraBR(aceite.data_hora)} (horário de Brasília), IP ${aceite.ip || 'não identificado'}.`
      : 'Pendente. O aceite fica registrado com o nome e o e-mail de quem aceitar, a data, a hora e o endereço IP.'] },
  ];
  const titulo = 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE COBRANÇA EXTRAJUDICIAL';
  const texto = [titulo, `Contrato nº ${numero}`, '', ...secoes.flatMap((s) => [s.titulo, ...s.paragrafos, ''])].join('\n');
  return { titulo, numero, secoes, texto };
}

/** SHA-256 do texto aceito (prova de integridade). Funciona no servidor e no navegador. */
export async function hashTexto(texto) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
