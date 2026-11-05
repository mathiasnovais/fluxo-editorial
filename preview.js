#!/usr/bin/env node
/**
 * Pré-visualização local: sobe o dashboard com dados de exemplo,
 * usando o MESMO agregador que roda no n8n.
 *
 *   node preview.js            -> http://localhost:8099 com planilha falsa
 *   node preview.js <url>      -> aponta para um webhook n8n real
 */
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PORTA = 8099;
const p = (...s) => path.join(__dirname, ...s);
const proxy = process.argv[2];

if (!fs.existsSync(p('dist', 'index.html'))) {
  console.error('Rode `node build.js` primeiro.');
  process.exit(1);
}

/* ── planilha de exemplo, no formato que o Sheets API devolve ── */
function planilhaFalsa() {
  const cab = ['Ano/Série', 'Livro', 'Matéria', 'Tipo de Ação',
    ...[1, 2, 3, 4, 5, 6].flatMap(n => [`Etapa ${n} - Prazo`, `Etapa ${n} - Status`]),
    '% Concluído', 'Situação Geral'];
  const rot = { C: 'Concluído', A: 'Em andamento', '-': 'Não iniciado' };
  const linha = (ano, livro, mat, acao, st) =>
    [ano, livro, mat, acao, ...st.split('').flatMap(s => ['24/07/2026', rot[s]]), '', ''];

  const materias = ['Português', 'Matemática', 'Ciências', 'História', 'Geografia', 'Arte', 'Inglês', 'Redação'];
  const gerar = (aba, anos, qtd) => {
    const linhas = [cab];
    for (let i = 0; i < qtd; i++) {
      const ano = anos[i % anos.length];
      const mat = materias[i % materias.length];
      const reescrita = /Ciências|Sociologia|Português/.test(mat) && i % 4 === 0;
      const feitas = i % 7 === 0 ? 0 : i % 5;
      const st = 'C'.repeat(feitas) + (feitas < 6 ? 'A' : '') + '-'.repeat(Math.max(0, 5 - feitas));
      linhas.push(linha(ano, `Livro ${1 + (i % 3)}`, mat, reescrita ? 'Reescrita' : 'Revisão', st.slice(0, 6)));
    }
    return { range: `'${aba}'!A1:AZ5000`, values: linhas };
  };

  return { valueRanges: [
    gerar('Educação Infantil', ['Berçário', 'Maternal 2', 'Pré-1'], 20),
    gerar('EFAI', ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'], 45),
    gerar('EFAF', ['6º ano', '7º ano', '8º ano', '9º ano'], 180),
    gerar('EM 1ª Série', ['1ª Série'], 67),
    gerar('EM 2ª Série', ['2ª Série'], 67),
    gerar('EM 3ª Série', ['3ª Série'], 93),
    gerar('AlfaMED', ['1ª Série', '2ª Série'], 36),
    gerar('Projeto Olímpico', ['8º ano', '9º ano'], 31),
    { range: "'Dashboard'!A1:AZ5000", values: [['aba de resumo — ignorada']] }
  ] };
}

function agregar() {
  const codigo = fs.readFileSync(p('n8n', 'agregador.js'), 'utf8');
  const ctx = { $input: { first: () => ({ json: planilhaFalsa() }) }, console, Date, Math, JSON,
    Set, Map, Array, Object, String, Number, RegExp, parseFloat, parseInt, isNaN };
  vm.createContext(ctx);
  return vm.runInContext('(function(){' + codigo + '})()', ctx)[0].json;
}

http.createServer(async (req, res) => {
  const rota = req.url.split('?')[0];

  if (rota === '/webhook/fluxo-editorial-dados') {
    try {
      let corpo;
      if (proxy) {
        const r = await fetch(proxy);
        corpo = await r.text();
      } else {
        corpo = JSON.stringify(agregar());
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(corpo);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ erro: e.message }));
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p('dist', 'index.html')));
}).listen(PORTA, () => {
  console.log(`\n  Dashboard:  http://localhost:${PORTA}`);
  console.log(`  Dados:      http://localhost:${PORTA}/webhook/fluxo-editorial-dados`);
  console.log(proxy ? `  Origem:     ${proxy}` : '  Origem:     planilha de exemplo (539 materiais)\n');
});
