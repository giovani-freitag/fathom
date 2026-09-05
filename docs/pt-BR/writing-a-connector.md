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

    planInstruments() {
        return { url: this.address(KuCoin.REST, '/api/v2/symbols') };
    }

    readInstruments(payload: unknown): VenueInstrument[] {
        return [];
    }
}
```

Isso é um conector inteiro. Três membros, e não há um quarto para lembrar: uma
corretora que não declara nada além da listagem não escreve nada além dela.

Todo o resto — o socket, o snapshot, os candles — vem do `Connector`, e tudo que
vem de lá recusa. Peça uma página de candles a uma corretora assim e ela diz que
não serve nenhum, com essas palavras, em vez de devolver uma página vazia que se
parece com um mercado parado.

Então você escreve um método quando, e só quando, sua declaração reivindica o
que está por trás dele. Os dois são conferidos um contra o outro na hora de
salvar: declare um livro sem os métodos para ler um e o Fathom nomeia os que
você não escreveu, e escreva os métodos sem declarar e o Fathom também avisa.

Cada um dos três campos de `declaration` é obrigatório, e cada um é descrito ou
`null`. Você precisa digitar o `null` — e digitar é o momento em que você lê o
que o Fathom faz no lugar.

O `Connector` também traz as duas leituras que todo conector acaba repetindo:

| | |
|---|---|
| `this.address(base, caminho, query)` | Uma URL, montada com `URL` e escapada para você. |
| `this.readNumber(campo)` | Um número, ou `null` quando não dá para ler como um. |
| `this.requireList(payload, 'data')` | Uma lista dentro da resposta, ou um erro dizendo que não veio nenhuma. |

Todo endereço deste guia passa pelo `address`. Uma URL colada à mão é uma URL
com um símbolo dentro sem escape, e o único par com `&` no nome é justamente o
que pede outra coisa sem avisar.

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
planInstruments() {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols') };
}

readInstruments(payload: unknown): VenueInstrument[] {
    return this.requireList(payload, 'data').map((listing) => {
        const entry = listing as Record<string, unknown>;
        return {
            symbol: String(entry['symbol']),
            base: String(entry['baseCurrency']),
            quote: String(entry['quoteCurrency']),
            priceStep: this.readNumber(entry['priceIncrement']) ?? 0,
            isTrading: entry['enableTrading'] === true,
        };
    });
}
```

`payload` é o que a corretora respondeu, já convertido de JSON. O `requireList`
lança o erro por você quando não existe lista onde você disse que existe. Em
qualquer outro ponto em que o formato te surpreender, lance um erro com uma
frase sua — o seletor mostra ela para quem estiver lendo.

### Uma listagem servida em páginas

Algumas corretoras entregam algumas centenas de pares por vez. O
`planInstruments` recebe o deslocamento que estão pedindo, então diga onde uma
página está e quantos existem no total:

```ts
planInstruments(from: number) {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols', { offset: from, limit: 500 }) };
}

override readInstrumentTotal(payload: unknown) {
    return this.readNumber((payload as Record<string, unknown>)['total']);
}
```

Esse par é o que dá ao leitor uma listagem em vez de uma espera. Sabendo o
total, o Fathom calcula o endereço de todas as páginas a partir da primeira e
pede **junto** — cinco no ar por vez, e cada uma entregue ao seletor conforme
chega, então os primeiros quinhentos pares já estão na tela enquanto o resto
vem.

Uma corretora que entrega um cursor em vez de um total tem páginas que só dá
para caminhar, e o `continueInstruments` é onde você diz isso:

```ts
override continueInstruments(payload: unknown, read: number) {
    void read;
    const cursor = (payload as { cursor?: string }).cursor;

    return cursor === undefined ? null : { url: this.address(KuCoin.REST, '/api/v2/symbols', { cursor }) };
}
```

De um jeito ou de outro o Fathom para na vigésima página, então uma corretora
cuja resposta nunca diz que acabou para na conta dele, não na sua.

### Uma corretora que busca por você

Um leitor digitando enquanto quatro mil pares ainda chegam está buscando no que
já caiu. Onde a corretora casa o texto por conta própria, passe a pergunta para
ela:

```ts
override planInstrumentSearch(term: string) {
    return { url: this.address(KuCoin.REST, '/api/v2/symbols', { query: term }) };
}
```

A resposta é lida pelo seu próprio `readInstruments`. Deixe o método de fora — o
padrão, e o certo para a maioria — e o seletor busca no que já leu, avisando
enquanto a leitura não terminou.

## Lendo candles

```ts
override planBars(request: BarPageRequest) {
    return {
        url: this.address(KuCoin.REST, '/api/v1/market/candles', {
            type: '1min',
            symbol: request.symbol,
            startAt: Math.floor(request.fromMs / 1_000),
            endAt: Math.floor(request.toMs / 1_000),
        }),
    };
}

override readBars(payload: unknown, request: BarPageRequest): VenueBar[] {
    return [];
}
```

O `override` é o que diz que você está entrando no lugar da recusa que herdou.
Sem ele o compilador avisa, que é a mesma conferência pelo outro lado: um método
escrito quase certo é um método que o Fathom nunca chama.

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

## Um socket que você precisa comprar antes

Muitas corretoras não dão uma URL fixa de socket. Você pede uma, elas devolvem
um endereço de curta duração, e é nele que você conecta. Um conector não busca
nada, então ele descreve as duas metades e o Fathom executa na ordem.

```ts
override planStreamTicket() {
    return { url: this.address(KuCoin.REST, '/api/v1/bullet-public'), method: 'POST' as const };
}

override readStreamTicket(payload: unknown): string {
    const data = (payload as Record<string, Record<string, unknown>>)['data'];
    return String((this.requireList(data, 'instanceServers')[0] as
        Record<string, unknown>)['endpoint']) + '?token=' + String(data?.['token']);
}

override planStream(symbol: string, ticket: string) {
    return {
        url: ticket,
        greetings: [JSON.stringify({ type: 'subscribe', topic: '/market/level2:' + symbol })],
        heartbeat: { everyMs: 20_000, send: JSON.stringify({ type: 'ping' }) },
    };
}
```

Qualquer pedido que você descrever pode levar `method`, `body` e `headers` — é
tudo que um `POST` precisa aqui. O que ele não pode levar é segredo: não existe
lugar no Fathom para guardar uma chave, então só dá para ler endpoint que não
pede assinatura.

O Fathom compra um bilhete novo toda vez que abre o socket, inclusive depois de
uma reconexão, porque um endereço de curta duração é curto justamente quando a
transmissão cai. E o temporizador do heartbeat é dele, pela razão lá do começo
da página.

## Instalando

Salve. A corretora aparece entre as outras no seletor de contrato, e o Fathom já
pergunta o que ela negocia. Marque um par para guardar ele em uma das suas
tags.

Seu conector é guardado como o código que você escreveu, então continua lá
semana que vem — e assim você consegue ler o que instalou antes que rode de
novo.

::: warning Onde seus conectores ficam guardados
Como os indicadores salvos, eles ficam no armazenamento local do navegador.
Limpar os dados do site leva eles junto. Exporte o que quiser manter.
:::

## O que um conector ainda não faz

- **Sem segredos.** Um pedido leva cabeçalhos, e não existe onde guardar a chave
  que iria em um deles. Só dá para ler endpoint que não pede assinatura, o que
  deixa de fora quase tudo que uma corretora põe atrás de uma conta.
- **O gráfico, não o coletor.** Um conector que você instala vive no seu
  navegador, então o servidor que grava livros de ofertas não o enxerga. Uma
  corretora trazida assim te dá uma listagem de pares e nada além: sem gravação
  atrás de um par, não há o que o gráfico abrir.
- **Só livro encadeado.** O grau que um conector declara é registrado mas ainda
  não é usado. O espelho do Fathom ainda precisa da referência anterior que a
  corretora nativa publica.
- **Nem toda corretora deixa uma página ler.** As seis que já vêm aqui publicam
  o cabeçalho que o navegador exige; muitas não publicam, a KuCoin entre elas.
  Onde o Fathom tem servidor, os pedidos passam por ele — só https, sem
  redirecionar, e sem alcançar nada da rede do próprio servidor. Na demo
  só-navegador não há a quem pedir, então só dá para ler corretora que deixa a
  página entrar.

## Mais receitas

Conectores inteiros para os formatos em que as corretoras vêm — uma listagem que
chega em páginas, candles como tuplas, um livro ao vivo, um socket que você
precisa pedir antes, um livro do qual você só recebe uma janela — estão no
[livro de receitas](/pt-BR/connector-cookbook).

## Um exemplo pronto

O [exemplo `kucoin`](https://github.com/giovani-freitag/fathom-example-addons/tree/main/src/addons/kucoin)
é um conector completo com testes, incluindo os segundos, a ordem dos campos e a
página invertida.

---

O raciocínio por trás de tudo isto está no
[ADR 25](/en/adr/0025-a-reader-brings-the-venue-as-well-as-the-indicator)
(em inglês).
