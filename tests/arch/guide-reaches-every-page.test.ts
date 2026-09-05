import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = join(import.meta.dirname, '../..', 'docs');

/** The languages the guide is published in. */
const LANGUAGES = ['en', 'pt-BR'] as const;

/** Links that leave the guide, which this cannot follow. */
const IS_OUTSIDE = /^(https?:|mailto:|#)/;

/**
 * Every page of one language, by the slug it answers to.
 */
function pagesIn(language: string): readonly string[] {
    return readdirSync(join(DOCS, language))
        .filter((name) => name.endsWith('.md'))
        .map((name) => (name === 'index.md' ? '' : name.replace(/\.md$/, '')));
}

/**
 * Whether the guide holds a page at a path, however it is written.
 *
 * @param link - A site-absolute path, as a page or the navigation writes one.
 * @returns True where a file answers it.
 */
function isReachable(link: string): boolean {
    const path = link.replace(/[#?].*$/, '').replace(/^\//, '').replace(/\/$/, '');
    // The reference is generated into the built site rather than written here.
    if (path.startsWith('api')) {
        return true;
    }

    return existsSync(join(DOCS, `${path}.md`))
        || existsSync(join(DOCS, path, 'index.md'))
        || existsSync(join(DOCS, path));
}

/** Every internal link a page carries, with the line it was written on. */
function linksIn(at: string): readonly { readonly link: string; readonly line: number }[] {
    const page = readFileSync(at, 'utf8');
    return [...page.matchAll(/]\((\/[^)\s]*)\)/g)].map((found) => ({
        link: found[1]!,
        line: page.slice(0, found.index).split('\n').length,
    }));
}

/** Every page of the guide, in both languages. */
function everyPage(): readonly { readonly at: string; readonly named: string }[] {
    return LANGUAGES.flatMap((language) => readdirSync(join(DOCS, language), { recursive: true })
        .map(String)
        .filter((name) => name.endsWith('.md'))
        .map((name) => ({ at: join(DOCS, language, name), named: `${language}/${name}` })));
}

describe('the guide', () => {
    it('has no page that links to one that is not there', () => {
        // A link that leads nowhere is worse in a guide than in an app: the
        // reader trusted it enough to leave the page they were reading.
        const broken = everyPage().flatMap(({ at, named }) => linksIn(at)
            .filter(({ link }) => !IS_OUTSIDE.test(link) && !isReachable(link))
            .map(({ link, line }) => `${named}:${String(line)} → ${link}`));

        expect(broken).toEqual([]);
    });

    it('is navigable in every language it is published in', async () => {
        // The navigation is built rather than written, so a page renamed in one
        // language leaves an entry pointing at nothing in both — and nothing in
        // the build says so, because a theme's own links are not checked.
        const config = await import('../../docs/.vitepress/config.ts');
        const locales = (config.default as unknown as {
            locales: Record<string, { themeConfig: { nav: Entry[]; sidebar: Group[] } }>;
        }).locales;

        const wrong: string[] = [];
        for (const [language, { themeConfig }] of Object.entries(locales)) {
            const links = [
                ...themeConfig.nav.map((entry) => entry.link),
                ...themeConfig.sidebar.flatMap((group) => group.items.map((entry) => entry.link)),
            ];
            wrong.push(...links
                .filter((link) => link !== undefined && !IS_OUTSIDE.test(link) && !isReachable(link))
                .map((link) => `${language} → ${String(link)}`));
        }

        expect(wrong).toEqual([]);
    });

    it('sends a reader switching language to a page that exists', () => {
        // The flags read this list to decide between the same page in the other
        // language and that language's front page. Read from anywhere else, a
        // reader asking for their own language is answered with a refusal.
        for (const language of LANGUAGES) {
            for (const slug of pagesIn(language)) {
                expect(isReachable(`/${language}/${slug}`)).toBe(true);
            }
        }
    });
});

describe('what the guide promises', () => {
    /** The pages a reader meets first, where an inventory would be written. */
    const FRONT = LANGUAGES.flatMap((language) => ['index.md', 'what-it-is.md']
        .map((name) => ({ at: join(DOCS, language, name), named: `${language}/${name}` })));

    it('counts nothing it would have to come back and recount', () => {
        // "Eighteen indicators ship with Fathom" was true for a fortnight. The
        // nineteenth lands and nobody remembers this sentence exists, so the
        // guide starts lying about the one thing a reader can check in a
        // second.
        // Two and up: the guard is against an inventory, and an inventory is
        // never one. "One venue of your own" is a sentence, not a count.
        const counted = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozens?|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|dezoito|d[úu]zias?|\d+)\s+(indicators?|readings?|venues?|exchanges?|connectors?|addons?|layers?|indicadores?|leituras?|corretoras?|conectores?|camadas?)\b/gi;

        const found = FRONT.flatMap(({ at, named }) => [...readFileSync(at, 'utf8').matchAll(counted)]
            .map((one) => `${named} → “${one[0]}”`));

        expect(found).toEqual([]);
    });

    it('makes the same promise on one page only', () => {
        // The reader is told there is no account to create on the front page.
        // Told again two pages later, and again under a heading, it stops
        // reading as a promise and starts reading as a sales pitch.
        const promise = /(no account|no sign-?up|sem cadastro|sem conta|n[ãa]o tem conta)/i;

        const said = FRONT
            .filter(({ at }) => promise.test(readFileSync(at, 'utf8')))
            .map(({ named }) => named);

        // The front page of each language, and nowhere else.
        expect(said).toEqual(LANGUAGES.map((language) => `${language}/index.md`));
    });
});

interface Entry {
    readonly text: string;
    readonly link?: string;
}

interface Group {
    readonly text: string;
    readonly items: readonly Entry[];
}
