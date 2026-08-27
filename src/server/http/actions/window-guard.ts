import type { FastifyReply } from 'fastify';
import { QUERY_LIMITS } from '../../core/gateway-configuration.ts';

interface Window {
    readonly fromMs: number;
    readonly toMs: number;
}

/**
 * Refuses a window the archive should not be asked for.
 *
 * Written once and applied to every windowed route, because it was written on
 * one of them: the same mistake used to earn a refusal from the depth window and
 * an empty answer from the bars, which leaves a caller unable to tell a question
 * asked wrong from a stretch nothing was recorded in.
 *
 * @param window - The range the caller asked for.
 * @param reply - The reply to refuse on.
 * @returns The refusal to return, or null when the window is answerable.
 */
export function refuseUnansweredWindow(window: Window, reply: FastifyReply): FastifyReply | null {
    if (window.toMs <= window.fromMs) {
        return reply.code(400).send({
            error: 'InvalidRange',
            message: 'toMs must be greater than fromMs',
        });
    }
    if (window.toMs - window.fromMs > QUERY_LIMITS.maximumRangeMs) {
        return reply.code(400).send({
            error: 'RangeTooWide',
            message: `Range must not exceed ${QUERY_LIMITS.maximumRangeMs}ms`,
        });
    }
    return null;
}
