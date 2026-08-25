# Fathom

> Sondagem de profundidade do livro de ofertas.

Grava a liquidez parada no livro da Binance e a desenha como um mapa de calor no
estilo Bookmap: cada linha horizontal é uma faixa de preço, cada coluna é um
instante, e o brilho é o tamanho descansando ali. As bolhas são agressões — ordens
a mercado que cruzaram o spread.

![Fathom](docs/screenshot.png)

## O que decide o projeto inteiro

**Histórico de order book não é recuperável.** Nenhuma exchange serve profundidade
passada por API pública — elas dão o snapshot de agora e o fluxo de mudanças a
partir daí. O gráfico só existe para o período em que o coletor esteve ligado.

Por isso a primeira entrega é o coletor, não o gráfico, e por isso ele roda como
serviço do sistema: cada hora desligada vira um buraco permanente na base.

## Instalação

Requer Node 22.12+ e Docker.

```bash
cp .env.example .env          # defina POSTGRES_PASSWORD e o DATABASE_URL correspondente
npm install
npm run database:up      # sobe o TimescaleDB e aplica o schema
npm run build            # compila o servidor e empacota a interface
```

Depois disso:

```bash
npm run collector        # começa a gravar
npm run gateway          # serve a API e a interface em http://localhost:8787
```

Para deixar rodando de verdade, veja [docs/operations.md](docs/operations.md) — há
unidades `systemd` prontas que sobrevivem a logout e reboot.

## Como ler o gráfico

| Elemento | O que é |
| --- | --- |
| Faixas horizontais | Liquidez parada no livro. Quanto mais quente, maior o tamanho |
| Bolhas | Agressões: ordens a mercado que cruzaram o spread. Verde comprou, vermelho vendeu |
| Linha tracejada ciano | Preço do livro na borda direita da janela |
| Faixas âmbar tracejadas | Períodos sem gravação |
| Painel à direita | Volume negociado por faixa de preço na janela |
| Linha âmbar no painel | Faixa que mais negociou — para onde o preço costuma voltar |
| Legenda `LIVRO` | Tamanho que satura a cor. É relativo à janela, não absoluto |

Passe o cursor (ou o dedo) para ver, num ponto: quanto está parado no livro ali e
quanto foi negociado naquela célula.

**Gestos:** um dedo arrasta, dois dedos dão zoom nos dois eixos ao mesmo tempo. No
desktop, a roda dá zoom no tempo e `shift` + roda no preço; duplo clique volta ao
tempo real.

O eixo de preço se recentra sozinho quando o preço sai da tela, mas só quando sai
de vez — se você parkou o eixo numa parede, ele fica onde você deixou.

## Uso no celular

O gateway serve a API **e** a interface na mesma porta, e escuta em `0.0.0.0`.
Abra `http://<ip-do-pc>:8787` no celular na mesma rede. A interface é desenhada
para o toque primeiro: um dedo arrasta, dois dedos dão zoom nos dois eixos ao
mesmo tempo, e os controles ficam na base da tela.

Não há autenticação. Mantenha em rede confiável.

## Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `INSTRUMENT_SYMBOL` | `BTCUSDT` | Contrato gravado (qualquer perpétuo USD-M) |
| `PRICE_BUCKET_SIZE` | `10` | Altura de cada linha do mapa, em USDT |
| `FRAME_INTERVAL_MS` | `1000` | Largura de cada coluna |
| `RECORDED_PRICE_RANGE_RATIO` | `0.02` | Faixa gravada acima e abaixo do meio do livro |
| `RETAINED_PRICE_RANGE_RATIO` | `0.10` | Além disso o livro local é podado, limitando a memória |
| `DEEP_REPAIR_INTERVAL_MS` | `300000` | De quanto em quanto tempo o topo do livro é reparado por REST |
| `GATEWAY_PORT` / `GATEWAY_HOST` | `8787` / `0.0.0.0` | Onde a API e a interface escutam |

Com os padrões, cada coluna tem ~320 faixas de preço e o consumo fica em torno de
150 MB/dia antes da compressão colunar, que reduz isso por mais de uma ordem de
grandeza depois de dois dias.

## Estrutura

Um projeto. O topo da árvore responde **quem executa isto**, que é a restrição
mais dura que existe aqui: o navegador não pode tocar o banco, o Node não pode
tocar o DOM.

```
src/
├── shared/      o contrato do fio          falado pelos três
│   ├── core/        tipos, faixas de preço
│   └── codec/       o formato binário
├── database/    o banco                    os dois processos de Node
│   ├── core/        conexão, mapeamento de linhas
│   └── services/    escrita, leitura
├── server/      http                       → dist/server/main.js
│   ├── core/        configuração
│   ├── services/    tail ao vivo
│   └── http/        servidor, rotas, schemas
├── workers/     processos de fundo         → dist/workers/collector.js
│   ├── core/        espelho do livro, construção do frame
│   └── services/    corretora, gravador
└── app/         o navegador                → dist/app/
    ├── core/        controller, viewport, dataset
    ├── services/    api http, socket ao vivo, preferências
    ├── painting/    canvas e suas camadas
    ├── react/       a ponte com React
    └── ui/          componentes
```

As setas só apontam para baixo:

```
server ─┐
        ├→ database → shared
workers ┘
app ──────────────→ shared
```

Ninguém precisa de disciplina para isso continuar verdade: `tests/arch/` percorre
os imports e falha em qualquer travessia. Cada lado tem seu próprio `tsconfig`
com as bibliotecas certas, então usar `document` dentro de `server/` é erro na
hora, no editor.

Detalhes em [docs/architecture.md](docs/architecture.md) e
[docs/data-model.md](docs/data-model.md).

## Desenvolvimento

```bash
npm run verify       # lint + typecheck + testes
npm run test:watch
npm run dev          # dev server do Vite, com proxy para o gateway
```

## O que o sinal não mostra

Vale saber antes de tomar decisão em cima disso:

- **Só ordens visíveis.** Iceberg e ordens ocultas não aparecem em lugar nenhum do
  livro público.
- **Paredes somem.** Ordens grandes são retiradas antes de executar com muita
  frequência; em cripto isso é rotina, não exceção.
- **A liquidez é fragmentada.** Uma parede na Binance não é a parede do mercado.
- **Isto é MBP, não MBO.** O livro público agrega por preço: você vê "42 BTC em
  79.000", não quantas ordens formam esses 42 nem a posição de cada uma na fila.
  Nenhuma exchange cripto grande publica Market-by-Order — isso é feed
  institucional (CME, Nasdaq). O desenho é o mesmo; o que falta é distinguir uma
  parede de uma ordem só de uma parede de cem.
- **Colunas amostradas.** Em janelas largas o servidor devolve uma coluna a cada N
  segundos. Uma parede que durou menos que isso pode nunca ter sido amostrada. A
  resolução vigente aparece sempre no cabeçalho.
- **Lacunas são explícitas.** Períodos sem gravação viram faixas âmbar tracejadas
  em vez de linha reta interpolada.

Não confunda com o "liquidation heatmap" do Coinglass: aquilo é estimativa de onde
há alavancagem, coisa diferente.
