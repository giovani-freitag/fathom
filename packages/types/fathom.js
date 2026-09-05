let spoken = "en";
/**
* One phrase in the language the page is being read in.
*
* @param words - The phrase, in every language its author wrote it in.
* @returns The reader's language where the author supplied it, English otherwise.
*/
function inWords(words) {
	return words[spoken] ?? words.en;
}
//#endregion
//#region src/shared/core/draw-plan.ts
/** Every tone a plan may name. */
const PLOT_TONES = [
	"bid",
	"ask",
	"amber",
	"phosphor",
	"violet",
	"cyan",
	"ink",
	"muted"
];
/** What a reading with no sessions declared is handed under any name. */
const NO_SESSIONS = {
	hasAny: false,
	perBar: [],
	turnsOver: /* @__PURE__ */ new Uint8Array(0),
	closed: [],
	indexPerBar: /* @__PURE__ */ new Int32Array(0)
};
/**
* A declared session, by name.
*
* @param input - What the reading was handed.
* @param name - The key the session was declared under.
* @returns The sessions, held back to what each drawn bar could know.
* @throws Error when nothing was declared under that name, which is louder
*     than the flat line an empty one would draw.
*/
function readSessions(input, name) {
	const found = input.sessions[name];
	if (found === void 0) {
		const declared = Object.keys(input.sessions);
		const names = declared.length === 0 ? "(none)" : declared.join(", ");
		throw new Error(`No session was declared under '${name}'. Declared: ${names}.`);
	}
	return found;
}
/**
* Limits a plan is held to, whoever produced it.
*
* An over-budget plan is rejected whole rather than truncated: half a series is
* a different claim than the one the author made.
*
* The series cap was four while every reading here was a line, a pair of them,
* or a line with a band. A set of levels is neither: a pivot set is seven lines
* that only mean anything together, and drawing three of them is not a smaller
* version of the reading. Eight is that set with room to spare, and still few
* enough that the legend stays a legend.
*/
const PLOT_BUDGET = {
	maximumSeriesCount: 8,
	maximumVerticesPerSeries: 8192
};
/**
* Whether a plan is within what the host will draw.
*
* @param plan - The draft to check.
* @returns True when every series fits the budget and every reference resolves.
*/
function isPlanWithinBudget(plan) {
	if (plan.series.length > PLOT_BUDGET.maximumSeriesCount) return false;
	return plan.series.every((series) => series.atMs.length === series.value.length && series.atMs.length <= PLOT_BUDGET.maximumVerticesPerSeries) && (plan.bands ?? []).every((band) => band.upperSeriesIndex < plan.series.length && band.lowerSeriesIndex < plan.series.length);
}
/**
* Reads a figure, falling back to what the indicator declared.
*
* Clamped rather than trusted: a setting outlives the control that produced it,
* so a figure no current control could produce still has to arrive safely.
*
* @param settings - Values the reader chose.
* @param parameter - The knob being read.
* @returns The value, clamped to the declared range and rounded when integral.
*/
function readSetting(settings, parameter) {
	const chosen = settings[parameter.name];
	const wanted = typeof chosen === "number" ? chosen : parameter.defaultValue;
	const clamped = Math.min(parameter.maximum, Math.max(parameter.minimum, wanted));
	return parameter.kind === "integer" ? Math.round(clamped) : clamped;
}
/**
* Reads a switch, falling back to what the indicator declared.
*
* @param settings - Values the reader chose.
* @param parameter - The knob being read.
* @returns Whether it is on.
*/
function readToggle(settings, parameter) {
	const chosen = settings[parameter.name];
	return typeof chosen === "boolean" ? chosen : parameter.defaultValue;
}
/**
* Reads a choice, falling back to what the indicator declared.
*
* @param settings - Values the reader chose.
* @param parameter - The knob being read.
* @returns One of the declared choices.
*/
function readChoice(settings, parameter) {
	const chosen = settings[parameter.name];
	return typeof chosen === "string" && parameter.choices.includes(chosen) ? chosen : parameter.defaultValue;
}
/**
* The knobs a legend shows, for a plan that did not say.
*
* Figures only: a choice is usually what a reading is rather than how it was
* tuned, and the name already says it.
*
* @param parameters - The knobs the indicator declared.
* @param settings - Values the reader chose.
* @returns The figures, in declaration order, or an empty string where none.
*/
function summariseParameters(parameters, settings) {
	const figures = [];
	for (const parameter of parameters) if (parameter.kind === "integer" || parameter.kind === "decimal") figures.push(String(readSetting(settings, parameter)));
	return figures.join(" · ");
}
//#endregion
//#region src/shared/core/price-bar.ts
/**
* Reads a bar's completeness off what built it.
*
* @param bar - The bar to classify.
* @returns Which of the three states it is in.
*/
function classifyBar(bar) {
	if (!bar.isClosed) return "forming";
	return bar.frameCount < bar.expectedFrames ? "partial" : "whole";
}
/**
* Bars are budgeted by what they scan and what they emit, never by the range asked for.
*
* A range is free to name a century; what it costs is bounded by the recording
* that actually overlaps it.
*/
const BAR_BUDGET = {
	maximumSourceFrames: 18e4,
	maximumBars: 2e3
};
//#endregion
//#region src/shared/core/series-math.ts
/**
* Splits bars into stretches that were recorded without interruption.
*
* Every indicator restarts at a boundary rather than carrying state across it.
* Smoothing over a hole invents a trend through time nobody observed, and the
* result is indistinguishable from a real one once it is a line on a screen.
*
* @param bars - The window, oldest first.
* @returns The stretches, in order.
*/
function findContinuousSegments(bars) {
	const segments = [];
	let startIndex = 0;
	for (let index = 1; index <= bars.length; index += 1) if (index === bars.length || bars[index].openedAtMs !== bars[index - 1].closedAtMs) {
		segments.push({
			startIndex,
			endIndex: index
		});
		startIndex = index;
	}
	return bars.length === 0 ? [] : segments;
}
/**
* The instant each bar is plotted at.
*
* @param bars - The window, oldest first.
* @returns Close instants, ascending.
*/
function collectInstants(bars) {
	const atMs = new Float64Array(bars.length);
	for (let index = 0; index < bars.length; index += 1) atMs[index] = bars[index].closedAtMs;
	return atMs;
}
/**
* An array of the given length with nothing said anywhere.
*
* @param length - How many vertices.
* @returns All NaN, so an untouched position breaks the line.
*/
function createBlankValues(length) {
	return new Float64Array(length).fill(NaN);
}
/**
* Wilder's smoothing step.
*
* @param previous - The running average.
* @param sample - The new observation.
* @param periodBars - The period the average is over.
* @returns The updated average.
*/
function smoothWilder(previous, sample, periodBars) {
	return previous + (sample - previous) / periodBars;
}
/**
* The exponential smoothing weight for a period.
*
* @param periodBars - Bars the average spans.
* @returns The weight given to each new sample.
*/
function resolveExponentialWeight(periodBars) {
	return 2 / (periodBars + 1);
}
/**
* Fills a stretch with an exponential average of a source series.
*
* Seeded with the simple mean of the first period rather than with the first
* value. It is what the reference implementations do, and it is why an average
* read off this chart and one read off another agree from the first bar either
* of them draws rather than only after the seed has washed out.
*
* @param fill - The source, the period, the stretch, and where to write it.
*/
function fillExponential(fill) {
	const { source, periodBars, out } = fill;
	const { startIndex, endIndex } = fill.segment;
	const firstIndex = findFirstReal(source, startIndex, endIndex);
	const seedIndex = firstIndex + periodBars - 1;
	if (firstIndex === -1 || seedIndex >= endIndex) return;
	let total = 0;
	for (let index = firstIndex; index <= seedIndex; index += 1) total += source[index];
	const weight = resolveExponentialWeight(periodBars);
	let average = total / periodBars;
	out[seedIndex] = average;
	for (let index = seedIndex + 1; index < endIndex; index += 1) {
		average += weight * (source[index] - average);
		out[index] = average;
	}
}
/**
* Fills a stretch with Wilder's smoothing of a source series.
*
* Seeded with the simple mean of the first period, which is the seed Wilder
* defined and the one the reference implementations use.
*
* @param fill - The source, the period, the stretch, and where to write it.
*/
function fillWilder(fill) {
	const { source, periodBars, out } = fill;
	const { startIndex, endIndex } = fill.segment;
	const seedIndex = startIndex + periodBars - 1;
	if (seedIndex >= endIndex) return;
	let total = 0;
	for (let index = startIndex; index <= seedIndex; index += 1) total += source[index];
	let average = total / periodBars;
	out[seedIndex] = average;
	for (let index = seedIndex + 1; index < endIndex; index += 1) {
		average = smoothWilder(average, source[index], periodBars);
		out[index] = average;
	}
}
function findFirstReal(source, startIndex, endIndex) {
	for (let index = startIndex; index < endIndex; index += 1) if (!Number.isNaN(source[index])) return index;
	return -1;
}
/**
* How far a bar travelled, counting the gap from where the last one closed.
*
* @param bar - The bar to measure.
* @param previousClose - What the bar before it closed at.
* @returns The true range, in quote currency.
*/
function resolveTrueRange(bar, previousClose) {
	return Math.max(bar.highPrice - bar.lowPrice, Math.abs(bar.highPrice - previousClose), Math.abs(bar.lowPrice - previousClose));
}
/**
* How far each bar of a stretch travelled.
*
* @param bars - The window, oldest first.
* @param segment - The unbroken stretch to measure.
* @returns One range per bar, blank outside the stretch.
*/
function collectTrueRanges(bars, segment) {
	const ranges = createBlankValues(bars.length);
	for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
		const bar = bars[index];
		ranges[index] = index === segment.startIndex ? bar.highPrice - bar.lowPrice : resolveTrueRange(bar, bars[index - 1].closePrice);
	}
	return ranges;
}
//#endregion
//#region src/shared/core/bar-source.ts
/**
* Which figure of a bar an indicator is run over.
*
* The closing price is what most readings mean by "the price", but not all of
* them: a channel drawn on the midpoint of each bar sits differently from one
* drawn on where trading happened to stop.
*/
const BAR_SOURCES = [
	"close",
	"open",
	"high",
	"low",
	"hl2",
	"hlc3",
	"ohlc4"
];
const SOURCE = {
	name: "source",
	kind: "choice",
	defaultValue: "close",
	choices: BAR_SOURCES
};
/**
* The figure a bar contributes under a chosen source.
*
* @param bar - The bar to read.
* @param source - Which figure, or which blend of them.
* @returns The value the indicator sees.
*/
function readBarSource(bar, source) {
	switch (source) {
		case "open": return bar.openPrice;
		case "high": return bar.highPrice;
		case "low": return bar.lowPrice;
		case "hl2": return (bar.highPrice + bar.lowPrice) / 2;
		case "hlc3": return (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
		case "ohlc4": return (bar.openPrice + bar.highPrice + bar.lowPrice + bar.closePrice) / 4;
		case "close": return bar.closePrice;
	}
}
/**
* The chosen source of every bar in a window.
*
* @param bars - The window, oldest first.
* @param settings - The reader's parameter values.
* @returns One figure per bar, in order.
*/
function collectSource(bars, settings) {
	const source = readChoice(settings, SOURCE);
	return Float64Array.from(bars, (bar) => readBarSource(bar, source));
}
//#endregion
//#region src/shared/core/settled-sessions.ts
/**
* The newest coarser bar that had already closed, for each bar of a window.
*
* This is the whole of what reading a coarser rung honestly amounts to. A daily
* level drawn on a minute chart is a level the day *before* agreed on, and the
* day being drawn through has not finished having its say: taking the figures
* off a bar that is still forming shows the reader, at nine in the morning,
* something that will not be true until midnight.
*
* A bar closing exactly when a drawn bar opens counts as settled. That is the
* instant it became knowable, and holding it back a bar would draw yesterday's
* level a minute into today.
*
* @param bars - The window being drawn, oldest first.
* @param higher - Bars of the coarser rung, oldest first.
* @returns One entry per drawn bar, undefined where nothing had closed yet.
*/
function holdLastClosed(bars, higher) {
	return walkSettled(bars, higher).perBar;
}
/**
* The same walk, keeping where each drawn bar landed as well as what it landed on.
*
* @param bars - The window being drawn, oldest first.
* @param higher - Bars of the coarser rung, oldest first.
* @returns What each drawn bar knew, and how far the walk got.
*/
function walkSettled(bars, higher) {
	const perBar = [];
	const indexPerBar = new Int32Array(bars.length);
	let cursor = 0;
	let settled;
	for (const [at, bar] of bars.entries()) {
		while (cursor < higher.length && higher[cursor].closedAtMs <= bar.openedAtMs) {
			settled = higher[cursor];
			cursor += 1;
		}
		perBar.push(settled);
		indexPerBar[at] = cursor - 1;
	}
	return {
		perBar,
		indexPerBar,
		reached: cursor
	};
}
//#endregion
//#region src/shared/core/venue-connector.ts
/**
* What a connector is written as.
*
* Every member is abstract, including the four that may be `null`. A base class
* that defaulted them would undo the one rule the declaration is built on: an
* author has to type `null` to say no, and typing it is the moment they read
* what the engine does instead. Here the compiler is what asks.
*
* What it does carry is the two readings every connector repeats — a figure a
* venue sent as text, and a list that has to be somewhere in the answer.
*/
var Connector = class {
	/**
	* A figure as a number, or null where it does not read as one.
	*
	* Null rather than NaN or zero: a price that reads as NaN is written as a
	* real print and no later read can tell it from one, and zero is a real
	* answer everywhere a venue publishes figures.
	*
	* @param field - Whatever arrived in that position.
	* @returns The number, or null.
	*/
	readNumber(field) {
		const value = Number(field);
		return typeof field !== "boolean" && field !== null && field !== "" && Number.isFinite(value) ? value : null;
	}
	/**
	* A list out of a venue's answer, or a refusal saying it sent none.
	*
	* @param payload - What the venue answered, already parsed from JSON.
	* @param at - The field the list is under, or absent where it is the answer.
	* @returns The entries, unread.
	* @throws Error when there is no list where the connector said there is one.
	*/
	requireList(payload, at) {
		const held = at === void 0 ? payload : payload?.[at];
		if (!Array.isArray(held)) throw new Error(`The venue answered with no list${at === void 0 ? "" : ` under “${at}”`}.`);
		return held;
	}
};
//#endregion
//#region src/shared/core/parameter-builder.ts
function buildNumeric(parameter) {
	return {
		...parameter,
		called: (label) => buildNumeric({
			...parameter,
			label
		}),
		between: (minimum, maximum) => buildNumeric({
			...parameter,
			minimum,
			maximum
		}),
		by: (step) => buildNumeric({
			...parameter,
			step
		}),
		startingAt: (defaultValue) => buildNumeric({
			...parameter,
			defaultValue
		})
	};
}
function buildChoice(parameter) {
	return {
		...parameter,
		called: (label) => buildChoice({
			...parameter,
			label
		}),
		startingAt: (defaultValue) => buildChoice({
			...parameter,
			defaultValue
		})
	};
}
function buildToggle(parameter) {
	return {
		...parameter,
		called: (label) => buildToggle({
			...parameter,
			label
		}),
		startingAt: (defaultValue) => buildToggle({
			...parameter,
			defaultValue
		})
	};
}
/**
* A whole-number knob.
*
* @param name - The key its value is stored under.
* @returns A builder that is already a usable parameter.
*/
function integerParameter(name) {
	return buildNumeric({
		name,
		kind: "integer",
		defaultValue: 1,
		minimum: 1,
		maximum: 100
	});
}
/**
* A knob that takes a fraction.
*
* @param name - The key its value is stored under.
* @returns A builder that is already a usable parameter.
*/
function decimalParameter(name) {
	return buildNumeric({
		name,
		kind: "decimal",
		defaultValue: 1,
		minimum: 0,
		maximum: 100
	});
}
/**
* A knob that takes one of a fixed set of answers.
*
* @param name - The key its value is stored under.
* @param choices - What the reader may pick, the first being the default.
* @returns A builder that is already a usable parameter.
*/
function choiceParameter(name, choices) {
	return buildChoice({
		name,
		kind: "choice",
		choices,
		defaultValue: choices[0] ?? ""
	});
}
/**
* A knob that is either on or off.
*
* @param name - The key its value is stored under.
* @returns A builder that is already a usable parameter.
*/
function toggleParameter(name) {
	return buildToggle({
		name,
		kind: "toggle",
		defaultValue: false
	});
}
//#endregion
//#region src/shared/core/plot-builder.ts
function toValues(values) {
	return values instanceof Float64Array ? values : Float64Array.from(values);
}
/**
* A plan under construction, bound to the bars its values line up with.
*
* Fluent because the raw draft has thirteen fields and an author cares about
* two; the rest are ways to be wrong quietly. Nothing here is a translation —
* every method sets a field on the object the host was always going to be
* given, so anything this does not cover is reachable by writing that object.
*/
var PlotBuilder = class {
	atMs;
	series = [];
	bands = [];
	levels = [];
	isNamingLines = false;
	ownSummary;
	ownConvergence;
	constructor(bars) {
		this.atMs = collectInstants(bars.bars);
	}
	/**
	* Adds a line.
	*
	* @param values - One per drawn bar. NaN breaks the line rather than bridging.
	* @param label - What the legend calls it.
	* @returns This builder.
	*/
	line(values, label = "") {
		return this.add("line", values, label);
	}
	/**
	* Adds a histogram.
	*
	* @param values - One per drawn bar.
	* @param label - What the legend calls it.
	* @returns This builder.
	*/
	histogram(values, label = "") {
		return this.add("histogram", values, label);
	}
	/**
	* Adds a series of marks that are not joined up.
	*
	* For a reading that flips from one side of price to the other: joining the
	* marks draws a stroke through the price at every flip that no reading took.
	*
	* @param values - One per drawn bar.
	* @param label - What the legend calls it.
	* @returns This builder.
	*/
	dots(values, label = "") {
		return this.add("dot", values, label);
	}
	/**
	* Adds one line per entry, in the order given.
	*
	* @param named - Values by the name each is drawn under.
	* @returns This builder.
	*/
	lines(named) {
		for (const [label, values] of Object.entries(named)) this.add("line", values, label);
		return this;
	}
	/**
	* Colours the series added last.
	*
	* @param tone - A token from the palette, never a CSS colour.
	* @returns This builder.
	*/
	in(tone) {
		return this.reviseLast({ tone });
	}
	/**
	* Draws the series added last as a broken line.
	*
	* @returns This builder.
	*/
	dashed() {
		return this.reviseLast({ isDashed: true });
	}
	/**
	* Sets how thick the series added last is drawn.
	*
	* @param widthPx - Stroke width.
	* @returns This builder.
	*/
	thick(widthPx) {
		return this.reviseLast({ widthPx });
	}
	/**
	* Splits the series added last by side about a baseline.
	*
	* @param baseline - Where it grows from.
	* @returns This builder.
	*/
	risingAndFalling(baseline = 0) {
		return this.reviseLast({
			tone: "bid",
			negativeTone: "ask",
			baseline
		});
	}
	/**
	* Shades the region between two series.
	*
	* @param upper - Index of the series above.
	* @param lower - Index of the series below.
	* @param tone - What to shade it in. Defaults to the upper series' tone.
	* @returns This builder.
	*/
	shading(upper, lower, tone) {
		this.bands.push({
			upperSeriesIndex: upper,
			lowerSeriesIndex: lower,
			tone: tone ?? this.series[upper]?.tone ?? "phosphor"
		});
		return this;
	}
	/**
	* Draws a horizontal line at a constant value.
	*
	* @param value - Where it sits.
	* @param tone - What to draw it in.
	* @returns This builder.
	*/
	at(value, tone = "muted") {
		this.levels.push({
			value,
			tone
		});
		return this;
	}
	/**
	* Writes each series' name at the end of its own line.
	*
	* For a plan whose series only mean anything named — a set of levels says
	* "some above and some below" unless the reader can see which is which.
	*
	* @returns This builder.
	*/
	namingEachLine() {
		this.isNamingLines = true;
		return this;
	}
	/**
	* Replaces what the legend shows for the knobs.
	*
	* @param summary - What to show instead of the figures the reader turned.
	* @returns This builder.
	*/
	summarisedAs(summary) {
		this.ownSummary = summary;
		return this;
	}
	/**
	* States whether the output can be trusted at its left edge.
	*
	* Only for a reading that converges on something other than a bar count —
	* an anchor to find, a session to see turn over.
	*
	* @param hasConverged - Whether the left edge is true.
	* @returns This builder.
	*/
	converged(hasConverged) {
		this.ownConvergence = hasConverged;
		return this;
	}
	/** Draws it over the chart, on the price's own axis. */
	overThePrice() {
		return this.finish({ kind: "price" });
	}
	/** Gives it a band of its own, scaled to what it drew. */
	inItsOwnBand() {
		return this.finish({ kind: "auto" });
	}
	/**
	* Gives it a band with fixed bounds.
	*
	* @param low - The floor of the axis.
	* @param high - The ceiling.
	* @returns The finished draft.
	*/
	between(low, high) {
		return this.finish({
			kind: "fixed",
			low,
			high
		});
	}
	/** Gives it a band centred on nought, so equal opposites read alike. */
	aboutZero() {
		return this.finish({ kind: "symmetric" });
	}
	/**
	* Puts it along the floor of the price pane, costing the price no height.
	*
	* @param heightRatio - How much of the pane's floor it takes.
	* @returns The finished draft.
	*/
	alongTheFloor(heightRatio = .2) {
		return this.finish({
			kind: "overlay",
			heightRatio
		});
	}
	add(shape, values, label) {
		if (values.length !== this.atMs.length) throw new Error(`A series needs one value per drawn bar. Got ${values.length} for ${this.atMs.length} bars.`);
		this.series.push({
			label,
			tone: "phosphor",
			shape,
			atMs: this.atMs,
			value: toValues(values)
		});
		return this;
	}
	reviseLast(fields) {
		const last = this.series.length - 1;
		if (last >= 0) this.series[last] = {
			...this.series[last],
			...fields
		};
		return this;
	}
	finish(scale) {
		return {
			series: this.series,
			scale,
			...this.bands.length > 0 ? { bands: this.bands } : {},
			...this.levels.length > 0 ? { levels: this.levels } : {},
			...this.isNamingLines ? { namesItsSeries: true } : {},
			...this.ownSummary === void 0 ? {} : { parameterSummary: this.ownSummary },
			...this.ownConvergence === void 0 ? {} : { hasConverged: this.ownConvergence }
		};
	}
};
/**
* Starts a plan over a window of bars.
*
* @param bars - The window being drawn, which every series lines up with.
* @returns A builder bound to those instants.
*/
function plotOver(bars) {
	return new PlotBuilder(bars);
}
//#endregion
//#region src/shared/core/addon-api.ts
/**
* Starts a plan, bound to the bars every series lines up with.
*
* @example
* Plot.over(input.bars).line(mean, 'Mean').in('amber').overThePrice()
*/
const Plot = { over: plotOver };
/**
* The knobs a reading offers, each already a usable parameter as it is built.
*
* @example
* Params.integer('periodBars').called('Period').between(2, 400).startingAt(20)
*/
const Params = {
	integer: integerParameter,
	decimal: decimalParameter,
	choice: choiceParameter,
	toggle: toggleParameter
};
//#endregion
export { BAR_BUDGET, BAR_SOURCES, Connector, NO_SESSIONS, PLOT_BUDGET, PLOT_TONES, Params, Plot, SOURCE, classifyBar, collectInstants, collectSource, collectTrueRanges, createBlankValues, fillExponential, fillWilder, findContinuousSegments, holdLastClosed, inWords, isPlanWithinBudget, readBarSource, readChoice, readSessions, readSetting, readToggle, resolveExponentialWeight, resolveTrueRange, smoothWilder, summariseParameters };
