/**
 * The English copy, and the shape every other translation must match.
 */
export const EN_DICTIONARY = {
    'chart.surface': 'Order book liquidity heat map',

    'instrument.label': 'Contract',

    'live.streaming': 'live',
    'live.connecting': 'connecting',
    'live.reconnecting': 'reconnecting',
    'live.refused': 'refused',
    'live.idle': 'idle',
    'live.history': 'history',

    'coverage.columnWidth': 'Width of each chart column',
    'coverage.perColumn': '/col',
    'coverage.gapTitle': 'Stretches with no recording in this window',
    'coverage.gapOne': '{count} gap',
    'coverage.gapMany': '{count} gaps',
    'coverage.loading': 'loading…',

    'legend.book': 'book',

    'span.label': 'Time window',
    'span.beyondCoverage': 'Not enough recorded yet',

    'page.returnToLive': 'Back to live',
    'page.probing': 'Sounding the archive…',
    'page.empty': 'Nothing recorded yet. The collector has to be running — book history cannot be backfilled.',
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
    'settings.lowerCutHelp': 'Below this the book is painted as empty. Raising it mutes the background churn and leaves the wall alone.',
    'settings.upperCut': 'Upper cut',
    'settings.upperCutHandle': 'Colour map upper cut',
    'settings.upperCutHelp': 'Where colour saturates. Lowering it sends more levels to the hot end; raising it reserves that end for the largest orders.',
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
    'settings.backfillNote': 'Windows wider than the recording are disabled. Book history cannot be backfilled: the chart only covers the time the collector was running.',

    'recording.reading': 'Reading what is being recorded…',
    'recording.title': 'Recording',
    'recording.usage': '{used} of {total}',
    'recording.contractsHelp': 'Turning a contract off stops new frames. What it already recorded stays, and is never deleted to make room before older history is.',
    'recording.toggle': 'Record {symbol}',
    'recording.ceiling': 'Storage ceiling',
    'recording.ceilingHelp': 'Past the ceiling the oldest day is dropped, a whole partition at a time — deleting single rows from compressed history costs more disk than it frees.',

    'demo.preRollTitle': 'Recording starts now',
    'demo.preRollBody': 'This page is its own collector. It is mirroring the order book and will draw the first column in a moment — there is no history to load, because an order book cannot be fetched after the fact.',
    'demo.connecting': 'Connecting to the venue and mirroring the book. The first columns appear within seconds.',
    'demo.stopped': 'Recording stopped. Reload to start again.',
    'demo.wasHidden': 'This tab was in the background. Browsers slow timers there, so those seconds are recorded as gaps rather than invented.',
    'demo.refusedTitle': 'This browser will not let the demo record',
    'demo.refusedBody': 'The page stores what it captures in the browser’s own database. Private windows and some privacy settings block it, and there is nowhere else to put a recording that only exists while you watch.',

    'failure.silent': 'The gateway did not answer. Check that it is running.',
    'failure.server': 'The gateway failed to answer. The archive may be unreachable.',
    'failure.refused': 'The gateway refused the query.',
    'failure.generic': 'Could not load the window.',
} as const;

/** Every phrase the interface can render. */
export type TranslationKey = keyof typeof EN_DICTIONARY;

/** A complete translation. Missing a key is a compile error, not a blank screen. */
export type Dictionary = Record<TranslationKey, string>;
