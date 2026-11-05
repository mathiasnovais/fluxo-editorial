// ============================================================
// n8n · Code node "Agregar planilha"
// Entrada : resposta do Google Sheets API values:batchGet
// Saída   : um único item com o JSON que o dashboard consome
// ============================================================

// ─────────── AJUSTE AQUI (o resto se vira sozinho) ───────────
const CONFIG = {
  // Data-alvo da gráfica (usada no card "Meta final").
  metaFinal: '2026-10-22',

  // Prazo institucional da etapa 1. Materiais que passaram disso
  // sem concluir a etapa 1 entram como "em risco".
  prazoEtapa1: '2026-07-24',

  // Abas que NÃO são de materiais (resumos, instruções, etc.).
  abasIgnoradas: ['dashboard', 'cronograma', 'cronograma e responsaveis', 'responsaveis', 'instrucoes', 'legenda', 'resumo'],

  // Metadados das trilhas. Os números (quantidade e %) vêm da
  // planilha; isto aqui é só o texto de apoio de cada cartão.
  trilhas: {
    'Revisão':   { duracao: '3 semanas', janela: '27/07 → 17/09', nota: 'Coordenação de Área e Direção de Unidade conduzem a etapa 2.' },
    'Reescrita': { duracao: '8 semanas', janela: '27/07 → 22/10', nota: 'Ciências, Sociologia e Português do EFAF · depende de redator externo.' }
  },

  // Rótulo de cada etapa, usado nos gargalos e na aba Responsáveis.
  etapas: [
    { n: 1, titulo: 'Revisão inicial em aberto',            sub: 'prazo institucional era 24/07/2026',      responsavel: 'Diretor(a) de Unidade e Coordenador(a) de Área' },
    { n: 2, titulo: 'Reescrita sem redator alocado',        sub: 'janela de 8 semanas já em curso',         responsavel: 'Coordenação ou redator externo' },
    { n: 3, titulo: 'Fila da Assessoria Pedagógica',        sub: 'concentra tudo em setembro',              responsavel: 'Assessoria Pedagógica' },
    { n: 4, titulo: 'Mecanografia sem lote previsto',       sub: 'capacidade de diagramação não declarada', responsavel: 'Mecanografia' },
    { n: 5, titulo: 'Validação pendente',                   sub: 'coordenação e assessoria em conjunto',    responsavel: 'Coordenação e Assessoria' },
    { n: 6, titulo: 'Liberação para a gráfica pendente',    sub: 'última trava antes do envio',             responsavel: 'Coordenação Editorial' }
  ],

  // Como identificar cada coluna. Basta que o cabeçalho CONTENHA
  // um destes termos (sem acento, sem caixa). Adicione variações
  // se a sua planilha usar outros nomes.
  colunas: {
    ano:      ['ano/serie', 'ano / serie', 'ano', 'serie'],
    livro:    ['livro', 'material', 'volume', 'fasciculo'],
    materia:  ['materia', 'disciplina', 'componente'],
    trilha:   ['tipo de acao', 'tipo acao', 'trilha', 'acao'],
    pct:      ['% concluido', 'percentual', 'conclusao', '% conclusao'],
    situacao: ['situacao geral', 'situacao', 'status geral']
  }
};
// ─────────────────────────────────────────────────────────────

const norm = s => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Classifica o conteúdo de uma célula de status em C (concluído), A (andamento) ou - (não iniciado). */
function classificar(valor) {
  const v = norm(valor);
  if (!v || v === '-' || v === '--' || v === 'n/a' || v === 'na') return '-';
  if (/^(nao iniciad|pendente|aguardand|a iniciar|nao)/.test(v)) return '-';
  if (/(conclu|finaliz|entregu|aprovad|liberad|pronto|feito|ok|100%)/.test(v) || v === 'c' || v === 'x' || v === 'sim') return 'C';
  if (/(andamento|em curso|iniciad|parcial|revisand|producao|execucao|analise)/.test(v) || v === 'a') return 'A';
  // Prazo preenchido (data) sem status explícito = etapa em curso.
  if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)) return 'A';
  return 'A';
}

/** Localiza o índice da coluna cujo cabeçalho casa com algum dos apelidos. */
function acharColuna(cabecalhos, apelidos) {
  for (const apelido of apelidos) {
    const i = cabecalhos.findIndex(h => h && h.includes(apelido));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Descobre as 6 colunas de STATUS das etapas.
 * Estratégia 1: cabeçalho contém "etapa N" (prefere o que também diz status/situação).
 * Estratégia 2 (fallback documentado): E..P, alternando prazo/status -> F,H,J,L,N,P.
 */
function acharEtapas(cabecalhos) {
  const achadas = [];
  for (let n = 1; n <= 6; n++) {
    const re = new RegExp('etapa\\s*0?' + n + '(?!\\d)');
    const candidatas = cabecalhos
      .map((h, i) => ({ h, i }))
      .filter(c => c.h && re.test(c.h));
    if (!candidatas.length) { achadas.push(-1); continue; }
    const comStatus = candidatas.find(c => /(status|situacao|estado)/.test(c.h));
    achadas.push((comStatus || candidatas[candidatas.length - 1]).i);
  }
  if (achadas.every(i => i >= 0)) return { indices: achadas, modo: 'cabecalho' };
  return { indices: [5, 7, 9, 11, 13, 15], modo: 'posicional' };
}

// ─────────── leitura das abas ───────────
const entrada = $input.first().json;
const faixas = entrada.valueRanges || [];
if (!faixas.length) throw new Error('A planilha não retornou nenhuma faixa (valueRanges vazio). Confira o ID e as permissões.');

const materiais = [];
const porSegmento = new Map();
const avisos = [];

for (const faixa of faixas) {
  // range vem como "'EFAF'!A1:Z2000" — extrai o nome da aba.
  const nomeAba = String(faixa.range || '').split('!')[0].replace(/^'|'$/g, '').replace(/''/g, "'");
  if (CONFIG.abasIgnoradas.includes(norm(nomeAba))) continue;

  const linhas = faixa.values || [];
  if (linhas.length < 2) { avisos.push(`Aba "${nomeAba}" sem linhas de dados.`); continue; }

  const cabecalhos = linhas[0].map(norm);
  const iAno      = acharColuna(cabecalhos, CONFIG.colunas.ano);
  const iLivro    = acharColuna(cabecalhos, CONFIG.colunas.livro);
  const iMateria  = acharColuna(cabecalhos, CONFIG.colunas.materia);
  const iTrilha   = acharColuna(cabecalhos, CONFIG.colunas.trilha);
  const iPct      = acharColuna(cabecalhos, CONFIG.colunas.pct);
  const iSituacao = acharColuna(cabecalhos, CONFIG.colunas.situacao);
  const { indices: iEtapas, modo } = acharEtapas(cabecalhos);

  if (modo === 'posicional') avisos.push(`Aba "${nomeAba}": colunas de etapa não identificadas pelo cabeçalho; usando posições E..P.`);

  // Sem cabeçalho reconhecível, cai para o mapeamento documentado A,B,C,D.
  const col = (linha, i, alt) => String(linha[i >= 0 ? i : alt] ?? '').trim();

  for (const linha of linhas.slice(1)) {
    const ano     = col(linha, iAno, 0);
    const livro   = col(linha, iLivro, 1);
    const materia = col(linha, iMateria, 2);
    if (!ano && !livro && !materia) continue;              // linha em branco
    if (norm(ano) === 'total' || norm(livro) === 'total') continue; // linha de soma

    const bruto = col(linha, iTrilha, 3);
    const trilha = /reescr/i.test(bruto) ? 'Reescrita' : /revis/i.test(bruto) ? 'Revisão' : (bruto || 'Revisão');

    const etapas = iEtapas.map(i => classificar(linha[i])).join('');
    const feitas = (etapas.match(/C/g) || []).length;

    // % da planilha tem prioridade; se não houver, calcula pelas etapas.
    let pct = Math.round(feitas / 6 * 100);
    if (iPct >= 0) {
      const p = parseFloat(String(linha[iPct] ?? '').replace('%', '').replace(',', '.'));
      if (!isNaN(p)) pct = Math.round(p <= 1 && p > 0 ? p * 100 : p);
    }

    let situacao = iSituacao >= 0 ? col(linha, iSituacao, -1) : '';
    if (!situacao) situacao = feitas === 6 ? 'Concluído' : feitas === 0 ? 'Não iniciado' : 'Em andamento';

    const etapa1Aberta = etapas[0] !== 'C';
    const atrasada = etapa1Aberta && new Date() > new Date(CONFIG.prazoEtapa1);
    const emRisco = pct < 100 && (trilha === 'Reescrita' || atrasada);

    materiais.push({
      segmento: nomeAba, ano, livro, materia, trilha, etapas, pct, situacao, emRisco,
      risco: (trilha === 'Reescrita' ? 200 : 0) + (atrasada ? 60 : 0) + (100 - pct)
    });

    if (!porSegmento.has(nomeAba)) porSegmento.set(nomeAba, []);
    porSegmento.get(nomeAba).push(pct);
  }
}

if (!materiais.length) throw new Error('Nenhum material lido. Verifique se as abas de segmento têm cabeçalho na linha 1.');

// ─────────── agregações ───────────
materiais.sort((a, b) => b.risco - a.risco || a.segmento.localeCompare(b.segmento) || a.ano.localeCompare(b.ano));

const total        = materiais.length;
const concluido    = materiais.filter(m => m.pct >= 100).length;
const naoIniciado  = materiais.filter(m => m.pct === 0).length;
const emAndamento  = total - concluido - naoIniciado;
const reescritaCritica = materiais.filter(m => m.trilha === 'Reescrita' && m.pct < 100).length;

const segmentos = [...porSegmento.entries()].map(([nome, pcts]) => {
  const t = pcts.length;
  const conc = pcts.filter(p => p >= 100).length;
  const and  = pcts.filter(p => p > 0 && p < 100).length;
  const detalhe = and ? `${and} em andamento` : conc === t ? 'concluído' : 'não iniciado';
  return {
    nome, total: t,
    pctConcluido: Math.round(conc / t * 100),
    pctAndamento: Math.round(and / t * 100),
    detalhe
  };
}).sort((a, b) => b.total - a.total);

const trilhas = [...new Set(materiais.map(m => m.trilha))].map(nome => {
  const itens = materiais.filter(m => m.trilha === nome);
  const meta = CONFIG.trilhas[nome] || { duracao: '', janela: '', nota: '' };
  return {
    nome, n: itens.length,
    pct: Math.round(itens.reduce((s, m) => s + m.pct, 0) / itens.length),
    duracao: meta.duracao, janela: meta.janela, nota: meta.nota
  };
}).sort((a, b) => b.n - a.n);

// Gargalo = quantos materiais estão PARADOS em cada etapa
// (primeira etapa ainda não concluída daquele material).
const gargalos = CONFIG.etapas.map(e => {
  // findIndex devolve -1 quando todas as 6 etapas estão concluídas.
  const n = materiais.filter(m => m.etapas.split('').findIndex(s => s !== 'C') === e.n - 1).length;
  const prop = n / total;
  return {
    etapa: 'E' + e.n, titulo: e.titulo, sub: e.sub, n,
    nivel: prop >= 0.30 ? 'critico' : prop >= 0.08 ? 'atencao' : 'ok'
  };
}).sort((a, b) => b.n - a.n).slice(0, 4);

const responsaveis = CONFIG.etapas.map(e => ({
  etapa: 'E' + e.n, nome: e.responsavel, papel: e.titulo.replace(/ (em aberto|pendente).*$/i, '')
}));

return [{
  json: {
    atualizadoEm: new Date().toISOString(),
    metaFinal: CONFIG.metaFinal,
    kpis: { total, naoIniciado, emAndamento, concluido, reescritaCritica },
    segmentos, trilhas, gargalos, responsaveis, materiais,
    avisos
  }
}];
