# Instalação

O jeito mais rápido de rodar o Fathom de verdade é um comando do Docker.

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  ghcr.io/giovani-freitag/fathom
```

Abra **http://localhost:8787**. As primeiras colunas aparecem em segundos.

Esse container sozinho tem o banco, o coletor que espelha o livro de ofertas e o
gateway que desenha. Não tem nada para configurar, nada para clonar e nenhum
arquivo para escrever antes.

::: warning Sempre dê um volume a ele
O `-v` acima não é opcional na prática. Sem ele, a gravação mora dentro do
container e vai embora com o container — e **um livro de ofertas não pode ser
gravado depois que passou.**
:::

## Só de olhada?

Se você só quer ver o que o Fathom desenha, a
[demo ao vivo](https://giovani-freitag.github.io/fathom/) não exige instalação
nenhuma. Ela roda o coletor num Web Worker e grava no armazenamento do
navegador.

É uma demo, e se comporta como uma: só grava com a aba aberta, guarda uma janela
corrida em vez de um histórico, cada par que ela acompanha divide o mesmo
aparelho, e o armazenamento do navegador pode ser limpo por baixo dela a
qualquer momento. Volte aqui quando quiser guardar o que foi gravado.

## Configuração

O comando acima roda nos padrões. Toda variável está documentada no
`.env.example`, mas estas cinco são as que você provavelmente vai mexer.

| | |
|---|---|
| `VENUE` | De qual corretora gravar: `binance-futures`, `bybit` ou `gate`, os conectores que publicam livro. Nomeada aqui só para a semente; todo contrato depois disso carrega a sua. |
| `INSTRUMENT_SYMBOL` | Qual contrato gravar, escrito como aquela corretora o escreve. |
| `PRICE_BUCKET_SIZE` | A altura de uma linha do mapa de calor, na moeda de cotação. Dez dólares no Bitcoin, um centésimo disso no Litecoin. |
| `RECORDED_PRICE_RANGE_RATIO` | Quão longe do preço, para cada lado, a gravação alcança. É isso que decide quanto um dia dela custa em disco. |
| `POSTGRES_PASSWORD` | Padrão `fathom`. Tudo bem enquanto a porta estiver no loopback, e não além disso. |

Passe com `-e`:

```bash
docker run -p 8787:8787 -v fathom:/var/lib/postgresql/data \
  -e VENUE=bybit -e INSTRUMENT_SYMBOL=ETHUSDT -e PRICE_BUCKET_SIZE=0.5 \
  ghcr.io/giovani-freitag/fathom
```

::: danger O Fathom não pergunta quem é você
Não tem login, o que é a graça na sua máquina e um problema numa máquina
pública. As duas portas são publicadas só em `127.0.0.1`. Ponha o Fathom atrás
de algo que autentique antes de abrir mais que isso.
:::

## Como quatro containers

Quando você começa a se importar com backup, atualização ou monitoramento, o
banco vai querer um container só dele.

```bash
curl -O https://raw.githubusercontent.com/giovani-freitag/fathom/main/docker-compose.yml
docker compose up -d
```

Isso sobe o TimescaleDB, um passo de migração que roda uma vez e para, o coletor
e o gateway. É um arquivo em vez de uma linha só porque quem escolhe isso no
lugar do container único vai editar.

Alguns comandos que você vai querer:

```bash
# O coletor mantém o log dele, uma linha por coisa que aconteceu.
docker compose exec collector tail -f logs/collector.*.log

docker compose logs collector         # só o que ele não conseguiu sobreviver
docker compose down                   # parar, mantendo a gravação
docker compose down -v                # parar e apagar a gravação, sem volta
```

## Direto do código

Se você quer subir o Fathom num lugar seu, ou mudar alguma coisa, clone. Precisa
do Node 22.12 ou mais novo, e do Docker só para o banco.

```bash
git clone https://github.com/giovani-freitag/fathom.git
cd fathom
npm install
cp .env.example .env
```

Suba o banco, aplique as migrações e monte:

```bash
docker compose up -d timescaledb      # o banco sozinho
npm run migrate                       # contra um banco que já existe
npm run build
```

Depois inicie as duas metades:

```bash
npm run collector &                   # a metade que não pode parar
npm run gateway                       # http://localhost:8787
```

Enquanto você mexe na interface, `npm run dev` serve o visualizador com hot
reload contra um gateway já rodando. `npm run dev:demo` serve a build que roda
só no navegador.

## Mantendo no ar

**O gráfico só cobre o tempo em que o coletor estava rodando.** Não tem
histórico para carregar e nada para esperar. Deixe no ar, e ele preenche atrás
de você.

[Arquitetura →](/en/architecture) ·
[Modelo de dados →](/en/data-model) ·
[Rodando como serviço →](/en/operations)

<small>Essas três estão só em inglês.</small>
