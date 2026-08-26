/**
 * Channel the archive announces a write on.
 *
 * The payload is the contract that grew, never the rows: a notification is
 * capped at eight kilobytes, and a reader that fetches from its own cursor
 * cannot be made wrong by one that was dropped.
 */
export const RECORDING_CHANNEL = 'fathom_recorded';
