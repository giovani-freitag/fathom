import { type Static, Type } from '@sinclair/typebox';
import { DEFAULT_FRAMES_PER_WINDOW, MAXIMUM_FRAMES_PER_WINDOW } from '../../../shared/core/api-contract.ts';

/** Query shared by every history route: an instrument and a half-open time range. */
export const WindowFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    fromMs: Type.Integer({ minimum: 0 }),
    toMs: Type.Integer({ minimum: 0 }),
    maxColumns: Type.Integer({
        minimum: 1,
        maximum: MAXIMUM_FRAMES_PER_WINDOW,
        default: DEFAULT_FRAMES_PER_WINDOW,
    }),
});

export type WindowFilters = Static<typeof WindowFiltersSchema>;

export const ErrorResponseSchema = Type.Object({
    error: Type.String(),
    message: Type.String(),
});
