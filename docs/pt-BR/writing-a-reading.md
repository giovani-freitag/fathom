# Escrevendo um indicador

## Introdução

Um indicador que você escreve usa exatamente a mesma interface dos dezoito que
já vêm com o Fathom. Não existe API de plugin nem superfície de segunda classe:
o que você escreve e o que vem pronto têm a mesma forma.

Você escreve na própria página. Clique em **Escrever uma leitura** na barra e um
editor abre ao lado do gráfico. Ele compila enquanto você digita, e o que ele
desenha aparece no gráfico bem ao lado.

Este guia começa pelo menor indicador que funciona e vai até as partes que você
só vai usar no fim. Todo exemplo aqui compila.

::: tip Aprenda com código que roda
O [repositório de addons de exemplo](https://github.com/giovani-freitag/fathom-example-addons)
tem vários indicadores completos, com testes. Eles são checados contra
exatamente esta superfície a cada push, então nada lá é um trecho que
funcionava antes.
:::

## Seu primeiro indicador

Aqui está um indicador completo e funcionando. Ele desenha o ponto médio de cada
barra.

```ts
import { Plot } from 'fathom';
import type { Indicator, IndicatorInput, PlanDraft } from 'fathom';

export default class Midpoint implements Indicator {
    readonly label = 'Ponto médio';
    readonly parameters = [];

    compute(input: IndicatorInput): PlanDraft {
        const middle = input.bars.bars.map((bar) => (bar.highPrice + bar.lowPrice) / 2);

        return Plot.over(input.bars).line(middle, 'Ponto médio').overThePrice();
    }
}
```

Clique em **Escrever uma leitura**, cole, e ele desenha.

Três coisas valem para todo indicador que você escreve:

- Ele mora em **`main.ts`**, e o **export default** é o indicador.
- Ele pode importar de **`'fathom'`** e dos próprios arquivos. Nada mais
  resolve.
- **`compute` é aritmética.** Ele roda de novo a cada barra nova, a cada arrasto
  e a cada zoom, então nunca pode buscar, esperar, nem lembrar nada entre
  chamadas.

## A forma de um indicador

Um indicador é uma classe com até cinco membros. Dois são obrigatórios.

```ts
export default class MeuIndicador implements Indicator {
    readonly label = 'Meu indicador';        // obrigatório — como o gráfico o chama
    readonly about = 'Uma linha sobre ele';  // opcional — aparece ao escolher a camada
    readonly parameters = [];                // obrigatório — os botões, talvez nenhum
    readonly scale = { kind: 'price' };      // opcional — normalmente já decidido

    resolveSources(settings) { … }           // opcional — o que buscar antes
    compute(input) { … }                     // obrigatório — a aritmética
}
```

Repare no `implements Indicator` em vez de `extends` alguma coisa. Não tem
classe base para importar. Um indicador que você escreve tem a mesma forma de um
que já vem.

`label` aparece na legenda e na lista de camadas. `about` é a única linha
mostrada abaixo do nome quando alguém está escolhendo o que adicionar. Os dois
são strings simples — veja [Dois idiomas](#dois-idiomas) se quiser traduzir.

## O que o compute recebe

O `compute` recebe um objeto:

```ts
interface IndicatorInput {
    readonly bars: PriceBarWindow;
    readonly settings: IndicatorSettings;
    readonly sessions: Readonly<Record<string, SettledSessions>>;
}
```

### As barras

`input.bars.bars` é o array de barras, da mais antiga para a mais nova. Cada uma
é assim:

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
    readonly expectedFrames: number;   // quadros que um balde inteiro dessa largura tem
    readonly frameCount: number;       // quadros realmente gravados
    readonly isClosed: boolean;        // falso para a barra ainda se formando
}
```

`buyVolume` e `sellVolume` são o par que a maioria dos gráficos não tem. Um zero
em qualquer um deles é uma resposta de verdade: significa um balde em que o
livro foi gravado e ninguém negociou daquele lado.

Quando `frameCount` fica abaixo de `expectedFrames`, a barra foi montada com
menos do que deveria. Isso é uma lacuna na gravação, não um mercado parado. Use
`classifyBar` quando precisar distinguir os dois.

O `input.bars` também carrega `instrumentSymbol` e `intervalMs`.

### Um valor por barra

Toda série que você plota precisa ter exatamente um valor para cada barra em
`input.bars.bars`. Devolva um tamanho diferente e o construtor do plano lança um
erro, dizendo o que recebeu e o que esperava.

Quando você não tem resposta para uma barra, use `Number.NaN`. Isso quebra a
linha naquele ponto em vez de desenhar um trecho reto atravessando a lacuna.

## Desenhando

`Plot.over(input.bars)` começa um plano. Você adiciona séries, estiliza e termina
dizendo para onde o plano vai. Essa última chamada devolve o plano, então ela
sempre encerra a corrente.

### Séries

```ts
Plot.over(input.bars)
    .line(values, 'Média')                 // uma linha ligada
    .histogram(values, 'Delta')            // barras a partir de uma base
    .dots(values, 'Stop')                  // marcas que não se ligam
    .lines({ Superior: a, Inferior: b })   // várias linhas de uma vez, em ordem
```

Use `dots` quando seu indicador pula de um lado do preço para o outro. Ligar as
marcas desenharia um traço atravessando o preço a cada virada, que é um
movimento que o indicador nunca fez.

### Estilizando o que você acabou de adicionar

Cada chamada de estilo se aplica à série adicionada logo antes.

```ts
    .in('amber')          // um token da paleta, nunca uma cor CSS
    .dashed()
    .thick(2)
    .risingAndFalling()   // separada por lado em torno de uma base, zero por padrão
```

Os tons são `bid`, `ask`, `amber`, `phosphor`, `violet`, `cyan`, `ink` e
`muted`.

Deixe a cor de fora e quem estiver lendo escolhe na lista de camadas. É isso que
a maioria dos indicadores deveria fazer — mantém a legibilidade quando o tema
muda.

### Níveis e sombreado

```ts
    .at(70, 'muted')            // uma linha horizontal num valor fixo
    .shading(0, 1, 'amber')     // preenche entre duas séries, pela ordem em que entraram
    .namingEachLine()           // escreve o nome de cada série no fim da linha
```

### Para onde o plano vai

Uma destas encerra a corrente.

```ts
    .overThePrice()        // sobre o próprio preço
    .inItsOwnBand()        // uma faixa embaixo, na escala do que os valores alcançam
    .between(0, 100)       // uma faixa presa a um intervalo fixo
    .aboutZero()           // uma faixa centrada no zero
    .alongTheFloor(0.2)    // uma tira no rodapé do painel de preço
```

`alongTheFloor` não custa altura nenhuma ao painel de preço, só um pedaço do
chão dele. É o que o indicador de volume nativo usa.

Mais duas chamadas aparecem de vez em quando:

```ts
    .summarisedAs('20, fechamento')   // o que a legenda diz sobre os ajustes
    .converged(false)                 // veja Sessões mais grossas, abaixo
```

### O orçamento

Um plano pode ter no máximo **8 séries de 8192 pontos cada**. Um plano acima
disso é recusado inteiro em vez de ser cortado em silêncio, e o rodapé do editor
diz qual limite você passou.

Essa mensagem só aparece enquanto o indicador está aberto no editor, então
`isPlanWithinBudget` existe para você checar um plano por conta própria.

## Parâmetros

Um parâmetro é construído uma vez, fora da classe. O objeto que você constrói é
tanto o que o painel de ajustes desenha quanto o que você usa para ler o valor
de volta.

```ts
import { Params, readSetting, readToggle, readChoice } from 'fathom';

const PERIOD = Params.integer('periodBars')   // guardado com esse nome
    .called('Período')                        // o que o painel mostra
    .between(2, 400)                          // limitado a esse intervalo
    .by(1)                                    // quanto um clique move
    .startingAt(20);

const BAND = Params.decimal('deviations').called('Desvios').between(0.5, 5).startingAt(2);
const MODE = Params.choice('mode', ['Rápido', 'Lento']).called('Modo').startingAt('Rápido');
const FILL = Params.toggle('isFilled').called('Preencher').startingAt(true);
```

Leia dentro do `compute`:

```ts
const periodBars = readSetting(input.settings, PERIOD);   // número
const deviations = readSetting(input.settings, BAND);     // número
const mode = readChoice(input.settings, MODE);            // string
const isFilled = readToggle(input.settings, FILL);        // booleano
```

Por fim, liste todo parâmetro que você construiu em `readonly parameters`, na
ordem em que quer que apareçam:

```ts
readonly parameters = [PERIOD, BAND, MODE, FILL];
```

::: warning Escolhas são guardadas como escritas
Os valores de uma escolha são mostrados exatamente como você escreveu, então
mantenha-os legíveis. E mantenha-os estáveis: a string é o que fica salvo, então
renomear uma perde o ajuste de quem já tinha escolhido ela.
:::

## Barras de aquecimento

Uma média de vinte barras precisa de dezenove barras de histórico antes da
primeira desenhada, senão a borda esquerda fica em branco sem precisar.

Peça, e o Fathom busca. Elas chegam dentro de `input.bars`, e a janela desenhada
não muda.

```ts
resolveSources(settings: IndicatorSettings): SourceRequest {
    return { warmupBars: readSetting(settings, PERIOD) };
}
```

Peça o que você realmente lê, e nada além. Um indicador que declara aquecimento
que não usa se reporta como não convergido sempre que a gravação começa no meio
da janela, e isso é um aviso sobre nada.

## Sessões mais grossas

Digamos que seu indicador desenha em barras de um minuto mas precisa do
fechamento de ontem. Declare a sessão mais grossa com um nome seu:

```ts
resolveSources(): SourceRequest {
    return { sessions: { anterior: { intervalMs: 86_400_000, reachingBack: 1 } } };
}
```

`reachingBack` é quantas sessões fechadas você precisa antes de a janela abrir.

### Lendo uma sessão de volta

```ts
const anterior = readSessions(input, 'anterior');

anterior.hasAny             // falso quando nada tinha fechado em nenhuma barra desenhada
anterior.perBar[index]      // a sessão mais nova que já tinha fechado na abertura da barra
anterior.turnsOver[index]   // 1 onde esta barra é a primeira depois da virada
anterior.closed             // toda sessão fechada, da mais antiga para a mais nova
anterior.indexPerBar[index] // onde em `closed` a sessão desta barra está
```

Os cinco são segurados no que cada barra desenhada podia saber. Não existe aqui
um índice que alcance uma sessão que a barra desenhada não poderia ter visto, o
que significa que um indicador escrito contra eles **não repinta**.

`perBar[index]` é `undefined` na borda esquerda, antes de qualquer coisa ter
fechado. `?? Number.NaN` é a resposta de sempre.

Buscar um nome que você nunca declarou lança um erro, e a mensagem lista os
nomes que você declarou. É a única falha que este desenho se recusa a deixar
silenciosa.

### Calculando sobre a série mais grossa

`perBar` responde *o que esta barra sabia*, que é uma sessão só. Para uma média,
uma amplitude, ou qualquer coisa com memória, você precisa da série inteira. Ela
é `closed`, e `indexPerBar` diz onde cada barra desenhada se encaixa nela.

```ts
const period = 50;
const held = readSessions(input, 'anterior');

// Calculada uma vez sobre a série, depois segurada em cada barra desenhada: um
// degrau, porque a média mais grossa não se mexeu entre os fechamentos.
const means = exponentialMean(held.closed.map((bar) => bar.closePrice), period);
const perBar = [...held.indexPerBar]
    .map((at) => (at < 0 ? Number.NaN : means[at] ?? Number.NaN));
```

`closed` alcança exatamente `reachingBack` sessões para trás, então peça um
múltiplo do seu período em vez de uma só. `reachingBack: period * 8` entrega
quatrocentos fechamentos a uma média de cinquenta períodos, e custa a mesma
requisição única por degrau que pedir uma custaria. Nada que ainda está se
formando entra aí.

::: tip Não existe degrau mensal
Quais larguras uma corretora publica é uma lista fixa: um minuto, cinco, quinze,
trinta, uma hora, duas, quatro, um dia, uma semana. Um mês não pode estar nela —
a lista é indexada por uma largura em milissegundos, e um mês não tem uma fixa.
:::

### Dizendo que você ainda não tem nada

```ts
    .converged(anterior.hasAny)
```

A legenda então marca seu indicador como ainda não convergido, em vez de deixar
uma linha em branco parecer uma linha plana.

## Dividindo em arquivos

Clique no botão de **novo arquivo** na barra e dê um nome. Um indicador sempre
começa em `main.ts`; o resto é você que organiza.

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

Você pode usar só caminhos relativos, e só dentro do seu próprio indicador:
`./`, `../` e `index.ts` para uma pasta.

::: warning Termine seus imports em `.js`, ou em nada
`./maths/mean` e `./maths/mean.js` acham `maths/mean.ts`. O segundo é como o
TypeScript manda escrever um import. Terminar em `.ts` é a única forma que o
compilador recusa, e o editor te avisa.
:::

Cada arquivo roda uma vez, por mais que outros o peçam. Dois arquivos que
importam um ao outro recebem o que o outro exportou até ali, em vez de entrar em
laço. Um arquivo que lança erro não fica guardado, então o próximo import roda
de novo e lança de novo.

`'fathom'` é a única outra coisa que resolve. **Não tem npm aqui.**

Um arquivo que você apaga é oferecido de volta por alguns segundos, do mesmo
jeito que um indicador apagado.

## Dois idiomas

A interface fala dois. Como um indicador dá nome a si mesmo, ele pode responder
nos dois:

```ts
import { inWords } from 'fathom';

readonly label = inWords({ en: 'My mean', 'pt-BR': 'Minha média' });
```

`en` é obrigatório, e é o que qualquer idioma que você não escreveu usa como
recurso.

Isso funciona em qualquer lugar do arquivo — um campo, o rótulo de um parâmetro,
o nome de uma série. Trocar o idioma reconstrói todo indicador a partir do
JavaScript com que ele foi salvo, então o arquivo inteiro roda de novo com o
idioma novo valendo.

## Depurando

`console.log` funciona. Ele imprime no painel **Console** abaixo do editor, e
não no console do navegador.

```ts
console.log('barras', input.bars.bars.length, 'primeira', input.bars.bars[0]);
```

Séries imprimem com o tamanho, tipo `Float64Array(43) [81176.4, …mais 31]`.
Listas mostram os doze primeiros e contam o resto. Objetos são abertos dois
níveis.

Lembre que `compute` roda de novo a cada barra, arrasto e zoom, então uma linha
impressa dentro dele chega o tempo todo. O Fathom cuida disso: uma linha impressa
duas vezes seguidas aparece uma vez com um contador ao lado, só as últimas 200
são guardadas, e quando mais de um indicador está imprimindo, cada linha ganha o
nome de quem imprimiu.

`warn` e `error` são marcados. `info` e `debug` aparecem como `log`. Nada mais do
console de verdade é oferecido.

## Compartilhando um indicador

**Exportando.** Um indicador de um arquivo só exporta como `.ts`. Um de vários
arquivos exporta como `.fathom.json` com todos eles, que é também de onde ele
abre.

**Importando de um arquivo.** O botão de abrir aceita `.ts`, `.tsx` ou um pacote.

**Importando de um repositório ou pacote.** O botão de nuvem aceita endereços
assim:

```text
gh/user/repo                       a tag mais nova, ou o branch padrão
gh/user/repo@main/readings/mean    um branch, e uma pasta dentro dele
npm/@alguem/leitura@1.2.0
```

Um endereço copiado direto do GitHub ou do npm também funciona.

O Fathom pega os arquivos `.ts` e `.tsx` sob a pasta que você indicou — até
quarenta deles e 512 kB, entrada em `main.ts` ou `index.ts`, com `.d.ts` de fora
— e abre todos como um indicador, marcado como não salvo.

Você vê a lista de arquivos e de onde vieram antes de um único byte ser buscado,
e o Fathom então busca exatamente o que te mostrou. Cada arquivo é conferido
contra o tamanho e o hash que a listagem informou.

::: danger O que você importa é código de outra pessoa
Ele roda nesta página assim que abre, do mesmo jeito que o seu. Só traga o que
você estaria disposto a rodar.
:::

## A superfície inteira

Tudo que se importa de `'fathom'`. Nada fora desta lista é público.

### Começando um plano e um parâmetro

| | |
|---|---|
| `Plot.over(bars)` | Começa um plano ligado às barras desenhadas. |
| `Params.integer(nome)` `.decimal` `.choice` `.toggle` | Constrói um botão. |

### Lendo ajustes e sessões

| | |
|---|---|
| `readSetting(settings, parameter)` | O valor de um botão numérico. |
| `readToggle(settings, parameter)` | O valor de um interruptor. |
| `readChoice(settings, parameter)` | O valor de uma escolha. |
| `readSessions(input, nome)` | Uma sessão declarada. Lança erro num nome não declarado. |
| `summariseParameters(parameters, settings)` | O resumo dos ajustes que a legenda usa. |

### As barras

| | |
|---|---|
| `readBarSource(bar, source)` | Uma barra sob `'close'`, `'hl2'`, `'ohlc4'` e o resto. |
| `collectSource(bars, settings)` | A fonte escolhida em todas as barras. |
| `collectInstants(bars)` | O instante de fechamento de cada barra. |
| `classifyBar(bar)` | Se uma barra foi gravada por inteiro. |
| `findContinuousSegments(bars)` | Trechos de barras sem lacuna entre elas. |
| `BAR_SOURCES`, `SOURCE` | Os nomes das fontes, e uma escolha pronta sobre eles. |

### Aritmética que os indicadores nativos usam

| | |
|---|---|
| `createBlankValues(length)` | Um `Float64Array` de NaN. |
| `smoothWilder(previous, sample, periodBars)` | Um passo de Wilder. |
| `fillWilder(fill)` / `fillExponential(fill)` | Uma série suavizada inteira, no lugar. |
| `resolveExponentialWeight(periodBars)` | O α que uma EMA desse tamanho usa. |
| `resolveTrueRange(bar, previousClose)` / `collectTrueRanges(bars, segment)` | Amplitude verdadeira. |
| `holdLastClosed(bars, higher)` | Alinha um degrau mais grosso à mão, como o host faz. |

### Palavras, orçamentos e formas

| | |
|---|---|
| `inWords(words)` | Uma frase no idioma de quem lê. |
| `isPlanWithinBudget(plan)` | Se um plano cabe no orçamento de 8 × 8192. |
| `PLOT_TONES`, `PLOT_BUDGET`, `BAR_BUDGET`, `NO_SESSIONS` | As constantes por trás de tudo. |

Tipos: `Indicator`, `IndicatorInput`, `IndicatorSettings`, `PlanDraft`,
`SourceRequest`, `SessionRequest`, `SettledSessions`, `PriceBar`,
`PriceBarWindow`, `PlotSeries`, `PlotShape`, `PlotTone`, `PlotScale`,
`PlotBand`, `PlotLevel`, `PlotValues`, `NumericParameter`, `ChoiceParameter`,
`ToggleParameter`, `IndicatorParameter`, `Tunable`, `BarSource`,
`BarCompleteness`, `BarSegment`, `SeriesFill`, `Words`, `Locale`, `DrawPlan`.

A classe base de conector e seus tipos estão na mesma superfície — veja
[Escrevendo um conector](/pt-BR/writing-a-connector).

## O que um indicador não pode fazer

Dito sem rodeio, porque descobrir tentando é pior.

- **Sem npm.** Nada fora de `'fathom'` e dos seus próprios arquivos resolve. Um
  pacote cujo código importe qualquer outra coisa não compila, e o editor diz
  qual import ele não achou.
- **Sem buscar, sem temporizadores, sem estado entre chamadas.** O `compute` é
  chamado de novo a cada redesenho, então qualquer coisa que ele lembre é um bug
  esperando um arrasto.
- **Sem livro, sem execuções, sem lacunas.** Um indicador alcança as barras e as
  sessões. O campo de livro de ofertas em torno do qual este gráfico foi
  construído ainda não está na superfície.
- **Sem sandbox.** Um indicador roda na página, na thread principal, igualzinho
  aos nativos. Ele alcança um global se for procurar, e um laço infinito leva a
  aba junto.
- **Sem cor própria.** Os tons vêm da paleta, então um indicador continua
  legível quando o tema muda.
- **Nada prometido entre versões.** A superfície é um barril só e pode mudar. Um
  indicador que para de compilar depois de uma atualização informa o erro do
  próprio compilador, e o código continua seu.

::: warning Onde seu trabalho fica guardado
Indicadores salvos ficam no armazenamento local do navegador. Isso é prático e
não é durável: limpar dados do site, encher o disco ou usar outro navegador não
vai ter eles. Exporte o que você quiser manter.
:::

---

O raciocínio por trás de tudo isto está no
[ADR 23](/en/adr/0023-a-reader-writes-an-indicator-in-the-page) (em inglês).
