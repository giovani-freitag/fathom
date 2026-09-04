import { withMermaid } from 'vitepress-plugin-mermaid';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Beside the demo rather than at the root: one Pages site, two things on it. */
const PUBLISHED_BASE_PATH = '/fathom/guide/';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every decision record, oldest first.
 *
 * In the order they were taken, because that is the order they make sense in:
 * the later ones are answers to the earlier ones, and reading them backwards
 * means meeting every conclusion before its question.
 *
 * Read from the folder rather than listed by hand: there are two dozen and one
 * lands every time something is settled.
 */
function decisions() {
    return readdirSync(join(DOCS, 'adr'))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .map((name) => ({ text: titleOf(name), link: `/adr/${name.replace(/\.md$/, '')}` }));
}

/** A record's own heading, so the list reads as its author wrote it. */
function titleOf(name: string): string {
    const held = readFileSync(join(DOCS, 'adr', name), 'utf8');
    return /^#\s+(.+)$/m.exec(held)?.[1] ?? name.replace(/\.md$/, '');
}

export default withMermaid({
    title: 'Fathom',
    description: 'Order book liquidity, recorded second by second — and the indicators you write against it.',
    base: PUBLISHED_BASE_PATH,
    lang: 'en',
    cleanUrls: true,
    lastUpdated: true,

    head: [
        ['link', { rel: 'icon', href: `${PUBLISHED_BASE_PATH}brand.svg` }],
        ['meta', { name: 'theme-color', content: '#087a6b' }],
    ],

    themeConfig: {
        logo: '/brand.svg',
        outline: [2, 3],

        nav: [
            { text: 'What it is', link: '/what-it-is' },
            { text: 'Write an indicator', link: '/writing-a-reading' },
            { text: 'API', link: '/api/' },
            { text: 'How it works', link: '/architecture' },
            { text: 'Open the chart ↗', link: 'https://giovani-freitag.github.io/fathom/' },
        ],

        sidebar: [
            {
                text: 'Start here',
                items: [
                    { text: 'What Fathom is', link: '/what-it-is' },
                    { text: 'Run it', link: '/running-it' },
                ],
            },
            {
                text: 'Write an indicator',
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
            message: 'An order book is only ever recorded, never recovered. '
                + '<a href="https://github.com/giovani-freitag/fathom">Source</a> · '
                + '<a href="https://giovani-freitag.github.io/fathom/">Chart</a> · '
                + '<a href="https://github.com/giovani-freitag/fathom-addons">Addons</a>',
            copyright: 'MIT',
        },
    },

    // Only what CSS cannot reach. The colours live in the stylesheet instead,
    // because a diagram configured here is drawn once and cannot follow a
    // reader switching between the light theme and the dark one.
    mermaid: {
        theme: 'base',
        themeVariables: {
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: '15px',
        },
        // Drawn at the size it needs and scrolled sideways, rather than squeezed
        // into the column: a wide flowchart shrunk to fit is a diagram whose
        // labels cannot be read, which is the only thing it was there for.
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
    },

    ignoreDeadLinks: [
        // The reference is generated, and its anchors are TypeDoc's own.
        /^\/api/,
        // An address a reader opens after starting it, which is not reachable
        // from a machine building this.
        /^http:\/\/localhost/,
    ],
});
