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


/**
 * What each language calls the parts of the site.
 *
 * One shape, two vocabularies. Written out per language rather than looked up
 * from a shared list, so a page that exists in one and not the other is a
 * missing entry here rather than a link that leads nowhere.
 */
const WORDS = {
    en: {
        startHere: 'Start here', whatItIs: 'What Fathom is', runIt: 'Run it',
        writeOne: 'Write an indicator', theGuide: 'The guide', reference: 'API reference',
        examples: 'Worked examples', howItWorks: 'How it works', architecture: 'Architecture',
        dataModel: 'Data model', operations: 'Operations', decisions: 'Decisions',
        openTheChart: 'Open the chart', editThisPage: 'Edit this page',
        footer: 'An order book is only ever recorded, never recovered.',
        source: 'Source', chart: 'Chart', addons: 'Addons',
    },
    'pt-BR': {
        startHere: 'Comece aqui', whatItIs: 'O que é o Fathom', runIt: 'Rodar',
        writeOne: 'Escrever um indicador', theGuide: 'O guia', reference: 'Referência da API',
        examples: 'Exemplos prontos', howItWorks: 'Como funciona', architecture: 'Arquitetura',
        dataModel: 'Modelo de dados', operations: 'Operação', decisions: 'Decisões',
        openTheChart: 'Abrir o gráfico', editThisPage: 'Editar esta página',
        footer: 'Um livro de ofertas só é gravado, nunca recuperado.',
        source: 'Código', chart: 'Gráfico', addons: 'Addons',
    },
} as const;

type Language = keyof typeof WORDS;

/**
 * The navigation for one language.
 *
 * @param language - Which one.
 * @returns Its nav, sidebar, footer and link labels.
 */
function navigationIn(language: Language) {
    const said = WORDS[language];
    // Only the pages that exist in both. The deeper three and the decision
    // records are written once, in English, and both languages link to the same
    // page rather than to a translation that is not there.
    const at = (path: string): string => (language === 'en' ? path : `/${language}${path}`);

    return {
        logo: '/brand.svg',
        outline: [2, 3] as [number, number],

        nav: [
            { text: said.whatItIs, link: at('/what-it-is') },
            { text: said.writeOne, link: at('/writing-a-reading') },
            { text: 'API', link: '/api/' },
            { text: said.howItWorks, link: '/architecture' },
            { text: said.openTheChart, link: 'https://giovani-freitag.github.io/fathom/' },
        ],

        sidebar: [
            {
                text: said.startHere,
                items: [
                    { text: said.whatItIs, link: at('/what-it-is') },
                    { text: said.runIt, link: at('/running-it') },
                ],
            },
            {
                text: said.writeOne,
                items: [
                    { text: said.theGuide, link: at('/writing-a-reading') },
                    { text: said.reference, link: '/api/' },
                    { text: said.examples, link: 'https://github.com/giovani-freitag/fathom-example-addons' },
                ],
            },
            {
                text: said.howItWorks,
                items: [
                    { text: said.architecture, link: '/architecture' },
                    { text: said.dataModel, link: '/data-model' },
                    { text: said.operations, link: '/operations' },
                ],
            },
            { text: said.decisions, collapsed: true, items: decisions() },
        ],

        socialLinks: [{ icon: 'github' as const, link: 'https://github.com/giovani-freitag/fathom' }],
        search: { provider: 'local' as const },

        editLink: {
            pattern: 'https://github.com/giovani-freitag/fathom/edit/main/docs/:path',
            text: said.editThisPage,
        },

        footer: {
            message: `${said.footer} `
                + `<a href="https://github.com/giovani-freitag/fathom">${said.source}</a> · `
                + `<a href="https://giovani-freitag.github.io/fathom/">${said.chart}</a> · `
                + `<a href="https://github.com/giovani-freitag/fathom-example-addons">${said.addons}</a>`,
            copyright: 'MIT',
        },
    };
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

    locales: {
        root: { label: 'English', lang: 'en' },
        'pt-BR': {
            label: 'Português',
            lang: 'pt-BR',
            description: 'Liquidez do livro de ofertas, gravada segundo a segundo — e os indicadores que você escreve contra ela.',
            themeConfig: navigationIn('pt-BR'),
        },
    },

    themeConfig: navigationIn('en'),

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
