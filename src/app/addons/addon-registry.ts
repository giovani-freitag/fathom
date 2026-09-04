import type { Indicator, Registered } from '../../shared/core/draw-plan.ts';

/**
 * What every addon's id begins with.
 *
 * Reserved, so a reader's script can never answer to a name the build ships
 * under however it is written.
 */
export const ADDON_ID_PREFIX = 'addon:';

/**
 * The id a reading is drawn under before it has ever been saved.
 *
 * Reserved rather than incidental: the chart has to be able to tell a preview
 * from a layer a reader chose, and only one of the two is worth remembering.
 */
export const UNSAVED_ADDON_ID = `${ADDON_ID_PREFIX}draft`;

const REGISTERED = new Map<string, Indicator>();

/**
 * Puts a reading a reader wrote where the chart can find it.
 *
 * @param name - What the reader called it, which the id is built from.
 * @param indicator - The reading their script exported.
 * @returns The id it is stored and found under.
 */
export function registerAddon(name: string, indicator: Indicator): string {
    const id = `${ADDON_ID_PREFIX}${name}`;
    REGISTERED.set(id, indicator);
    return id;
}

/**
 * Takes a reading a reader wrote back off the chart.
 *
 * @param id - The id it was registered under.
 */
export function forgetAddon(id: string): void {
    REGISTERED.delete(id);
}

/**
 * Looks up a reading a reader wrote.
 *
 * @param id - The id a stored selection names.
 * @returns The reading, or null where nothing is registered under it.
 */
export function findAddon(id: string): Indicator | null {
    return REGISTERED.get(id) ?? null;
}

/**
 * Every reading a reader has loaded, for the palette to offer alongside ours.
 *
 * @returns The entries, in the order they were registered.
 */
export function listAddons(): readonly Registered<Indicator>[] {
    return [...REGISTERED].map(([id, layer]) => ({ id, layer }));
}

/** Whether an id names a reading a reader wrote rather than one we ship. */
export function isAddonId(id: string): boolean {
    return id.startsWith(ADDON_ID_PREFIX);
}
