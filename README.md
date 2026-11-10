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

## Propostas e contratos

```sh
nexo documents templates --agent proposal
nexo documents templates add modelo.pptx --agent proposal
nexo documents questionnaire --agent proposal --deal <negócio> --template <modelo> -o respostas.json
nexo documents create --answers respostas.json
nexo documents revise <documento> --request "deixa mais direto"
nexo documents accept <documento>
nexo documents pdf <documento> -o proposta.pdf
nexo documents negotiate <documento> --person "Renata Lima <renata@cliente.com.br>" --approver renata@cliente.com.br
```

A jornada da proposta e do contrato, a mesma do app: o modelo, o questionário, o documento escrito, as versões e as saídas. `--agent` é `proposal` ou `contract`. Também atende por `nexo documentos`.

- **Modelos.** `templates` lista os que você pode usar; `templates add <arquivo>` envia outro (proposta: PDF, PPTX, DOCX ou HTML; contrato: DOCX, PDF ou HTML) e espera o Nexo ler; `templates download <modelo>` baixa o arquivo de origem. Sem modelo nenhum, é preciso enviar um.
- **Questionário.** `questionnaire` imprime os blocos e os campos, cada um com o valor que o Nexo já sabe, a fonte e o que falta. Ler as calls e o WhatsApp do negócio usa a IA e conta no limite da empresa: `--no-reading` traz só o cadastro. Com `-o respostas.json`, grava o arquivo de respostas: edite o `text` de cada resposta (o `path` é o endereço do campo; o resto é só para ler). Num contrato, ponha ou tire um item de um grupo em `groups`, como `{ "group": "testemunhas", "action": "add" }`, e responda os campos dele pelo `path` (`testemunhas.2.nome`).
- **Escrita.** `create` manda as respostas, pede a escrita ao Nexo e espera a versão ficar pronta, mostrando a situação; `--no-wait` devolve os ids na hora e `nexo documents get <documento>` acompanha. O negócio e o modelo vêm do arquivo de respostas, ou de `--deal` e `--template`. Só segue para o Nexo a resposta que difere do que ele já preenche sozinho. Resposta obrigatória faltando, ou que não cabe no tipo do campo, sai com a lista e código de saída 1, e nada é escrito. Com `--document arquivo.html`, você manda o documento já escrito: o Nexo limpa o HTML e confere valores, datas e prazos contra as respostas, sem rodar a IA; no contrato, `--adaptations arquivo.json` leva a lista do que foi tirado ou adaptado em relação ao modelo.
- **Versões.** `revise` pede uma versão nova com o pedido como você diria, e a anterior fica no histórico. Para mudar uma resposta, gere o arquivo com `questionnaire --revising <documento> -o respostas.json` e mande com `revise <documento> --answers respostas.json`. Uma versão que não passa na conferência não sai: a CLI mostra o que não bateu e sai com código 1.
- **Saídas.** `accept` aceita a versão da proposta, que deixa de ser rascunho (o contrato não tem este passo). `pdf` e `docx` baixam o arquivo da versão; o DOCX é só do contrato. `--version-number <n>` escolhe outra versão que não a atual.
- **Negociação.** `negotiate` mostra quem vai receber o e-mail com o link e pede o sim; fora de um terminal, só envia com `--yes`. `--person` se repete, até 10 pessoas, e `--approver` diz quem dá o de acordo que encerra a negociação.

O token precisa de `context:read` para ler, `conversations:read` para o questionário e `deals:write` para enviar modelo, escrever, aceitar e negociar. Vale a visibilidade do app: o vendedor vê os negócios dele e os documentos que criou.

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
