# Introdução

O Fathom é um gráfico do **livro de ofertas**, não só do preço.

Uma vez por segundo ele grava todas as ordens limitadas em repouso dos dois
lados do mercado e desenha isso como um mapa de calor que você percorre. As
faixas claras são paredes de tamanho em repouso. As bolhas são os negócios que
comeram essas paredes. Os candles ficam por cima, então dá para ver se a parede
segurou ou quebrou, e quanto tempo ela ficou lá antes.

![O gráfico](/screenshot.png)

Não tem conta para criar, não tem teste para começar, e não tem plano pago
escondendo a parte útil. Você abre e funciona.

## Por que ele precisa estar rodando

Os candles vêm da corretora, então o gráfico já abre com histórico de verdade
desde o primeiro segundo.

**O livro de ofertas não.** Nenhuma corretora vende a profundidade em repouso de
ontem, e nada reconstrói isso a partir dos negócios que aconteceram. Uma hora
que ninguém gravou está perdida para sempre.

Esse único fato molda todo o resto. O coletor é a parte que não pode parar, e
qualquer trecho do gráfico é feito só do que ele conseguiu gravar.

::: tip Deixe rodando
Se você instalar o Fathom na segunda e abrir na sexta, você tem de segunda a
sexta. Se instalar na sexta, você tem sexta. Não existe histórico para baixar.
:::

## O que tem no gráfico

| | |
|---|---|
| 🌊 **Mapa de calor da profundidade** | Cada preço com ordem em repouso, uma vez por segundo, como cor |
| 🕯️ **Candles sobre a liquidez** | Histórico e volume completos da corretora, com o livro desenhado embaixo |
| 🫧 **Bolhas de agressão** | Negócios dimensionados pelo volume e coloridos pelo lado que cruzou o spread |
| 📊 **Escada de profundidade** | Tamanho em repouso e volume negociado por preço, ao lado do gráfico |
| 🎚️ **Mapa de cor com dois cortes** | Abafe o ruído de fundo para as paredes de verdade aparecerem |
| 🔭 **Faixas que sobrevivem ao zoom** | Ao longo de dias, os preços se dobram em linhas que você ainda acompanha |
| ✏️ **Marcas e medidas** | Níveis, linhas de tendência, zonas e retrações, presos ao tempo e ao preço |
| 📱 **Feito para toque** | Um dedo arrasta, dois dão pinça nos dois eixos, e os eixos são alças de escala |
| ⚡ **Cauda ao vivo** | Um WebSocket acrescenta cada segundo novo sem rebuscar a janela |

## Indicadores

Dezoito indicadores já vêm com o Fathom: médias móveis, bandas, osciladores,
volume e delta. Você adiciona pelo painel de camadas e ajusta por ali mesmo.

Além desses, você escreve os seus. Um **indicador** é um arquivo TypeScript que
você escreve na própria página, contra exatamente a mesma interface que os
nativos usam. Ele compila enquanto você digita e desenha no gráfico ao lado do
editor.

Você também pode trazer um de um repositório no GitHub ou de um pacote npm. O
Fathom mostra cada arquivo, o tamanho e de onde veio antes de buscar um byte.

- [Escrevendo um indicador →](/pt-BR/writing-a-reading)
- [Exemplos prontos](https://github.com/giovani-freitag/fathom-example-addons)

## Corretoras

O Fathom grava perpétuos USD-M da Binance, e já vem lendo mais cinco
corretoras: Bybit, OKX, Coinbase, Kraken e Gate. Se você quer uma que não está
aí, escreve um **conector** — o mesmo tipo de addon, no mesmo editor, e a mesma
interface contra a qual os seis que já vêm juntos foram escritos. Um conector
diz ao Fathom o que aquela corretora consegue responder e como ler a resposta,
e o Fathom faz as chamadas.

Um conector também declara o que a corretora **não** faz. A maioria não publica
a separação por lado agressor nos candles, por exemplo. Quando um conector diz
isso, o Fathom esmaece as leituras que precisariam dela em vez de desenhar um
delta de zero e deixar parecer que a compra e a venda estavam equilibradas.

[Escrevendo um conector →](/pt-BR/writing-a-connector)

## Onde ele roda

Você tem duas formas de rodar o Fathom, e a diferença importa.

### No navegador, como demo

A [demo ao vivo](https://giovani-freitag.github.io/fathom/) roda o coletor
inteiro dentro de um Web Worker e grava no IndexedDB. Nada é instalado e nenhum
servidor entra na história.

É o mesmo código, e é genuinamente limitado:

- **Só grava com a aba aberta.** Fechou, parou de gravar.
- **Guarda uma janela, não um histórico.** Os quadros mais novos até uma fatia
  da cota do aparelho, os mais velhos descartados primeiro. Dias num desktop,
  horas num celular.
- **Acompanha um contrato por vez**, não quatro.
- **Armazenamento de navegador não é durável.** Limpar dados do site, encher o
  disco ou o navegador recuperando espaço levam a gravação junto.

Use para ver o que o Fathom desenha. Não use para guardar nada.

### Na sua máquina, de verdade

Um `docker run` te dá o banco, o coletor e o gráfico, gravando num volume que é
seu e rodando independente de ter aba aberta.

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  ghcr.io/giovani-freitag/fathom
```

Se preferir subir num lugar seu, clone o repositório e monte. Quatro
containers, um arquivo compose, ou direto do código — tudo isso está na próxima
página.

[Instalação →](/pt-BR/running-it)
