# Nexo CLI

A CLI do [Nexo](https://nexo.winningsales.com.br) para quem desenvolve sobre a plataforma: a API pública no terminal hoje e, nas próximas versões, o Nexo Connect, os dashboards e os fluxos como arquivos no seu repositório, com a documentação e as skills do produto para a sua IA (Claude Code, Cursor, Codex).

A documentação completa fica em [docs.nexo.winningsales.com.br](https://docs.nexo.winningsales.com.br).

## Instalar

```sh
npm install -g @winning-sales-nexus/nexo
nexo --version
```

Precisa do Node 20.11 ou mais novo.

## Entrar

```sh
nexo login
```

A CLI abre o Nexo no navegador. Você entra com a sua conta, escolhe o que a CLI pode fazer e autoriza; o navegador devolve o acesso para a CLI, que fica guardado em `~/.config/nexo/credentials.json` (só o seu usuário lê) e se renova sozinho. A conexão aparece como **Nexo CLI** em Configurações › Integrações, e `nexo logout` a revoga.

Um login novo encerra o anterior da mesma pessoa. Para usar a CLI em mais de uma máquina ao mesmo tempo, num servidor sem navegador ou no CI, use um token pessoal, criado em **Configurações › Integrações › Tokens de API e MCP**:

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
nexo api context-notes -f text="Cliente pediu desconto" -F pinned=true   # POST com corpo JSON
nexo api connect/connectors --input conector.json                         # corpo de um arquivo (ou - para o stdin)
nexo logout                      # remove o perfil desta máquina
```

`-f` manda o valor como texto; `-F` entende número, `true`, `false`, `null` e JSON. Com campos e sem `-X`, o método é POST, como no `gh api`.

`--json` deixa toda saída em JSON, e o erro sai no stderr como o `problem+json` da API.

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
```

## Licença

MIT. Veja [LICENSE](LICENSE).
