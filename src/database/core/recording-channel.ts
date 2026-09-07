import { type ContractIdentity, FIRST_VENUE } from '../../shared/core/recording-control.ts';

/**
 * Channel the archive announces a write on.
 *
 * The payload is the contract that grew, never the rows: a notification is
 * capped at eight kilobytes, and a reader that fetches from its own cursor
 * cannot be made wrong by one that was dropped.
 */
export const RECORDING_CHANNEL = 'fathom_recorded';

/**
 * The contract a notification names, whichever way the sender spelled it.
 *
 * A collector built before the recording was keyed by venue announces the
 * symbol alone, and the two processes are replaced one at a time — so for the
 * minutes between, a payload with no venue in it means the venue everything was
 * recorded under. Read the other way round it would be a symbol nobody is
 * following, and every reader would fall back to its own interval.
 *
 * @param payload - What arrived on the channel.
 * @returns The venue and symbol it names.
 */
export function readAnnouncedContract(payload: string): ContractIdentity {
    const divide = payload.indexOf('/');
    return divide < 0
        ? { venue: FIRST_VENUE, instrumentSymbol: payload }
        : { venue: payload.slice(0, divide), instrumentSymbol: payload.slice(divide + 1) };
}
