# Livro de receitas de conectores

Conectores inteiros para os formatos em que as corretoras de verdade vêm. Toda
receita desta página é compilada contra a superfície publicada a cada build,
então nada aqui é um trecho que funcionava antes.

Comece por [Escrevendo um conector](/pt-BR/writing-a-connector) se ainda não
leu. Esta página é a parte seguinte: como uma corretora realmente se parece
quando você senta para adicionar uma.

## A menor coisa que funciona

A maioria das corretoras que você vai querer é isto: uma listagem e um passado.
Sem livro ao vivo, sem fita.

```ts
import { Connector } from 'fathom';
import type { BarPageRequest, VenueBar, VenueInstrument } from 'fathom';

export default class Simple extends Connector {
    private static readonly REST = 'https://api.example.com';
    private static readonly MINUTE_MS = 60_000;

    readonly declaration = {
        book: null,
        tape: null,
        bars: {
            rungs: [{ widthMs: Simple.MINUTE_MS, anchorMs: 0 }],
            barsPerRequest: 1_000,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    readonly instruments = {
        planInstruments: () => ({ url: Simple.REST + '/markets' }),
        readInstruments: (payload: unknown): VenueInstrument[] =>
            this.requireList(payload, 'markets').map((one) => {
                const entry = one as Record<string, unknown>;
                return {
                    symbol: String(entry['id']),
                    base: String(entry['base']),
                    quote: String(entry['quote']),
                    priceStep: this.readNumber(entry['tick']) ?? 0,
                    isTrading: entry['status'] === 'online',
                };
            }),
    };

    readonly planStream = null;
    readonly book = null;
    readonly tape = null;

    readonly bars = {
        planPage: (request: BarPageRequest) => ({
            url: Simple.REST + '/candles?market=' + encodeURIComponent(request.symbol)
                + '&from=' + String(request.fromMs) + '&to=' + String(request.toMs),
        }),
        readPage: (payload: unknown): VenueBar[] =>
            this.requireList(payload, 'candles').map((one) => {
                const row = one as Record<string, unknown>;
                const openedAtMs = this.readNumber(row['t']) ?? 0;
                return {
                    openedAtMs,
                    closedAtMs: openedAtMs,
                    openPrice: this.readNumber(row['o']) ?? 0,
                    highPrice: this.readNumber(row['h']) ?? 0,
                    lowPrice: this.readNumber(row['l']) ?? 0,
                    closePrice: this.readNumber(row['c']) ?? 0,
                    volume: this.readNumber(row['v']),
                    buyVolume: null,
                    tradeCount: null,
                };
            }),
    };
}
```

Essa é uma corretora completa e instalável. Tudo abaixo é uma variação dela.

## Candles que chegam como tuplas

Muitas corretoras mandam um array por candle em vez de um objeto. Nomeie as
posições uma vez, dentro da classe, e leia pelo nome.

```ts
import { Connector } from 'fathom';
import type { BarPageRequest, VenueBar } from 'fathom';

export default class Tuples extends Connector {
    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;

    /** Quantas posições uma linha precisa ter para valer a leitura. */
    private static readonly FIELDS = 6;

    readonly declaration = { book: null, tape: null, bars: null };
    readonly instruments = {
        planInstruments: () => ({ url: 'https://api.example.com/markets' }),
        readInstruments: () => [],
    };
    readonly planStream = null;
    readonly book = null;
    readonly tape = null;

    readonly bars = {
        planPage: (request: BarPageRequest) => ({
            url: 'https://api.example.com/klines?symbol=' + encodeURIComponent(request.symbol),
        }),
        readPage: (payload: unknown): VenueBar[] => this
            .requireList(payload)
            .map((row) => this.readCandle(row))
            .filter((bar): bar is VenueBar => bar !== null),
    };

    /**
     * Um candle a partir de uma tupla, ou null onde um campo é ilegível.
     */
    private readCandle(row: unknown): VenueBar | null {
        if (!Array.isArray(row) || row.length < Tuples.FIELDS) {
            return null;
        }

        const openedAtMs = this.readNumber(row[Tuples.OPENED_AT]);
        const closePrice = this.readNumber(row[Tuples.CLOSE_PRICE]);
        if (openedAtMs === null || closePrice === null) {
            return null;
        }

        return {
            openedAtMs,
            closedAtMs: openedAtMs,
            openPrice: this.readNumber(row[Tuples.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Tuples.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Tuples.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Tuples.VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}
```

::: warning Três armadilhas, na ordem em que mais mordem
**Segundos.** O Fathom trabalha em milissegundos do começo ao fim. Várias
corretoras recebem e devolvem segundos — multiplique na entrada, divida na
saída.

**Ordem da sequência.** Devolva do mais antigo para o mais novo. Uma corretora
que manda ao contrário precisa de um `.reverse()`, e sem ele o gráfico anda para
trás.

**Ordem dos campos.** `abertura, fechamento, máxima, mínima` é uma ordem de
verdade, usada por corretoras de verdade. Leia como se fosse a usual e a máxima
fica abaixo da mínima em todo candle que fechou em queda.
:::

## Uma corretora que fecha os candles para você

Algumas corretoras nomeiam as duas bordas. Diga isso, e o Fathom usa a sua em
vez de derivar uma da largura.

```ts
const openedAtMs = this.readNumber(row['start']) ?? 0;
const closedAtMs = this.readNumber(row['end']) ?? 0;

return {
    openedAtMs,
    // A corretora fecha no último instante que ela contém; o gráfico trata a
    // borda como o primeiro que ela não contém. Daí o milissegundo.
    closedAtMs: closedAtMs + 1,
    // …
};
```

Deixe `closedAtMs` igual a `openedAtMs` onde a corretora só nomeia a abertura, e
o Fathom preenche a borda com a largura que pediu.

## Um livro ao vivo

Esta é a metade que faz o mapa de calor. Você precisa de três coisas: um socket
para abrir, um retrato para começar o espelho, e um jeito de ler cada
atualização.

```ts
import { Connector } from 'fathom';
import type { DepthDiff, DepthSnapshot, SerializedPriceLevel } from 'fathom';

export default class Live extends Connector {
    private static readonly REST = 'https://api.example.com';
    private static readonly SOCKET = 'wss://stream.example.com';

    readonly declaration = {
        book: {
            // Toda atualização nomeia a anterior, que é a checagem mais forte
            // que existe. Veja abaixo uma corretora que oferece menos.
            grade: 'linked' as const,
            levelsPerSide: 'all' as const,
            publishIntervalMs: 100,
            clock: 'venue' as const,
        },
        tape: null,
        bars: null,
    };

    readonly instruments = {
        planInstruments: () => ({ url: Live.REST + '/markets' }),
        readInstruments: () => [],
    };

    readonly planStream = (symbol: string) => ({
        url: Live.SOCKET + '/book/' + symbol.toLowerCase(),
    });

    readonly book = {
        planSnapshot: (symbol: string) => ({
            url: Live.REST + '/book?symbol=' + encodeURIComponent(symbol) + '&depth=1000',
        }),
        readSnapshot: (payload: unknown): DepthSnapshot => ({
            lastUpdateId: this.readNumber((payload as Record<string, unknown>)['seq']) ?? 0,
            bidLevels: this.requireList(payload, 'bids') as SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as SerializedPriceLevel[],
        }),
        readUpdate: (payload: unknown): DepthDiff | null => {
            const message = payload as Record<string, unknown>;
            const first = this.readNumber(message['from']);
            const final = this.readNumber(message['to']);
            // Qualquer outra coisa no socket não é erro — é um heartbeat, uma
            // confirmação, ou o tráfego de outra inscrição.
            if (first === null || final === null
                || !Array.isArray(message['b']) || !Array.isArray(message['a'])) {
                return null;
            }

            return {
                firstUpdateId: first,
                finalUpdateId: final,
                previousFinalUpdateId: first - 1,
                bidLevels: message['b'] as SerializedPriceLevel[],
                askLevels: message['a'] as SerializedPriceLevel[],
            };
        },
    };

    readonly tape = null;
    readonly bars = null;
}
```

`readUpdate` devolver `null` é o caso normal, não o caso de falha. Um socket só
carrega tudo que a corretora transmite, então a maioria das mensagens nele não é
sua.

## Um socket com quem é preciso falar

Muitas corretoras recebem a inscrição pelo socket em vez de pela URL, e derrubam
uma conexão em que ninguém falou nada.

```ts
readonly planStream = (symbol: string) => ({
    url: 'wss://stream.example.com/v2',
    greetings: [JSON.stringify({ op: 'subscribe', args: ['book.' + symbol] })],
    heartbeat: { everyMs: 20_000, send: JSON.stringify({ op: 'ping' }) },
});
```

O Fathom é dono desse temporizador. Um conector que segurasse um poderia manter
o processo vivo depois que a gravação a que ele pertencia foi desligada, que é a
razão inteira de um conector nunca segurar nada.

## Um livro do qual você só recebe uma janela

A maioria das corretoras publica os poucos níveis mais próximos em vez do livro
inteiro. Diga quantos, e o Fathom apara o espelho até esse posto depois de cada
atualização.

```ts
readonly declaration = {
    book: {
        grade: 'stepped' as const,
        // Cinquenta por lado, não o livro inteiro. Num livro inteiro um preço
        // ausente significa que nada repousa ali; numa janela significa que
        // ninguém disse.
        levelsPerSide: 50,
        publishIntervalMs: 200,
        clock: 'venue' as const,
    },
    tape: null,
    bars: null,
};
```

Sem a apara, um nível que um movimento rápido empurrou para fora da janela fica
na gravação por horas com o tamanho que tinha por último — uma prateleira sólida
que deixou de existir no instante em que o movimento começou.

## Declarando menos do que você consegue

A coisa mais útil que um conector faz é dizer não.

```ts
bars: {
    rungs: [{ widthMs: 60_000, anchorMs: 0 }],
    barsPerRequest: 500,
    hasVolume: true,
    // Quase toda corretora. Declare falso e o delta, o delta acumulado e o
    // volume em dois tons ficam esmaecidos aqui, com o motivo na linha.
    hasBuyVolume: false,
    hasTradeCount: false,
}
```

A tentação é deixar a flag em `true` e torcer. O que isso compra é um delta de
zero desenhado no gráfico inteiro, que se lê exatamente como compra e venda
equilibradas.

## O que a API ainda não faz por você

Escrito aqui porque descobrir tentando é pior, e porque estas são as bordas em
que uma corretora de verdade vai te parar.

- **Uma requisição por listagem.** `planInstruments` devolve uma requisição só.
  Uma corretora que pagina a lista de símbolos não dá para ler inteira — você
  recebe a primeira página.
- **Sem segredos.** `VenueRequest` carrega cabeçalhos, e não existe onde guardar
  uma chave que pertence a um. Só funcionam endpoints que não pedem
  autenticação.
- **Só `GET`.** Sem método, sem corpo. Uma corretora que entrega o socket por um
  `POST` não dá para transmitir.
- **Sem uma segunda requisição antes da primeira.** Um conector não consegue
  dizer "busque isto, e use a resposta para montar a próxima URL" — que é o
  formato de todo socket protegido por token.

Cada um desses é um limite de verdade, não um descuido esperando ser achado. Se
um deles estiver no seu caminho, vale dizer: são as próximas coisas a mudar.
