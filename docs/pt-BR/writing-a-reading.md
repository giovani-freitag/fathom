# Escrevendo uma leitura

Uma **leitura** é um indicador que você escreve, na própria página, contra a
mesma superfície que os nativos usam. Ele compila enquanto você digita, desenha
no gráfico ao lado do editor, e nunca sai do seu navegador.

Este guia vai da menor leitura que funciona até as partes que você só vai
precisar no fim. Todo exemplo aqui compila.

Exemplos prontos que você abre com um clique:
[github.com/giovani-freitag/fathom-example-addons](https://github.com/giovani-freitag/fathom-example-addons)
— checados contra esta superfície a cada push, então nada lá é um trecho que
funcionava antes.

---

## 1. A menor leitura que funciona

```ts
import { Plot } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft } from 'fathom';

export default class Midpoint implements Indicator {
    readonly label = 'Midpoint';
    readonly parameters = [];

    compute(input: IndicatorInput): PlanDraft {
        const middle = input.bars.bars.map((bar) => (bar.highPrice + bar.lowPrice) / 2);

        return Plot.over(input.bars).line(middle, 'Midpoint').overThePrice();
    }
}
```

É uma leitura inteira. Aperte **Escrever uma leitura**, cole, e ela desenha.

Três coisas valem para toda leitura:

- Ela mora em **`main.ts`**, e o **export default** é a leitura.
- Ela importa de **`'fathom'`** e dos próprios arquivos. Nada mais resolve.
- **`compute` é aritmética.** Ele roda de novo a cada barra, a cada arrasto e a
  cada zoom, então não pode buscar, esperar nem lembrar nada entre as chamadas.

---

## 2. As cinco partes

```ts
export default class MyReading implements Indicator {
    readonly label = 'My reading';          // obrigatório — como o gráfico a chama
    readonly about = 'One line about it';   // opcional — aparece onde se escolhe uma camada
    readonly parameters = [];               // obrigatório — os botões, talvez nenhum
    readonly scale = { kind: 'price' };     // opcional — em geral decidido pelo builder

    resolveSources(settings) { … }          // opcional — o que o gráfico precisa buscar antes
    compute(input) { … }                    // obrigatório — a aritmética
}
```

`implements Indicator` em vez de `extends` qualquer coisa: não há classe base
para importar, e uma leitura que você escreve tem a mesma forma de uma que vem
junto.

**`label`** aparece na legenda e na lista de camadas. **`about`** é uma linha
sob o nome onde o leitor adiciona uma camada. Os dois são strings comuns — veja
a [§9](#_9-duas-linguas) para escrevê-los em mais de um idioma.

---

## 3. O que você recebe

`compute` recebe um objeto:

```ts
interface IndicatorInput {
    readonly bars: PriceBarWindow;
    readonly settings: IndicatorSettings;
    readonly sessions: Readonly<Record<string, SettledSessions>>;
}
```

### As barras

`input.bars.bars` é o array, da mais antiga para a mais nova. Cada barra:

```ts
interface PriceBar {
    readonly openedAtMs: number;   // bordas do balde, sempre alinhadas
    readonly closedAtMs: number;
    readonly openPrice: number;
    readonly highPrice: number;
    readonly lowPrice: number;
    readonly closePrice: number;
    readonly buyVolume: number;    // o que cruzou o spread, por lado
    readonly sellVolume: number;
    readonly tradeCount: number;
    readonly expectedFrames: number;   // quadros que um balde inteiro desta largura tem
    readonly frameCount: number;       // quadros de fato gravados
    readonly isClosed: boolean;        // falso para a barra ainda se formando
}
```

`buyVolume` e `sellVolume` são o par que este gráfico tem e a maioria não: um
zero é uma resposta de verdade, e significa um balde atravessado com o livro
sendo gravado e ninguém negociando.

`frameCount` menor que `expectedFrames` quer dizer que a barra foi montada com
menos do que devia — uma lacuna na gravação, não um mercado parado.
`classifyBar` diz qual é o caso.

`input.bars` também carrega `instrumentSymbol` e `intervalMs`.

### Um valor por barra desenhada

Toda série que você plota precisa ter exatamente um valor por barra em
`input.bars.bars`. Devolva um comprimento diferente e o builder joga, dizendo o
que recebeu e o que esperava. Use `Number.NaN` para "sem resposta aqui" — isso
quebra a linha em vez de fazer ponte sobre a lacuna.

---

## 4. Desenhando

`Plot.over(input.bars)` começa um plano. Você acrescenta séries e depois diz
para onde ele vai. A última chamada devolve o plano, então ela sempre encerra a
corrente.

### Séries

```ts
Plot.over(input.bars)
    .line(values, 'Mean')            // uma linha ligada
    .histogram(values, 'Delta')      // barras a partir de uma base
    .dots(values, 'Stop')            // marcas que não são ligadas
    .lines({ Upper: a, Lower: b })   // várias linhas de uma vez, em ordem
```

`dots` é para uma leitura que pula de um lado do preço para o outro: ligar as
marcas desenharia, a cada pulo, um traço atravessando o preço que leitura
nenhuma fez.

### Estilizando a que você acabou de acrescentar

```ts
    .in('amber')          // um token da paleta, nunca uma cor CSS
    .dashed()
    .thick(2)
    .risingAndFalling()   // separa por lado em torno de uma base, zero por padrão
```

Tons: `bid`, `ask`, `amber`, `phosphor`, `violet`, `cyan`, `ink`, `muted`.
Deixe a cor de fora e o leitor escolhe na lista de camadas, que é o que a
maioria das leituras deveria fazer.

### Marcas que não são séries

```ts
    .at(70, 'muted')            // uma linha horizontal num valor fixo
    .shading(0, 1, 'amber')     // preenche entre duas séries, pela ordem em que entraram
    .namingEachLine()           // escreve o nome de cada série no fim da própria linha
```

### Onde ele vai — uma destas encerra a corrente

```ts
    .overThePrice()        // sobre o próprio preço
    .inItsOwnBand()        // uma faixa embaixo, escalada pelo que os valores alcançam
    .between(0, 100)       // uma faixa presa a um intervalo fixo
    .aboutZero()           // uma faixa centrada no zero
    .alongTheFloor(0.2)    // uma tira ao longo do rodapé do painel de preço
```

`alongTheFloor` não custa altura ao preço, só um pedaço do chão dele — é o que o
volume usa.

### Mais duas, de vez em quando

```ts
    .summarisedAs('20, close')   // o que a legenda diz sobre os ajustes
    .converged(false)            // veja a §7
```

**Orçamento:** no máximo 8 séries e 8192 pontos cada. Um plano acima disso é
recusado inteiro em vez de ser cortado, e o rodapé do editor diz qual limite foi
ultrapassado — mas só enquanto a leitura estiver aberta, então
`isPlanWithinBudget` continua ali para você checar um plano antes do gráfico.

---

## 5. Botões que o leitor pode girar

Um parâmetro é construído uma vez, fora da classe. O objeto que você constrói é
ao mesmo tempo o que o painel de ajustes mostra e o que você usa para ler o
valor de volta.

```ts
import { Params, readSetting, readToggle, readChoice } from 'fathom';

const PERIOD = Params.integer('periodBars')   // guardado sob este nome
    .called('Period')                         // o que o painel mostra
    .between(2, 400)                          // limitado a este intervalo
    .by(1)                                    // quanto um toque move
    .startingAt(20);

const BAND = Params.decimal('deviations').called('Deviations').between(0.5, 5).startingAt(2);
const MODE = Params.choice('mode', ['Fast', 'Slow']).called('Mode').startingAt('Fast');
const FILL = Params.toggle('isFilled').called('Fill it').startingAt(true);
```

Depois, no `compute`:

```ts
const periodBars = readSetting(input.settings, PERIOD);   // número
const deviations = readSetting(input.settings, BAND);     // número
const mode = readChoice(input.settings, MODE);            // string
const isFilled = readToggle(input.settings, FILL);        // booleano
```

Ponha cada um que você construiu em
`readonly parameters = [PERIOD, BAND, MODE, FILL]`, na ordem em que quer que
apareçam.

Os valores de uma escolha aparecem como estão, então mantenha-os legíveis — e
mantenha-os estáveis, porque o valor é o que fica guardado.

---

## 6. O que o gráfico precisa buscar antes

Uma média de vinte barras precisa de dezenove barras de histórico antes da
primeira desenhada, senão a borda esquerda fica em branco sem precisar. Peça, e
o gráfico as busca; elas chegam como parte de `input.bars` e a janela desenhada
não muda.

```ts
resolveSources(settings: IndicatorSettings): SourceRequest {
    return { warmupBars: readSetting(settings, PERIOD) };
}
```

Peça o que você de fato lê. Uma leitura que declara aquecimento que não usa se
declara não convergida quando o arquivo começa no meio da janela, o que é um
aviso sobre nada.

---

## 7. Um tempo gráfico mais grosso

Para uma leitura desenhada em barras de um minuto que precisa do fechamento de
ontem, declare a sessão com um nome seu:

```ts
resolveSources(): SourceRequest {
    return { sessions: { previous: { intervalMs: 86_400_000, reachingBack: 1 } } };
}
```

`reachingBack` é quantas sessões já assentadas você precisa antes da janela
abrir. Depois leia de volta:

```ts
const previous = readSessions(input, 'previous');

previous.hasAny             // falso se nada tinha assentado em nenhuma barra desenhada
previous.perBar[index]      // a sessão mais recente já fechada quando essa barra abriu
previous.turnsOver[index]   // 1 onde esta barra é a primeira depois da virada
previous.closed             // toda sessão assentada, da mais antiga para a mais nova
previous.indexPerBar[index] // onde em `closed` a sessão desta barra está
```

**Os quatro são segurados no que cada barra desenhada podia saber**, então não
existe índice que alcance uma sessão que a barra não poderia ter visto. Uma
leitura escrita contra eles não repinta.

`perBar[index]` é `undefined` na borda esquerda, antes de qualquer coisa ter
assentado. `?? Number.NaN` é a resposta de sempre.

Pedir um nome que você nunca declarou joga, e diz quais nomes você declarou. É a
única falha que este desenho se recusa a deixar silenciosa.

### Um número calculado sobre o tempo gráfico mais grosso

`perBar` responde *o que esta barra sabia*, que é uma sessão. Para uma média,
uma amplitude ou qualquer coisa com memória, você precisa da corrida — que é
`closed`, e `indexPerBar` diz onde cada barra desenhada cai nela:

```ts
const period = 50;
const held = readSessions(input, 'previous');

// Calculado uma vez sobre a corrida, depois segurado em cada barra desenhada:
// um degrau, porque a média mais grossa não se moveu entre os fechamentos.
const means = exponentialMean(held.closed.map((bar) => bar.closePrice), period);
const perBar = [...held.indexPerBar]
    .map((at) => (at < 0 ? Number.NaN : means[at] ?? Number.NaN));
```

`closed` alcança para trás por `reachingBack` sessões, então peça um múltiplo do
período em vez de uma: `reachingBack: period * 8` entrega quatrocentos
fechamentos a uma média de cinquenta períodos, e custa a mesma única requisição
por tempo gráfico que pedir uma. Nada ainda se formando está lá dentro.

Quais tempos gráficos uma corretora publica é uma lista fixa — um minuto, cinco,
quinze, trinta, uma hora, duas, quatro, um dia, uma semana. O mês não está nela
e não pode estar: a lista é indexada por uma largura em milissegundos e um mês
não tem largura fixa.

### Dizendo que você ainda não tem nada

```ts
    .converged(previous.hasAny)
```

A legenda então marca a leitura como ainda não convergida, em vez de deixar uma
linha em branco parecer uma linha reta.

---

## 8. Mais de um arquivo

Aperte o botão de **novo arquivo** na barra e dê um nome a ele. Uma leitura
começa em `main.ts`; todo o resto é seu para organizar.

```ts
// maths/mean.ts
export function rollingMean(values: readonly number[], periodBars: number): number[] {
    // …
}
```

```ts
// main.ts
import { rollingMean } from './maths/mean.js';
```

Só caminhos relativos, e só dentro da leitura: `./`, `../`, e `index.ts` para
uma pasta. Escreva a terminação ou deixe de fora — `./maths/mean`,
`./maths/mean.ts` e `./maths/mean.js` acham o mesmo arquivo, o último porque é
assim que o TypeScript manda escrever um import.

Cada arquivo roda uma vez, por mais que outros o peçam. Dois arquivos que
importam um ao outro recebem o que o outro exportou até ali, em vez de entrar em
laço. Um arquivo que joga não fica guardado: o próximo `require` roda de novo e
joga de novo.

`'fathom'` é a única outra coisa que resolve. **Não há npm aqui.**

Um arquivo que você tira é oferecido de volta por alguns segundos, como uma
leitura apagada.

---

## 9. Duas línguas

A interface tem duas. Uma leitura dá nome a si mesma, então pode responder nas
duas:

```ts
import { inWords } from 'fathom';

readonly label = inWords({ en: 'My mean', 'pt-BR': 'Minha média' });
```

`en` é obrigatório e é para onde cai um idioma que você não escreveu. Funciona
em qualquer lugar do arquivo — um campo, o rótulo de um parâmetro, o nome de uma
série — porque trocar o idioma reconstrói toda leitura a partir do JavaScript em
que ela foi salva, então o arquivo inteiro roda de novo com o novo idioma
valendo.

---

## 10. Vendo o que de fato chegou

`console.log` funciona, e imprime no **Console** abaixo do editor, não no do
navegador.

```ts
console.log('bars', input.bars.bars.length, 'first', input.bars.bars[0]);
```

Séries são impressas com o comprimento — `Float64Array(43) [81176.4, …31 more]`
—, listas mostram os doze primeiros e contam o resto, e objetos são abertos até
dois níveis.

`compute` roda de novo a cada barra, arrasto e zoom, então uma linha impressa
dentro dele chega o tempo todo: uma linha impressa duas vezes seguidas aparece
uma vez com uma contagem ao lado, só as últimas 200 ficam guardadas, e quando
mais de uma leitura está imprimindo cada linha é nomeada. `warn` e `error` são
marcados; `info` e `debug` valem como `log`. Nada mais do console de verdade é
oferecido.

---

## 11. Compartilhando uma

**Para fora.** Uma leitura de um arquivo exporta como `.ts`. Uma de vários
exporta como um `.fathom.json` com todos eles, que é também de onde ela abre.

**Para dentro, de um arquivo.** O botão de abrir aceita um `.ts`, um `.tsx` ou
um pacote.

**Para dentro, de um repositório ou de um pacote.** O botão de nuvem aceita:

```text
gh/user/repo                       a tag mais nova, ou o branch padrão
gh/user/repo@main/readings/mean    um branch, e uma pasta dentro dele
npm/@someone/reading@1.2.0
```

Um endereço copiado do GitHub ou do npm também funciona. Ele pega os arquivos
`.ts` e `.tsx` sob a pasta que você nomeou — até quarenta e 512 kB, entrada em
`main.ts` ou `index.ts`, `.d.ts` de fora — e os abre como uma leitura, marcada
como não salva.

Você vê a lista de arquivos e de onde eles vieram antes de qualquer coisa ser
buscada, e a busca é exatamente do que foi mostrado. Cada arquivo é conferido
contra o tamanho e o hash que a listagem informou.

> O que você traz é código de outra pessoa, e ele roda nesta página assim que
> abrir — do mesmo jeito que o seu. Traga apenas o que você mesmo rodaria.

---

## 12. Tudo na superfície

Tudo que é importável de `'fathom'`. Nada fora desta lista é público.

### Começando um plano e um parâmetro

| | |
|---|---|
| `Plot.over(bars)` | Começa um plano ligado às barras desenhadas. |
| `Params.integer(name)` `.decimal` `.choice` `.toggle` | Constrói um botão. |

### Lendo ajustes e sessões

| | |
|---|---|
| `readSetting(settings, parameter)` | O valor de um botão numérico. |
| `readToggle(settings, parameter)` | O valor de um interruptor. |
| `readChoice(settings, parameter)` | O valor de uma escolha. |
| `readSessions(input, name)` | Uma sessão declarada. Joga num nome que você não declarou. |
| `summariseParameters(parameters, settings)` | O resumo que a legenda faz dos ajustes. |

### As barras

| | |
|---|---|
| `readBarSource(bar, source)` | Uma barra sob `'close'`, `'hl2'`, `'ohlc4'` e o resto. |
| `collectSource(bars, settings)` | A fonte escolhida ao longo de todas as barras. |
| `collectInstants(bars)` | O instante de fechamento de cada barra. |
| `classifyBar(bar)` | Se a barra foi gravada por inteiro. |
| `findContinuousSegments(bars)` | Trechos de barras sem lacuna entre elas. |
| `BAR_SOURCES`, `SOURCE` | Os nomes das fontes, e uma escolha pronta sobre eles. |

### A aritmética que as leituras nativas usam

| | |
|---|---|
| `createBlankValues(length)` | Um `Float64Array` de NaN. |
| `smoothWilder(previous, sample, periodBars)` | Um passo de Wilder. |
| `fillWilder(fill)` / `fillExponential(fill)` | Uma série suavizada inteira, no lugar. |
| `resolveExponentialWeight(periodBars)` | O α que uma EMA desse tamanho usa. |
| `resolveTrueRange(bar, previousClose)` / `collectTrueRanges(bars, segment)` | True range. |
| `holdLastClosed(bars, higher)` | Alinha um tempo gráfico mais grosso à mão, como o host faz. |

### Palavras, orçamentos e formas

| | |
|---|---|
| `inWords(words)` | Uma frase no idioma do leitor. |
| `isPlanWithinBudget(plan)` | Se um plano está dentro do orçamento de 8 × 8192. |
| `PLOT_TONES`, `PLOT_BUDGET`, `BAR_BUDGET`, `NO_SESSIONS` | As constantes por trás de tudo. |

Tipos: `Indicator`, `IndicatorInput`, `IndicatorSettings`, `PlanDraft`,
`SourceRequest`, `SessionRequest`, `SettledSessions`, `PriceBar`,
`PriceBarWindow`, `PlotSeries`, `PlotShape`, `PlotTone`, `PlotScale`,
`PlotBand`, `PlotLevel`, `PlotValues`, `NumericParameter`, `ChoiceParameter`,
`ToggleParameter`, `IndicatorParameter`, `Tunable`, `BarSource`,
`BarCompleteness`, `BarSegment`, `SeriesFill`, `Words`, `Locale`, `DrawPlan`.

---

## 13. O que uma leitura não pode fazer

Dito sem rodeio, porque descobrir tentando é pior.

- **Sem npm.** Nada fora de `'fathom'` e dos seus próprios arquivos resolve. Um
  pacote cujo código importe qualquer outra coisa não vai compilar, e o editor
  diz qual import ele não achou.
- **Sem buscar, sem temporizadores, sem estado entre chamadas.** `compute` é
  chamado de novo a cada redesenho; qualquer coisa que ele lembre é um bug
  esperando um arrasto.
- **Sem livro, sem execuções, sem lacunas.** Uma leitura alcança as barras e as
  sessões. O campo de livro de ofertas em torno do qual este gráfico é
  construído ainda não está na superfície.
- **Sem sandbox.** Uma leitura roda na página, na thread principal, como as
  nativas. Ela alcança um global se for procurar. Um laço infinito leva a aba
  junto.
- **Sem cor própria.** Os tons vêm da paleta, então uma leitura continua legível
  quando o tema muda.
- **Nada prometido entre versões.** A superfície é um barril só e pode mudar.
  Uma leitura que para de compilar depois de uma atualização informa o erro do
  próprio compilador, e o código continua seu.

---

O desenho por trás de tudo isto — o que foi decidido e o que custou — está no
[ADR 23](/en/adr/0023-a-reader-writes-an-indicator-in-the-page).
