# Escrevendo um conector

## Introdução

Um conector é o segundo tipo de addon. Um indicador acrescenta aritmética sobre
o que a corretora disse; um conector acrescenta a corretora que diz.

Você escreve no mesmo editor, salva do mesmo jeito, e o Fathom descobre qual dos
dois você escreveu pelo que o seu arquivo exporta.

Para começar, abra o seletor de contrato no topo do gráfico e clique em
**Adicionar corretora**. O editor abre num conector, não numa média móvel.

## A única regra

**Um conector descreve e lê. O Fathom executa e mede.**

Todo método que você escreve é simples e síncrono. Ele devolve uma URL e lê o
que voltou. Ele nunca busca, nunca segura um socket e nunca cria um
temporizador. O Fathom é dono do timeout, do limite de tamanho, da retentativa e
do relógio.

Isso não é questão de estilo. O coletor desliga uma gravação esperando ela
soltar, então um conector dono de uma conexão seria dono de um `close` que pode
travar — e isso pararia todas as outras gravações da máquina, não só a dele.

## A forma de um conector

Você escreve um conector como uma classe que estende `Connector`.

```ts
import { Connector } from 'fathom';
import type { VenueInstrument } from 'fathom';

/**
 * A KuCoin spot, até onde uma página consegue ler.
 */
export default class KuCoin extends Connector {
    // Fica aqui dentro porque nada fora desta classe usa.
    private static readonly REST = 'https://api.kucoin.com';

    readonly declaration = { book: null, tape: null, bars: null };

    readonly instruments = {
        planInstruments: () => ({ url: KuCoin.REST + '/api/v2/symbols' }),
        readInstruments: (payload: unknown): VenueInstrument[] => [],
    };

    readonly planStream = null;
    readonly book = null;
    readonly tape = null;
    readonly bars = null;
}
```

Seis membros, e cinco deles podem ser `null`.

Todos são abstratos na classe base, inclusive esses cinco. É de propósito: você
precisa digitar `null` para dizer não, e digitar é o momento em que você lê o
que o Fathom faz no lugar. Se esquecer um, o compilador cobra.

O `Connector` também traz as duas leituras que todo conector acaba repetindo:

| | |
|---|---|
| `this.readNumber(campo)` | Um número, ou `null` quando não dá para ler como um. |
| `this.requireList(payload, 'data')` | Uma lista dentro da resposta, ou um erro dizendo que não veio nenhuma. |

## Declarando o que a corretora não faz

`declaration` é onde a corretora diz o que consegue responder. São três
capacidades, cada uma descrita ou `null`.

| | O que significa quando existe | O que `null` faz |
|---|---|---|
| `book` | Tamanho em repouso por preço, ao vivo | Nenhum mapa de calor nesta corretora |
| `tape` | O que de fato foi negociado, ao vivo | Nenhuma execução ao vivo |
| `bars` | Candles do passado | O Fathom dobra as barras do que ele grava |

Dentro de `bars`, três flags decidem no que um indicador pode se apoiar:

```ts
bars: {
    rungs: [{ widthMs: 60_000, anchorMs: 0 }],
    barsPerRequest: 1_500,
    hasVolume: true,
    hasBuyVolume: false,
    hasTradeCount: false,
}
```

`hasBuyVolume: false` é a importante, e é a resposta honesta em quase todo
lugar. Só uma corretora de porte publica a separação por lado agressor nos
candles.

Declare falso e todo indicador que divide por ela — delta, delta acumulado,
volume em dois tons — fica esmaecido nesta corretora, com o motivo escrito na
linha. Deixe de fora e o Fathom desenharia um delta de zero, que se parece
exatamente com compra e venda equilibradas.

O `anchorMs` ao lado de cada largura é a fase em que os baldes abrem. É zero
para quase tudo. Um candle semanal abre numa segunda-feira, que fica quatro dias
depois de onde a época coloca uma.

## Lendo a listagem

É a metade que vale escrever primeiro, porque você descobre em um segundo se
funciona. Aperte salvar, e ou os pares aparecem no seletor ou a corretora diz
por que não.

```ts
readonly instruments = {
    planInstruments: () => ({ url: KuCoin.REST + '/api/v2/symbols' }),
    readInstruments: (payload: unknown): VenueInstrument[] =>
        this.requireList(payload, 'data').map((listing) => {
            const entry = listing as Record<string, unknown>;
            return {
                symbol: String(entry['symbol']),
                base: String(entry['baseCurrency']),
                quote: String(entry['quoteCurrency']),
                priceStep: this.readNumber(entry['priceIncrement']) ?? 0,
                isTrading: entry['enableTrading'] === true,
            };
        }),
};
```

`payload` é o que a corretora respondeu, já convertido de JSON. O `requireList`
lança o erro por você quando não existe lista onde você disse que existe. Em
qualquer outro ponto em que o formato te surpreender, lance um erro com uma
frase sua — o seletor mostra ela para quem estiver lendo.

## Lendo candles

```ts
readonly bars = {
    planPage: (request: BarPageRequest) => ({
        url: KuCoin.REST + '/api/v1/market/candles?type=1min'
            + '&symbol=' + encodeURIComponent(request.symbol)
            + '&startAt=' + String(Math.floor(request.fromMs / 1_000))
            + '&endAt=' + String(Math.floor(request.toMs / 1_000)),
    }),
    readPage: (payload: unknown, request: BarPageRequest): VenueBar[] => [],
};
```

Três coisas pegam todo mundo:

- **Unidades.** O Fathom trabalha em milissegundos. Várias corretoras recebem e
  devolvem segundos.
- **Ordem.** Devolva suas barras da mais antiga para a mais nova. Algumas
  corretoras mandam ao contrário, e uma sequência invertida desenha um gráfico
  que anda para trás.
- **Ordem dos campos.** Algumas corretoras mandam `abertura, fechamento, máxima,
  mínima` em vez da ordem usual. Lendo errado, a máxima fica abaixo da mínima em
  todo candle que fechou em queda.

Deixe `volume`, `buyVolume` e `tradeCount` como `null` onde a corretora não
publica nenhum. Zero é uma resposta de verdade aqui — um balde em que ninguém
negociou é um balde quieto — então uma corretora que não publica nada precisa
continuar distinguível de uma que só ficou quieta.

Se a corretora só nomeia onde o candle abre, deixe `closedAtMs` igual a
`openedAtMs`. O Fathom preenche a borda de fechamento com a largura que pediu.

## Instalando

Salve. A corretora aparece entre as outras no seletor de contrato, e o Fathom já
pergunta o que ela negocia. Marque um par com a estrela para guardar numa das
suas listas.

Seu conector é guardado como o código que você escreveu, então continua lá
semana que vem — e assim você consegue ler o que instalou antes que rode de
novo.

::: warning Onde seus conectores ficam guardados
Como os indicadores salvos, eles ficam no armazenamento local do navegador.
Limpar os dados do site leva eles junto. Exporte o que quiser manter.
:::

## O que um conector ainda não faz

- **Só `GET`.** Um conector nomeia uma URL. Uma corretora que entrega o socket
  por um `POST` que responde com uma URL de curta duração não dá para
  transmitir, que é exatamente por que o exemplo da KuCoin declara `book: null`.
- **O gráfico, não o coletor.** Um conector que você instala vive no seu
  navegador, então o servidor que grava livros de ofertas não o enxerga. Uma
  corretora trazida assim te dá uma listagem de pares e nada além: sem gravação
  atrás de um par, não há o que o gráfico abrir.
- **Só livro encadeado.** O grau que um conector declara é registrado mas ainda
  não é usado. O espelho do Fathom ainda precisa da referência anterior que a
  corretora nativa publica.
- **Uma página sozinha não alcança quase nenhuma corretora.** Quase nenhuma
  publica o cabeçalho que o navegador exige para ler de outra origem. Onde o
  Fathom tem servidor, os pedidos passam por ele — só https, sem redirecionar, e
  sem alcançar nada da rede do próprio servidor. Na demo só-navegador não há a
  quem pedir, então só dá para ler corretora que deixa a página entrar.

## Um exemplo pronto

O [exemplo `kucoin`](https://github.com/giovani-freitag/fathom-example-addons/tree/main/src/addons/kucoin)
é um conector completo com testes, incluindo os segundos, a ordem dos campos e a
página invertida.

---

O raciocínio por trás de tudo isto está no
[ADR 25](/en/adr/0025-a-reader-brings-the-venue-as-well-as-the-indicator).
