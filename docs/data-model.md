# Modelo de dados

## Uma linha por instante, não por nível

`liquidity_frame` guarda **uma linha por bucket de tempo**, com a escada de
profundidade inteira em arrays.

Modelar uma linha por nível de preço geraria cerca de 40 milhões de linhas por dia
nesta resolução, o que nenhum banco de nó único serve bem. Assim são 86.400 linhas
por dia.

```sql
CREATE TABLE liquidity_frame (
    captured_at             TIMESTAMPTZ,
    instrument_symbol       TEXT,
    price_bucket_size       DOUBLE PRECISION,
    best_bid_price          DOUBLE PRECISION,
    best_ask_price          DOUBLE PRECISION,
    bid_lowest_bucket_index INTEGER,
    bid_quantities          REAL[],
    ask_lowest_bucket_index INTEGER,
    ask_quantities          REAL[]
);
```

O preço de `bid_quantities[i]` (1-based, como o PostgreSQL indexa arrays) é
`(bid_lowest_bucket_index + i - 1) * price_bucket_size`.

### Por que dois arrays e não um

Compra e venda carregam offset e array próprios. Duas razões:

1. **O bucket do spread.** Com faixas de 10 USDT, a melhor compra em 79.001,4 e a
   melhor venda em 79.001,6 caem na mesma faixa. Num array único as duas somariam
   numa linha fantasma que não existe no livro.
2. **Nenhum lado guarda a metade vazia do outro.** Cada array cobre só a extensão
   que o seu lado ocupa, então dois arrays custam o mesmo que um denso cobrindo
   tudo — e dizem mais.

## Execuções pré-agregadas

`trade_cluster` guarda agressões já somadas na grade de (segundo, faixa de preço):

```sql
CREATE TABLE trade_cluster (
    executed_at            TIMESTAMPTZ,
    instrument_symbol      TEXT,
    price_bucket_size      DOUBLE PRECISION,
    price_bucket_index     INTEGER,
    buy_quantity           REAL,
    sell_quantity          REAL,
    trade_count            INTEGER,
    largest_trade_quantity REAL
);
```

Todo campo rola para uma grade mais grossa sem perda: quantidades e contagem
somam, `largest_trade_quantity` usa máximo. É isso que mantém uma impressão de 40
BTC visível depois de agregar por hora, em vez de dissolvida na média.

As views contínuas `trade_cluster_minute` e `trade_cluster_hour` materializam os
dois zooms mais largos. A granularidade de preço é preservada em todos os níveis;
só o tempo é agregado.

## Lacunas

```sql
CREATE TABLE recording_gap (
    gap_started_at    TIMESTAMPTZ,
    gap_ended_at      TIMESTAMPTZ,
    instrument_symbol TEXT,
    gap_reason        TEXT
);
```

Sem essa tabela o renderizador liga os dois lados de uma queda de conexão com uma
linha reta e inventa liquidez que nunca esteve ali — o pior tipo de erro num
gráfico usado para decidir. Com ela, o período vira uma faixa âmbar tracejada.

Uma lacuna é aberta quando o livro fica indisponível, quando um lote de escrita
é descartado, e no arranque, medida a partir do último frame que a execução
anterior gravou.

## Idempotência

Índices únicos em `(instrument_symbol, captured_at)` e
`(instrument_symbol, executed_at, price_bucket_index)`, com `ON CONFLICT DO NOTHING`.
Um restart que reprisa o segundo corrente, ou a repetição de um lote cuja falha
chegou depois do commit, converge em vez de duplicar coluna.

## Compressão

Depois de dois dias os chunks convertem para armazenamento colunar. Os arrays de
profundidade são majoritariamente esparsos e comprimem por mais de uma ordem de
grandeza.

## O formato binário do fio

Mil colunas de profundidade são algumas centenas de milhares de quantidades. Como
JSON isso são dezenas de megabytes de texto decimal, e o parse custa mais que o
desenho. A rota `/api/heatmap` responde binário.

Cabeçalho de 32 bytes, depois um registro por frame (40 bytes de cabeçalho e dois
arrays de `float32`), tudo little-endian:

| offset | tipo | campo |
| --- | --- | --- |
| 0 | `u32` | magic `FTHM` |
| 4 | `u16` | versão do formato |
| 8 | `f64` | `priceBucketSize` |
| 16 | `f64` | instante base |
| 24 | `u32` | número de frames |
| 28 | `u32` | intervalo de amostragem |

O passo de cada frame é múltiplo de 4, então o decodificador cria as
`Float32Array` como **views** sobre o buffer recebido, sem cópia. O `@fastify/compress`
comprime a resposta — na prática 4x, porque a faixa gravada é bem mais larga do
que a parte densa do livro.

`application/octet-stream` é marcado como não-comprimível no `mime-db`; o gateway
precisa listá-lo explicitamente, senão a maior resposta da API é justamente a
única que viaja crua.
