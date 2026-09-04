import { defineConfig } from 'vitepress';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Beside the demo rather than at the root: one Pages site, two things on it. */
const PUBLISHED_BASE_PATH = '/fathom/guide/';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every decision record, newest first.
 *
 * Read from the folder rather than listed by hand: there are two dozen and one
 * is added every time something is settled, so a list kept here goes stale on
 * the first one nobody remembers to add.
 */
function decisions() {
    return readdirSync(join(DOCS, 'adr'))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse()
        .map((name) => ({
            text: name.replace(/^(\d+)-/, '$1. ').replace(/-/g, ' ').replace(/\.md$/, ''),
            link: `/adr/${name.replace(/\.md$/, '')}`,
        }));
}

export default defineConfig({
    title: 'Fathom',
    description: 'Order book liquidity, recorded second by second — and the indicators you write against it.',
    base: PUBLISHED_BASE_PATH,
    lang: 'en',
    cleanUrls: true,
    lastUpdated: true,
    // The chart is dark and this is read beside it.
    appearance: 'dark',

    head: [
        ['link', { rel: 'icon', href: `${PUBLISHED_BASE_PATH}brand.svg` }],
        ['meta', { name: 'theme-color', content: '#35e0c4' }],
    ],

    themeConfig: {
        logo: '/brand.svg',
        outline: [2, 3],

        nav: [
            { text: 'Write a reading', link: '/writing-a-reading' },
            { text: 'API', link: '/api/' },
            { text: 'How it works', link: '/architecture' },
            { text: 'Chart ↗', link: 'https://giovani-freitag.github.io/fathom/' },
        ],

        sidebar: [
            {
                text: 'Writing a reading',
                items: [
                    { text: 'The guide', link: '/writing-a-reading' },
                    { text: 'API reference', link: '/api/' },
                    {
                        text: 'Worked examples ↗',
                        link: 'https://github.com/giovani-freitag/fathom-addons',
                    },
                ],
            },
            {
                text: 'How it works',
                items: [
                    { text: 'Architecture', link: '/architecture' },
                    { text: 'Data model', link: '/data-model' },
                    { text: 'Operations', link: '/operations' },
                ],
            },
            { text: 'Decisions', collapsed: true, items: decisions() },
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/giovani-freitag/fathom' },
        ],

        search: { provider: 'local' },

        editLink: {
            pattern: 'https://github.com/giovani-freitag/fathom/edit/main/docs/:path',
            text: 'Edit this page',
        },

        footer: {
            message: 'MIT',
            copyright: 'Fathom',
        },
    },

    // The API page is generated, and its anchors are what TypeDoc made them.
    ignoreDeadLinks: [/^\/api/],
});
