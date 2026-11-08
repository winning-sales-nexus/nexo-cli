# Nexo CLI

A CLI do [Nexo](https://nexo.winningsales.com.br) para quem desenvolve sobre a plataforma: a API pública no terminal, o Nexo Connect e os painéis como arquivos no seu repositório, e a documentação e as skills do produto para a sua IA (Claude Code, Cursor, Codex).

A documentação completa fica em [docs.nexo.winningsales.com.br](https://docs.nexo.winningsales.com.br).

## Instalar

```sh
npm install -g @winning-sales/nexo
nexo --version
```

Precisa do Node 20.11 ou mais novo.

## Entrar

```sh
nexo login
```

A CLI abre o Nexo no navegador. Você entra com a sua conta, escolhe o que a CLI pode fazer e autoriza; o navegador devolve o acesso para a CLI, que fica guardado em `~/.config/nexo/credentials.json` (só o seu usuário lê) e se renova sozinho. A conexão aparece como **Nexo CLI** em Configurações › Conexões › IA e API, e `nexo logout` a revoga.

Um login novo encerra o anterior da mesma pessoa. Para usar a CLI em mais de uma máquina ao mesmo tempo, num servidor sem navegador ou no CI, use um token pessoal, criado em **Configurações › Conexões › IA e API**:

```sh
nexo login --token                  # cola o token, sem mostrá-lo na tela
nexo login --with-token < token.txt # lê do stdin
NEXO_TOKEN=nexo_pat_... nexo whoami # sem login, pelo ambiente
```

| Opção                  | O que faz                                                   |
| ---------------------- | ----------------------------------------------------------- |
| `--scopes a,b`         | pede só esses escopos no navegador (padrão: os do Nexo)     |
| `--no-browser`         | só mostra o endereço para você abrir                        |
| `--env dev`            | entra no ambiente de desenvolvimento do Nexo                |
| `--api-url <url>`      | entra numa API em outro endereço (só https fora da máquina) |
| `-p, --profile <nome>` | guarda e usa mais de um login, um por perfil                |

## Comandos

```sh
nexo whoami                      # quem está conectado, empresa, escopos e validade
nexo api deals                   # GET /v1/deals
nexo api deals -X GET -f limit=5 # campos viram query string no GET
nexo api crm/dashboards/catalog -X GET -f text=receita -F limit=5           # -F manda o número como número
nexo api connect/connectors --input conector.json                         # corpo de um arquivo (ou - para o stdin)
nexo logout                      # remove o perfil desta máquina
```

`-f` manda o valor como texto; `-F` entende número, `true`, `false`, `null` e JSON. Com campos e sem `-X`, o método é POST, como no `gh api`.

`--json` deixa toda saída em JSON, e o erro sai no stderr como o `problem+json` da API.

## A documentação e a sua IA

```sh
nexo docs search escopo connectors:hosts
nexo docs show referencia-do-manifesto
nexo skills install
nexo mcp setup --claude
```

- `nexo docs` lê a documentação do [site](https://docs.nexo.winningsales.com.br), embutida na versão da CLI, sem internet. `--online` lê a versão do ar.
- `nexo skills install` grava as regras do Nexo (API, Connect, painéis) no projeto, para o Claude Code (`.claude/skills`), o Cursor (`.cursor/rules`) e o Codex e outros (`AGENTS.md` com `.nexo/skills`). Sem opção, detecta o que o projeto usa; `--all` grava nos três. Rode de novo depois de atualizar a CLI.
- `nexo mcp setup --claude|--cursor|--codex` configura o MCP do Nexo e o do Nexo Connect no projeto, com o token lido de `NEXO_TOKEN`, fora do arquivo.

## Nexo Connect como código

```sh
nexo connect systems --category erp
nexo connect init clientes-erp --system omie
nexo connect push clientes-erp -m "primeira versão"
nexo connect secrets set OMIE_APP_KEY clientes-erp
nexo connect rehearse clientes-erp
nexo connect publish clientes-erp
nexo connect enable clientes-erp
```

O conector vive numa pasta do seu repositório: `connector.ts`, `manifest.json`, os tipos do SDK (`connect-sdk.d.ts`) para checar com `tsc`, e `nexo-connector.json` com o id e a versão de onde a pasta partiu. `pull` baixa um conector que já existe; `status`, `runs` e `run <id>` mostram o estado e as execuções.

Publicar, ligar e pausar mostram a prévia e pedem o sim. Fora de um terminal (numa IA ou num script), a CLI mostra a prévia e o comando para aplicar com `--confirm <token>`, que vale uma vez. O valor de um segredo só é digitado por uma pessoa num terminal (ou por `--stdin`, num script) e nunca volta pela API.

## As automações

```sh
nexo automations catalog
nexo automations entities lead
nexo automations init boas-vindas --name "Boas-vindas ao negócio novo"
nexo automations push boas-vindas -m "primeira versão"
nexo automations publish boas-vindas
nexo automations runs boas-vindas --state failed
nexo automations events lead <registro>
```

A regra vive em `automation.json` (nome, reentrada e o documento com os passos e as ligações). `push` cria a automação ou salva o rascunho, sem mudar o que está no ar, e mostra todos os problemas que impedem publicar. `publish` mostra o que vai ao ar e pede o sim; fora de um terminal, só publica com `--yes`. Também atende por `nexo flows`.

Os gatilhos genéricos (`entidade.criada`, `entidade.alterada`, `entidade.apagada`) escutam qualquer entidade: `nexo automations entities` mostra as entidades e os campos, e `nexo automations events lead <registro>` mostra o que o Nexo guardou do registro (operação, nomes dos campos que mudaram, origem e despacho) para depurar uma regra que não disparou. Uma alteração segura uma janela de 24 h: as seguintes do mesmo registro não disparam de novo, e a prévia do `publish` e o `runs` mostram isso. `get`, `versions` e `restore` completam o ciclo.

Por enquanto, os escopos de automação só existem no token pessoal (`nexo login --token`).

## Painéis como código

```sh
nexo dashboards catalog --text receita
nexo dashboards pull <id> comercial
nexo dashboards push comercial -m "gráfico de receita por vendedor"
nexo dashboards run <relatório> comercial
```

O painel vive em `dashboard.json`: o painel, as abas, as seções e os relatórios (consultas, apresentação, posição na grade e quem vê). `push` compara a pasta com o painel no Nexo, manda só o que mudou e mostra a prévia, com cada relatório já conferido e rodado pelo servidor. Salva depois do sim; fora de um terminal, mostra o `nexo dashboards save <prévia>` para rodar depois do sim. Depois de salvar, a pasta passa a usar os ids do Nexo. Também atende por `nexo paineis`.

## Plano e cobrança

```sh
nexo billing                       # plano, assentos, próximo pagamento, situação e cartão
nexo billing invoices              # as faturas, da mais nova para a mais antiga
nexo billing invoices <id>         # uma fatura com as linhas
```

Só leitura, em reais, e só para administrador da empresa: o token precisa do escopo `billing:read`. Mudar a quantidade de assentos continua sendo da plataforma. Também atende por `nexo cobranca`. `--json` imprime a resposta da API como veio.

## Códigos de saída

| Código | Quando                                             |
| ------ | -------------------------------------------------- |
| 0      | deu certo                                          |
| 1      | falha (rede, resposta inesperada, erro da API)     |
| 2      | uso errado (opção, campo, token malformado)        |
| 3      | sem login, ou token inválido, expirado ou revogado |
| 4      | o token ou o perfil não liberam a operação         |
| 5      | não encontrado                                     |
| 6      | limite de chamadas da empresa atingido             |

## Desenvolvimento

```sh
npm ci
npm run dev -- whoami      # roda direto do código
npm run check              # formato, lint, tipos e testes
npm run openapi:sync       # regenera os tipos do /v1 a partir da API de produção
npm run docs:sync          # atualiza a documentação e os arquivos do Connect embutidos
```

### Publicar uma versão

Suba a versão num PR (`npm version minor --no-git-tag-version`, ou `patch` para correção). Quando o PR entra na `main`, o workflow `release` vê que a versão ainda não está no npm, roda as checagens, publica com proveniência pelo Trusted Publisher do npm (sem token), e cria a tag `v<versão>` e o release no GitHub. Sem mudança de versão, ele não faz nada.

O pacote publicado leva `reference.json`, a árvore de comandos que o `prepublishOnly` gera. O site de docs lê a referência e o README da versão `latest` do npm. Depois de publicar, o `release` dispara a sincronização do site, se o secret `NEXU_DOCS_DISPATCH_TOKEN` existir; sem ele, o site pega a versão nova na sincronização diária.

## Licença

MIT. Veja [LICENSE](LICENSE).
