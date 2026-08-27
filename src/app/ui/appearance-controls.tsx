import { type Locale, SUPPORTED_LOCALES } from '../i18n/locale.ts';
import { type ResolvedTheme, THEME_CHOICES, type ThemeChoice } from '../core/theme.ts';
import { Monitor, Moon, Sun } from 'lucide-react';
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
}

/**
 * The language and the theme, side by side.
 */
export function AppearanceControls({
    locale,
    themeChoice,
    resolvedTheme,
    translate,
    onSelectLocale,
    onSelectTheme,
}: AppearanceControlsProps): ReactElement {
    return (
        <div className="flex flex-wrap gap-2">
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
        </div>
    );
}

function ThemeMark({ choice }: { readonly choice: ThemeChoice }): ReactElement {
    const Icon = THEME_ICONS[choice];
    return <Icon className="size-[18px] text-ink-400" />;
}
