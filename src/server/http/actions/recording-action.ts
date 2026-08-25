import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RecordingControlService } from '../../../database/services/recording-control-service.ts';
import type { Static } from '@sinclair/typebox';
import type { BudgetUpdateSchema, InstrumentUpdateSchema } from '../schemas/recording-schema.ts';

export interface RecordingHandlerConfig {
    readonly control: RecordingControlService;
}

type InstrumentUpdate = Static<typeof InstrumentUpdateSchema>;
type BudgetUpdate = Static<typeof BudgetUpdateSchema>;

/**
 * Builds the handler that reports what is being recorded and what it costs.
 *
 * @param config - The control service backing the reading.
 * @returns A handler returning every contract and the disk budget.
 */
export function createRecordingHandler(config: RecordingHandlerConfig) {
    return async function recordingHandler(
        _request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        return reply.send(await readState(config.control));
    };
}

/**
 * Builds the handler that turns a contract's recording on or off.
 *
 * The supervisor reconciles on its own schedule, so this only records the
 * decision — the change takes effect within one reconcile interval rather than
 * synchronously, and saying so is better than pretending otherwise.
 *
 * @param config - The control service backing the change.
 * @returns A handler applying the change and returning the new state.
 */
export function createInstrumentUpdateHandler(config: RecordingHandlerConfig) {
    return async function instrumentUpdateHandler(
        request: FastifyRequest<{ Body: InstrumentUpdate }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        await config.control.upsertInstrument(request.body);
        return reply.send(await readState(config.control));
    };
}

/**
 * Builds the handler that changes how much disk the recording may take.
 *
 * @param config - The control service backing the change.
 * @returns A handler applying the change and returning the new state.
 */
export function createBudgetUpdateHandler(config: RecordingHandlerConfig) {
    return async function budgetUpdateHandler(
        request: FastifyRequest<{ Body: BudgetUpdate }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        await config.control.setBudget(request.body.maximumBytes);
        return reply.send(await readState(config.control));
    };
}

async function readState(control: RecordingControlService) {
    const [instruments, budget] = await Promise.all([
        control.listInstruments(),
        control.readBudget(),
    ]);
    return { instruments, ...budget };
}
