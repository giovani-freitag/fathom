import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { h } from 'vue';
import AppearanceSwitch from './AppearanceSwitch.vue';
import FlagSwitch from './FlagSwitch.vue';
import SourceLink from './SourceLink.vue';
import './fathom.css';

/**
 * The default theme, wearing the chart's own palette.
 *
 * Three of its controls are replaced rather than restyled. The language menu
 * becomes two flags, because there are two languages and a dropdown asks a
 * reader to open something before they can see that. The appearance toggle
 * becomes three buttons, because "follow the system" is a choice a reader
 * should be able to go back to and a two-state switch cannot express it. And on
 * a phone the repository link becomes a line of the menu, because a bare mark
 * ruled off on its own is neither readable nor reachable by a thumb.
 */
export default {
    extends: DefaultTheme,
    Layout: () => h(DefaultTheme.Layout, null, {
        'nav-bar-content-after': () => h('div', { class: 'nav-extras' }, [
            h(FlagSwitch),
            h(AppearanceSwitch),
        ]),
        // On the small screen the repository joins the menu as a line of it,
        // rather than sitting alone in the middle as an unlabelled mark.
        'nav-screen-content-after': () => h('div', { class: 'nav-screen-extras' }, [
            h('div', { class: 'nav-extras nav-extras--screen' }, [
                h(FlagSwitch),
                h(AppearanceSwitch),
            ]),
            h(SourceLink),
        ]),
    }),
} satisfies Theme;
