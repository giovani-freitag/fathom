import { describeLoadFailure } from '../../../src/app/core/failure-copy.ts';
import { HeatmapApiError } from '../../../src/app/services/heatmap-api-service.ts';
import { describe, expect, it } from 'vitest';

describe('describeLoadFailure', () => {
    it('names the gateway when nothing answered at all', () => {
        expect(describeLoadFailure(new HeatmapApiError('Gateway unreachable', 0)))
            .toContain('did not answer');
    });

    it('separates a gateway fault from a rejected query', () => {
        const serverFault = describeLoadFailure(new HeatmapApiError('boom', 503));
        const rejected = describeLoadFailure(new HeatmapApiError('bad range', 400));

        expect(serverFault).not.toBe(rejected);
    });

    it('falls back to a general sentence for anything else', () => {
        expect(describeLoadFailure(new TypeError('undefined is not a function')))
            .toBe('Could not load the window.');
    });

    it('never leaks the underlying message', () => {
        expect(describeLoadFailure(new Error('ECONNREFUSED 127.0.0.1:8787')))
            .not.toContain('ECONNREFUSED');
    });
});
