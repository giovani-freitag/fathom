import { type Locale, SUPPORTED_LOCALES } from '../i18n/locale.ts';
import { type ResolvedTheme, THEME_CHOICES, type ThemeChoice } from '../core/theme.ts';
import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactElement } from 'react';
import { DropdownMenu } from 'radix-ui';
import { FlagIcon } from './flag-icon.tsx';
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

const TRIGGER_CLASSES = 'inline-flex min-h-9 items-center gap-2 rounded-md border border-hairline bg-abyss-800 px-2.5 text-xs text-ink-200 transition-colors hover:border-hairline-bright data-[state=open]:border-phosphor/60';

const ITEM_CLASSES = 'relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 pr-8 text-xs text-ink-300 outline-none data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100';

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
    const ThemeIcon = THEME_ICONS[themeChoice];

    return (
        <div className="flex flex-wrap gap-2">
            <PickerMenu
                label={translate('settings.language')}
                trigger={
                    <>
                        <FlagIcon locale={locale} />
                        {translate(LOCALE_LABEL_KEYS[locale])}
                    </>
                }
            >
                {SUPPORTED_LOCALES.map((candidate) => (
                    <DropdownMenu.Item
                        key={candidate}
                        className={ITEM_CLASSES}
                        onSelect={() => { onSelectLocale(candidate); }}
                    >
                        <FlagIcon locale={candidate} />
                        {translate(LOCALE_LABEL_KEYS[candidate])}
                        {candidate === locale && <SelectedMark />}
                    </DropdownMenu.Item>
                ))}
            </PickerMenu>

            <PickerMenu
                label={translate('settings.theme')}
                trigger={
                    <>
                        {/* The resolved theme, not the choice: under `system` the
                            icon is the only place the reader learns which one won. */}
                        <ThemeIcon className="size-[18px] text-ink-400" />
                        {translate(THEME_LABEL_KEYS[themeChoice])}
                        {themeChoice === 'system' && (
                            <span className="text-ink-600">
                                {translate(THEME_LABEL_KEYS[resolvedTheme])}
                            </span>
                        )}
                    </>
                }
            >
                {THEME_CHOICES.map((candidate) => {
                    const CandidateIcon = THEME_ICONS[candidate];
                    return (
                        <DropdownMenu.Item
                            key={candidate}
                            className={ITEM_CLASSES}
                            onSelect={() => { onSelectTheme(candidate); }}
                        >
                            <CandidateIcon className="size-[18px] text-ink-400" />
                            {translate(THEME_LABEL_KEYS[candidate])}
                            {candidate === themeChoice && <SelectedMark />}
                        </DropdownMenu.Item>
                    );
                })}
            </PickerMenu>
        </div>
    );
}

interface PickerMenuProps {
    readonly label: string;
    readonly trigger: ReactElement;
    readonly children: ReactElement | readonly ReactElement[];
}

function PickerMenu({ label, trigger, children }: PickerMenuProps): ReactElement {
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label={label} className={TRIGGER_CLASSES}>
                {trigger}
                <ChevronDown className="size-3.5 text-ink-500" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    sideOffset={6}
                    align="start"
                    className="z-50 min-w-[10rem] overflow-hidden rounded-lg border border-hairline bg-abyss-800 p-1 shadow-2xl shadow-black/40"
                >
                    {children}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

function SelectedMark(): ReactElement {
    return <Check className="absolute right-2.5 size-3.5 text-phosphor" />;
}
