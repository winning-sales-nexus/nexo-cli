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
nexo companies [busca]           # (login de plataforma) lista as empresas em que se pode agir
nexo use <empresa>               # escolhe a empresa, por id ou por um nome que case com uma só
nexo use --none                  # sai da empresa escolhida
nexo api deals                   # GET /v1/deals
nexo api deals -X GET -f limit=5 # campos viram query string no GET
nexo api crm/dashboards/catalog -X GET -f text=receita -F limit=5           # -F manda o número como número
nexo api connect/connectors --input conector.json                         # corpo de um arquivo (ou - para o stdin)
nexo logout                      # remove o perfil desta máquina
```

`-f` manda o valor como texto; `-F` entende número, `true`, `false`, `null` e JSON. Com campos e sem `-X`, o método é POST, como no `gh api`.

**Usuário da plataforma.** O admin da empresa do Nexo que roda `nexo login` entra com uma conexão de plataforma: ela não age em empresa nenhuma até a escolha. `nexo companies` lista as empresas, `nexo use <empresa>` escolhe uma (por id, ou por um nome que case com uma só; se casar com várias, lista as opções e não escolhe nenhuma) e `nexo whoami` mostra a empresa ativa. A escolha fica no servidor e vale até a troca ou `nexo use --none`; dentro da empresa, `nexo connect ...` e `nexo api ...` agem como o usuário de suporte do Nexo. Um comando que ainda esbarre em "escolha uma empresa" aponta esses dois comandos. Para qualquer outro login, `companies` e `use` respondem que não existem.

`--json` deixa toda saída em JSON, e o erro sai no stderr como o `problem+json` da API.

## A documentação e a sua IA

```sh
nexo docs search escopo connectors:hosts
nexo docs show referencia-do-manifesto
nexo skills install
nexo mcp setup --claude
```

- `nexo docs` lê a documentação do [site](https://docs.nexo.winningsales.com.br), embutida na versão da CLI, sem internet. `--online` lê a versão do ar.
- `nexo skills install` grava as skills de produto (API, Connect, painéis) no projeto, para o Claude Code (`.claude/skills`), o Cursor (`.cursor/skills`) e o Codex e outros (`AGENTS.md` com `.nexo/skills`). Sem opção, detecta o que o projeto usa; `--all` grava nos três. Rode de novo depois de atualizar a CLI.
- Com login, `nexo skills install` também traz as skills da sua empresa, área e time (as mesmas que o copiloto mostra para você), **para a sua pasta** (`~/.claude/skills`, `~/.cursor/skills` ou `~/.codex/skills`) e nunca para o projeto, onde seriam commitadas. Cada skill leva o perfil no nome da pasta (`nexo-<perfil>-<skill>`); quem usa o Cursor junto com o Claude Code recebe cada skill uma vez só, na pasta do Claude Code. A skill em teste vem marcada `em-teste` e só para quem a escreveu. O `install` é incremental: compara a versão de cada skill e só baixa e regrava a que mudou (as que não mudaram só têm a data renovada), e apaga o que saiu do seu alcance; se a rede cai no meio, a pasta fica como estava. `nexo logout` apaga as do perfil. Sem login, ou sem rede, ficam as de produto, e a CLI diz por quê.
- Com rede, `nexo skills install` e `nexo skills list` comparam o hash das skills de produto que vêm com a CLI com o do `/docs/skills/index.json` e avisam quando estão velhas: atualize a CLI (`npm install -g @winning-sales/nexo@latest`) e rode `nexo skills install` de novo. A skill de produto também orienta a sua IA a pedir esse `install` quando as skills da sua empresa tiverem mais de um dia.
- `nexo skills list` mostra o nível de cada skill (produto, empresa, área, time) e `nexo skills show <nome>` mostra uma inteira, lendo a API na hora e sem gravar nada.
- `nexo mcp setup --claude|--cursor|--codex` configura o MCP do Nexo, o do Nexo Admin e o do Nexo Connect no projeto, com o token lido de `NEXO_TOKEN`, fora do arquivo.

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

### Versões, execuções e o resultado do ensaio

```sh
nexo connect versions clientes-erp                       # número, resumo, origem, quem e quando, ensaio limpo; marca a publicada e a em edição
nexo connect diff 1 3 clientes-erp                       # o que mudou no código e no manifesto (sem <para>, até a em edição)
nexo connect restore 1 clientes-erp                      # mostra a versão, pede o sim (ou -y) e reescreve connector.ts e manifest.json
nexo connect rehearse --operation pedidos --args '{"dias":3}'   # ensaia uma operação; --args aceita @arquivo.json
nexo connect run-now clientes-erp                        # roda a versão publicada ao vivo: mostra, pede o sim (ou -y) e espera
nexo connect initial-load clientes-erp                   # a carga inicial, ao vivo; --no-wait só abre a execução
nexo connect undo <execução> clientes-erp                # prévia do Nexo; aplica depois do sim
nexo connect run <execução> --quiet                      # só o resumo
```

`restore` grava a versão antiga como uma versão nova, em edição (o que está publicado não muda) e reescreve a pasta. Se a pasta tem mudanças que não subiram, recusa sem chamar o Nexo, a não ser com `--force`. `run-now` e `initial-load` gravam no Nexo de verdade: mostram qual versão roda e que o `undo` leva de volta, e só abrem a execução depois do sim (`-y`, ou `--confirm` fora de um terminal). Um conector pausado responde `connect.not_enabled` e o comando sai com código diferente de zero.

`rehearse` e `run <id>` mostram, depois do resumo: os **logs do script** (hora, mensagem e `data` em JSON compacto), o **resultado da operação** (`output`) e **"Iriam para a quarentena (N)"** (objeto, chave, motivo e valores). Na tela os logs e o resultado são cortados em 20 linhas e a quarentena em 10 registros; `--json` traz tudo, sem corte, e `--quiet` só o resumo. Uma resposta antiga, sem esses campos, não quebra o comando.

### Registros retidos: quarentena e escritas no outro sistema

```sh
nexo connect quarantine clientes-erp                                  # os registros abertos: id, objeto, motivo, valores mascarados e execução
nexo connect quarantine fix <registro> --set cnpj=12345678000190      # mostra campo, valor de hoje e valor novo; pede o sim
nexo connect quarantine fix <registro> --file correcao.json           # o corpo do PATCH: { "values": {...}, "properties": {...} }
nexo connect quarantine discard <registro>                            # mostra o registro; pede o sim
nexo connect quarantine reprocess                                     # prévia do Nexo; aplica depois do sim
nexo connect writes clientes-erp                                      # as escritas retidas e os hosts confirmados
nexo connect writes confirm <escrita>                                 # prévia do Nexo; a escrita sai e não se desfaz
nexo connect write-hosts confirm api.erp.example.com.br               # confirma a escrita num host do manifesto
nexo connect write-hosts revoke api.erp.example.com.br                # revoga
```

Cada comando que muda algo mostra a prévia e pede o sim num terminal; `-y` aplica logo depois de mostrar. Fora de um terminal, a CLI mostra a prévia e o comando que aplica: `reprocess`, `writes confirm` e `write-hosts` com `--confirm <token>`, que vale uma vez; `fix` e `discard` (o `/v1` não tem prévia para eles, a prévia é montada pela CLI) com `--confirm`, sem token. Em `fix`, `--set campo=valor` mexe num campo nativo e `--set properties.chave=valor` numa propriedade; `true` e `false` viram booleano e o resto é texto (para outro tipo, use `--file`). Um campo fora do manifesto, ou um host que não é dele, volta como a recusa do Nexo, em português. Todos aceitam `--json`.

### A conversa com a IA do Connect

```sh
nexo connect build "ler os clientes do Omie"              # fora de uma pasta de conector: começa um conector novo
nexo connect build "traga também a cidade" clientes-erp   # numa pasta com conector: manda a mensagem na conversa dele
nexo connect build show clientes-erp                      # a conversa inteira: suas mensagens, as da IA e o que ela fez
nexo connect build fix <execução> clientes-erp            # pede a correção de uma execução que falhou
nexo connect build "..." --no-wait                        # só manda; acompanhe com build show
```

É a mesma conversa da tela do conector. `build` e `build fix` avisam numa linha (no stderr) que gastam a franquia de IA da empresa, mandam a mensagem e esperam a IA responder (até 10 minutos; passou disso, a CLI sai com código 1 e aponta `build show`). Mostram o id do conector e a vez, a resposta da IA, as versões que ela escreveu e a dica de `nexo connect pull <id> <pasta>` para trazer o código. Uma mensagem enquanto a IA ainda responde a anterior volta `connect.build_turn_in_progress`. `build fix` leva a execução inteira à IA (`-m` acrescenta um pedido) e só vale para uma execução que já terminou. Publicar a correção e reprocessar continuam com você. Todos aceitam `--json`.

## Operações de ERP: `nexo erp`

As consultas e as ações que um conector declara no manifesto (ler o estoque, incluir um pedido), para quem vende ou para um agente em nome dela. Vale a mesma regra de acesso do MCP: só aparece o que o seu perfil alcança.

```sh
nexo erp list                                                    # as operações: id, chave, tipo, conector, argumentos e guia do conector
nexo erp list estoque                                            # filtra por palavras
nexo erp query estoque_por_sku --args '{"sku":"CAD-001"}'        # roda uma consulta (--args aceita @arquivo)
nexo erp action incluir_pedido --args @pedido.json               # prévia do que seria gravado no outro sistema e o sim
nexo erp action incluir_pedido --args @pedido.json --confirm <token>
```

`<operação>` é o id (`<conector>:<chave>`) ou a chave; a chave é resolvida pela lista, e se existir em mais de um conector a CLI pede o id. `--args` é um objeto JSON e é recusado antes de chamar o Nexo se não for. Uma consulta mostra o resultado cortado em 20 linhas (`--json` traz tudo). Uma ação mostra a prévia e só aplica depois do sim num terminal; fora dele, mostra a prévia e o comando com `--confirm <token>` (vale 10 minutos e grava uma vez, com os mesmos `--args`). Não existe `-y` aqui: gravar no sistema do cliente pede o sim da pessoa. O mesmo token de novo devolve a resposta da primeira vez, avisando que nada foi gravado de novo. Erros: operação não encontrada (aponta `nexo erp list`), empresa sem o Nexo Connect no plano, e ERP fora do ar (diz que é o outro sistema, não o Nexo).

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
- **Questionário.** `questionnaire` imprime os blocos e os campos, cada um com o valor que o Nexo já sabe, a fonte e o que falta. Ler as calls e o WhatsApp do negócio usa a IA e conta no limite da empresa: `--no-reading` traz só o cadastro. Com `-o respostas.json`, grava o arquivo de respostas: edite o `text` de cada resposta (o `path` é o endereço do campo; o resto é só para ler). Num contrato, ponha ou tire um item de um grupo em `groups`, como `{ "group": "testemunhas", "action": "add" }` ou `{ "group": "testemunhas", "action": "remove", "item": 2 }` (a posição conta a partir de 1; sem `item`, sai o último), e responda os campos dele pelo `path` (`testemunhas.2.nome`).
- **Escrita.** `create` manda as respostas, pede a escrita ao Nexo e espera a versão ficar pronta, mostrando a situação; `--no-wait` devolve os ids na hora e `nexo documents get <documento>` acompanha. O negócio e o modelo vêm do arquivo de respostas, ou de `--deal` e `--template`. Só segue para o Nexo a resposta que difere do que ele já preenche sozinho. Resposta obrigatória faltando, ou que não cabe no tipo do campo, sai com a lista e código de saída 1, e nada é escrito. Com `--document arquivo.html`, você manda o documento já escrito: o Nexo limpa o HTML e confere valores, datas e prazos contra as respostas, sem rodar a IA; reprovado, a CLI mostra o que não bateu e nada é guardado. No contrato, `--adaptations arquivo.json` leva a lista do que foi tirado ou adaptado em relação ao modelo (`kind`: `removed`, `adapted` ou `requested`; `clause`; `note`). Sem limite de IA no ciclo da empresa, a escrita pelo Nexo responde 429 e nada é escrito; mandar o documento já escrito com `--document` não usa a IA.
- **Versões.** `revise` pede uma versão nova com o pedido como você diria, e a anterior fica no histórico. Para mudar uma resposta, gere o arquivo com `questionnaire --revising <documento> -o respostas.json` e mande com `revise <documento> --answers respostas.json`; `revise <documento> --document arquivo.html` manda a versão nova já escrita. Um documento só escreve uma versão por vez: com outra ainda saindo, a API responde 409. Uma versão que não passa na conferência não sai: a CLI mostra o que não bateu e sai com código 1.
- **Saídas.** `accept` aceita a versão da proposta, que deixa de ser rascunho (o contrato não tem este passo). `pdf` e `docx` baixam o arquivo da versão; o DOCX é só do contrato. `--version-number <n>` escolhe outra versão que não a atual.
- **Negociação.** `negotiate` mostra quem vai receber o e-mail com o link e pede o sim; fora de um terminal, só envia com `--yes`. `--person` se repete, até 10 pessoas, e `--approver` diz quem dá o de acordo que encerra a negociação.

O token precisa de `context:read` para ler e para baixar o PDF e o DOCX, `conversations:read` para o questionário e `deals:write` para enviar modelo, escrever, aceitar e negociar. Vale a visibilidade do app: o vendedor vê os negócios dele e os documentos que criou.

## A análise do negócio e os artefatos

```sh
nexo deals analysis <negócio>                        # gera (ou atualiza) a análise e mostra o link para abrir e o aiState
nexo deals analysis <negócio> --brief "o que trava o fechamento"
nexo artifacts list --deal <negócio> --kind analysis # os artefatos do negócio, com a versão atual
nexo artifacts get <artefato>                        # o artefato com as versões
nexo artifacts get <artefato> --version-number 2     # uma versão, com o link para abrir (a análise fica num arquivo)
```

`deals analysis` cria a análise na primeira vez e uma versão nova a cada pedido; o `aiState` diz como a IA terminou (`written`, ou `fallback_*` quando a página saiu só com os números do Nexo; nesse caso, e se já havia uma versão com a leitura da IA, nada é gravado e a CLI avisa). O link `view` abre a página no navegador e vale 5 minutos. Dá 404 para o negócio que você não vê, 403 se o seu Editar de Negócios não alcança o dono e 409 se já há uma análise sendo gerada. `artifacts` só lê. A pessoa só vê o que a regra de Documentos deixa. O token precisa de `dashboards:write` para gerar e de `context:read` para listar e ler. Também atendem por `nexo negocios analise` e `nexo artefatos`. (`--version-number` e não `--version`, que é a versão da CLI.)

## Cérebro: skills por ideia e por item

```sh
nexo brain areas                              # as áreas da empresa (o id vai em --area)
nexo brain moments                            # os momentos que aceitam skill nova
nexo brain list area --scope <área>           # as skills de um nível (area, team, company ou person; a pessoal é só sua)
nexo brain create area --area <área> --objective "Follow-up curto" --moment follow_up_draft \
  --always "citar o último passo" --always "propor uma data" --never "prometer desconto" --example "Oi, Ana..."
nexo brain create company --objective ... --moment ... --never ... --example ...    # empresa: sem --area/--team
nexo brain create team --team <time> ...
nexo brain edit area <skill> --add-always "propor uma data" --update-never "prometer desconto => prometer prazo" --remove-always "..."
nexo brain edit company <skill> --remove-never "..." --confirm-shrink
nexo brain remove team <skill> --yes          # vale para company, area, team e person
nexo brain create person --objective ... --moment ... --always ... --example ...   # skill pessoal, pela ideia
nexo brain templates                          # os modelos da Winning para skill pessoal
nexo brain from-template <modelo> --answer "campo=texto" --answer "outro=texto"
nexo brain blind-test <skill-pessoal>         # dois textos A e B, sem dizer qual tem a skill
nexo brain choose <comparação> a              # a escolha às cegas; só então mostra qual tinha a skill
```

Ninguém envia o texto da skill: a CLI só manda a **ideia** (objetivo, momento da lista, o que fazer sempre, o que nunca fazer, um exemplo) e o Cérebro escreve o `SKILL.md`. Não há opção para nome, descrição nem corpo. A skill nasce em teste e só liga depois do teste "não piora" e da escolha às cegas. `edit` muda um item por vez (`--add-*`, `--update-*` com `"atual => novo"`, `--remove-*`, em `always` ou `never`) e nenhuma outra linha muda; a edição que tira item ou encolhe a skill em mais de 30% volta 409 e só passa com `--confirm-shrink`, depois do sim da pessoa. Os erros da API (hierarquia, texto recusado, nome repetido, falta de permissão) aparecem com a explicação. Só admin, com o escopo `calibration:write` para escrever. Atende também por `nexo cerebro`. A API pública cobre empresa (criar e editar), área e time; a skill pessoal e a biblioteca de modelos da Winning ainda não têm rota no `/v1`.

## Modelos de mensagem e o e-mail com a marca

```sh
nexo templates list --channel email           # os modelos, com o canal, o estado e a versão
nexo templates get <modelo>                   # o formato (com a marca, antigo ou texto simples) e as regras que usam; --json traz os blocos
nexo templates preview <modelo> --html email.html   # a prévia do editor, com amostras fixas
nexo templates structure --template <modelo> --out estruturado.json   # um modelo antigo na estrutura nova; nada é gravado
nexo templates create --channel email --name "Boas-vindas" --subject "Olá, {{contato_nome}}" --blocks blocos.json
nexo templates change <modelo> --blocks blocos.json
nexo templates publish <modelo>
```

Os modelos são os do app, nos dois canais. O e-mail é um documento de blocos com a identidade visual da empresa (logo, cores, fonte), e a IA que escreve os blocos usa só **nomes** de cor (`marca`, `marca-escura`, `suave`, `texto`, `apoio`, `branco`), nunca hex, CSS nem a URL do logo: o Nexo troca pelos valores reais, garante o cabeçalho, o logo e o contraste e grava tudo no modelo. Os blocos vão em `--blocks` (a lista completa, de um arquivo ou `-` para o stdin) ou no `--input` (o pedido inteiro em JSON); as opções valem mais que o arquivo. `--no-structure` só quando a pessoa pede o e-mail sem logo, faixas nem cabeçalho.

- **Escrever é em dois passos.** `create`, `change` e `publish` pedem a prévia ao Nexo, mostram o cartão (o que sai e o que entra, o assunto e o aviso do que falta na marca, com o lugar de cadastrar) e só gravam depois do sim, mandando o token de confirmação da prévia. Fora de um terminal, só gravam com `--yes`, depois do sim da pessoa. `--html arquivo` guarda o HTML da prévia. Criar e mudar só gravam o rascunho; `publish` deixa o modelo pronto e, no WhatsApp, envia à Meta.
- **Recusa do compositor.** Hex escrito à mão, contraste baixo, imagem sem https, seção dentro de seção dentro de seção ou mais de dois botões voltam com o motivo (422); nada é gravado. Corrija os blocos e rode de novo. Se o modelo mudar depois da prévia, a API responde 409: rode o comando de novo.
- **Modelo antigo.** `get` diz o formato. `structure` mostra o modelo antigo na estrutura nova, sem gravar; para gravar, mande o conteúdo com `change`.
- **Identidade visual.** O resultado diz se a identidade é completa, parcial ou ausente, o que falta (`logo`, `cores`) e onde cadastrar.

O token precisa de `automations:read` para ler, prever e estruturar, e de `automations:write` para criar, mudar e publicar (admin ou líder de vendas, com o módulo Automações no plano). Também atende por `nexo modelos`. A skill `nexo-automations` traz as diretrizes de estilo do e-mail.

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
npm run docs:sync          # atualiza a documentação, os arquivos do Connect e as skills embutidas
```

As skills de `assets/skills/` vêm do nexu-api, a mesma fonte do comportamento do copiloto e do MCP (`packages/comportamento-nexo/cli-skills/`), servidas em `https://mcp-nexo.winningsales.com.br/docs/skills/`. Mude a skill lá; aqui, `npm run docs:sync` traz a versão nova e apaga a que saiu do índice.

### Publicar uma versão

Suba a versão num PR (`npm version minor --no-git-tag-version`, ou `patch` para correção). Quando o PR entra na `main`, o workflow `release` vê que a versão ainda não está no npm, roda as checagens, publica com proveniência pelo Trusted Publisher do npm (sem token), e cria a tag `v<versão>` e o release no GitHub. Sem mudança de versão, ele não faz nada.

O pacote publicado leva `reference.json`, a árvore de comandos que o `prepublishOnly` gera. O site de docs lê a referência e o README da versão `latest` do npm. Depois de publicar, o `release` dispara a sincronização do site, se o secret `NEXU_DOCS_DISPATCH_TOKEN` existir; sem ele, o site pega a versão nova na sincronização diária.

## Licença

MIT. Veja [LICENSE](LICENSE).
