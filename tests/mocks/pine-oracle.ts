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
