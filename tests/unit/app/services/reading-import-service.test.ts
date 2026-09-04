import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describe as describeSpec, readSpec, ReadingImportService } from '../../../../src/app/services/reading-import/reading-import-service.ts';

const VERSIONS = JSON.stringify({ tags: { latest: '1.0.0' }, versions: [{ version: '1.0.0' }] });

const AT = 'https://cdn.jsdelivr.net/gh/someone/readings@1.0.0';

/** What a listing says about one file, taken from the file itself. */
function entryFor(path: string, source: string, size?: number) {
    return {
        name: `/${path}`,
        size: size ?? Buffer.byteLength(source),
        hash: createHash('sha256').update(source).digest('base64'),
    };
}

/**
 * A jsDelivr that answers about the files a test set out.
 *
 * The listing is derived from the content rather than written beside it: the
 * two disagreeing is the failure this service exists to catch, and a double
 * that cannot disagree cannot catch it.
 */
function buildNetwork(content: Record<string, string>, sizes: Record<string, number> = {}) {
    const asked: string[] = [];
    const listing = Object.entries(content).map(([path, source]) => entryFor(path, source, sizes[path]));

    const fetched: typeof globalThis.fetch = (input) => {
        const url = input as string;
        asked.push(url);
        if (url.startsWith('https://data.jsdelivr.com')) {
            return Promise.resolve(new Response(
                url.includes('@') ? JSON.stringify({ files: listing }) : VERSIONS,
                { status: 200 },
            ));
        }
        const held = Object.entries(content).find(([path]) => url === `${AT}/${path}`);
        return Promise.resolve(held === undefined
            ? new Response('no', { status: 404 })
            : new Response(held[1], { status: 200 }));
    };
    return { fetched, asked };
}

function digest(data: ArrayBuffer): Promise<ArrayBuffer> {
    const held = createHash('sha256').update(new Uint8Array(data)).digest();
    return Promise.resolve(held.buffer.slice(held.byteOffset, held.byteOffset + held.byteLength));
}

/** Content nobody is checking, for a test that is only about the listing. */
function filesNamed(...paths: readonly string[]): Record<string, string> {
    return Object.fromEntries(paths.map((path) => [path, `// ${path}`]));
}

function serviceFor(content: Record<string, string>, sizes?: Record<string, number>) {
    const { fetched, asked } = buildNetwork(content, sizes);
    return { service: new ReadingImportService({ fetch: fetched, digest }), asked };
}

describe('naming where a reading comes from', () => {
    it('reads a repository, a branch and a folder within it', () => {
        expect(readSpec('gh/someone/readings@main/mean')).toEqual({
            host: 'gh',
            name: 'someone/readings',
            version: 'main',
            folder: 'mean',
        });
    });

    it('reads a package, scope and all', () => {
        expect(readSpec('npm/@someone/reading@1.2.0')).toMatchObject({
            host: 'npm',
            name: '@someone/reading',
            version: '1.2.0',
        });
    });

    it('takes an address copied straight out of GitHub', () => {
        // What a reader actually has in hand is the page they were looking at,
        // not a spec in a shape this invented.
        expect(describeSpec(readSpec('https://github.com/someone/readings/tree/main/mean')))
            .toBe('gh/someone/readings@main/mean');
    });

    it('takes one copied out of npm', () => {
        expect(describeSpec(readSpec('https://www.npmjs.com/package/@someone/reading')))
            .toBe('npm/@someone/reading');
    });

    it('says what a spec should look like rather than failing silently', () => {
        expect(() => readSpec('somewhere else')).toThrow(/gh\/user\/repo/);
    });

    it('refuses a name a browser would read as a path of its own', () => {
        // A backslash is a separator to a URL, and the `..` around it resolve:
        // this fetched another package entirely while the panel went on showing
        // what was typed, which is the one thing the two steps exist to prevent.
        expect(() => readSpec('gh/x/y\\..\\..\\..\\gh\\attacker\\repo@main')).toThrow(/gh\/user\/repo/);
        expect(() => readSpec('gh/a/b@v\\..\\..\\..\\npm\\evil')).toThrow(/not a version/);
        expect(() => readSpec('npm/x?a=1')).toThrow(/gh\/user\/repo/);
        expect(() => readSpec('npm/x#z')).toThrow(/gh\/user\/repo/);
    });

    it('refuses one hidden inside a pasted GitHub address', () => {
        expect(() => readSpec('https://github.com/good/repo\\..\\..\\..\\npm\\evil@1.0.0'))
            .toThrow(/gh\/user\/repo/);
    });
});

describe('looking at a reading before running it', () => {
    it('names the files from inside the folder they were asked for', async () => {
        // A reading kept in a subfolder imports `./helpers`, so what comes in
        // has to be named the way the reading names itself.
        const { service } = serviceFor(filesNamed('mean/main.ts', 'mean/helpers.ts', 'other/main.ts'));

        const found = await service.look('gh/someone/readings/mean');

        expect(found.files.map((one) => one.path).sort()).toEqual(['helpers.ts', 'main.ts']);
    });

    it('leaves out everything that is not a reading', async () => {
        const { service } = serviceFor(filesNamed('main.ts', 'README.md', 'index.js', 'types.d.ts'));

        const found = await service.look('gh/someone/readings');

        expect(found.files.map((one) => one.path)).toEqual(['main.ts']);
    });

    it('settles on a version when the reader named none', async () => {
        // Asked without one, jsDelivr answers with an index of versions and no
        // files at all — which reads as a repository with nothing in it, so the
        // very spec the panel offers as an example could never have worked.
        const { service } = serviceFor(filesNamed('main.ts'));

        const found = await service.look('gh/someone/readings');

        expect(found.at.version).toBe('1.0.0');
        expect(found.from).toBe('gh/someone/readings@1.0.0');
    });

    it('reads an index.ts as the entry, since that is where anything else starts', async () => {
        const { service } = serviceFor({ 'index.ts': 'the entry', 'helpers.ts': 'the helpers' });

        const found = await service.look('gh/someone/readings');
        const files = await service.take(found);

        expect(Object.keys(files).sort()).toEqual(['helpers.ts', 'main.ts']);
        expect(files['main.ts']).toBe('the entry');
    });

    it('refuses what has no entry, rather than opening half a reading', async () => {
        const { service } = serviceFor(filesNamed('helpers.ts'));

        await expect(service.look('gh/someone/readings')).rejects.toThrow(/needs a main\.ts or an index\.ts/);
    });

    it('refuses a whole repository rather than opening forty files of it', async () => {
        const many = Array.from({ length: 60 }, (_unused, index) => `file${index}.ts`);
        const { service } = serviceFor(filesNamed('main.ts', ...many));

        await expect(service.look('gh/someone/readings')).rejects.toThrow(/may be up to 40/);
    });

    it('refuses one that weighs more than a reading should', async () => {
        const { service } = serviceFor({ 'main.ts': 'small' }, { 'main.ts': 900 * 1024 });

        await expect(service.look('gh/someone/readings')).rejects.toThrow(/may be up to 512 kB/);
    });

    it('says so plainly when there is nothing there', async () => {
        const service = new ReadingImportService({
            fetch: () => Promise.resolve(new Response('', { status: 404 })),
        });

        await expect(service.look('gh/someone/nothing')).rejects.toThrow(/Nothing is published/);
    });

    it('fetches nothing at all while it is only looking', async () => {
        // The whole point of the two steps: a reader is told what they are
        // about to run before any of it has arrived.
        const { service, asked } = serviceFor(filesNamed('main.ts'));

        await service.look('gh/someone/readings');

        expect(asked.every((url) => url.startsWith('https://data.jsdelivr.com'))).toBe(true);
    });
});

describe('taking a reading in', () => {
    it('hands back the files under the paths the reading imports them by', async () => {
        const { service } = serviceFor({ 'mean/main.ts': 'the entry', 'mean/helpers.ts': 'the helpers' });
        const found = await service.look('gh/someone/readings/mean');

        const files = await service.take(found);

        expect(files).toEqual({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });
    });

    it('fetches from where the look looked, whatever has been typed since', async () => {
        // The field stays the reader's to edit after a look. Read again at the
        // press, they could approve one repository and run another.
        const { service, asked } = serviceFor(filesNamed('main.ts'));
        const found = await service.look('gh/someone/readings');

        await service.take({ ...found, from: 'gh/somebody/else@9.9.9' });

        expect(asked.some((url) => url.includes('somebody/else'))).toBe(false);
    });

    it('refuses a file that is not the one the reader was shown', async () => {
        // The listing and the files come from two services with their own
        // caches, and a branch can move between the look and the press.
        const service = swappedFor('main.ts', 'something else entirely');
        const found = await service.look('gh/someone/readings');

        await expect(service.take(found)).rejects.toThrow(/not the file that was listed/);
    });

    it('refuses one whose bytes hash to something else at the very size it claimed', async () => {
        const service = swappedFor('main.ts', 'what was hijack');
        const found = await service.look('gh/someone/readings');

        await expect(service.take(found)).rejects.toThrow(/not the file that was listed/);
    });

    it('still checks the size where the page cannot hash anything', async () => {
        // No `crypto.subtle` outside a secure context. The size the listing
        // gave is the only check left, and it is better than none.
        const { fetched } = buildNetwork({ 'main.ts': 'what was listed' });
        const service = new ReadingImportService({
            fetch: (input) => ((input as string).startsWith('https://data.jsdelivr.com')
                ? fetched(input)
                : Promise.resolve(new Response('something rather longer than that', { status: 200 }))),
        });
        const found = await service.look('gh/someone/readings');

        await expect(service.take(found)).rejects.toThrow(/not the file that was listed/);
    });

    it('asks a second time before giving up on a file', async () => {
        // Twenty files asked for at once came back with some of them refused,
        // and the same ask a moment later answered every one of them.
        const { fetched } = buildNetwork({ 'main.ts': 'the entry' });
        let refusals = 1;
        const service = new ReadingImportService({
            fetch: (input) => {
                if ((input as string).startsWith('https://data.jsdelivr.com') || refusals === 0) {
                    return fetched(input);
                }
                refusals -= 1;
                return Promise.resolve(new Response('', { status: 404 }));
            },
            digest,
        });
        const found = await service.look('gh/someone/readings');

        const files = await service.take(found);

        expect(files).toEqual({ 'main.ts': 'the entry' });
    });

    it('says which file could not be fetched rather than opening a reading with a hole in it', async () => {
        const { service } = serviceFor({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });
        const found = await service.look('gh/someone/readings');
        const gone = { ...found, files: found.files.map((one) => ({ ...one, readAt: 'gone.ts' })) };

        await expect(service.take(gone)).rejects.toThrow(/could not be fetched/);
    });
});

/** A network whose listing is honest and whose files are not the listed ones. */
function swappedFor(path: string, instead: string) {
    const { fetched } = buildNetwork({ [path]: 'what was listed' });
    return new ReadingImportService({
        fetch: (input) => ((input as string).startsWith('https://data.jsdelivr.com')
            ? fetched(input)
            : Promise.resolve(new Response(instead, { status: 200 }))),
        digest,
    });
}
