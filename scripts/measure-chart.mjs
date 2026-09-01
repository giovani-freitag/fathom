#!/usr/bin/env node
// Drives the chart through real gestures and reports what each one costs.
//
// Everything else measures a part: a unit test measures a function, a query log
// measures the database, a profile measures one recording of one moment. What a
// reader feels is none of those — it is the whole chain, from the finger moving
// to the picture standing still again, and the only honest way to see it is to
// move the chart and watch.
//
// Three numbers matter, and they fail in different ways:
//   - the frame, which is whether the chart keeps up with the hand;
//   - the wait, which is how long the reader looks at the old picture;
//   - the bytes, which is what the wait is made of.
// A change that improves one and quietly ruins another is the usual outcome, so
// they are reported side by side and never separately.
//
// Talks to a Chrome already running with a debugging port rather than launching
// one: a chart is judged on a real GPU with a real compositor, and a headless
// browser started for the occasion answers about neither.
//
//   google-chrome --remote-debugging-port=9222
//   node --env-file-if-exists=.env scripts/measure-chart.mjs
//
//   --url      where the gateway is        (default http://127.0.0.1:8787)
//   --port     the debugging port          (default 9222)
//   --repeat   passes per scenario         (default 3)
//   --json     print the readings as JSON, for a run kept to compare against

import { WebSocket } from 'ws';

const options = readOptions(process.argv.slice(2));

/**
 * Reads the flags a run was given.
 *
 * @param argv - Everything after the script name.
 * @returns The settings, with defaults filled in.
 */
function readOptions(argv) {
    const read = (name, fallback) => {
        const at = argv.indexOf(`--${name}`);
        return at < 0 || at + 1 >= argv.length ? fallback : argv[at + 1];
    };
    return {
        url: read('url', `http://127.0.0.1:${process.env.GATEWAY_PORT ?? '8787'}`),
        port: Number(read('port', '9222')),
        repeat: Number(read('repeat', '3')),
        asJson: argv.includes('--json'),
    };
}

/**
 * One page, spoken to over the debugging protocol.
 *
 * Thin on purpose: the whole conversation is `Runtime.evaluate`, because the
 * measuring is done by the page itself. Nothing the protocol reports about
 * timing survives being read from outside the frame it belongs to.
 */
class DebuggedPage {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        socket.on('message', (raw) => {
            const message = JSON.parse(String(raw));
            const settle = this.pending.get(message.id);
            if (settle === undefined) {
                return;
            }
            this.pending.delete(message.id);
            settle(message);
        });
    }

    /**
     * Sends one protocol command.
     *
     * @param method - The command name.
     * @param params - Its arguments.
     * @returns Whatever it answered.
     */
    send(method, params = {}) {
        const id = this.nextId;
        this.nextId += 1;
        return new Promise((resolve, reject) => {
            this.pending.set(id, (message) => {
                if (message.error) {
                    reject(new Error(`${method}: ${message.error.message}`));
                    return;
                }
                resolve(message.result);
            });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    /**
     * Runs a function inside the page and waits for what it returns.
     *
     * @param body - The source of a function taking no arguments.
     * @returns Its resolved value.
     */
    async call(body) {
        const result = await this.send('Runtime.evaluate', {
            expression: `(${body})()`,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description
                ?? result.exceptionDetails.text);
        }
        return result.result.value;
    }
}

/**
 * Opens a tab on the chart, reusing one that is already there.
 *
 * @returns The page, ready to be spoken to.
 */
async function openChart() {
    const tabs = await (await fetch(`http://127.0.0.1:${String(options.port)}/json/list`)).json();
    const wanted = tabs.find((tab) => tab.type === 'page' && tab.url.startsWith(options.url));
    const tab = wanted ?? await (await fetch(
        `http://127.0.0.1:${String(options.port)}/json/new?${encodeURIComponent(options.url)}`,
        { method: 'PUT' },
    )).json();

    const socket = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    const page = new DebuggedPage(socket);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    // Always from a fresh page. Anything left behind by a previous run — a
    // probe of its own asking for frames — makes the chart look busy for ever
    // and every reading after it a measurement of the last one.
    await page.send('Page.navigate', { url: options.url });
    await new Promise((resolve) => { setTimeout(resolve, 1_500); });
    return page;
}

/**
 * What the page needs before it can be measured, installed once per pass.
 *
 * Kept as source text handed to the page rather than imported, because it has
 * to run inside the frame being watched: a timer read from outside it measures
 * the protocol round trip as much as the chart.
 */
const HARNESS = `() => {
    // Anything begun later than this after a gesture ended is the chart reading
    // ahead of the reader, not the reader waiting.
    const AHEAD_OF_THE_READER_MS = 400;

    const surface = document.querySelector('canvas');
    if (surface === null) { return false; }

    // A gesture arrives as a captured pointer. Synthetic events cannot be
    // captured, and the chart drops the whole drag when the capture throws, so
    // capture is made a no-op for the length of a run.
    const element = Element.prototype;
    element.setPointerCapture = function () {};
    element.hasPointerCapture = function () { return true; };
    element.releasePointerCapture = function () {};

    const held = { frames: [], longTasks: [], reads: [], gestureEndedAt: Infinity };
    window.__fathomProbe = held;

    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) { held.longTasks.push(entry.duration); }
    }).observe({ entryTypes: ['longtask'] });

    // What the chart is still waiting for, so a gesture that has asked for a
    // window and is waiting on it is not mistaken for one that has finished.
    // Every read, with when it began and when it ended. Whether the reader was
    // waiting for one is decided afterwards, from when the gesture ended:
    // counting a read the chart started by itself once the gesture was over
    // measures the chart being helpful and calls it slow.
    const request = window.fetch.bind(window);
    window.fetch = async (...args) => {
        if (!String(args[0]?.url ?? args[0]).includes('/api/')) {
            return request(...args);
        }
        const read = { startedAt: performance.now(), endedAt: Infinity };
        held.reads.push(read);
        try {
            return await request(...args);
        } finally {
            read.endedAt = performance.now();
        }
    };

    /** The reads the reader was waiting on, which is not the ones read ahead. */
    held.awaited = () => held.reads.filter(
        (read) => read.startedAt < held.gestureEndedAt + AHEAD_OF_THE_READER_MS,
    );

    // Every frame the CHART asks for, with what it spent inside it.
    //
    // Timed rather than counted. An idle chart still repaints about once a
    // second for the clock on the live candle, so counting frames says a chart
    // is busy when it is doing nothing; what separates work from the clock is
    // that the clock costs a millisecond and building a picture costs tens.
    const askForFrame = window.requestAnimationFrame.bind(window);
    let previous = 0;
    window.requestAnimationFrame = (callback) => askForFrame((at) => {
        const startedAt = performance.now();
        if (previous > 0 && startedAt - previous < 100) {
            held.frames.push(startedAt - previous);
        }
        previous = startedAt;
        callback(at);
        held.lastFrame = { at: startedAt, jsMs: performance.now() - startedAt };
        held.work.push(held.lastFrame);
    });
    held.work = [];
    return true;
}`;


/**
 * The gestures a reader makes, as the page performs them on itself.
 *
 * Each returns once the chart has stopped asking for frames, which is the
 * moment the picture it was building is finished — not the moment the data
 * arrived, and not the moment the gesture ended.
 */
const SCENARIOS = {
    // Short enough to stay inside the window already loaded, which is what the
    // overscan is for: this is the cost of redrawing alone.
    'nudge back': 'async (page) => page.drag(0.2)',
    // Past it, so the whole chain runs: ask, wait, decode, fold, paint.
    'pan back': 'async (page) => page.drag(0.9)',
    // The reader walking back through the day, which is where a chart that
    // refetches the whole window on every step is felt.
    'walk back': 'async (page) => { for (let step = 0; step < 4; step += 1) { await page.drag(0.9); } }',
    'pan forward': 'async (page) => page.drag(-0.9)',
    'zoom out': 'async (page) => page.wheel(120, 10)',
    'zoom in': 'async (page) => page.wheel(-120, 10)',
    'price pan': 'async (page) => page.dragAxis(-260)',
    'price zoom': 'async (page) => page.wheelAxis(-120, 8)',
    // Going somewhere and coming back, which is the gesture a chart is used
    // with more than any other and the one nothing used to be kept for.
    'there and back': 'async (page) => { for (let s = 0; s < 3; s += 1) { await page.drag(0.9); } for (let s = 0; s < 3; s += 1) { await page.drag(-0.9); } }',
    // Across and up at once: two stretches come into view, not one.
    'diagonal': 'async (page) => page.dragBoth(0.9, -320)',
};

/**
 * The gesture driver, installed alongside the harness.
 */
const DRIVER = `() => {
    const surface = document.querySelector('canvas');
    const bounds = () => surface.getBoundingClientRect();
    const fire = (type, clientX, clientY) => surface.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', isPrimary: true,
        clientX, clientY, buttons: type === 'pointerup' ? 0 : 1,
    }));
    const rest = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    // What a hand delivers: one move a frame. Slower than that and the reading
    // is of the driver's pacing rather than of the chart.
    const STEP_MS = 16;

    /**
     * Waits until nothing is on its way and no frame is still doing real work.
     *
     * Real work is measured, not counted: an idle chart repaints for its clock
     * about once a second, and a frame that costs a millisecond is that clock.
     */
    const settle = async (quietMs, capMs) => {
        const startedAt = performance.now();
        for (;;) {
            await rest(30);
            const held = window.__fathomProbe;
            const working = held.work.filter((one) => one.jsMs > 4);
            const lastWorkAt = working.length === 0 ? 0 : working[working.length - 1].at;
            const awaited = held.awaited();
            const lastReadAt = awaited.reduce((at, read) => Math.max(at, read.endedAt), 0);
            const isQuiet = awaited.every((read) => read.endedAt < Infinity)
                && performance.now() - Math.max(lastWorkAt, lastReadAt) > quietMs;
            if (isQuiet || performance.now() - startedAt > capMs) { return; }
        }
    };

    window.__fathomDriver = {
        settle,
        /**
         * Puts the chart back where every pass starts from.
         *
         * Without it each pass begins wherever the last one left off, so the
         * readings are of different windows over different stretches of the
         * archive and comparing them says nothing.
         */
        async reset() {
            const back = [...document.querySelectorAll('button')].find((one) => /back to live/i
                .test(one.getAttribute('aria-label') ?? one.getAttribute('description') ?? ''));
            back?.click();
            await rest(200);
            const range = [...document.querySelectorAll('[role=radio], button')]
                .find((one) => one.textContent.trim() === '4h');
            range?.click();
            await settle(400, 8_000);
            await rest(400);
        },
        /**
         * Drags across the plot, as a share of its width.
         *
         * Positive walks back through history: the content follows the hand, so
         * a hand moving right pulls older instants into view.
         */
        async drag(share) {
            const box = bounds();
            const y = box.top + box.height * 0.35;
            const travel = box.width * share;
            const from = box.left + box.width * (share > 0 ? 0.05 : 0.95);
            const steps = 30;
            fire('pointerdown', from, y);
            for (let step = 1; step <= steps; step += 1) {
                fire('pointermove', from + travel * (step / steps), y);
                await rest(STEP_MS);
            }
            fire('pointerup', from + travel, y);
        },
        /** Drags across and up at once, so time and price both move. */
        async dragBoth(share, travelY) {
            const box = bounds();
            const fromX = box.left + box.width * 0.05;
            const fromY = box.top + box.height * 0.6;
            const travelX = box.width * share;
            const steps = 30;
            fire('pointerdown', fromX, fromY);
            for (let step = 1; step <= steps; step += 1) {
                fire('pointermove', fromX + travelX * (step / steps), fromY + travelY * (step / steps));
                await rest(STEP_MS);
            }
            fire('pointerup', fromX + travelX, fromY + travelY);
        },
        /** Drags over the price axis, which stretches the band rather than the span. */
        async dragAxis(travelY) {
            const box = bounds();
            const x = box.right - 40;
            const from = box.top + box.height * 0.5;
            const steps = 24;
            fire('pointerdown', x, from);
            for (let step = 1; step <= steps; step += 1) {
                fire('pointermove', x, from + travelY * (step / steps));
                await rest(STEP_MS);
            }
            fire('pointerup', x, from + travelY);
        },
        async wheel(deltaY, notches) {
            const box = bounds();
            await this.turn(deltaY, notches, box.left + box.width * 0.5, box.top + box.height * 0.4);
        },
        async wheelAxis(deltaY, notches) {
            const box = bounds();
            await this.turn(deltaY, notches, box.right - 40, box.top + box.height * 0.5);
        },
        async turn(deltaY, notches, x, y) {
            for (let notch = 0; notch < notches; notch += 1) {
                surface.dispatchEvent(new WheelEvent('wheel', {
                    bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, deltaMode: 0,
                }));
                await rest(STEP_MS);
            }
        },
    };
    return true;
}`;

/**
 * Runs one gesture and reports what it cost.
 *
 * @param page - The chart being measured.
 * @param body - The gesture, as source.
 * @returns One reading.
 */
async function measure(page, body) {
    return page.call(`async () => {
        const held = window.__fathomProbe;
        const driver = window.__fathomDriver;
        await driver.reset();

        held.frames.length = 0;
        held.longTasks.length = 0;
        held.work.length = 0;
        held.reads.length = 0;
        held.gestureEndedAt = Infinity;
        const before = performance.getEntriesByType('resource').length;
        const startedAt = performance.now();

        await (${body})(driver);
        const gestureEndedAt = performance.now();
        held.gestureEndedAt = gestureEndedAt;
        await driver.settle(300, 12_000);
        // The quiet the settle waited out is not part of the wait a reader felt,
        // and a gesture the chart kept up with has no wait at all.
        const settledAt = Math.max(gestureEndedAt, performance.now() - 300);

        const loads = performance.getEntriesByType('resource').slice(before)
            .filter((one) => one.name.includes('/api/heatmap'));
        const awaitedLoads = loads.filter(
            (one) => one.startTime < gestureEndedAt + 400,
        );
        const frames = [...held.frames].sort((left, right) => left - right);
        const at = (share) => Math.round(frames[Math.floor(frames.length * share)] ?? 0);
        const afterGesture = held.work.filter((one) => one.at >= gestureEndedAt);
        return {
            settleMs: Math.round(settledAt - gestureEndedAt),
            frameP50: at(0.5),
            frameP95: at(0.95),
            frameWorst: Math.round(frames.at(-1) ?? 0),
            janks: frames.filter((one) => one > 50).length,
            jsMs: Math.round(afterGesture.reduce((sum, one) => sum + one.jsMs, 0)),
            worstJsMs: Math.round(Math.max(0, ...afterGesture.map((one) => one.jsMs))),
            loads: awaitedLoads.length,
            ahead: loads.length - awaitedLoads.length,
            kb: Math.round(awaitedLoads.reduce((sum, one) => sum + one.transferSize, 0) / 1024),
            serverMs: Math.round(awaitedLoads.reduce((sum, one) => sum + one.duration, 0)),
        };
    }`);
}

/** The middle reading of a set, which is the one a repeat is for. */
function median(readings, field) {
    const sorted = readings.map((one) => one[field]).sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const page = await openChart();
await page.call(`async () => {
    // Long enough for the first window to land, so the first gesture is not
    // measuring the page opening.
    await new Promise((resolve) => { setTimeout(resolve, 3_000); });
    return true;
}`);
if (await page.call(HARNESS) !== true) {
    console.error('No chart on that page. Is the gateway serving it?');
    process.exit(1);
}
await page.call(DRIVER);

const readings = {};
for (const [name, body] of Object.entries(SCENARIOS)) {
    readings[name] = [];
    for (let pass = 0; pass < options.repeat; pass += 1) {
        readings[name].push(await measure(page, body));
    }
}

if (options.asJson) {
    console.log(JSON.stringify(readings, null, 2));
} else {
    const columns = [
        ['settle ms', 'settleMs'], ['js ms', 'jsMs'], ['worst js', 'worstJsMs'],
        ['frame p50', 'frameP50'], ['frame p95', 'frameP95'], ['janks', 'janks'],
        ['loads', 'loads'], ['ahead', 'ahead'], ['KB', 'kb'], ['server ms', 'serverMs'],
    ];
    console.log('gesture'.padEnd(12) + columns.map(([label]) => label.padStart(11)).join(''));
    for (const [name, passes] of Object.entries(readings)) {
        console.log(name.padEnd(12)
            + columns.map(([, field]) => String(median(passes, field)).padStart(11)).join(''));
    }
}
process.exit(0);
