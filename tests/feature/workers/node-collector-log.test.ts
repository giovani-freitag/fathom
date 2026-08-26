import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { openNodeCollectorLog } from '../../../src/workers/transport/node-collector-log.ts';
import { tmpdir } from 'node:os';

interface WrittenLine {
    readonly level: string;
    readonly message: string;
    readonly time: string;
    readonly [field: string]: unknown;
}

describe('openNodeCollectorLog', () => {
    let directory = '';

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'fathom-log-'));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    async function readLines(): Promise<WrittenLine[]> {
        const [name] = await readdir(directory);
        const written = await readFile(join(directory, name!), 'utf8');
        return written.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as WrittenLine);
    }

    it('writes one JSON object per event', async () => {
        const opened = await openNodeCollectorLog({ filePath: join(directory, 'collector') });

        opened.log.info('Recording', { frameIntervalMs: 1_000 });
        await opened.close();

        expect(await readLines()).toEqual([
            expect.objectContaining({ level: 'info', message: 'Recording', frameIntervalMs: 1_000 }),
        ]);
    });

    it('names the level in words rather than in pino s numbers', async () => {
        const opened = await openNodeCollectorLog({ filePath: join(directory, 'collector') });

        opened.log.warning('Market data stream lost', { reason: 'socket closed' });
        await opened.close();

        expect((await readLines())[0]).toMatchObject({ level: 'warning', reason: 'socket closed' });
    });

    it('stamps a bound field on every line the child writes', async () => {
        const opened = await openNodeCollectorLog({ filePath: join(directory, 'collector') });
        const perContract = opened.log.child({ instrumentSymbol: 'ETHUSDT' });

        perContract.info('Order book synchronized', { restingLevels: 2_000 });
        perContract.warning('Order book desynchronized');
        await opened.close();

        const written = await readLines();
        expect(written.map((line) => line['instrumentSymbol'])).toEqual(['ETHUSDT', 'ETHUSDT']);
    });

    it('dates the file it writes, so a day can be read on its own', async () => {
        const opened = await openNodeCollectorLog({ filePath: join(directory, 'collector') });

        opened.log.info('Recording');
        await opened.close();

        const [name] = await readdir(directory);
        expect(name).toMatch(/^collector\.\d{4}-\d{2}-\d{2}\.\d+\.log$/);
    });
});
