import { describe, expect, it } from 'vitest';
import { describe as describeSpec, readSpec, ReadingImportService } from '../../../../src/app/services/reading-import/reading-import-service.ts';

/** A jsDelivr that answers with whatever a test set out. */
function buildNetwork(listing: readonly { name: string; size: number }[], content: Record<string, string> = {}) {
    const asked: string[] = [];
    const fetched: typeof globalThis.fetch = (input) => {
        const url = input as string;
        asked.push(url);
        if (url.startsWith('https://data.jsdelivr.com')) {
            return Promise.resolve(new Response(JSON.stringify({ files: listing }), { status: 200 }));
        }
        // Matched whole rather than by its ending: a URL that names the
        // folder twice over still ends with the right file, and the reading
        // that could not be fetched at all read as one that could.
        const held = Object.entries(content).find(([path]) => url === `https://cdn.jsdelivr.net/gh/someone/readings/${path}`);
        return Promise.resolve(held === undefined
            ? new Response('no', { status: 404 })
            : new Response(held[1], { status: 200 }));
    };
    return { fetched, asked };
}

function listingOf(...paths: readonly string[]) {
    return paths.map((name) => ({ name: `/${name}`, size: 100 }));
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
});

describe('looking at a reading before running it', () => {
    it('names the files from inside the folder they were asked for', async () => {
        // A reading kept in a subfolder imports `./helpers`, so what comes in
        // has to be named the way the reading names itself.
        const { fetched } = buildNetwork(listingOf('mean/main.ts', 'mean/helpers.ts', 'other/main.ts'));
        const service = new ReadingImportService({ fetch: fetched });

        const found = await service.look('gh/someone/readings/mean');

        expect(found.files.map((one) => one.path).sort()).toEqual(['helpers.ts', 'main.ts']);
    });

    it('leaves out everything that is not a reading', async () => {
        const { fetched } = buildNetwork(listingOf('main.ts', 'README.md', 'index.js', 'types.d.ts'));
        const service = new ReadingImportService({ fetch: fetched });

        const found = await service.look('gh/someone/readings');

        expect(found.files.map((one) => one.path)).toEqual(['main.ts']);
    });

    it('reads an index.ts as the entry, since that is where anything else starts', async () => {
        const { fetched } = buildNetwork(listingOf('index.ts', 'helpers.ts'), {
            'index.ts': 'the entry',
            'helpers.ts': 'the helpers',
        });
        const service = new ReadingImportService({ fetch: fetched });

        const found = await service.look('gh/someone/readings');
        const files = await service.take('gh/someone/readings', found);

        expect(Object.keys(files).sort()).toEqual(['helpers.ts', 'main.ts']);
        expect(files['main.ts']).toBe('the entry');
    });

    it('refuses what has no entry, rather than opening half a reading', async () => {
        const { fetched } = buildNetwork(listingOf('helpers.ts'));
        const service = new ReadingImportService({ fetch: fetched });

        await expect(service.look('gh/someone/readings')).rejects.toThrow(/needs a main\.ts or an index\.ts/);
    });

    it('refuses a whole repository rather than opening forty files of it', async () => {
        const many = Array.from({ length: 60 }, (_unused, index) => `file${index}.ts`);
        const { fetched } = buildNetwork(listingOf('main.ts', ...many));
        const service = new ReadingImportService({ fetch: fetched });

        await expect(service.look('gh/someone/readings')).rejects.toThrow(/may be up to 40/);
    });

    it('refuses one that weighs more than a reading should', async () => {
        const { fetched } = buildNetwork([{ name: '/main.ts', size: 900 * 1024 }]);
        const service = new ReadingImportService({ fetch: fetched });

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
        const { fetched, asked } = buildNetwork(listingOf('main.ts'));
        const service = new ReadingImportService({ fetch: fetched });

        await service.look('gh/someone/readings');

        expect(asked.every((url) => url.startsWith('https://data.jsdelivr.com'))).toBe(true);
    });
});

describe('taking a reading in', () => {
    it('hands back the files under the paths the reading imports them by', async () => {
        const { fetched } = buildNetwork(
            listingOf('mean/main.ts', 'mean/helpers.ts'),
            { 'mean/main.ts': 'the entry', 'mean/helpers.ts': 'the helpers' },
        );
        const service = new ReadingImportService({ fetch: fetched });
        const found = await service.look('gh/someone/readings/mean');

        const files = await service.take('gh/someone/readings/mean', found);

        expect(files).toEqual({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });
    });

    it('asks a second time before giving up on a file', async () => {
        // Twenty files asked for at once came back with some of them refused,
        // and the same ask a moment later answered every one of them.
        let refusals = 1;
        const service = new ReadingImportService({
            fetch: (input) => {
                const url = input as string;
                if (url.startsWith('https://data.jsdelivr.com')) {
                    return Promise.resolve(new Response(JSON.stringify({ files: listingOf('main.ts') }), { status: 200 }));
                }
                if (refusals > 0) {
                    refusals -= 1;
                    return Promise.resolve(new Response('', { status: 404 }));
                }
                return Promise.resolve(new Response('the entry', { status: 200 }));
            },
        });
        const found = await service.look('gh/someone/readings');

        const files = await service.take('gh/someone/readings', found);

        expect(files).toEqual({ 'main.ts': 'the entry' });
    });

    it('says which file could not be fetched rather than opening a reading with a hole in it', async () => {
        const { fetched } = buildNetwork(listingOf('main.ts', 'helpers.ts'), { 'main.ts': 'the entry' });
        const service = new ReadingImportService({ fetch: fetched });
        const found = await service.look('gh/someone/readings');

        await expect(service.take('gh/someone/readings', found)).rejects.toThrow(/helpers\.ts could not be fetched/);
    });
});
