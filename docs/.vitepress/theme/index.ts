import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { h } from 'vue';
import AppearanceSwitch from './AppearanceSwitch.vue';
import FlagSwitch from './FlagSwitch.vue';
import './fathom.css';

/**
 * The default theme, wearing the chart's own palette.
 *
 * Two of its controls are replaced rather than restyled. The language menu
 * becomes two flags, because there are two languages and a dropdown asks a
 * reader to open something before they can see that. The appearance toggle
 * becomes three buttons, because "follow the system" is a choice a reader
 * should be able to go back to and a two-state switch cannot express it.
 */
export default {
    extends: DefaultTheme,
    Layout: () => h(DefaultTheme.Layout, null, {
        'nav-bar-content-after': () => h('div', { class: 'nav-extras' }, [
            h(FlagSwitch),
            h(AppearanceSwitch),
        ]),
        'nav-screen-content-after': () => h('div', { class: 'nav-extras nav-extras--screen' }, [
            h(FlagSwitch),
            h(AppearanceSwitch),
        ]),
    }),
} satisfies Theme;
