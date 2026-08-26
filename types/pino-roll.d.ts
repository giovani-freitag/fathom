/**
 * Hand-written because the package ships no types of its own.
 *
 * Only the options this project passes and has verified are declared. The
 * package documents an `extension` option that its version 4 ignores, so it is
 * deliberately absent: an ambient declaration that repeats a README nobody
 * checked would promise a behaviour the library does not have.
 */
declare module 'pino-roll' {
    interface PinoRollOptions {
        /** Path the dated suffix and roll counter are appended to. */
        readonly file: string;
        /** How often a new file is started. */
        readonly frequency?: 'daily' | 'hourly' | number;
        /** How the date is rendered into the name, in `date-fns` tokens. */
        readonly dateFormat?: string;
        /** Size at which a file rolls early, such as `64m`. */
        readonly size?: string;
        /** How many files to keep besides the active one. */
        readonly limit?: { readonly count?: number; readonly removeOtherLogFiles?: boolean };
        /** Whether to create the directory when it is missing. */
        readonly mkdir?: boolean;
    }

    export default function build(options: PinoRollOptions): Promise<NodeJS.WritableStream>;
}
