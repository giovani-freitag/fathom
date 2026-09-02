import type { PlotTone } from '../../../shared/core/draw-plan.ts';
import type { TranslationKey } from '../../i18n/dictionaries/en.ts';

/**
 * What each drawing colour is called, for a reader who cannot see it.
 *
 * The tone is a design token, and a token is a name for where a colour is used
 * rather than for the colour itself. Read out as it stands, a swatch announces
 * itself as "ask" or "ink" — which tells someone choosing a colour nothing, and
 * tells someone who knows the chart something false about a line that has no
 * side.
 */
export const TONE_LABEL_KEYS: Readonly<Record<PlotTone, TranslationKey>> = {
    bid: 'colour.green',
    ask: 'colour.red',
    amber: 'colour.amber',
    phosphor: 'colour.teal',
    violet: 'colour.violet',
    cyan: 'colour.blue',
    ink: 'colour.white',
    muted: 'colour.grey',
};
