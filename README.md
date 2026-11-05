# Fluxo editorial: painel ligado à planilha

Painel de acompanhamento da produção editorial de materiais didáticos. A planilha de controle (uma aba por segmento, uma linha por material, seis etapas com prazo e status) é lida ao vivo por um workflow do n8n, que agrega tudo e devolve um JSON. O painel mostra totais, percentual por segmento, contagem por trilha (Revisão e Reescrita), gargalos por etapa e a lista de materiais com filtros, busca, paginação e exportação CSV. Nenhum número fica escrito no código: o que está na planilha é o que aparece na tela.

```
Google Sheets -> n8n (lê e agrega) -> webhook JSON -> painel (recarrega sozinho a cada 60 s)
```

## Como está organizado

| Arquivo | O que é |
|---|---|
| `index.html` | A tela. Usa `__LOGO_*__` como marcador dos logos. `CONFIG.ENDPOINT` no topo aponta para o webhook de dados. |
| `n8n/agregador.js` | Código do node "Agregar Planilha" do n8n. É aqui que ficam as regras de negócio (colunas, status, risco, gargalos). |
| `assets/*.png` | Logos. |
| `build.js` | Gera `dist/index.html` (logos embutidos) e `dist/workflow.json` (workflow do n8n com o HTML embutido). |
| `preview.js` | Sobe a tela localmente com uma planilha fictícia, sem precisar do n8n, passando pelo mesmo `agregador.js`. |
| `dist/index.html` | Tela pronta, em arquivo único. |
| `dist/workflow.json` | Gerado pelo `build.js` com o ID da sua planilha. Não é versionado. |

## Stack

- Tela: HTML, CSS e JavaScript puro, sem framework.
- Backend: n8n (webhooks, leitura da planilha pela API do Google Sheets com credencial OAuth2 e um node de código para agregar).
- Geração dos arquivos e pré-visualização: Node.js 18 ou mais novo.
- Hospedagem: o próprio n8n serve a página pelo webhook; o `dist/index.html` também pode ir para hospedagem estática, desde que `CONFIG.ENDPOINT` aponte para o webhook de dados.

## Ver funcionando sem n8n

```bash
node build.js
node preview.js
```

Abra http://localhost:8099. Os materiais são fictícios, gerados pelo `preview.js`.

## Ligar na planilha de verdade

1. A planilha precisa ser Google Sheets nativa (não `.xlsx` em modo Excel). Se for o caso, converta em Arquivo > Salvar como Planilha Google.
2. Pegue o ID da planilha: na URL, o trecho entre `/d/` e `/edit`.
3. Gere o workflow com esse ID. No PowerShell: `$env:PLANILHA_ID = "ID_DA_PLANILHA"; node build.js`. No bash: `PLANILHA_ID=ID_DA_PLANILHA node build.js`.
4. No n8n: Workflows > Import from File > `dist/workflow.json`.
5. Abra os nodes "Listar Abas" e "Ler Planilha" e selecione (ou crie) uma credencial Google Sheets OAuth2 API com acesso de leitura à planilha.
6. Ative o workflow. O painel fica em `https://SEU-N8N/webhook/fluxo-editorial` (a URL de teste, `/webhook-test/`, responde só uma vez).
7. Se o seu n8n usa outro prefixo de webhook, ajuste `CONFIG.ENDPOINT` no `index.html` e rode `node build.js` de novo.

## Como a planilha é lida

O workflow descobre as abas sozinho. Toda aba vira um segmento, exceto as listadas em `abasIgnoradas` (Dashboard, Cronograma, Responsáveis etc.). As colunas são achadas pelo cabeçalho da linha 1, sem depender da posição: basta que o cabeçalho contenha um dos termos de `CONFIG.colunas` (ano/série, livro, matéria, tipo de ação, etapa 1 a 6, % concluído, situação). Cada célula de etapa vira Concluído, Em andamento ou Não iniciado conforme o texto (ou uma data preenchida). Linhas em branco e linhas de Total são descartadas.

Regras no `CONFIG` do `agregador.js`: `metaFinal` (data da gráfica), `prazoEtapa1` (passou disso com a etapa 1 aberta, entra como em risco), textos dos cartões de trilha e rótulos dos gargalos. Em risco = ainda não concluído e (trilha Reescrita ou etapa 1 atrasada). Gargalo da etapa N = materiais cuja primeira etapa não concluída é a N.

No navegador ficam só os filtros, a busca, a paginação e a exportação CSV. A tela recarrega a cada 60 s (`CONFIG.REFRESH_MS`), ao voltar o foco para a aba e pelo botão "Atualizar agora". O n8n lê a planilha a cada requisição, sem cache.

Depois de qualquer edição em `index.html` ou `n8n/agregador.js`, rode `node build.js` e reimporte o `dist/workflow.json` no n8n.

## Dados

Este repositório não contém dados pessoais nem o ID da planilha: o `dist/workflow.json` gerado com o ID real fica fora do repositório, e a credencial do Google é configurada só dentro do n8n. Os dados da pré-visualização são fictícios. Os arquivos de importação e as listas ficam fora por LGPD.
