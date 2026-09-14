import type { HeadConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Beside the demo rather than at the root: one Pages site, two things on it. */
const PUBLISHED_BASE_PATH = '/fathom/guide/';

/** Where the guide answers from, for the addresses that only work absolute. */
const PUBLISHED_ORIGIN = 'https://giovani-freitag.github.io';

/** The two languages the guide is written in, and the one an unplaced reader gets. */
const LANGUAGES = ['en', 'pt-BR'] as const;
const DEFAULT_LANGUAGE = 'en';

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
    return readdirSync(join(DOCS, 'en', 'adr'))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .map((name) => ({ text: titleOf(name), link: `/en/adr/${name.replace(/\.md$/, '')}` }));
}

/**
 * The pages that exist in one language, by the slug they answer to.
 *
 * Read from the folder rather than listed by hand: a page written in one
 * language and not the other is the ordinary state here, and the interface has
 * to know which is which without anybody remembering to say so.
 *
 * @param language - Which one.
 * @returns Its slugs, the front page included as an empty string.
 */
function pagesIn(language: Language): readonly string[] {
    return readdirSync(join(DOCS, language))
        .filter((name) => name.endsWith('.md'))
        .map((name) => (name === 'index.md' ? '' : name.replace(/\.md$/, '')));
}

/** A record's own heading, so the list reads as its author wrote it. */
function titleOf(name: string): string {
    const held = readFileSync(join(DOCS, 'en', 'adr', name), 'utf8');
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
        startHere: 'Getting started', whatItIs: 'Introduction', runIt: 'Installation',
        writeOne: 'Addons', theGuide: 'Writing an indicator', connectors: 'Writing a connector', cookbook: 'Connector cookbook',
        reference: 'API reference',
        examples: 'Worked examples', howItWorks: 'Under the hood', architecture: 'Architecture',
        dataModel: 'Data model', operations: 'Operations', decisions: 'Decisions',
        openTheChart: 'Open the chart', editThisPage: 'Edit this page',
        source: 'GitHub', chart: 'Live chart', addons: 'Example addons',
        /* Written once, in English, and said so where the reader is not. */
        inEnglish: '',
    },
    'pt-BR': {
        startHere: 'Primeiros passos', whatItIs: 'Introdução', runIt: 'Instalação',
        writeOne: 'Addons', theGuide: 'Escrevendo um indicador', connectors: 'Escrevendo um conector', cookbook: 'Receitas de conectores',
        reference: 'Referência da API',
        examples: 'Exemplos prontos', howItWorks: 'Por dentro', architecture: 'Arquitetura',
        dataModel: 'Modelo de dados', operations: 'Operação', decisions: 'Decisões',
        openTheChart: 'Abrir o gráfico', editThisPage: 'Editar esta página',
        source: 'GitHub', chart: 'Gráfico ao vivo', addons: 'Addons de exemplo',
        inEnglish: ' (em inglês)',
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
    const at = (path: string): string => `/${language}${path}`;

    return {
        logo: '/brand.svg',
        outline: [2, 3] as [number, number],
        // Handed to the theme so the flags know which pages the other language
        // actually has: sent to one it does not, a reader lands on a refusal
        // instead of on the language they asked for.
        pages: { en: pagesIn('en'), 'pt-BR': pagesIn('pt-BR') },

        nav: [
            { text: said.whatItIs, link: at('/what-it-is') },
            { text: said.runIt, link: at('/running-it') },
            { text: said.writeOne, link: at('/writing-a-reading') },
            { text: said.howItWorks, link: '/en/architecture' },
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
                    { text: said.connectors, link: at('/writing-a-connector') },
                    { text: said.cookbook, link: at('/connector-cookbook') },
                    { text: said.reference, link: '/api/' },
                    { text: said.examples, link: 'https://github.com/giovani-freitag/fathom-example-addons' },
                ],
            },
            {
                text: said.howItWorks,
                items: [
                    { text: said.architecture + said.inEnglish, link: '/en/architecture' },
                    { text: said.dataModel + said.inEnglish, link: '/en/data-model' },
                    { text: said.operations + said.inEnglish, link: '/en/operations' },
                ],
            },
            { text: said.decisions + said.inEnglish, collapsed: true, items: decisions() },
        ],

        socialLinks: [{ icon: 'github' as const, link: 'https://github.com/giovani-freitag/fathom' }],
        search: { provider: 'local' as const },

        editLink: {
            pattern: 'https://github.com/giovani-freitag/fathom/edit/main/docs/:path',
            text: said.editThisPage,
        },

        // Links and nothing else. A line of prose under every page is a line
        // every page carries and no page needed.
        footer: {
            message: `<a href="https://giovani-freitag.github.io/fathom/">${said.chart}</a>`
                + `<a href="https://github.com/giovani-freitag/fathom">${said.source}</a>`
                + `<a href="https://github.com/giovani-freitag/fathom-example-addons">${said.addons}</a>`,
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

    /*
     * Eighty-four pages that nothing links to from outside.
     *
     * The guide is reachable by following links from the chart, and that is the
     * only way in: a crawler that has not found the entrance finds none of the
     * rest. A sitemap is the list of everything, handed over at once. It is
     * worth having here and would not be on a site of one page — it is
     * submitted by hand in Search Console, because a `Sitemap:` line has to
     * live in a robots.txt at the root of the host, and the root of this host
     * is a 404 nobody here owns.
     */
    sitemap: { hostname: `${PUBLISHED_ORIGIN}${PUBLISHED_BASE_PATH}` },

    head: [
        ['link', { rel: 'icon', href: `${PUBLISHED_BASE_PATH}brand.svg` }],
        ['meta', { name: 'theme-color', content: '#087a6b' }],
    ],

    /**
     * The addresses of a page: which one it really is, and where it is in the
     * other language.
     *
     * Both are missing without this, and both matter more here than on a site
     * of one page. A page that exists in both languages is otherwise a pair of
     * near-identical documents competing with each other; `hreflang` is what
     * says they are the same page said twice and which reader each is for, and
     * `x-default` names the one to fall back to for a reader neither language
     * was written for.
     *
     * Only for the pages that really are written twice. A page in one language
     * and not the other is the ordinary state here — the architecture and the
     * decision records are English only — and an annotation pointing at an
     * address that answers 404 is a broken one, so the set is read from the
     * folders rather than assumed.
     *
     * The Open Graph tags come from the same place because a guide page pasted
     * into a chat is currently a bare link with no title and no picture, while
     * the chart beside it has had a card since the day it shipped.
     *
     * @param context - The page VitePress is about to write, and what it knows.
     */
    transformHead({ pageData, siteData }): HeadConfig[] {
        // The home page of the whole guide, which belongs to neither language.
        if (!pageData.relativePath) return [];

        const language = LANGUAGES.find((code) => pageData.relativePath.startsWith(`${code}/`));
        if (!language) return [];

        const slug = pageData.relativePath.slice(language.length + 1).replace(/(?:index)?\.md$/, '');
        const addressOf = (code: string): string => `${PUBLISHED_ORIGIN}${PUBLISHED_BASE_PATH}${code}/${slug}`;

        /* A decision record lives in a folder of its own and is written once, in English. */
        const written: readonly string[] = slug.includes('/')
            ? [DEFAULT_LANGUAGE]
            : LANGUAGES.filter((code) => pagesIn(code).includes(slug));

        const matter = pageData.frontmatter as Record<string, unknown>;
        const said = (key: string): string | undefined =>
            typeof matter[key] === 'string' ? matter[key] : undefined;

        // `||` rather than `??`: a page whose heading is empty should fall through, not ship blank.
        const title = said('title') || pageData.title || siteData.title;
        const description =
            said('description') ?? siteData.locales[language]?.description ?? siteData.description;

        const alternates: HeadConfig[] =
            // One address in one language is not a set, and annotating it as one says nothing.
            written.length > 1
                ? [
                    ...written.map(
                        (code): HeadConfig => [
                            'link',
                            { rel: 'alternate', hreflang: code, href: addressOf(code) },
                        ],
                    ),
                    ['link', { rel: 'alternate', hreflang: 'x-default', href: addressOf(DEFAULT_LANGUAGE) }],
                ]
                : [];

        return [
            ['link', { rel: 'canonical', href: addressOf(language) }],
            ...alternates,
            ['meta', { property: 'og:type', content: 'article' }],
            ['meta', { property: 'og:site_name', content: 'Fathom' }],
            ['meta', { property: 'og:title', content: title }],
            ['meta', { property: 'og:description', content: description }],
            ['meta', { property: 'og:url', content: addressOf(language) }],
            ['meta', { property: 'og:locale', content: language === 'en' ? 'en_US' : language.replace('-', '_') }],
            ['meta', { property: 'og:image', content: `${PUBLISHED_ORIGIN}/fathom/social-card.png` }],
            ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
            ['meta', { name: 'twitter:title', content: title }],
            ['meta', { name: 'twitter:description', content: description }],
        ];
    },

    // Neither language at the root. One of them served from `/` and the other
    // from a folder makes the first read as the real one and the second as a
    // translation of it; both in a folder makes them two of the same thing.
    // `/` sends a reader to English, which is only which one is the default.
    locales: {
        en: {
            label: 'English',
            lang: 'en',
            themeConfig: navigationIn('en'),
        },
        'pt-BR': {
            label: 'Português',
            lang: 'pt-BR',
            description: 'Liquidez do livro de ofertas, gravada segundo a segundo — e os indicadores que você escreve contra ela.',
            themeConfig: navigationIn('pt-BR'),
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

    // Mermaid reaches a CommonJS package to schedule its layout work, and a
    // dev server that has not pre-bundled that package hands the browser a
    // module with no default export — one uncaught error, and every page in the
    // guide renders blank. The built site bundles it either way; this is only
    // the dev server catching up.
    vite: {
        optimizeDeps: { include: ['mermaid', 'fastdom'] },
        ssr: { noExternal: ['mermaid'] },
    },

    ignoreDeadLinks: [
        // The reference is generated, and its anchors are TypeDoc's own.
        /^\/api/,
        // An address a reader opens after starting it, which is not reachable
        // from a machine building this.
        /^http:\/\/localhost/,
    ],
});
