---
name: nexo-dashboards
description: Como montar e mudar painéis (dashboards) do Nexo pela API — catálogo de dados, consultas, fórmulas entre séries, metas, variáveis de filtro, prévia e salvamento versionado. Use sempre que a tarefa for criar ou editar um painel, uma aba, um gráfico ou um filtro do Nexo, ler os números de um relatório salvo, ou criar alertas e links públicos de painel.
---

# Painéis do Nexo

Um painel tem abas, seções e relatórios (gráficos). **Nenhum número sai de você**: você escreve a especificação, o servidor confere contra o catálogo da empresa e roda a consulta. A leitura pede `context:read`; mudar pede `dashboards:write`. Tudo fica em `/v1/crm/dashboards`.

## O fluxo

1. **Catálogo primeiro.** `nexo api crm/dashboards/catalog -X GET -f text=<termo> --json`. Use só fontes, campos e medidas que o catálogo devolve; o campo de uma fonte ligada é `ligacao.campo` (`owner.name`, `deal.pipelineId`). Se a medida pedida não existe, diga "não há a medida X" e não invente.
2. **Painel atual.** `nexo api crm/dashboards --json` e `nexo api crm/dashboards/<id> --json`.
3. **Prévia.** `nexo api crm/dashboards/preview --input mudanca.json` com `dashboardId` (sem ele, cria um painel), `summary` e `operations`: `set_panel`, `add_tab`, `rename_tab`, `set_tab_variables`, `remove_tab`, `add_section`, `change_section`, `remove_section`, `add_report`, `change_report`, `remove_report`, `set_tab_audience`, `set_report_audience`. O que você não cita fica como estava. Se vier `dashboards.spec_invalid`, corrija pelo `problems` e mande de novo.
4. **Mostre a prévia e espere o sim.** Depois: `nexo api crm/dashboards/proposals/<proposalId>/save -X POST`. Repetir o sim não grava outra versão. Proposta vale 2 horas; `dashboards.proposal_conflict` (409) quer dizer que o painel mudou no que você editou: leia de novo e refaça.
5. Errou? `nexo api crm/dashboards/<id>/versions/<seq>/restore -X POST` cria uma versão nova igual à antiga (o painel guarda 30).

## A especificação de um relatório

- De 1 a 4 consultas de dados (`queries`, chaves `A`, `B`…), cada uma com fonte, medidas, filtros e período próprios. Elas se juntam pelo primeiro agrupamento, que tem de ser o mesmo balde de tempo ou a mesma categoria em todas.
- **Fórmula** é uma entrada `{ key, expression }` sem fonte: `A / B * 100`, `(A - B) / B * 100`, `A / A[1]`. Só números, `+ - * /`, parênteses e chaves de consulta (letras, dígitos e `_`). Divisão por zero e lacuna dão `null`, nunca zero.
- **Apresentação** por série em `presentation.series`: rótulo, cor, `unit`, `decimals`, `style` (`line`, `bar`, `area`), eixo `left`/`right`. No máximo dois eixos Y, uma unidade por eixo, e 20 séries por relatório. Percentual de 0 a 100 usa `unit: 'percent'`.
- **Meta** em `presentation.target`: `fixed` (valor na unidade da série, dinheiro em centavos) ou `goal` (as metas de receita do Nexo, por tempo, por dono ou no total). O tipo `progress` exige meta.
- **Variáveis** (filtros) no painel e em cada aba, até 10 por lista; a da aba vence a do painel no mesmo campo quando tem valor. Um filtro só age nos relatórios cuja fonte tem aquele campo. Não acrescente filtro que a pessoa não pediu: ofereça em uma linha.

## Outras operações

- Números de um relatório salvo: `nexo api crm/dashboards/<id>/reports/<reportId>/run -X POST`.
- Valores possíveis de um filtro: `nexo api crm/dashboards/variables/options --input valores.json`.
- Alertas (`.../<id>/alerts`) e links públicos (`.../<id>/public-links`, só administrador) mudam o que outras pessoas recebem: confirme com a pessoa antes.
- Apagar um painel não tem volta pela API: confirme antes de `nexo api crm/dashboards/<id> -X DELETE`.

Os campos exatos de cada operação estão no OpenAPI (`/v1/openapi.json`, `POST /v1/crm/dashboards/preview`) e em `nexo docs search painel`.
