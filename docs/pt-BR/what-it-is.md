# O que é o Fathom

Um gráfico do **livro de ofertas**, não só do preço.

A cada segundo o Fathom grava as ordens limitadas em repouso dos dois lados do
mercado e as desenha como um mapa de calor que você percorre. As faixas claras
são paredes de tamanho em repouso; as bolhas são os negócios que as comeram; os
candles ficam por cima. Você vê se uma parede segurou ou quebrou, e quanto tempo
ela ficou de pé antes.

![O gráfico](/screenshot.png)

## Por que ele precisa estar rodando

Os candles vêm da corretora, então o gráfico abre com histórico desde o primeiro
segundo. **O livro de ofertas não.** Nenhuma corretora vende a profundidade em
repouso de ontem, e nada a reconstrói a partir dos negócios — uma hora que não
foi gravada está perdida para sempre.

Esse único fato molda todo o desenho: o coletor é a parte que não pode parar, e
um trecho de gráfico só é feito daquilo que ele gravou.

## O que está no gráfico

| | |
|---|---|
| 🌊 **Mapa de calor da profundidade** | Cada preço com ordem em repouso, uma vez por segundo, como cor |
| 🕯️ **Candles sobre a liquidez** | Histórico e volume completos da corretora, com o livro desenhado embaixo |
| 🫧 **Bolhas de agressão** | Negócios dimensionados pelo volume, coloridos por quem cruzou o spread |
| 📊 **Escada de profundidade** | Tamanho em repouso e volume negociado por preço, ao lado do gráfico |
| 🎚️ **Mapa de cor com dois cortes** | Abafa o ruído de fundo para as paredes de verdade ficarem sozinhas |
| 🔭 **Faixas que aguentam o zoom** | Ao longo de dias, os preços se dobram em linhas que você ainda acompanha |
| ✏️ **Marcações e medidas** | Níveis, linhas de tendência, zonas e retrações, fixados em tempo e preço |
| 📱 **Toque em primeiro lugar** | Um dedo arrasta, dois dão pinça nos dois eixos, os eixos são alças de escala |
| ⚡ **Cauda ao vivo** | Um WebSocket acrescenta cada segundo novo sem rebuscar a janela |

## O que você pode acrescentar

Dezoito indicadores vêm junto — médias móveis, bandas, osciladores, volume e
delta. Além deles, você escreve os seus: uma **leitura** é um arquivo TypeScript
que você escreve na própria página, contra a mesma superfície que os nativos
usam. Ele compila enquanto você digita e desenha no gráfico ao lado do editor.

Você também pode trazer uma de um repositório do GitHub ou de um pacote npm. O
Fathom lista o que há lá, e de onde veio, antes de buscar um byte.

- [Escrever uma →](/pt-BR/writing-a-reading)
- [Exemplos prontos](https://github.com/giovani-freitag/fathom-example-addons)

## Onde ele roda

De duas formas, a partir do mesmo código:

- **Com backend** — um coletor gravando no TimescaleDB e um gateway servindo o
  gráfico. Um contêiner, ou quatro.
- **Sem backend nenhum** — o mesmo coletor se registra como Web Worker e grava
  no IndexedDB. É isso que a
  [demonstração ao vivo](https://giovani-freitag.github.io/fathom/) é: sem
  servidor, sem conta, e uma gravação que vive na aba.

[Rodar →](/pt-BR/running-it)
