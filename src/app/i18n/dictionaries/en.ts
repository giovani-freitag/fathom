/**
 * The English copy, and the shape every other translation must match.
 */
export const EN_DICTIONARY = {
    'chart.surface': 'Order book liquidity heat map',

    'instrument.label': 'Contract',

    'live.streaming': 'live',
    'live.connecting': 'connecting',
    'live.reconnecting': 'reconnecting',
    'live.refused': 'offline',
    'live.idle': 'idle',
    'live.history': 'history',

    'coverage.columnWidth': 'Width of each chart column',
    'coverage.perColumn': '/col',
    'coverage.barInterval': 'Width of each bar',
    'coverage.gapTitle': 'Stretches with no recording in this window',
    'coverage.gapOne': '{count} gap',
    'coverage.gapMany': '{count} gaps',
    'coverage.loading': 'loading…',

    'legend.book': 'book',

    'readout.bid': 'BID {size} {asset} at {price}',
    'readout.ask': 'ASK {size} {asset} at {price}',
    'readout.empty': 'nothing resting at {price}',
    'readout.fromMid': '{delta} · {percent} from mid',
    'readout.buy': 'buy {size}',
    'readout.sell': 'sell {size}',
    'readout.traded': 'traded {sides}',
    'readout.tradeCount': '{count}x · largest {size}',

    'unit.seconds': '{value}s',
    'unit.minutes': '{value}min',
    'unit.hours': '{value}h',
    'unit.days': '{value}d',

    'span.1m': '1m',
    'span.5m': '5m',
    'span.15m': '15m',
    'span.1h': '1h',
    'span.4h': '4h',
    'span.1d': '1d',
    'span.3d': '3d',
    'span.1w': '1w',

    'span.label': 'Time window',
    'span.beyondCoverage': 'Not enough recorded yet',

    'page.returnToLive': 'Back to live',
    'page.probing': 'Loading the recording…',
    'page.empty': 'Nothing recorded yet. Recording has to be on: an order book cannot be recovered after the fact.',
    'page.retry': 'Try again',

    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.close': 'Close',

    'settings.appearance': 'Appearance',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'theme.system': 'System',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'language.en': 'English',
    'language.pt-BR': 'Portuguese',

    'settings.display': 'Display',
    'settings.intensity': 'Intensity',
    'settings.intensityHandle': 'Colour intensity',
    'settings.lowerCut': 'Lower cut',
    'settings.lowerCutHandle': 'Colour map lower cut',
    'settings.lowerCutHelp': 'Resting orders smaller than this are painted as empty. Raise it to mute the constant churn of small orders and leave the large ones standing alone.',
    'settings.upperCut': 'Upper cut',
    'settings.upperCutHandle': 'Colour map upper cut',
    'settings.upperCutHelp': 'Where the colour reaches its hottest. Lower it to light up more of the book; raise it to keep that end for the largest orders only.',
    'settings.candles': 'Candles',
    'settings.candlesHelp': 'Open, high, low and close of the mid price',
    'settings.aggressors': 'Aggressors',
    'settings.aggressorsHelp': 'Bubbles for orders that crossed the spread',
    'settings.volumeProfile': 'Volume profile',
    'settings.volumeProfileHelp': 'Traded volume per price band',
    'settings.recordedSoFar': 'Recorded so far',
    'settings.resolution': 'Resolution',
    'settings.perColumn': '{value} per column',
    'settings.priceBand': 'Price band',
    'settings.perRow': '{value} per row',
    'settings.columnsLoaded': 'Columns loaded',
    'settings.gapsInWindow': 'Gaps in window',
    'about.whatsNew': 'What’s new',
    'about.releasedOn': 'Released {date}',
    'about.unreleased': 'Built from the working tree',

    'settings.backfillNote': 'Windows longer than what has been recorded are disabled. The chart only covers the time recording was on — an order book cannot be recovered after the fact.',

    'recording.reading': 'Reading what is being recorded…',
    'recording.title': 'Recording',
    'recording.usage': '{used} of {total}',
    'recording.contractsHelp': 'Turning a contract off stops recording it. Everything it already captured stays.',
    'recording.toggle': 'Record {symbol}',
    'recording.saveFailed': 'That change could not be saved.',
    'recording.ceiling': 'Storage ceiling',
    'recording.ceilingHelp': 'Once the ceiling is reached, the oldest days are dropped to make room for the newest.',

    'demo.preRollTitle': 'Recording starts now',
    'demo.preRollBody': 'This page records the order book itself, live. The first column appears in a moment — there is no history to load, because an order book cannot be recovered after the fact.',
    'demo.connecting': 'Connecting to the exchange and mirroring the order book. The first columns appear within seconds.',
    'demo.stopped': 'Recording stopped. Reload to start again.',
    'demo.wasHidden': 'This tab was in the background, where recording slows down. Those seconds show as gaps rather than as made-up data.',
    'demo.refusedTitle': 'This browser will not let the demo record',
    'demo.refusedBody': 'The page saves what it records inside your browser. Private windows and some privacy settings block that, and a recording that only exists while you watch has nowhere else to go.',

    'failure.silent': 'The server did not answer. Check that it is running.',
    'failure.server': 'The server could not answer. It may not be able to reach the recording.',
    'failure.refused': 'The server refused the request.',
    'failure.generic': 'Could not load this time window.',
} as const;

/** Every phrase the interface can render. */
export type TranslationKey = keyof typeof EN_DICTIONARY;

/** A complete translation. Missing a key is a compile error, not a blank screen. */
export type Dictionary = Record<TranslationKey, string>;
