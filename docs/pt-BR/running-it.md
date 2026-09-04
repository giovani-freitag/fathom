# Rodar

```bash
docker run -p 8787:8787 ghcr.io/giovani-freitag/fathom
```

Abra **http://localhost:8787**. As primeiras colunas aparecem em segundos.

Um contêiner: o banco, o coletor que espelha o livro, e o gateway que o desenha.
Nada para configurar, nada para clonar, nenhum arquivo para escrever antes.

::: warning Dê a ele onde gravar antes de se importar
A gravação vive dentro do contêiner, então ela vai embora junto com ele. É o
padrão certo para dar uma olhada e o errado para guardar o que ele viu — **um
livro de ofertas não pode ser gravado de novo depois do fato.**

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data ghcr.io/giovani-freitag/fathom
```
:::

## O que mudar

O comando acima roda nos padrões. O `.env.example` documenta cada variável;
estas quatro decidem o que você recebe.

| | |
|---|---|
| `INSTRUMENT_SYMBOL` | Qual contrato gravar. Qualquer perpétuo USD-M da Binance. |
| `PRICE_BUCKET_SIZE` | Qual a altura de uma linha do mapa de calor, na moeda de cotação. Dez dólares no Bitcoin; um centésimo disso no Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | Até onde a gravação alcança para cada lado do preço. É isso que decide quanto um dia custa em disco. |
| `POSTGRES_PASSWORD` | Padrão `fathom`, o que serve enquanto a porta estiver no loopback e não fora disso. |

Um `-e` de cada vez:

```bash
docker run -p 8787:8787 -e INSTRUMENT_SYMBOL=ETHUSDT -e PRICE_BUCKET_SIZE=0.5 \
  ghcr.io/giovani-freitag/fathom
```

As duas portas são publicadas só em `127.0.0.1`. **O Fathom não pergunta a
ninguém quem é** — ponha algo que pergunte na frente antes de abrir mais.

## Como quatro contêineres

O banco no próprio contêiner é o que qualquer coisa que precise de backup,
atualização ou monitoramento vai querer.

```bash
curl -O https://raw.githubusercontent.com/giovani-freitag/fathom/main/docker-compose.yml
docker compose up -d
```

TimescaleDB, um passo de migração que roda uma vez e para, o coletor e o
gateway. O arquivo em vez de uma linha só, porque quem escolhe isto no lugar do
contêiner único vai editá-lo.

```bash
# O coletor mantém o próprio log, uma linha por coisa que aconteceu com ele.
docker compose exec collector tail -f logs/collector.*.log

docker compose logs collector         # só o que ele não conseguiu sobreviver
docker compose down                   # parar, mantendo a gravação
docker compose down -v                # parar e apagá-la, para sempre
```

## A partir do código

Node 22.12 ou mais novo, e Docker só para o banco.

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env

docker compose up -d timescaledb      # só o banco
npm run migrate                       # só contra um banco que já existe
npm run build

npm run collector &                   # a metade que não pode parar
npm run gateway                       # http://localhost:8787
```

`npm run dev` serve o visualizador com recarga a quente contra um gateway já
rodando.

## Sem backend nenhum

O mesmo coletor se registra como Web Worker e grava no IndexedDB, que é o que a
[demonstração](https://giovani-freitag.github.io/fathom/) é.

```bash
npm run dev:demo
```

## Mantendo no ar

**O gráfico só cobre o tempo em que o coletor esteve rodando.** Não há histórico
para carregar e nada pelo que esperar. Deixe no ar.

[Como é montado →](/architecture) · [O que ele grava →](/data-model) ·
[Rodando como serviço →](/operations)
