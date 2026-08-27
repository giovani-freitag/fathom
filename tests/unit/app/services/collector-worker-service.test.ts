import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectorEvent } from '../../../../src/shared/core/collector-worker-contract.ts';
import { CollectorWorkerService } from '../../../../src/app/services/collector-worker-service.ts';
import { type FakeWorker, readLastWorker, stubWorkerConstructor } from '../../../mocks/worker.ts';

describe('CollectorWorkerService', () => {
    let service: CollectorWorkerService;
    let events: CollectorEvent[];

    beforeEach(() => {
        vi.useFakeTimers();
        stubWorkerConstructor();
        events = [];
        service = new CollectorWorkerService({ onEvent: (event) => { events.push(event); } });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('asks the collector to begin as soon as it is registered', () => {
        service.start();

        expect(readLastWorker().commands).toEqual([{ kind: 'start' }]);
    });

    it('registers one collector however many times it is started', () => {
        service.start();
        service.start();

        expect(readLastWorker().commands).toEqual([{ kind: 'start' }]);
    });

    it('passes on what the collector reports', () => {
        service.start();

        readLastWorker().say({ kind: 'state', state: 'recording' });

        expect(events).toEqual([{ kind: 'state', state: 'recording' }]);
    });

    it('asks the collector to follow one contract', () => {
        service.start();

        service.subscribe('BTCUSDT', 1_000);

        expect(readLastWorker().commands.at(-1)).toEqual({
            kind: 'subscribe', instrumentSymbol: 'BTCUSDT', afterMs: 1_000,
        });
    });

    it('says nothing to a collector that was never registered', () => {
        service.unsubscribe();

        expect(() => readLastWorker()).toThrow();
    });

    it('gives the collector time to write out what it buffered', () => {
        // Terminated the moment it is told to stop, the collector dies part-way
        // through its last write, and the archive is the only copy those frames
        // ever had.
        service.start();
        const worker: FakeWorker = readLastWorker();

        service.stop();

        expect(worker.terminate).not.toHaveBeenCalled();
    });

    it('lets the collector go once it says it has stopped', () => {
        service.start();
        const worker: FakeWorker = readLastWorker();
        service.stop();

        worker.say({ kind: 'state', state: 'stopped' });

        expect(worker.terminate).toHaveBeenCalled();
    });

    it('lets a collector that never answers go anyway', async () => {
        service.start();
        const worker: FakeWorker = readLastWorker();
        service.stop();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(worker.terminate).toHaveBeenCalled();
    });

    it('reports nothing more from a collector it let go', () => {
        service.start();
        const worker: FakeWorker = readLastWorker();
        service.stop();
        worker.say({ kind: 'state', state: 'stopped' });

        expect(worker.countListeners('message')).toBe(0);
    });

    it('stops passing on live messages once it has been stopped', () => {
        service.start();
        const worker: FakeWorker = readLastWorker();
        service.stop();
        events.length = 0;

        worker.say({ kind: 'log', level: 'info', message: 'still going' });

        expect(events).toEqual([]);
    });
});
