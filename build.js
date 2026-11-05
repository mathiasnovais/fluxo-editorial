#!/usr/bin/env node
/**
 * Gera:
 *   dist/index.html      -> dashboard standalone (logos embutidos), para abrir/hospedar
 *   dist/workflow.json   -> workflow do n8n pronto para importar, com o HTML embutido
 *
 * Rode `node build.js` sempre que editar index.html ou n8n/agregador.js.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const p = (...s) => path.join(RAIZ, ...s);

// ── 1. HTML standalone ────────────────────────────────────────
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(p('assets', f)).toString('base64');

let html = fs.readFileSync(p('index.html'), 'utf8')
  .replace('__LOGO_PRINCIPAL__', b64('logo-alfacem.png'))
  .replace('__LOGO_RODAPE__', b64('logo-rodape.png'));

fs.mkdirSync(p('dist'), { recursive: true });
fs.writeFileSync(p('dist', 'index.html'), html);

// ── 2. Workflow do n8n ────────────────────────────────────────
const agregador = fs.readFileSync(p('n8n', 'agregador.js'), 'utf8');

// Preencha com o ID da sua planilha (o trecho entre /d/ e /edit na URL).
const PLANILHA_ID = process.env.PLANILHA_ID || 'COLE_AQUI_O_ID_DA_PLANILHA';

const nó = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ parameters, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, type, typeVersion, position, ...extra });

const CRED_SHEETS = { googleSheetsOAuth2Api: { id: 'REPLACE_ME', name: 'Google Sheets account' } };

const workflow = {
  name: 'Fluxo Editorial 2027 · Dashboard',
  settings: { executionOrder: 'v1' },
  nodes: [
    // ─── Rota A: serve o dashboard ───
    nó('Webhook Dashboard', 'n8n-nodes-base.webhook', 2, [0, 0], {
      httpMethod: 'GET', path: 'fluxo-editorial', responseMode: 'responseNode', options: {}
    }, { webhookId: 'fluxo-editorial-html' }),

    nó('Responder HTML', 'n8n-nodes-base.respondToWebhook', 1.1, [280, 0], {
      respondWith: 'text',
      responseBody: html,
      options: { responseHeaders: { entries: [
        { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' }
      ] } }
    }),

    // ─── Rota B: serve os dados ───
    nó('Webhook Dados', 'n8n-nodes-base.webhook', 2, [0, 260], {
      httpMethod: 'GET', path: 'fluxo-editorial-dados', responseMode: 'responseNode', options: {}
    }, { webhookId: 'fluxo-editorial-dados' }),

    // Descobre as abas da planilha (não precisa digitar nome de aba).
    nó('Listar Abas', 'n8n-nodes-base.httpRequest', 4.2, [240, 260], {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA_ID}?fields=sheets.properties.title`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      options: {}
    }, { credentials: CRED_SHEETS }),

    nó('Montar Ranges', 'n8n-nodes-base.code', 2, [480, 260], {
      jsCode: [
        "// Transforma a lista de abas em query string ?ranges=...&ranges=...",
        "const abas = ($input.first().json.sheets || []).map(s => s.properties.title);",
        "if (!abas.length) throw new Error('Planilha sem abas ou credencial sem acesso.');",
        "const query = abas.map(a => 'ranges=' + encodeURIComponent(`'${a.replace(/'/g, \"''\")}'!A1:AZ5000`)).join('&');",
        "return [{ json: { query, abas } }];"
      ].join('\n')
    }),

    nó('Ler Planilha', 'n8n-nodes-base.httpRequest', 4.2, [720, 260], {
      url: `=https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA_ID}/values:batchGet?{{ $json.query }}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      options: {}
    }, { credentials: CRED_SHEETS }),

    nó('Agregar Planilha', 'n8n-nodes-base.code', 2, [960, 260], { jsCode: agregador }),

    nó('Responder JSON', 'n8n-nodes-base.respondToWebhook', 1.1, [1200, 260], {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json) }}',
      options: { responseHeaders: { entries: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'Access-Control-Allow-Origin', value: '*' }
      ] } }
    })
  ],
  connections: {
    'Webhook Dashboard': { main: [[{ node: 'Responder HTML', type: 'main', index: 0 }]] },
    'Webhook Dados':     { main: [[{ node: 'Listar Abas', type: 'main', index: 0 }]] },
    'Listar Abas':       { main: [[{ node: 'Montar Ranges', type: 'main', index: 0 }]] },
    'Montar Ranges':     { main: [[{ node: 'Ler Planilha', type: 'main', index: 0 }]] },
    'Ler Planilha':      { main: [[{ node: 'Agregar Planilha', type: 'main', index: 0 }]] },
    'Agregar Planilha':  { main: [[{ node: 'Responder JSON', type: 'main', index: 0 }]] }
  }
};

fs.writeFileSync(p('dist', 'workflow.json'), JSON.stringify(workflow, null, 2));

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('dist/index.html    ', kb(html.length));
console.log('dist/workflow.json ', kb(fs.statSync(p('dist', 'workflow.json')).size));
console.log(PLANILHA_ID.startsWith('COLE')
  ? '\n⚠  Rode com o ID da planilha:  PLANILHA_ID=1AbC... node build.js'
  : '\n✓  Planilha: ' + PLANILHA_ID);
