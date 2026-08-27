import {
    type DrawPlan,
    isPlanWithinBudget,
    type PlotBand,
    type PlotLevel,
    type PlotSeries,
    type PlotTone,
} from '../../../shared/core/draw-plan.ts';
import {
    groupPanedPlans,
    needsOwnBand,
    PaneProjector,
    resolveOverlayRect,
    resolvePlanRange,
    type ValueProjector,
} from '../pane-projector.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext, PanePlacement, PaneRect } from '../render-types.ts';

/** The palette a plan's tone resolves against, chosen by the host and not the author. */
const TONE_COLOURS: Record<PlotTone, () => string> = {
    bid: () => RENDER_PALETTE.bid,
    ask: () => RENDER_PALETTE.ask,
    amber: () => RENDER_PALETTE.amber,
    violet: () => RENDER_PALETTE.violet,
    cyan: () => RENDER_PALETTE.cyan,
    phosphor: () => RENDER_PALETTE.phosphor,
    ink: () => RENDER_PALETTE.inkPrimary,
    muted: () => RENDER_PALETTE.inkMuted,
};

/** An unconverged series is drawn dashed, so it does not read as settled. */
const UNCONVERGED_DASH = [4, 3];
const LEVEL_DASH = [2, 4];

/** How much of a fill's colour survives, so what is under a band stays legible. */
const BAND_ALPHA = 0.1;

/** How much of a floor strip survives, so the depth map under it still reads. */
const FLOOR_STRIP_ALPHA = 0.55;

interface SeriesPaint {
    readonly paint: PaintContext;
    readonly series: PlotSeries;
    readonly plan: DrawPlan;
    readonly projector: ValueProjector;
}

interface BandPaint {
    readonly paint: PaintContext;
    readonly plan: DrawPlan;
    readonly band: PlotBand;
    readonly projector: ValueProjector;
}

/**
 * One unbroken stretch of a band, named because six of them in a row were not.
 *
 * Two series and two indices, and either pair transposed compiles: the shading
 * would be drawn upside down, or over a stretch nobody asked for.
 */
interface BandRun {
    readonly paint: PaintContext;
    readonly upper: PlotSeries;
    readonly lower: PlotSeries;
    readonly projector: ValueProjector;
    readonly fromIndex: number;
    readonly toIndex: number;
}

/**
 * Draws the plans indicators produced, each against the scale it asked for.
 *
 * The plan holds vertices in data space and this is the only place they become
 * pixels, which is what lets a pan re-project a plan the host already has
 * rather than asking whoever wrote the indicator for a new one.
 */
export class PlotPainter {
    /**
     * Draws the plans that share the price axis.
     *
     * @param paint - The shared paint context.
     */
    paintOverPrice(paint: PaintContext): void {
        for (const plan of paint.request.plans) {
            if (!isPlanWithinBudget(plan) || needsOwnBand(plan.scale)) {
                continue;
            }
            const strip = resolveOverlayRect(plan.scale, paint.layout.pricePaneHeight);
            if (strip === null) {
                this.paintPlanOverPrice(paint, plan, paint.projector);
                continue;
            }
            this.paintAlongTheFloor(paint, plan, strip);
        }
    }

    /**
     * Draws a plan in a strip along the floor of the price pane.
     *
     * Held back so what it covers still reads: the strip sits over the depth
     * map, and a reading that hides the liquidity it sits on has taken more
     * than it gave.
     */
    private paintAlongTheFloor(paint: PaintContext, plan: DrawPlan, strip: PaneRect): void {
        const { context } = paint;
        context.save();
        context.globalAlpha = FLOOR_STRIP_ALPHA;
        context.beginPath();
        context.rect(0, strip.topY, paint.layout.plotWidth, strip.height);
        context.clip();

        this.paintPlanOverPrice(paint, plan, new PaneProjector({
            rect: strip,
            ...resolvePlanRange(plan, paint.request.viewport),
        }));

        context.restore();
    }

    /**
     * Draws the plans that were given a band of their own.
     *
     * @param paint - The shared paint context.
     */
    paintInPanes(paint: PaintContext): void {
        groupPanedPlans(paint.request.plans).forEach((band, index) => {
            const placement = paint.panePlacements[index];
            if (placement === undefined) {
                return;
            }
            // Rejected whole rather than clipped: half a series is a different
            // claim than the one its author made.
            const drawable = band.filter((plan) => isPlanWithinBudget(plan));
            if (drawable.length > 0) {
                this.paintPane(paint, drawable, placement);
            }
        });
    }

    /**
     * Draws a plan that shares the price axis with what it describes.
     */
    private paintPlanOverPrice(
        paint: PaintContext,
        plan: DrawPlan,
        projector: ValueProjector,
    ): void {
        this.paintBands(paint, plan, projector);
        for (const series of plan.series) {
            this.paintSeries({ paint, series, plan, projector });
        }
    }

    /**
     * Draws one band of the stack, and everything sharing it, on one scale.
     */
    private paintPane(
        paint: PaintContext,
        band: readonly DrawPlan[],
        placement: PanePlacement,
    ): void {
        const rect = placement.rect;
        const projector = new PaneProjector(placement);
        const { context } = paint;

        // Clipped to its own band. A pane is the promise that an indicator
        // cannot draw over the price, whatever its values turn out to be.
        context.save();
        context.beginPath();
        // The plot, not the gutter beside it. Clipped to the axis instead, the
        // series run on under the volume profile while the band's own rule and
        // its thresholds stop short, and below the price pane there is no
        // backdrop to hide the difference.
        context.rect(0, rect.topY, paint.layout.plotWidth, rect.height);
        context.clip();

        this.paintPaneFrame(paint, rect);
        for (const plan of band) {
            for (const level of plan.levels ?? []) {
                this.paintLevel(paint, level, projector);
            }
        }
        for (const plan of band) {
            this.paintBands(paint, plan, projector);
            for (const series of plan.series) {
                this.paintSeries({ paint, series, plan, projector });
            }
        }

        context.restore();
    }

    private paintSeries(request: SeriesPaint): void {
        const { paint, series, plan, projector } = request;
        if (series.shape === 'histogram') {
            this.paintHistogram(paint, series, projector);
            return;
        }

        const { context, layout } = paint;
        context.strokeStyle = TONE_COLOURS[series.tone]();
        context.lineWidth = series.widthPx ?? 1;
        context.setLineDash(this.resolveDash(series, plan));
        context.beginPath();

        let isDrawing = false;
        for (let index = 0; index < series.atMs.length; index += 1) {
            const value = series.value[index]!;
            const x = paint.projector.timeToX(series.atMs[index]!);
            if (Number.isNaN(value) || x < -layout.plotWidth || x > layout.plotWidth * 2) {
                isDrawing = false;
                continue;
            }

            const y = projector.valueToY(value);
            if (isDrawing) {
                context.lineTo(x, y);
                continue;
            }
            context.moveTo(x, y);
            isDrawing = true;
        }

        context.stroke();
        context.setLineDash([]);
    }

    /**
     * Draws a series as columns from its baseline, coloured by which side of it they fall.
     */
    private paintHistogram(
        paint: PaintContext,
        series: PlotSeries,
        projector: ValueProjector,
    ): void {
        const { context, layout } = paint;
        const baseline = series.baseline ?? 0;
        const baselineY = projector.valueToY(baseline);
        const columnWidth = this.resolveColumnWidth(paint, series);

        for (let index = 0; index < series.atMs.length; index += 1) {
            const value = series.value[index]!;
            const x = paint.projector.timeToX(series.atMs[index]!);
            if (Number.isNaN(value) || x < -columnWidth || x > layout.plotWidth + columnWidth) {
                continue;
            }

            const isNegative = value < baseline;
            const tone = isNegative ? series.negativeTone ?? series.tone : series.tone;
            context.fillStyle = TONE_COLOURS[tone]();
            const y = projector.valueToY(value);
            context.fillRect(
                Math.round(x - columnWidth / 2),
                Math.round(Math.min(y, baselineY)),
                Math.max(1, Math.round(columnWidth)),
                Math.max(1, Math.round(Math.abs(y - baselineY))),
            );
        }
    }

    /**
     * Shades the region between two of a plan's series.
     */
    private paintBands(paint: PaintContext, plan: DrawPlan, projector: ValueProjector): void {
        for (const band of plan.bands ?? []) {
            this.paintBand({ paint, plan, band, projector });
        }
    }

    private paintBand(request: BandPaint): void {
        const { paint, plan, band, projector } = request;
        const upper = plan.series[band.upperSeriesIndex];
        const lower = plan.series[band.lowerSeriesIndex];
        if (upper === undefined || lower === undefined) {
            return;
        }

        const { context } = paint;
        context.save();
        context.globalAlpha = BAND_ALPHA;
        context.fillStyle = TONE_COLOURS[band.tone]();

        // Walked out along the upper edge and back along the lower one, so a
        // break in either closes the shape instead of shading across the hole.
        let runStart = -1;
        for (let index = 0; index <= upper.value.length; index += 1) {
            const isUsable = index < upper.value.length
                && Number.isFinite(upper.value[index]!)
                && Number.isFinite(lower.value[index]!);
            if (isUsable && runStart === -1) {
                runStart = index;
            }
            if (!isUsable && runStart !== -1) {
                this.fillBandRun({ paint, upper, lower, projector, fromIndex: runStart, toIndex: index });
                runStart = -1;
            }
        }

        context.restore();
    }

    private fillBandRun(run: BandRun): void {
        const { paint, upper, lower, projector, fromIndex, toIndex } = run;
        const { context } = paint;
        context.beginPath();
        for (let index = fromIndex; index < toIndex; index += 1) {
            const x = paint.projector.timeToX(upper.atMs[index]!);
            const y = projector.valueToY(upper.value[index]!);
            if (index === fromIndex) {
                context.moveTo(x, y);
                continue;
            }
            context.lineTo(x, y);
        }
        for (let index = toIndex - 1; index >= fromIndex; index -= 1) {
            context.lineTo(
                paint.projector.timeToX(lower.atMs[index]!),
                projector.valueToY(lower.value[index]!),
            );
        }
        context.closePath();
        context.fill();
    }

    private paintLevel(paint: PaintContext, level: PlotLevel, projector: ValueProjector): void {
        const { context, layout } = paint;
        const y = Math.round(projector.valueToY(level.value)) + 0.5;

        context.strokeStyle = TONE_COLOURS[level.tone]();
        context.lineWidth = 1;
        context.setLineDash(level.isDashed === true ? LEVEL_DASH : []);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(layout.plotWidth, y);
        context.stroke();
        context.setLineDash([]);
    }

    /**
     * Rules the top of a pane, so the stack reads as separate bands.
     */
    private paintPaneFrame(paint: PaintContext, rect: PaneRect): void {
        const { context, layout } = paint;
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.lineWidth = 1;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(0, Math.round(rect.topY) + 0.5);
        context.lineTo(layout.plotWidth, Math.round(rect.topY) + 0.5);
        context.stroke();
    }

    private resolveDash(series: PlotSeries, plan: DrawPlan): readonly number[] {
        if (!plan.hasConverged) {
            return UNCONVERGED_DASH;
        }
        return series.isDashed === true ? LEVEL_DASH : [];
    }

    /**
     * How wide one histogram column may be without touching its neighbour.
     */
    private resolveColumnWidth(paint: PaintContext, series: PlotSeries): number {
        if (series.atMs.length < 2) {
            return 2;
        }
        const stride = paint.projector.timeToX(series.atMs[1]!) - paint.projector.timeToX(series.atMs[0]!);
        return Math.max(1, stride * 0.7);
    }
}
