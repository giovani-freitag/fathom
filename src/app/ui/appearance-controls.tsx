import { type Locale, SUPPORTED_LOCALES } from '../i18n/locale.ts';
import {
    GRID_CHOICES,
    type GridChoice,
    type ResolvedTheme,
    THEME_CHOICES,
    type ThemeChoice,
} from '../core/theme.ts';
import { Grid2x2X, Grid3x3, Monitor, Moon, Rows3, Sun } from 'lucide-react';
import type { ReactElement } from 'react';
import { FlagIcon } from './flag-icon.tsx';
import { Select } from './select.tsx';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { Translate } from '../i18n/translator.ts';

const THEME_ICONS: Record<ThemeChoice, typeof Monitor> = {
    system: Monitor,
    light: Sun,
    dark: Moon,
};

const THEME_LABEL_KEYS: Record<ThemeChoice, TranslationKey> = {
    system: 'theme.system',
    light: 'theme.light',
    dark: 'theme.dark',
};

const LOCALE_LABEL_KEYS: Record<Locale, TranslationKey> = {
    'en': 'language.en',
    'pt-BR': 'language.pt-BR',
};

export interface AppearanceControlsProps {
    readonly locale: Locale;
    readonly themeChoice: ThemeChoice;
    readonly resolvedTheme: ResolvedTheme;
    readonly translate: Translate;
    readonly onSelectLocale: (locale: Locale) => void;
    readonly onSelectTheme: (themeChoice: ThemeChoice) => void;
    readonly gridChoice: GridChoice;
    readonly onSelectGrid: (gridChoice: GridChoice) => void;
}

/** Each amount of grid, drawn as that much of a grid. */
const GRID_ICONS: Readonly<Record<GridChoice, typeof Rows3>> = {
    // A grid struck through rather than an empty square: the mark has to say
    // which control this is even in the state where it rules nothing.
    none: Grid2x2X,
    price: Rows3,
    both: Grid3x3,
};

/** What each amount of grid is called. */
const GRID_LABEL_KEYS: Readonly<Record<GridChoice, TranslationKey>> = {
    none: 'settings.grid.none',
    price: 'settings.grid.price',
    both: 'settings.grid.both',
};

/**
 * The language, the theme and the grid, side by side.
 */
export function AppearanceControls({
    locale,
    themeChoice,
    resolvedTheme,
    translate,
    onSelectLocale,
    onSelectTheme,
    gridChoice,
    onSelectGrid,
}: AppearanceControlsProps): ReactElement {
    return (
        <div className="flex flex-wrap gap-2">
            {/* Labelled the way every indicator control is. Three selects reading
                "English", "System" and "Price" say what they are set to and
                never what they are about — and "Price" on its own does not
                convey a grid. */}
            <LabelledField label={translate('settings.language')}>
                <Select
                    value={locale}
                    label={translate('settings.language')}
                    onSelect={(chosen) => { onSelectLocale(chosen as Locale); }}
                    choices={SUPPORTED_LOCALES.map((candidate) => ({
                        value: candidate,
                        label: translate(LOCALE_LABEL_KEYS[candidate]),
                        icon: <FlagIcon locale={candidate} />,
                    }))}
                />
            </LabelledField>

            <LabelledField label={translate('settings.theme')}>
                <Select
                    value={themeChoice}
                    label={translate('settings.theme')}
                    onSelect={(chosen) => { onSelectTheme(chosen as ThemeChoice); }}
                    choices={THEME_CHOICES.map((candidate) => ({
                        value: candidate,
                        label: translate(THEME_LABEL_KEYS[candidate]),
                        icon: <ThemeMark choice={candidate} />,
                        // Under `system` the resolved theme is the only place the
                        // reader learns which one won.
                        ...(candidate === 'system'
                            ? { detail: translate(THEME_LABEL_KEYS[resolvedTheme]) }
                            : {}),
                    }))}
                />
            </LabelledField>

            <LabelledField label={translate('settings.grid')}>
                <Select
                    value={gridChoice}
                    label={translate('settings.grid')}
                    onSelect={(chosen) => { onSelectGrid(chosen as GridChoice); }}
                    choices={GRID_CHOICES.map((candidate) => ({
                        value: candidate,
                        label: translate(GRID_LABEL_KEYS[candidate]),
                        // What the control is about is carried by the mark, the way
                        // the flag and the monitor carry the two beside it. Without
                        // one, "None" on a shelf of selects answers no question.
                        icon: <GridMark choice={candidate} />,
                    }))}
                />
            </LabelledField>
        </div>
    );
}

/**
 * One control with its name written above it.
 *
 * @param props - The name, and the control it belongs to.
 * @returns The pair.
 */
function LabelledField({ label, children }: {
    readonly label: string;
    readonly children: ReactElement;
}): ReactElement {
    return (
        <div className="flex flex-col gap-1">
            <span className="field-label">{label}</span>
            {children}
        </div>
    );
}

function ThemeMark({ choice }: { readonly choice: ThemeChoice }): ReactElement {
    const Icon = THEME_ICONS[choice];
    return <Icon className="size-[18px] text-ink-400" />;
}

/** How much of the grid a choice rules, drawn as that much of a grid. */
function GridMark({ choice }: { readonly choice: GridChoice }): ReactElement {
    const Icon = GRID_ICONS[choice];
    return <Icon className="size-[18px] text-ink-400" />;
}
