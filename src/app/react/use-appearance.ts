import type { AppearanceState } from '../core/appearance-controller.ts';
import { buildTranslate, type Translate } from '../i18n/translator.ts';
import { useKernel } from './kernel-context.ts';
import { useMemo } from 'react';
import { useStore } from './use-store.ts';

/**
 * The language and theme the interface is drawn in.
 *
 * @returns The current appearance, re-rendering the caller on each change.
 */
export function useAppearance(): AppearanceState {
    return useStore(useKernel().appearance.store);
}

/**
 * The phrase renderer for the reader's language.
 *
 * @returns A renderer that re-renders the caller when the language changes.
 */
export function useTranslate(): Translate {
    const { locale } = useAppearance();
    return useMemo(() => buildTranslate(locale), [locale]);
}
