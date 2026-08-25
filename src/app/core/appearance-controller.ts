import { type Locale, resolveLocale } from '../i18n/locale.ts';
import { type ResolvedTheme, resolveTheme, type ThemeChoice } from './theme.ts';
import { applyFormattingLocale } from './formatting.ts';
import { applyRenderTheme } from '../painting/render-theme.ts';
import { ObservableStore } from './observable-store.ts';
import type { PreferencesService } from '../services/preferences-service.ts';

export interface AppearanceState {
    readonly locale: Locale;
    readonly themeChoice: ThemeChoice;
    readonly resolvedTheme: ResolvedTheme;
}

/** The browser handles the appearance is expressed through. */
export interface AppearanceHost {
    /** The element carrying `data-theme`, which is what the tokens key off. */
    readonly rootElement: HTMLElement;
    readonly darkQuery: MediaQueryList;
    readonly languages: readonly string[];
}

export interface AppearanceControllerConfig {
    readonly preferences: PreferencesService;
    /** Absent in a test that runs outside a DOM. */
    readonly host: AppearanceHost | null;
}

/**
 * Owns the language and the theme the whole interface is drawn in.
 */
export class AppearanceController {
    readonly store: ObservableStore<AppearanceState>;

    private readonly config: AppearanceControllerConfig;
    private isListening = false;

    constructor(config: AppearanceControllerConfig) {
        this.config = config;
        this.handleHostThemeChange = this.handleHostThemeChange.bind(this);

        const stored = config.preferences.read();
        const locale = stored.locale ?? resolveLocale(config.host?.languages ?? []);
        this.store = new ObservableStore<AppearanceState>({
            initialState: {
                locale,
                themeChoice: stored.themeChoice,
                resolvedTheme: resolveTheme(stored.themeChoice, config.host?.darkQuery.matches ?? true),
            },
        });
    }

    /**
     * Paints the stored appearance and follows the host from then on.
     */
    start(): void {
        const { locale, resolvedTheme } = this.store.read();
        applyFormattingLocale(locale);
        this.paintTheme(resolvedTheme);
        if (this.isListening) {
            return;
        }
        this.config.host?.darkQuery.addEventListener('change', this.handleHostThemeChange);
        this.isListening = true;
    }

    /**
     * Stops following the host. Safe in any state.
     */
    dispose(): void {
        this.config.host?.darkQuery.removeEventListener('change', this.handleHostThemeChange);
        this.isListening = false;
    }

    /**
     * Switches the interface to a language and remembers the choice.
     *
     * @param locale - The language to render in.
     */
    selectLocale(locale: Locale): void {
        // Prices and clocks are read beside the words they sit next to: a
        // thousands separator from another language reads as a decimal point.
        applyFormattingLocale(locale);
        this.store.update((state) => ({ ...state, locale }));
        this.config.preferences.write({ locale });
    }

    /**
     * Switches the interface to a theme and remembers the choice.
     *
     * @param themeChoice - The theme, or `system` to follow the host.
     */
    selectTheme(themeChoice: ThemeChoice): void {
        const resolvedTheme = resolveTheme(themeChoice, this.config.host?.darkQuery.matches ?? true);
        this.store.update((state) => ({ ...state, themeChoice, resolvedTheme }));
        this.paintTheme(resolvedTheme);
        this.config.preferences.write({ themeChoice });
    }

    private paintTheme(theme: ResolvedTheme): void {
        // The canvas cannot read the cascade, so the tokens and the painters are
        // pointed at the theme in the same breath or they disagree for a frame.
        this.config.host?.rootElement.setAttribute('data-theme', theme);
        applyRenderTheme(theme);
    }

    /**
     * Follows the host, but only while the reader has not overruled it.
     */
    private handleHostThemeChange(event: MediaQueryListEvent): void {
        if (this.store.read().themeChoice !== 'system') {
            return;
        }
        const resolvedTheme = resolveTheme('system', event.matches);
        this.store.update((state) => ({ ...state, resolvedTheme }));
        this.paintTheme(resolvedTheme);
    }
}
