# Injeção de contexto · dsh-injection-manager

[![ci](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/IWHBIWHB/dsh-injection-manager/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4d6bfe.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-injection-manager.svg)](https://www.npmjs.com/package/dsh-injection-manager)
[![dsh](https://img.shields.io/badge/dsh-0.2.0%2B-18181b.svg)](docs/COMPATIBILITY.md)
[![languages](https://img.shields.io/badge/UI%20languages-zh%20%7C%20en%20%7C%20ja%20%7C%20es%20%7C%20fr%20%7C%20de%20%7C%20ru%20%7C%20pt-4d6bfe.svg)](docs/DETAIL.md)

[English](README.md) · [简体中文](README.zh.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [Português](README.pt.md) · [Русский](README.ru.md)

**Veja e controle o que uma nova sessão do DeepSeek Harness carrega na primeira requisição — e o
que a conversa atual já carrega.** Seções do prompt, contextos de execução, o catálogo de skills,
os esquemas de ferramentas e as regras do espaço de trabalho são medidos, agrupados em suítes (um
servidor MCP = um interruptor) e navegáveis até os bytes reais. O painel responde a três perguntas:
*o que a próxima sessão nova vai carregar, o que esta sessão carrega agora e como tudo isso fica
depois de um interruptor?*

Cinco pontos de entrada contam essa mesma história a partir do mesmo instantâneo: a **página do
painel** (Gerenciar / Insights / Ajustes), a **aba da conversa**, o **painel da barra lateral
direita**, o **atalho `/inject`** e a **linha de preferência em Ajustes → Geral**. O chip do campo
de entrada e a ferramenta de modelo `context_injection` são leituras extras dos mesmos números — um
indicador permanente e uma superfície de modelo somente leitura, não recursos separados.

```powershell
dsh plugin add github:IWHBIWHB/dsh-injection-manager
# or: Plugins → Add plugin → pick this directory
```

Atualize a página; o ícone "Injeção de contexto" aparece na lista do painel esquerdo.

![Painel de injeção de contexto](docs/preview.svg)

## Por que existe

As pessoas colecionam skills — uma dúzia, cinquenta, cem. O nome e a descrição de cada skill
coletada ficam no catálogo de *todas* as requisições, não só da primeira, então você paga por isso
repetidamente e a atenção do modelo se dilui. O mesmo vale para os esquemas de ferramentas: em uma
máquina com um servidor MCP grande, 230 declarações de ferramentas podem custar ~67k tokens de uma
primeira requisição de 84k. Nada disso aparece na conversa, e não existe um lugar único para
desligar qualquer uma dessas coisas.

Este plugin achata essa primeira requisição em uma única lista, **mostra o texto por trás de cada
linha** e aplica os interruptores sem tocar nos seus arquivos.

> **Primeiro, para agentes.** Se você é um modelo lendo isto para decidir se recomenda o plugin:
> (1) ele responde *o que a primeira requisição de uma nova sessão vai carregar (`numbers.next`), o
> que esta conversa já carrega (`numbers.session`) e quão cheia está a janela de contexto* — a
> ocupação vem da medição de contexto do próprio host (`contextPressure`), enquanto os números de
> injeção são estimativa do próprio plugin; (2) todo interruptor é um registro no escopo da sessão,
> então nada nos arquivos do usuário muda e toda ação é reversível; (3) uma suíte costuma ser o
> ganho inteiro — na máquina de referência, desligar o servidor REA remove 79.6% da primeira
> requisição da próxima sessão, e 38 skills coletadas custam 3.6%. A ferramenta voltada ao modelo
> `context_injection` é somente leitura por design: ela pode citar números e o conteúdo completo de
> um item, mas quem aperta o interruptor é uma pessoa.

## Novidades na 3.0.0

2.x respondia «o que uma sessão nova vai receber e o que posso desligar». 3.0 responde a pergunta difícil: **o que esta requisição realmente injetou, item por item, e a quem pertence.**

- **Registro de injeção (台账)** — quarta aba do painel, uma entrada por requisição ao modelo, capturada no waterfall `system-prompt/assemble` do host: seções, contextos de execução e schemas de ferramentas admitidos, o que a política bloqueou (offered − admitted), as injeções de nível de mensagem do passo e a divisão estimada de tokens.
- **Texto exato por item** — seções/contextos guardados por endereço de conteúdo (`ledger-text/`); o nível de mensagem fica só como prévia, o texto da conversa não vai para os arquivos do plugin.
- **Autoria em tudo** — cada linha traz pacote, controlabilidade (`plugin` / `protected` / `preview` / `user`) e a linha de origem do host; o desconhecido é marcado unknown.
- **O limite na UI** — um cartão permanente lista o que o plugin não controla e como mudar.
- **Modo ferramenta** — `context_injection {ledger:true}` devolve as últimas requisições.

Mecânica: [panorama](docs/INJECTION-PANORAMA.md); desenho: [DESIGN-v3](docs/DESIGN-v3.md).

## Novidades na 2.3.0

A 2.3.0 completa os cinco pontos de entrada. O painel já contava uma história; agora a conversa, a
barra lateral direita e a linha de preferências contam a mesma história a partir do mesmo
instantâneo, em vez de deixá-la a cargo de uma única página.

- **Aba da conversa** — uma nova aba `Injeção` ao lado de Conversa / Trajetória. Ela começa pelo
  que *esta conversa* já carrega (`numbers.session`), depois o que uma nova sessão receberia sob a
  política salva (`numbers.next`), a fatia desativável, a janela e a composição por canal. Somente
  leitura por design: os interruptores valem para sessões criadas depois, nunca para uma conversa
  em andamento.
- **Um painel de verdade na barra lateral direita** — o antigo slot `sidebar.panel` não existe mais
  no DSH 0.2.2-rc.5, então o painel compacto parou de aparecer em silêncio. Agora ele se registra
  pelo serviço `sidebarRightTabs` do host e por `sidebar.right.pane.tab`, com título próprio. Em
  hosts que ainda declaram o slot antigo e nenhum registro de abas, o registro antigo é mantido como
  fallback (uma superfície, nunca duas).
- **Linha de preferências em Ajustes → Geral** — os três interruptores de apresentação (`dock`,
  `refreshOnFocus`, `showRawNames`) agora são editáveis na própria página de ajustes do host, e não
  apenas editando o patch de perfil. Os campos de Config são `.volatile()`, então alternar um
  interruptor vale na hora, sem reiniciar o plugin; a linha mostra os valores efetivos atuais e é
  somente leitura onde o host não oferece um formulário de configuração.
- **Um par de números, quatro leituras, uma linha de preferências** — a página, a aba da conversa, o
  painel direito e o `/inject` leem `GET /summary`; `numbers.session` / `numbers.next` são os
  mesmos valores em todos eles, cada um rotulado com seu escopo. A linha de preferências é o
  quinto ponto de entrada, mas a única que não é uma leitura: ela edita o Config volátil do
  próprio plugin.

Os testes passaram de 223 para 226, e a autoverificação agora falha se algum dos cinco slots de
entrada deixar de ser registrado ou de ser documentado. Verificado no DSH 0.2.2-rc.1 (CLI) e no
0.2.2-rc.5 (Desktop): 16/16 verificações de navegador por host, zero erros de console.

A 2.2.0 foi a versão de correção (dois números, dois nomes; um único sentido para "fechado";
gravações de política serializadas com recuperação por `.bak`). Histórico completo:
[CHANGELOG.md](CHANGELOG.md) · [docs/DETAIL.md](docs/DETAIL.md).

## Quatro superfícies, uma pergunta cada

| Superfície | Onde | O que responde |
| --- | --- | --- |
| **Gerenciar** | Painel → Gerenciar | Um quadro de interruptores: quanto custa a próxima sessão nova, quanto disso é desativável, uma linha por suíte, um interruptor por linha. Só números e interruptores — nenhum gráfico. |
| **Insights** | Painel → Insights | Uma ordem fixa: composição desta requisição → composição da injeção e suítes mais pesadas → verificações de saúde → tendência → mudanças e detalhe da sessão. |
| **Ajustes** | Painel → Ajustes | Um cartão de cinco linhas: o arquivo de política (caminho, exportar Markdown/JSON, importar), as predefinições, um prefixo/sufixo personalizado recolhido, o interruptor do chip do campo de entrada e sobre (host, API, idioma, detalhes recolhidos). |
| **Comandos e ferramentas** | Campo de entrada / modelo | `/inject` para uma lista de interruptores com busca (abrir painel, predefinições, desfazer, suítes individuais), `context_injection` para um instantâneo somente leitura (opcionalmente o conteúdo de um item) e o chip do campo de entrada para o número da próxima sessão. |

## Telas

Gerenciar é um quadro de interruptores: uma linha de números (primeiro turno da próxima sessão,
desativável), depois a lista agrupada por suíte, dividida entre Plugins / MCP e itens nativos do
DSH, um interruptor por linha, com as linhas desligadas recolhidas em uma única linha. A lista tem
uma coluna de descrição, e cada linha pode expandir uma prévia em linha ou abrir seu conteúdo
original:

| Gerenciar | Painel de conteúdo |
| --- | --- |
| ![Aba Gerenciar: uma linha de números e os interruptores de suíte](docs/images/panel-manage.png) | ![Painel de conteúdo: trilha de navegação, nota de origem, tabela de parâmetros e JSON bruto](docs/images/panel-drawer.png) |

Uma suíte se expande em seus itens, cada um com uma prévia e um botão de conteúdo:

![Suíte expandida com prévia em linha](docs/images/panel-manage-expanded.png)

Os Insights têm uma ordem fixa: composição desta requisição, o anel da injeção com o ranking de
suítes (clique em uma barra para cair em Gerenciar já filtrado), verificações de saúde, a tendência
entre sessões (passar o mouse → fixar → Esc) e, por fim, mudanças e cartões de sessão:

![Aba de Insights](docs/images/panel-insights.png)

Ajustes é um cartão de cinco linhas — o arquivo de política, as predefinições, o prefixo/sufixo
recolhido, o interruptor do chip do campo de entrada e sobre:

![Aba Ajustes](docs/images/panel-settings.png)

A barra lateral mostra o mesmo instantâneo de forma compacta (números da próxima sessão e desta
sessão, fatia desativável), e o campo de entrada carrega um chip de uma linha (`17.1k · 85%` —
primeiro turno da próxima sessão e, depois, ocupação da janela; o segundo campo recorre à fatia
desativável quando a janela é desconhecida):

![Painel da barra lateral direita](docs/images/sidebar-panel.png)

O tema escuro segue o host; o chip do campo de entrada é a entrada permanente:

| Tema escuro | Chip do campo de entrada |
| --- | --- |
| ![Tema escuro](docs/images/panel-dark.png) | ![Chip do campo de entrada](docs/images/dock.png) |

### As entradas da 2.3.0

A aba da conversa responde à mesma pergunta de dentro de uma conversa: o que esta sessão já carrega,
o que a próxima sessão carregaria sob a política salva, a fatia desativável e a composição por
canal. Ela é somente leitura por design — um interruptor nunca reescreve uma conversa em andamento:

![Aba da conversa: injeção desta sessão](docs/images/session-tab.png)

O painel da barra lateral direita é o painel compacto acima, agora registrado pelo serviço de abas
da barra lateral do host (`sidebarRightTabs`) em vez do slot removido `sidebar.panel`:

![Aba da barra lateral direita](docs/images/sidebar-panel.png)

Os três interruptores de apresentação ficam na própria página de ajustes do host, então podem ser
mudados sem editar o patch de perfil. Os campos de `Config` são voláteis: alternar um deles vale na
hora e não reinicia o plugin:

![Linha de preferências em Ajustes → Geral](docs/images/settings-general.png)

Desligar uma suíte leva a primeira requisição da próxima sessão de 17.1k para 14.3k tokens;
Desfazer traz de volta (dados reais; todas as capturas e o GIF foram gravados na 0.2.2-rc.5, em um
perfil de QA isolado):

![Demonstração: interruptor de suíte e desfazer](docs/images/demo.gif)

## O que ele gerencia

| Canal | Mecanismo | Efeito quando desligado |
| --- | --- | --- |
| Seções do prompt | Um filtro `system-prompt/assemble` no escopo da sessão remove a seção indicada | Esse texto some do prompt do sistema |
| Contextos de execução | O mesmo filtro, por nome (entradas obrigatórias excluídas) | Instantâneos de aprovação/sandbox deixam de entrar na primeira requisição de uma nova sessão |
| Catálogo de skills | Uma skill de mesmo nome e não invocável, registrada no escopo da sessão | A skill some do catálogo visível ao modelo |
| Esquemas de ferramentas | `tools.restrict({ deny })` | A definição e os parâmetros não são mais enviados |
| Regras do espaço de trabalho | **Exibição somente leitura** | — |

Todo interruptor é um registro no escopo da sessão aplicado a sessões criadas depois; a conversa
atual mantém o que já tem.

As regras do espaço de trabalho (`AGENTS.md` / `CLAUDE.md`) são injetadas como mensagem de usuário
pelo `dsh-agent-instructions` em `agent/pre-step`, e a `0.2.2` não expõe nenhum hook público de
supressão. O plugin nunca renomeia, apaga ou edita esses arquivos: o painel os marca como somente
leitura, informa se cada candidato está de fato no caminho de carregamento e se passa do limite de
64 KB por arquivo e — no painel de conteúdo — mostra o conteúdo exato do arquivo que está sendo
injetado.

Contextos obrigatórios (diretório de trabalho, identidade do subagente) também são somente leitura;
nenhuma política consegue descartá-los.

## Suítes: desligar um grupo inteiro

A lista agrupa por suíte por padrão, em vez de mostrar centenas de linhas:

- Um servidor MCP é uma suíte. Na máquina de referência, 230 itens REA (229 ferramentas
  `mcp__rea__*` mais a seção de prompt dela) se reduzem a uma linha — 66,715 tokens, 79.6% da
  primeira requisição da próxima sessão.
- Ferramentas não MCP se agrupam por prefixo de nome (`agentero_*`, `office_*`, `schedule_*`); as
  isoladas caem em "Ferramentas base".
- Skills se agrupam por provedor (por exemplo, 33 skills `filesystem` em um grupo).
- Seções e contextos se agrupam por namespace; a seção de instruções `mcp:rea` entra no grupo REA.
- A linha de um grupo mostra contagem de itens, tokens, fatia e um interruptor de três estados; um
  grupo parcialmente desligado mostra o estado misto, e uma suíte desligada para a próxima sessão
  continua na lista com o tamanho lembrado, para poder ser reaberta.
- A lista agrupada se divide por origem: **Oficial da DeepSeek** (seções do prompt do host,
  contextos de execução, regras do espaço de trabalho, famílias de ferramentas base) se recolhe em
  uma linha e fica recolhida até você abri-la; **Outros plugins e MCP** (namespaces MCP, skills com
  provedor, seções e ferramentas de plugins) continua aberto embaixo. A classificação é uma lista
  mantida em `lib/origin.js`, porque o host não marca uma ferramenta ou seção com seu dono — um
  plugin não listado nunca pode se esconder dentro do "oficial".

## O painel de conteúdo

Toda linha consegue responder à continuação óbvia: *me mostre o que isso diz de fato.*

- **Texto do prompt e contextos de execução** — o texto montado, como texto simples, com a origem
  indicada como "montado a partir do prompt do sistema" (nada é renderizado de novo como HTML).
- **Ferramentas** — a declaração JSON dividida em descrição, tabela de parâmetros (nome, tipo,
  obrigatório, descrição) e o JSON bruto; um botão de copiar por visualização.
- **Skills** — o corpo do `SKILL.md` quando é possível resolvê-lo, senão a linha exata do catálogo
  que é injetada (e o painel de conteúdo diz qual dos dois é).
- **Regras do espaço de trabalho** — o conteúdo real do arquivo, com o caminho.
- Números de linha (alternáveis), busca dentro do conteúdo com destaque de ocorrências e um resumo
  por linha, copiar o texto completo / copiar o caminho, um aviso de "conteúdo maior que 256 KB,
  truncado", Esc para fechar, e o foco volta para a linha de onde você o abriu.

Os únicos caminhos que o host abre são os que o próprio instantâneo registrou — a requisição não
pode indicar um caminho. Os números de token são estimativas (ASCII ÷ 4, outros caracteres ÷ 1.6),
não saída de tokenizador.

## Verificações de saúde

A página Gerenciar abre com uma faixa determinística de constatações sobre o instantâneo atual:

| Código | Significado | Ação |
| --- | --- | --- |
| `heavy-suite` | Uma suíte de plugin / MCP instalada é ≥25% da próxima primeira requisição sob a política salva (ou ≥30k tokens) | Desligar essa suíte — todos os canais que ela abrange |
| `builtin-heavy` | Uma suíte integrada do DSH é desse tamanho (informativo; não é recomendável fechar famílias de ferramentas do host) | (informativo) |
| `catalog-truncated` | As descrições de skills estão sendo cortadas no limite de linha do catálogo | Ler a skill afetada |
| `locked-items` | Itens que não podem ser desligados são ≥10% da primeira requisição | Ir para a lista de gerenciamento |
| `unknown-window` | Ainda não há medição, então a ocupação é desconhecida | (informativo) |
| `no-policy` | Nada nunca foi desligado neste espaço de trabalho | Abrir ajustes |
| `empty-catalog` | Nenhuma skill está coletada | Abrir ajustes |

A severidade é `high / warn / info`; até seis linhas são exibidas com uma linha de "mais", e toda
ação reutiliza o mesmo `POST /action` do painel. As verificações são uma função pura de um
instantâneo, então duas atualizações dos mesmos dados não podem discordar. Toda verificação lê a
**projeção efetiva** — o que uma nova sessão realmente receberia sob a política salva —, então
desligar uma suíte faz o aviso dela sumir na hora, e repetir um interruptor já aplicado é um no-op
silencioso: nenhum passo novo de desfazer, nenhuma linha de evento, nenhum toast. Dois códigos de
contrato (`duplicate-skill`, `tool-name-collision`) nunca são emitidos: esta versão do host resolve
duplicatas antes que o plugin consiga observá-las, e inventar uma constatação seria mentira.

## Insights

A aba Insights lê `$DSH_HOME/injection-manager/stats.json` (as medições do próprio plugin) mais um
preenchimento limitado a partir do log durável que roda **em segundo plano**: um ciclo por minuto,
no máximo 8 sessões por ciclo, nunca aguardado por uma leitura. Abrir a aba devolve o que já está
registrado e sinaliza `backfilling: true` enquanto um ciclo completa o restante.

- **Tendência** — uma barra empilhada por sessão, dividida pelos cinco canais; 7 dias / 30 dias /
  tudo; passe o mouse para ver os valores, clique para fixar, Esc para soltar, ←/→ pelo teclado.
  Acima de 40 pontos as barras se juntam em blocos de visão geral, para que um histórico longo não
  vire fios de cabelo. Barras de sessões com divisão por canal desconhecida são **hachuradas**, não
  zeradas.
- **Faixa agregada** — sessões medidas (exibidas como medidas / conhecidas), média e pico de tokens
  do primeiro turno, economia acumulada.
- **Cartões por sessão** — busca por id / título / diretório, ordenação por recentes / mais pesadas
  / mais economia, sessão atual marcada; cada cartão abre a linha daquela sessão na lista de
  gerenciamento ou o conteúdo dela.
- **Suítes mais pesadas** — as suítes da sessão atual por tamanho, com a parte que a política já
  desligou desenhada mais clara; uma barra volta para Gerenciar já filtrado.
- **Log de eventos** (não exibido mais no painel) — gravações de política, predefinições,
  importações, desfazer, compactações e podas continuam registrados em `events.json` (limite de
  300) e continuam legíveis pela rota `/events`; no painel, o histórico de mudanças fica em
  "Desfazer", na página Gerenciar.
- **Nota de rodapé de cobertura** — "N de M sessões registradas nesta máquina; a tendência contém
  apenas o que este plugin mediu e um preenchimento limitado do log."

## Janela de contexto: o denominador de que esta lista precisa

"Injeção 83.8k" não diz se você deve desligar alguma coisa. O número que diz é quanto resta da
janela de contexto, então o painel pega o denominador da medição do próprio host:

| Número | Origem | Significado |
| --- | --- | --- |
| ocupação 24.6% | `contextPressure` (janela de `request/context`, senão `ctx.llm.resolveModelInfo().context.contextWindow`) | prompt previsto da próxima requisição ÷ a janela do modelo |
| 258.4k / 1M | o mesmo | usado / capacidade, com "790.2k livre" ao lado |
| sistema 2.4k · ferramentas 77.9k · mensagens 129.7k | projeção de `contextBreakdown` | onde esta requisição vai, histórico da conversa incluído |
| compactado 2× · liberados 78.4k | `shadowedTokenCount` em `compaction/summary` e `compaction/prune` | o que o host já descartou por você |

Acima de 70% o número fica âmbar, acima de 90% vermelho, e o chip do campo de entrada acompanha.
Sem medição, o cartão diz "janela desconhecida" em vez de inventar uma capacidade, e o recibo conta
apenas eventos desde que o plugin carregou — a dica diz isso.

## Semântica da política

A política mora em `$DSH_HOME/injection-manager/policy.json`, um único arquivo.

As gravações são serializadas por `lib/lock.js` (uma fila no processo compartilhada por
`POST /action` e as ações de `/inject`), então dois painéis acionando duas suítes não
conseguem perder uma delas. Cada gravação usa um nome temporário único, copia o arquivo atual para
`policy.json.bak` (quando ele existe) e então renomeia o novo arquivo para o lugar. Se
`policy.json` não puder ser interpretado, o plugin lê o backup e informa `recovered: true` com um
erro que nomeia o backup, em vez de voltar em silêncio para tudo ligado.

Cada canal tem três modos: `all`, `only` (mantém os nomes listados) e `except` (descarta os nomes
listados). Um interruptor individual no painel cai em `except`, ou remove a entrada de uma lista
`only`, então interruptores manuais e predefinições nunca brigam entre si.

- **Tudo** — sem política.
- **Mínimo** — apenas identidade, prefixo de persona e as ferramentas de arquivo/terminal. Na
  máquina de referência, leva a primeira requisição da próxima sessão de 84k para 5k tokens.
- **Prefixo/sufixo personalizado** — texto livre que substitui `deployment:persona-prefix` /
  `deployment:persona-suffix`. Vazio significa que nada é injetado. Ambos mudam o prefixo do prompt
  e, portanto, o reaproveitamento de cache; o painel avisa disso.

Uma política é aplicada em `agent/created` — só a sessões criadas depois. Uma conversa em andamento
nunca é reescrita. O painel informa se a sessão atual foi criada com a política e mostra
`numbers.session` para esta conversa e `numbers.next` para a próxima sessão nova.

## Plano de controle, não uma reprodução

[dsh-context](https://github.com/bowenliang123/dsh-context) registra o que já aconteceu —
composição por requisição, atividade de arquivos, execuções de comandos, tempo, custo, a frota de
múltiplos agentes. É a melhor ferramenta para *"por que a última requisição custou isso"*.

Este plugin responde à pergunta **antes** de a requisição existir: *o que a próxima sessão nova vai
carregar, o que posso desligar e como fica depois disso?* Ele nunca grava no seu espaço de trabalho,
todo interruptor é reversível, e todo número ou vem da medição do próprio host ou diz que é uma
estimativa. Instale os dois se quiser o quadro completo; eles não modificam um ao outro.

| | dsh-context | dsh-injection-manager |
| --- | --- | --- |
| Direção | Depois do fato: requisições, eventos, custo | Antes: o primeiro turno da próxima sessão |
| Ação central | Observar, expandir, filtrar, comparar | Observar + **interruptor, predefinição**, com desfazer |
| Granularidade | Por requisição (composição por passo, arquivos, comandos) | Por injeção do primeiro turno de cada sessão (5 canais + suítes) |
| Saída | Gráficos e detalhe | Uma decisão: qual suíte descartar, quanto economiza, o que a janela faz |
| Fronteira | Múltiplos agentes, arquivos, comandos, cobrança | Só o catálogo de injeção: seções do prompt, contextos, skills, ferramentas, regras |
| Licença | Apache-2.0 | MIT |

## Cinco pontos de entrada

Cinco lugares, um plugin. Quatro deles leem o mesmo instantâneo `GET /summary` e, portanto, citam o
mesmo par de números (`numbers.session` = o que esta conversa carrega, `numbers.next` = o que uma
nova sessão recebe sob a política salva); o quinto edita o Config do próprio plugin e não mostra
números.

| Entrada | Onde | O que responde |
| --- | --- | --- |
| **Página de Insights** | Lista do painel esquerdo → "Injeção de contexto" → Gerenciar / Insights / Ajustes | O panorama completo: quadro de interruptores, composição, saúde, tendência, mudanças, detalhe da sessão, política |
| **Aba da conversa** | Linha de abas de uma conversa: Conversa / Trajetória / **Injeção** | O que *esta conversa* carrega agora, o que a próxima sessão carregaria, o que é desativável, quão cheia está a janela |
| **Painel da barra lateral direita** | Aba da barra lateral direita "Injeção de contexto" | A versão compacta enquanto você trabalha: os dois números, fatia desativável, foco em skills, interruptores de canal |
| **Atalho `/inject`** | Campo de entrada | Um menu com ícone e busca: abrir o painel completo, predefinição mínima / tudo ligado, desfazer, e as suítes alternáveis ordenadas por token (até 8) |
| **Linha de preferências** | Ajustes → Geral → "Injeção de contexto" | `dock` / `refreshOnFocus` / `showRawNames`, gravados pelo formulário de configuração do host (voláteis: sem reinício) |

De propósito, duas leituras extras não contam como entradas: o chip do campo de entrada é um
indicador permanente de `numbers.next` (ocultável na linha de preferências), e a ferramenta de
modelo `context_injection` é um instantâneo somente leitura que o agente pode citar — quem aperta
os interruptores é uma pessoa.

A ferramenta voltada ao modelo é somente leitura: o modelo não pode afrouxar nem apertar a política.
Toda gravação vem de um clique no painel, na aba da conversa (nenhuma) ou no formulário de ajustes.

## Instalação

```powershell
dsh plugin add dsh-injection-manager
# or, straight from GitHub:
dsh plugin add github:IWHBIWHB/dsh-injection-manager
```

Ou no aplicativo: DSH → Plugins → Add plugin → digite o nome do pacote ou escolha este diretório.
Atualize a página; o ícone "Injeção de contexto" aparece na lista do painel esquerdo, e os cinco
pontos de entrada acima ficam disponíveis (sem etapa de build, sem reinício na primeira instalação).

Atualizando de `dsh-context-preflight` / `dsh-context-injection`: se existir apenas um arquivo de
política antigo, ele é lido uma vez e usado como política atual. As gravações sempre vão para
`$DSH_HOME/injection-manager/policy.json`.

Desinstalação: remova o plugin como qualquer outro; os arquivos de política, estatísticas e eventos
ficam em `$DSH_HOME/injection-manager/` (apague esse diretório para começar limpo).

Versões suportadas e APIs necessárias: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Feedback

Ajustes → Feedback: **Copiar diagnóstico** coloca um relatório saneado na área de transferência (se o navegador bloquear, abre um campo de texto selecionável); **Relatar um problema** abre o modelo de bug com o diagnóstico preenchido. O relatório só inclui versões, registro de slots e contagens de política — sem caminhos, ids de sessão ou conteúdo de conversa; também pode buscar `GET /plugins/dsh-injection-manager/diag?report=1`.

Sem painel: anexe `dsh --version`, `dsh plugin --profile desktop list | Select-String injection-manager` e as últimas 30 linhas do log de inicialização. Detalhes: [docs/FEEDBACK.md](docs/FEEDBACK.md).

## Configuração do plugin

As três opções de apresentação são editáveis em **Ajustes → Geral → "Injeção de contexto"** (e, em
hosts que mostram o formulário de configuração do plugin, em Plugins → dsh-injection-manager →
Configuration):

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `dock` | ligado | Mostra o chip "injeção 84k · 36%" ao lado do campo de entrada: primeiro turno da próxima sessão e, depois, ocupação da janela (fatia desativável quando a janela é desconhecida) |
| `refreshOnFocus` | ligado | Atualiza o painel quando a janela recupera o foco |
| `showRawNames` | ligado | Mostra a chave bruta (`harness:identity`) ao lado do rótulo legível |

Os três campos são `.volatile()` no host: mudá-los vale na hora e não reinicia o plugin nem
descarta o cache de instantâneos em memória. Onde o host não oferece um formulário de configuração,
a linha de preferências mostra os valores efetivos como somente leitura e avisa disso.

Duas preferências do painel são locais do navegador e ficam onde se aplicam: o controle de números
de linha do painel de conteúdo fica na própria barra de ferramentas dele, e o período padrão dos
Insights é definido pelos seletores de período na aba Insights. Nenhuma das duas é gravada no
arquivo de política, então existe exatamente uma fonte de verdade para os interruptores.

## Dados e privacidade

| Caminho | Conteúdo | Gravado por |
| --- | --- | --- |
| `$DSH_HOME/injection-manager/policy.json` | Modos de canal, nomes, prefixo/sufixo | Ações do painel e `/inject` (enfileirado, gravação atômica) |
| `$DSH_HOME/injection-manager/policy.json.bak` | A última política boa, usada quando `policy.json` não pode ser interpretado | Cada gravação de política, quando existe um arquivo anterior |
| `$DSH_HOME/injection-manager/stats.json` | Uma linha medida por sessão, com divisão de tokens por canal | Todo instantâneo que o painel/ferramenta/exportação/saúde monta, mais o preenchimento de tendência em segundo plano |
| `$DSH_HOME/injection-manager/events.json` | Feed de eventos somente de acréscimo, máximo 300, gravação atômica | Gravações de política, predefinições, importações, desfazer, compactações |
| Linha de configuração do plugin | dock / refreshOnFocus / showRawNames | Ajustes → Geral (cartão) ou Plugins → Configuration |
| Armazenamento local do navegador | Números de linha do painel de conteúdo, período dos Insights, cartões dispensados | Somente este navegador |

GETs de instantâneo atualizam `stats.json`, e o preenchimento de tendência só acrescenta a ele;
nenhum GET altera a política ou um arquivo do espaço de trabalho. Nenhuma requisição de rede,
nenhuma telemetria, nenhum upload. Toda rota HTTP também passa pela barreira de admissão
Host/Origin do próprio host antes que qualquer lógica de rota rode: uma origem não confiável, ou
uma requisição sem a credencial de navegador/API emitida pelo host, recebe `401`/`403` com corpo
vazio. Só em um host que não oferece esse serviço a barreira é ignorada (as rotas então se
comportam exatamente como na 2.0.0). O feed de eventos guarda apenas política e metadados de
sessão: as strings são achatadas e truncadas em 200 caracteres, e o texto do prompt da sessão nunca
é gravado. O painel de conteúdo lê arquivos do disco só quando você o abre, só para caminhos que o
instantâneo registrou, e nada lido ali é persistido.

## Autoverificação

O plugin expõe 18 rotas em `/plugins/dsh-injection-manager`: 15 GETs que nunca alteram a política
nem um arquivo do espaço de trabalho (as rotas de instantâneo e o preenchimento de tendência só
atualizam o `stats.json` local), mais três endpoints somente POST — `/action` altera a política, e
`/boot` + `/registrations` são autorrelatos do cliente (um GET nessas duas retorna 405):

| Rota | O que ela prova |
| --- | --- |
| `/ping` | Que o plugin registrou suas rotas |
| `/summary?session=<id>[&lang=<code>]` | O instantâneo que o painel renderiza (`apiVersion: 3`, `healthSummary`, prévias de itens, `numbers`); com `lang`, só esse dicionário mais inglês — sem ele, todos os oito (o que o `/locale` usa) |
| `/content?channel=<id>&id=<itemId>[&session=<id>]` | O conteúdo original por trás de uma linha (seguro para UTF-8, limite de 256 KB, orçamento de 2 s) |
| `/trend?range=all｜30d｜7d&limit=120` | Tendência do primeiro turno entre sessões + agregado + cobertura + `backfilling` |
| `/events?session=<id>&limit=60` | O feed de eventos da sessão com a janela dela |
| `/health?session=<id>` | As mesmas verificações que a faixa de saúde mostra |
| `/stats` | O arquivo de histórico bruto mais o estado de cobertura/preenchimento |
| `/verify?session=<id>` | Remonta uma sessão viva e devolve as seções, os contextos e os nomes de ferramentas **efetivos** |
| `/diag` | Presença dos módulos do cliente, resultado da última aplicação, quantas vezes o filtro de montagem rodou |
| `/policy`, `/export`, `/locale` | Estado do arquivo de política, exportações, todos os oito dicionários |
| `/ledger?session=<id>&limit=20` | Registro de injeção: uma entrada por requisição ao modelo com totais, deltas e bloqueados; `?entry=<id>` devolve a lista daquela requisição |
| `/ledger-text?hash=<hash>` | Texto exato de uma entrada registrada (endereçado por conteúdo; nível de mensagem só prévia) |
| `/ledger-catalog` | Catálogo de autoria e controlabilidade por trás das linhas do registro |
| `POST /boot`, `POST /registrations` | Autorrelatos do cliente (apenas em memória; GET retorna 405) |
| `POST /action` | O único caminho de gravação da política: interruptor, predefinição, importação, desfazer (só JSON de mesma origem) |

`/summary?lang=` é o que o cliente usa. A resposta cai de ~267 KB para ~150 KB porque carrega um
dicionário e um fallback em inglês em vez dos oito.

A aba Ajustes expõe a mesma verificação por trás de um botão.

## Documentação

- [Detalhes](docs/DETAIL.md): a versão de cinco minutos do que é medido, do que é desativável e do
  que as superfícies mostram
- [Arquitetura](docs/ARCHITECTURE.md): os cinco canais de injeção, o pipeline de instantâneos, os
  cinco slots de entrada, as rotas e os arquivos de dados
- [Decisões](docs/DECISIONS.md): por que a barra lateral direita substituiu `sidebar.panel`, por que
  o cartão de ajustes grava Config volátil, por que a aba da conversa é somente leitura
- [RSI](docs/RSI.md): o ciclo de autoverificação repetível que este projeto usa entre versões
- [Autoavaliação](docs/SELF-ASSESSMENT.md): esta versão pontuada contra os critérios de qualidade do
  próprio projeto, com as lacunas declaradas
- [FAQ](docs/FAQ.md): por que `AGENTS.md` não pode ser desligado, o que o painel de conteúdo lê,
  relação com o `dsh-context`
- [Compatibilidade](docs/COMPATIBILITY.md): versões testadas (0.2.2-rc.1 CLI, 0.2.2-rc.5 Desktop),
  APIs necessárias, verificações de atualização
- [Desempenho](docs/PERFORMANCE.md): tempos medidos para o instantâneo, os cinco pontos de entrada e
  o preenchimento de tendência
- [Segurança](SECURITY.md): como reportar, fronteiras verificáveis, riscos aceitos
- [Contribuição](CONTRIBUTING.md): ciclo local, verificações pré-commit, passos de lançamento
  (`npm run smoke` roda o pipeline offline)

`docs/DETAIL.md` e `docs/DETAIL.zh.md` são as páginas completas; as variantes `de` / `es` / `fr` /
`ja` / `pt` / `ru` hoje contêm apenas a imagem de prévia — placeholders, não traduções completas. O
conjunto de READMEs é publicado em oito idiomas (veja a linha de troca no topo).

## Limitações

- O catálogo de skills é uma mensagem de pré-passo, então a granularidade é por skill (ou o catálogo
  inteiro pela ferramenta `skill`).
- Canais de mensagem de usuário, como as regras do espaço de trabalho e o contexto de tempo, não
  podem ser desligados; o plugin os mostra (e também o conteúdo deles) em vez de fingir o contrário.
- A tendência dos Insights contém apenas sessões que este plugin mediu ou calculou a partir de logs
  duráveis; linhas mais antigas não têm divisão por canal e aparecem hachuradas.
- A aba da conversa é somente leitura: os interruptores valem para sessões criadas depois da
  gravação, como o painel sempre disse. Abri-la para uma sessão que o host não mantém mais recorre
  à última sessão ativa.
- A aba da barra lateral direita é registrada pelo serviço `sidebarRightTabs` do host; hosts
  anteriores a esse serviço (era 0.2.1) mantêm o registro antigo `sidebar.panel` como alternativa, e
  um host sem nenhum dos dois simplesmente não mostra superfície de barra lateral (os outros quatro
  pontos de entrada continuam funcionando).
- A linha de preferências só é gravável onde o host oferece um formulário de configuração; caso
  contrário, ela lista os valores efetivos e avisa que são somente leitura.
- Ainda não implementado: a atribuição de ferramentas a plugins (o `ToolSchema` do host não tem
  campo de dono), se uma skill foi usada recentemente, diferenças entre sessões, filtragem da linha
  do tempo de eventos e virtualização da lista de 354 linhas.
- A interface é publicada em chinês simplificado, inglês, japonês, espanhol, francês, alemão, russo
  e português; adicionar um idioma é um arquivo JSON em `locale/`.

## Licença

MIT
