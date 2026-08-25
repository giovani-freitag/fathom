import type { Dictionary } from './en.ts';

/**
 * The Brazilian Portuguese copy.
 */
export const PT_BR_DICTIONARY: Dictionary = {
    'chart.surface': 'Mapa de calor da liquidez do livro',

    'instrument.label': 'Contrato',

    'live.streaming': 'ao vivo',
    'live.connecting': 'conectando',
    'live.reconnecting': 'reconectando',
    'live.refused': 'recusado',
    'live.idle': 'parado',
    'live.history': 'histórico',

    'coverage.columnWidth': 'Largura de cada coluna do gráfico',
    'coverage.perColumn': '/col',
    'coverage.gapTitle': 'Trechos sem gravação nesta janela',
    'coverage.gapOne': '{count} lacuna',
    'coverage.gapMany': '{count} lacunas',
    'coverage.loading': 'carregando…',

    'legend.book': 'livro',

    'span.label': 'Janela de tempo',
    'span.beyondCoverage': 'Ainda não há gravação suficiente',

    'page.returnToLive': 'Voltar ao tempo real',
    'page.probing': 'Sondando o arquivo…',
    'page.empty': 'Nada gravado ainda. O coletor precisa estar rodando — o histórico do livro não pode ser recuperado depois.',
    'page.retry': 'Tentar de novo',

    'settings.open': 'Preferências',
    'settings.title': 'Preferências',
    'settings.close': 'Fechar',

    'settings.appearance': 'Aparência',
    'settings.language': 'Idioma',
    'settings.theme': 'Tema',
    'theme.system': 'Do sistema',
    'theme.light': 'Claro',
    'theme.dark': 'Escuro',
    'language.en': 'Inglês',
    'language.pt-BR': 'Português',

    'settings.display': 'Exibição',
    'settings.intensity': 'Intensidade',
    'settings.intensityHandle': 'Intensidade da cor',
    'settings.lowerCut': 'Corte inferior',
    'settings.lowerCutHandle': 'Corte inferior do mapa de cores',
    'settings.lowerCutHelp': 'Abaixo disto o livro é pintado como vazio. Subir o corte silencia o ruído de fundo e deixa a parede sozinha.',
    'settings.upperCut': 'Corte superior',
    'settings.upperCutHandle': 'Corte superior do mapa de cores',
    'settings.upperCutHelp': 'Onde a cor satura. Baixar leva mais níveis ao extremo quente; subir reserva esse extremo para as maiores ordens.',
    'settings.candles': 'Candles',
    'settings.candlesHelp': 'Abertura, máxima, mínima e fechamento do preço médio',
    'settings.aggressors': 'Agressores',
    'settings.aggressorsHelp': 'Bolhas para ordens que atravessaram o spread',
    'settings.volumeProfile': 'Perfil de volume',
    'settings.volumeProfileHelp': 'Volume negociado por faixa de preço',
    'settings.recordedSoFar': 'Gravado até agora',
    'settings.resolution': 'Resolução',
    'settings.perColumn': '{value} por coluna',
    'settings.priceBand': 'Faixa de preço',
    'settings.perRow': '{value} por linha',
    'settings.columnsLoaded': 'Colunas carregadas',
    'settings.gapsInWindow': 'Lacunas na janela',
    'settings.backfillNote': 'Janelas maiores que a gravação ficam desabilitadas. O histórico do livro não pode ser recuperado depois: o gráfico só cobre o tempo em que o coletor esteve rodando.',

    'recording.reading': 'Lendo o que está sendo gravado…',
    'recording.title': 'Gravação',
    'recording.usage': '{used} de {total}',
    'recording.contractsHelp': 'Desligar um contrato interrompe novos quadros. O que ele já gravou permanece, e nunca é apagado para abrir espaço antes do histórico mais antigo.',
    'recording.toggle': 'Gravar {symbol}',
    'recording.ceiling': 'Teto de armazenamento',
    'recording.ceilingHelp': 'Passado o teto, o dia mais antigo é descartado inteiro, uma partição por vez — apagar linhas soltas de um histórico comprimido custa mais disco do que libera.',

    'demo.preRollTitle': 'A gravação começa agora',
    'demo.preRollBody': 'Esta página é o próprio coletor. Ela está espelhando o livro de ofertas e vai desenhar a primeira coluna em instantes — não há histórico para carregar, porque um livro de ofertas não pode ser buscado depois do fato.',
    'demo.connecting': 'Conectando à corretora e espelhando o livro. As primeiras colunas aparecem em segundos.',
    'demo.stopped': 'Gravação interrompida. Recarregue para começar de novo.',
    'demo.wasHidden': 'Esta aba esteve em segundo plano. Os navegadores desaceleram os temporizadores ali, então esses segundos são gravados como lacunas em vez de inventados.',
    'demo.refusedTitle': 'Este navegador não deixa a demonstração gravar',
    'demo.refusedBody': 'A página guarda o que captura no banco de dados do próprio navegador. Janelas anônimas e algumas configurações de privacidade bloqueiam isso, e não há outro lugar para pôr uma gravação que só existe enquanto você assiste.',

    'failure.silent': 'O gateway não respondeu. Verifique se ele está rodando.',
    'failure.server': 'O gateway falhou ao responder. O arquivo pode estar inacessível.',
    'failure.refused': 'O gateway recusou a consulta.',
    'failure.generic': 'Não foi possível carregar a janela.',
};
