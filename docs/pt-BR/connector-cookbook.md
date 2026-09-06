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

    planInstruments() {
        return { url: this.address(Simple.REST, '/markets') };
    }

    readInstruments(payload: unknown): VenueInstrument[] {
        return this.requireList(payload, 'markets').map((one) => {
            const entry = one as Record<string, unknown>;
            return {
                symbol: String(entry['id']),
                base: String(entry['base']),
                quote: String(entry['quote']),
                priceStep: this.readNumber(entry['tick']) ?? 0,
                isTrading: entry['status'] === 'online',
            };
        });
    }

    override planBars(request: BarPageRequest) {
        // Montada em vez de escrita à mão: o `address` escapa o que recebe,
        // então um símbolo com `&` pede o par em vez de pedir dois parâmetros
        // que a corretora nunca ouviu falar.
        return {
            url: this.address(Simple.REST, '/candles', {
                market: request.symbol,
                from: request.fromMs,
                to: request.toMs,
            }),
        };
    }

    override readBars(payload: unknown): VenueBar[] {
        return this.requireList(payload, 'candles').map((one) => {
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
        });
    }
}
```

Essa é uma corretora completa e instalável. Tudo abaixo é uma variação dela.

## Uma listagem que chega em páginas

Uma corretora com quatro mil pares raramente entrega todos de uma vez. Diga onde
uma página está e quantos existem no total, e o Fathom calcula o resto dos
endereços sozinho — pedindo todos juntos em vez de um depois do outro.

```ts
import { Connector } from 'fathom';
import type { VenueInstrument, VenueRequest } from 'fathom';

export default class Paged extends Connector {
    private static readonly REST = 'https://api.example.com';
    private static readonly PER_PAGE = 500;

    readonly declaration = { book: null, tape: null, bars: null };

    planInstruments(from: number): VenueRequest {
        return {
            url: this.address(Paged.REST, '/symbols', { limit: Paged.PER_PAGE, offset: from }),
        };
    }

    readInstruments(payload: unknown): VenueInstrument[] {
        return this.requireList(payload, 'symbols').map((one) => {
            const entry = one as Record<string, unknown>;
            return {
                symbol: String(entry['name']),
                base: String(entry['base']),
                quote: String(entry['quote']),
                priceStep: this.readNumber(entry['tick']) ?? 0,
                isTrading: entry['halted'] !== true,
            };
        });
    }

    override readInstrumentTotal(payload: unknown): number | null {
        return this.readNumber((payload as Record<string, unknown>)['total']);
    }
}
```

O `planInstruments` recebe o deslocamento que estão pedindo, e o
`readInstrumentTotal` diz quantos existem no total. Com os dois, o Fathom sabe o
endereço de todas as páginas assim que lê a primeira — então pede o resto
**junto**, em vez de esperar cada uma nomear a próxima. Uma listagem de quatro
mil pares vira uma ida e uma leva, não oito idas em fila.

O Fathom para na vigésima página, diga a corretora o que disser, e entrega cada
página ao seletor conforme ela chega: o leitor vê os primeiros quinhentos pares
enquanto o resto ainda está no ar.

### Quando a corretora só entrega um cursor

Algumas corretoras dão um token junto com cada página, e nenhum total. Essas
páginas só dá para caminhar, porque o segundo endereço não existe antes de a
primeira resposta chegar.

```ts
override continueInstruments(payload: unknown, read: number) {
    void read;
    const next = (payload as { cursor?: string }).cursor;

    return next === undefined ? null : { url: this.address(Paged.REST, '/symbols', { cursor: next }) };
}
```

Escreva um ou outro, não os dois: o total é o que compra a leitura em paralelo,
e o cursor é o que a corretora oferece no lugar dele.

### Quando a corretora busca por você

Um leitor digitando no seletor enquanto quatro mil pares ainda chegam está
buscando no que por acaso já caiu. Onde a corretora casa o texto por conta
própria, diga isso e o Fathom pergunta a ela.

```ts
override planInstrumentSearch(term: string) {
    return { url: this.address(Paged.REST, '/symbols', { query: term, limit: 50 }) };
}
```

A resposta volta pelo seu próprio `readInstruments`. Deixe o método de fora — que
é o padrão, e o certo para a maioria — e o seletor busca no que já leu, avisando
enquanto a leitura não terminou.

## Candles que chegam como tuplas

Muitas corretoras mandam um array por candle em vez de um objeto. Nomeie as
posições uma vez, dentro da classe, e leia pelo nome.

```ts
import { Connector } from 'fathom';
import type { BarPageRequest, VenueBar } from 'fathom';

export default class Tuples extends Connector {
    private static readonly REST = 'https://api.example.com';

    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;

    /** Quantas posições uma linha precisa ter para valer a leitura. */
    private static readonly FIELDS = 6;

    readonly declaration = {
        book: null,
        tape: null,
        bars: {
            rungs: [{ widthMs: 60_000, anchorMs: 0 }],
            barsPerRequest: 500,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    planInstruments() {
        return { url: this.address(Tuples.REST, '/markets') };
    }

    readInstruments() {
        return [];
    }

    override planBars(request: BarPageRequest) {
        return { url: this.address(Tuples.REST, '/klines', { symbol: request.symbol }) };
    }

    override readBars(payload: unknown): VenueBar[] {
        return this.requireList(payload)
            .map((row) => this.readCandle(row))
            .filter((bar): bar is VenueBar => bar !== null);
    }

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

## Servindo mais de uma largura de candle

Toda receita acima pede uma largura só, que não é o que nenhuma corretora de
verdade faz. O degrau que o gráfico está desenhando chega na requisição, e o
nome que a corretora dá pra ele é uma tabela que você escreve uma vez:

```ts
import { Connector } from 'fathom';
import type { BarPageRequest } from 'fathom';

export default class Widths extends Connector {
    private static readonly REST = 'https://api.example.com';

    /** Como a corretora chama cada largura que serve, pela largura em si. */
    private static readonly WIDTH_NAMES = new Map<number, string>([
        [60_000, '1m'],
        [300_000, '5m'],
        [3_600_000, '1h'],
        [86_400_000, '1d'],
    ]);

    readonly declaration = {
        book: null,
        tape: null,
        bars: {
            // As duas listas são uma lista só: um degrau declarado aqui que o
            // planejador não sabe nomear é um degrau que o gráfico oferece e a
            // corretora recusa.
            rungs: [...Widths.WIDTH_NAMES.keys()].map((widthMs) => ({ widthMs, anchorMs: 0 })),
            barsPerRequest: 500,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    planInstruments() {
        return { url: this.address(Widths.REST, '/markets') };
    }

    readInstruments() {
        return [];
    }

    override planBars(request: BarPageRequest) {
        const interval = Widths.WIDTH_NAMES.get(request.widthMs);
        if (interval === undefined) {
            // Recusado em vez de chutado. Uma largura que a corretora não serve
            // responde com a mais próxima dela, e o gráfico desenha candle de
            // uma hora num eixo de cinco minutos sem dizer nada.
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(Widths.REST, '/candles', {
                symbol: request.symbol,
                interval,
                from: request.fromMs,
                to: request.toMs,
                limit: request.limit,
            }),
        };
    }

    override readBars() {
        return [];
    }
}
```

O `request` carrega tudo que o motor decidiu: o símbolo, `widthMs`, `fromMs`,
`toMs` e o `limit` que ele não vai ultrapassar. Derivar os degraus da mesma
tabela é o que impede a declaração e o planejador de se separarem — a
conferência que pega isso depois é o gráfico vazio de um leitor.

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

    planInstruments() {
        return { url: this.address(Live.REST, '/markets') };
    }

    readInstruments() {
        return [];
    }

    override planStream(symbol: string) {
        return { url: this.address(Live.SOCKET, '/book/' + symbol.toLowerCase()) };
    }

    override planSnapshot(symbol: string) {
        return { url: this.address(Live.REST, '/book', { symbol, depth: 1_000 }) };
    }

    override readSnapshot(payload: unknown): DepthSnapshot {
        return {
            lastUpdateId: this.readNumber((payload as Record<string, unknown>)['seq']) ?? 0,
            bidLevels: this.requireList(payload, 'bids') as SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as SerializedPriceLevel[],
        };
    }

    override readUpdate(payload: unknown): DepthDiff | null {
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
    }
}
```

`readUpdate` devolver `null` é o caso normal, não o caso de falha. Um socket só
carrega tudo que a corretora transmite, então a maioria das mensagens nele não é
sua.

## Um socket com quem é preciso falar

Muitas corretoras recebem a inscrição pelo socket em vez de pela URL, e derrubam
uma conexão em que ninguém falou nada.

```ts
override planStream(symbol: string) {
    return {
        url: 'wss://stream.example.com/v2',
        greetings: [JSON.stringify({ op: 'subscribe', args: ['book.' + symbol] })],
        heartbeat: { everyMs: 20_000, send: JSON.stringify({ op: 'ping' }) },
    };
}
```

O Fathom é dono desse temporizador. Um conector que segurasse um poderia manter
o processo vivo depois que a gravação a que ele pertencia foi desligada, que é a
razão inteira de um conector nunca segurar nada.

## Um socket que você precisa pedir antes

O formato chato, e comum: a URL do socket não é fixa. Você faz um `POST` pedindo
uma, a corretora responde com um endereço válido pelos próximos minutos, e é
nele que você conecta. Um conector nunca busca nada, então ele descreve as duas
metades e o Fathom executa na ordem.

```ts
import { Connector } from 'fathom';
import type { DepthDiff, DepthSnapshot, SerializedPriceLevel, VenueRequest } from 'fathom';

export default class Ticketed extends Connector {
    private static readonly REST = 'https://api.example.com';

    readonly declaration = {
        book: {
            grade: 'linked' as const,
            levelsPerSide: 'all' as const,
            publishIntervalMs: 100,
            clock: 'venue' as const,
        },
        tape: null,
        bars: null,
    };

    planInstruments(): VenueRequest {
        return { url: this.address(Ticketed.REST, '/symbols') };
    }

    readInstruments(): [] {
        return [];
    }

    override planStreamTicket(): VenueRequest {
        // Um método e um corpo, para a corretora que não responde a uma leitura
        // simples. Tudo que uma requisição pode levar está aqui; uma chave não,
        // porque não existe onde guardar uma no Fathom.
        return {
            url: this.address(Ticketed.REST, '/bullet-public'),
            method: 'POST',
            body: JSON.stringify({ scope: 'level2' }),
            headers: { 'content-type': 'application/json' },
        };
    }

    override readStreamTicket(payload: unknown): string {
        const data = (payload as Record<string, Record<string, unknown>>)['data'];

        return String(data?.['endpoint']) + '?token=' + String(data?.['token']);
    }

    override planStream(symbol: string, ticket: string) {
        return {
            url: ticket,
            greetings: [JSON.stringify({ type: 'subscribe', topic: '/market/level2:' + symbol })],
            heartbeat: { everyMs: 20_000, send: JSON.stringify({ type: 'ping' }) },
        };
    }

    override planSnapshot(symbol: string): VenueRequest {
        return { url: this.address(Ticketed.REST, '/book', { symbol }) };
    }

    override readSnapshot(payload: unknown): DepthSnapshot {
        return {
            lastUpdateId: this.readNumber((payload as Record<string, unknown>)['seq']) ?? 0,
            bidLevels: this.requireList(payload, 'bids') as SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as SerializedPriceLevel[],
        };
    }

    override readUpdate(payload: unknown): DepthDiff | null {
        const message = payload as Record<string, unknown>;
        const first = this.readNumber(message['from']);
        const final = this.readNumber(message['to']);
        if (first === null || final === null) {
            return null;
        }

        return {
            firstUpdateId: first,
            finalUpdateId: final,
            previousFinalUpdateId: first - 1,
            bidLevels: this.requireList(message, 'b') as SerializedPriceLevel[],
            askLevels: this.requireList(message, 'a') as SerializedPriceLevel[],
        };
    }
}
```

Um bilhete novo é comprado toda vez que o socket abre, reconexão incluída. É
esse o motivo da divisão: um endereço válido por cinco minutos não serve de nada
para uma gravação que está de pé há seis horas, e a reconexão é exatamente
quando um vencido seria usado.

Deixe `planStreamTicket` de fora e o Fathom não pede nada, entrega um bilhete
vazio ao `planStream` e conecta direto na URL que você nomeou — que é o caso
comum, e por isso é assim que a classe base responde.

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

## O que o motor decide, e o que o seu driver decide

Escrito aqui porque descobrir tentando é pior. A maior parte desta lista é sua
no momento em que você precisar. Dois itens são do motor, e são justamente os
que valem reclamação.

Seus, dentro da sua própria classe:

- **Cabeçalhos, tokens, cookies.** Uma `VenueRequest` carrega `headers`, e é
  você quem constrói o conector antes de entregá-lo ao `registerConnector`, então
  um valor guardado num campo privado chega à corretora como qualquer outro. O
  que o Fathom não tem é onde *guardar* esse valor por você — nenhum cofre,
  nenhum campo para digitar, nada que sobreviva ao build — e no navegador ele vai
  para a página junto com o resto. Isso é motivo para pensar bem em qual chave
  usar, não motivo para um endpoint assinado não poder ser lido.
- **Métodos privados, e estado privado.** O contrato fixa a forma que o motor
  chama, não o interior da classe. O `findContradictions` compara a declaração
  com os métodos do contrato que você sobrescreveu e não olha mais nada, então
  auxiliares, um cache, um cursor, um backoff seu são todos seus para escrever. O
  motor continua entregando a cada método o que ele precisa — a contagem para o
  `continueInstruments`, a requisição para o `readBars` — para que um conector
  *possa* ser escrito sem segurar nada, o que vale a pena onde der: o que você
  segura é seu para manter correto ao longo de uma reconexão, de um segundo
  gráfico e de um replay.

- **A marca com que a sua corretora é desenhada.** As listas que nomeiam uma
  corretora desenham o ícone dela ao lado, adivinhado a partir do host para onde
  vai a sua primeira requisição — o `/favicon.ico` daquela origem. Se a API da
  sua corretora responde num host sem marca própria, diga o endereço:

  ```ts
  readonly markUrl = 'https://brand.example.com/icon.svg';
  ```

  Um palpite que falha não custa nada: a linha cai para a letra inicial da
  corretora, e nada nela se mexe quando a imagem não chega.

Do motor, hoje:

- **Com que velocidade a corretora pode ser consultada** — mas só a forma disso.
  Um conector carrega um `pacing`, e o motor lê ele em vez de um número próprio:

  ```ts
  readonly pacing: VenuePacing = { pagesPerListing: 60, requestsAtOnce: 2 };
  ```

  Não dizer nada é herdar vinte páginas e cinco requisições por vez, que é o que
  as corretoras que já vêm no build toleram. O motor ainda recusa contagem menor
  que um, e recusa mais de quinhentas páginas ou vinte requisições por vez — uma
  proteção contra o erro de digitação que faz a corretora recusar o seu próprio
  endereço, não uma segunda opinião sobre um limite que o conector leu e o motor
  não.
- **O grau declarado é registrado, não usado.** O espelho do Fathom ainda quer a
  referência anterior que um livro `linked` publica, seja lá o que um conector
  declare.

Esses dois últimos são limites, não descuidos esperando ser achados — mas são
limites do motor, e não do que você pode escrever. Se um deles estiver no seu
caminho, vale dizer: são as próximas coisas a mudar.
