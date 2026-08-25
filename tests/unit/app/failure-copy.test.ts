import { HeatmapApiError } from '../../../src/app/services/heatmap-api-service.ts';
import { resolveFailureKey } from '../../../src/app/core/failure-copy.ts';
import { describe, expect, it } from 'vitest';

describe('resolveFailureKey', () => {
    it('names the gateway when nothing answered at all', () => {
        expect(resolveFailureKey(new HeatmapApiError('Gateway unreachable', 0)))
            .toBe('failure.silent');
    });

    it('separates a gateway fault from a rejected query', () => {
        const serverFault = resolveFailureKey(new HeatmapApiError('boom', 503));
        const rejected = resolveFailureKey(new HeatmapApiError('bad range', 400));

        expect(serverFault).not.toBe(rejected);
    });

    it('falls back to a general phrase for anything else', () => {
        expect(resolveFailureKey(new TypeError('undefined is not a function')))
            .toBe('failure.generic');
    });
});
