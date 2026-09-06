/**
 * The size jsdom reports for anything a component measures.
 *
 * jsdom implements no layout, so an element that lays itself out by its own
 * width would stay at zero and take whichever shape zero happens to select.
 * A test says how much room the thing under test has, the way it already says
 * how wide the window is.
 */
export const observedSize = { width: 1_000, height: 600 };
