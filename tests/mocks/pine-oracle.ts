/**
 * The reference formulas, transcribed from their published definitions.
 *
 * Deliberately kept clear of this project's own types and helpers. It is an
 * oracle, and an oracle that shares code with what it checks agrees with it for
 * the wrong reason.
 */
type Series = readonly number[];
const sma = (v: Series, n: number, i: number): number => { let t = 0; for (let k = i - n + 1; k <= i; k++) t += v[k]!; return t / n; };

function rma(values: Series, n: number): number[] {
    const out: number[] = new Array<number>(values.length).fill(NaN);
    out[n - 1] = sma(values, n, n - 1);
    for (let i = n; i < values.length; i++) out[i] = (out[i - 1]! * (n - 1) + values[i]!) / n;
    return out;
}
function ema(values: Series, n: number): number[] {
    const out: number[] = new Array<number>(values.length).fill(NaN);
    const a = 2 / (n + 1);
    out[n - 1] = sma(values, n, n - 1);
    for (let i = n; i < values.length; i++) out[i] = a * values[i]! + (1 - a) * out[i - 1]!;
    return out;
}
function rsi(close: Series, n: number): number[] {
    const up: number[] = [0];
    const down: number[] = [0];
    for (let i = 1; i < close.length; i++) {
        const ch = close[i]! - close[i - 1]!;
        up.push(Math.max(ch, 0)); down.push(Math.max(-ch, 0));
    }
    // Pine applies rma over the change series, which begins at bar 1.
    const u = rma(up.slice(1), n);
    const d = rma(down.slice(1), n);
    const out: number[] = new Array<number>(close.length).fill(NaN);
    for (let i = 0; i < u.length; i++) {
        if (Number.isNaN(u[i]!)) continue;
        // A stretch with neither a rise nor a fall has no ratio to take, and it
        // is not maximum strength: it is the middle. The published branch reads
        // "no losses means a hundred", which is only true where something rose.
        if (u[i] === 0 && d[i] === 0) {
            out[i + 1] = 50;
            continue;
        }
        out[i + 1] = d[i] === 0 ? 100 : u[i] === 0 ? 0 : 100 - 100 / (1 + u[i]! / d[i]!);
    }
    return out;
}
function stdevPop(v: Series, n: number, i: number): number {
    const m = sma(v, n, i);
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += (v[k]! - m) ** 2;
    return Math.sqrt(s / n);
}
function atr(high: Series, low: Series, close: Series, n: number): number[] {
    const tr: number[] = [high[0]! - low[0]!];
    for (let i = 1; i < close.length; i++) {
        tr.push(Math.max(high[i]! - low[i]!, Math.abs(high[i]! - close[i - 1]!), Math.abs(low[i]! - close[i - 1]!)));
    }
    return rma(tr, n);
}
export { sma, rma, ema, rsi, stdevPop, atr };

/** ta.dev — the mean absolute deviation, which is not the standard one. */
function dev(v: Series, n: number, i: number): number {
    const m = sma(v, n, i);
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += Math.abs(v[k]! - m);
    return s / n;
}
function cci(src: Series, n: number): number[] {
    const out: number[] = new Array<number>(src.length).fill(NaN);
    for (let i = n - 1; i < src.length; i++) {
        const d = dev(src, n, i);
        out[i] = d === 0 ? 0 : (src[i]! - sma(src, n, i)) / (0.015 * d);
    }
    return out;
}

/**
 * ta.mfi — note that a bar whose source did not change counts on neither side.
 *
 * Pine writes the two sums as `change <= 0 ? 0 : src` and `change >= 0 ? 0 : src`,
 * so an unchanged bar is excluded twice rather than sorted into the falls.
 */
function mfi(src: Series, volume: Series, n: number): number[] {
    const out: number[] = new Array<number>(src.length).fill(NaN);
    for (let i = n; i < src.length; i++) {
        let upper = 0;
        let lower = 0;
        for (let k = i - n + 1; k <= i; k++) {
            const ch = src[k]! - src[k - 1]!;
            upper += volume[k]! * (ch <= 0 ? 0 : src[k]!);
            lower += volume[k]! * (ch >= 0 ? 0 : src[k]!);
        }
        out[i] = lower === 0 ? 100 : 100 - 100 / (1 + upper / lower);
    }
    return out;
}

/** ta.dmi — the two directional lines and the strength between them. */
function dmi(high: Series, low: Series, close: Series, n: number): { plus: number[]; minus: number[]; adx: number[] } {
    const plusDM: number[] = [0];
    const minusDM: number[] = [0];
    for (let i = 1; i < close.length; i++) {
        const up = high[i]! - high[i - 1]!;
        const down = low[i - 1]! - low[i]!;
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
    }
    const trur = atr(high, low, close, n);
    const rp = rma(plusDM, n);
    const rm = rma(minusDM, n);
    const plus: number[] = new Array<number>(close.length).fill(NaN);
    const minus: number[] = new Array<number>(close.length).fill(NaN);
    const dx: number[] = [];
    for (let i = 0; i < close.length; i++) {
        if (Number.isNaN(trur[i]!) || Number.isNaN(rp[i]!)) continue;
        plus[i] = 100 * rp[i]! / trur[i]!;
        minus[i] = 100 * rm[i]! / trur[i]!;
        const sum = plus[i]! + minus[i]!;
        dx.push(100 * Math.abs(plus[i]! - minus[i]!) / (sum === 0 ? 1 : sum));
    }
    const firstReal = plus.findIndex((v) => !Number.isNaN(v));
    const smoothed = rma(dx, n);
    const adx: number[] = new Array<number>(close.length).fill(NaN);
    for (let k = 0; k < smoothed.length; k++) if (!Number.isNaN(smoothed[k]!)) adx[firstReal + k] = smoothed[k]!;
    return { plus, minus, adx };
}

/** ta.supertrend — the band the stop is on, and which side that is. */
function supertrend(high: Series, low: Series, close: Series, factor: number, n: number): number[] {
    const a = atr(high, low, close, n);
    const out: number[] = new Array<number>(close.length).fill(NaN);
    let upper = NaN;
    let lower = NaN;
    let previous = NaN;
    for (let i = 0; i < close.length; i++) {
        if (Number.isNaN(a[i]!)) continue;
        const src = (high[i]! + low[i]!) / 2;
        let u = src + factor * a[i]!;
        let l = src - factor * a[i]!;
        const pl = Number.isNaN(lower) ? 0 : lower;
        const pu = Number.isNaN(upper) ? 0 : upper;
        l = l > pl || close[i - 1]! < pl ? l : pl;
        u = u < pu || close[i - 1]! > pu ? u : pu;
        let direction: number;
        if (Number.isNaN(a[i - 1]!)) direction = 1;
        else if (previous === pu) direction = close[i]! > u ? -1 : 1;
        else direction = close[i]! < l ? 1 : -1;
        out[i] = direction === -1 ? l : u;
        previous = out[i]!;
        upper = u;
        lower = l;
    }
    return out;
}

/** ta.sar — Wilder's stop, transcribed from Pine's own listing of it. */
function sar(high: Series, low: Series, close: Series, start: number, inc: number, max: number): number[] {
    const out: number[] = new Array<number>(close.length).fill(NaN);
    let result = 0;
    let maxMin = 0;
    let acceleration = 0;
    let isBelow = false;
    for (let i = 1; i < close.length; i++) {
        let isFirstTrendBar = false;
        if (i === 1) {
            isBelow = close[1]! > close[0]!;
            maxMin = isBelow ? high[1]! : low[1]!;
            result = isBelow ? low[0]! : high[0]!;
            isFirstTrendBar = true;
            acceleration = start;
        }
        result = result + acceleration * (maxMin - result);
        if (isBelow && result > low[i]!) {
            isFirstTrendBar = true; isBelow = false;
            result = Math.max(high[i]!, maxMin); maxMin = low[i]!; acceleration = start;
        } else if (!isBelow && result < high[i]!) {
            isFirstTrendBar = true; isBelow = true;
            result = Math.min(low[i]!, maxMin); maxMin = high[i]!; acceleration = start;
        }
        if (!isFirstTrendBar) {
            if (isBelow && high[i]! > maxMin) { maxMin = high[i]!; acceleration = Math.min(acceleration + inc, max); }
            if (!isBelow && low[i]! < maxMin) { maxMin = low[i]!; acceleration = Math.min(acceleration + inc, max); }
        }
        if (isBelow) {
            result = Math.min(result, low[i - 1]!);
            if (i > 1) result = Math.min(result, low[i - 2]!);
        } else {
            result = Math.max(result, high[i - 1]!);
            if (i > 1) result = Math.max(result, high[i - 2]!);
        }
        out[i] = result;
    }
    return out;
}

export { cci, dmi, mfi, sar, supertrend };

