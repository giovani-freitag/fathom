import type { LiquidityArchive } from '../database/services/liquidity-archive.ts';
import {
    BINANCE_ENDPOINTS,
    type CollectorConfiguration,
    RESILIENCE_SETTINGS,
    WRITE_SETTINGS,
} from './core/collector-configuration.ts';
import type { CollectorLog } from './core/collector-log.ts';
import type { MarketDataSocketFactory } from './core/market-data-socket.ts';
import { BinanceDepthFeedService } from './services/binance-depth-feed-service.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade } from './core/depth-types.ts';
import { OrderBookService } from './core/order-book-service.ts';
import {
    LiquidityRecorderService,
    type WideRecordingConfig,
} from './services/liquidity-recorder-service.ts';

/**
 * The collector's object graph and its lifecycle, wired by hand in one place.
 */
/**
 * What the runtime needs beyond the settings read from the environment.
 */
export interface CollectorRuntimeConfig {
    readonly configuration: CollectorConfiguration;
    readonly openSocket: MarketDataSocketFactory;
    /** Where recorded frames go. Postgres on a server, IndexedDB in a page. */
    readonly archive: LiquidityArchive;
    /** How many frames queue before a flush; one in a page, a batch on a server. */
    readonly framesPerFlush: number;
    /** Where the runtime narrates itself; streams on a server, messages in a page. */
    readonly log: CollectorLog;
    /**
     * A second, far wider recording of the same instants.
     *
     * Absent in a page, where there is no room for it. On a server it is what
     * carries the walls standing at prices the market has not reached, which
     * the narrow recording cannot see at all.
     */
    readonly wideRecordings?: readonly WideRecordingConfig[];
}

export class CollectorRuntime {
    private readonly configuration: CollectorConfiguration;
    private readonly archive: LiquidityArchive;
    private readonly log: CollectorLog;
    private readonly feed: BinanceDepthFeedService;
    private readonly orderBook: OrderBookService;
    private readonly recorder: LiquidityRecorderService;

    constructor(config: CollectorRuntimeConfig) {
        const { configuration } = config;
        this.configuration = configuration;
        this.handleDepthDiff = this.handleDepthDiff.bind(this);
        this.handleExecutedTrade = this.handleExecutedTrade.bind(this);
        this.handleFeedConnected = this.handleFeedConnected.bind(this);
        this.handleFeedDisconnected = this.handleFeedDisconnected.bind(this);
        this.handleBookDesynchronized = this.handleBookDesynchronized.bind(this);
        this.handleBookSynchronized = this.handleBookSynchronized.bind(this);
        this.handleRecorderStatus = this.handleRecorderStatus.bind(this);
        this.fetchDepthSnapshot = this.fetchDepthSnapshot.bind(this);

        this.archive = config.archive;
        this.log = config.log;

        this.feed = new BinanceDepthFeedService({
            instrumentSymbol: configuration.instrumentSymbol,
            restApiBaseUrl: BINANCE_ENDPOINTS.restApiBaseUrl,
            webSocketBaseUrl: BINANCE_ENDPOINTS.webSocketBaseUrl,
            depthSnapshotLevelLimit: BINANCE_ENDPOINTS.depthSnapshotLevelLimit,
            depthUpdateIntervalLabel: BINANCE_ENDPOINTS.depthUpdateIntervalLabel,
            proactiveReconnectIntervalMs: RESILIENCE_SETTINGS.proactiveReconnectIntervalMs,
            inboundSilenceTimeoutMs: RESILIENCE_SETTINGS.inboundSilenceTimeoutMs,
            initialReconnectDelayMs: RESILIENCE_SETTINGS.initialReconnectDelayMs,
            maximumReconnectDelayMs: RESILIENCE_SETTINGS.maximumReconnectDelayMs,
            snapshotRequestTimeoutMs: RESILIENCE_SETTINGS.snapshotRequestTimeoutMs,
            onDepthDiff: this.handleDepthDiff,
            onExecutedTrade: this.handleExecutedTrade,
            onConnected: this.handleFeedConnected,
            onDisconnected: this.handleFeedDisconnected,
            openSocket: config.openSocket,
        });

        this.orderBook = new OrderBookService({
            fetchDepthSnapshot: this.fetchDepthSnapshot,
            retainedPriceRangeRatio: configuration.retainedPriceRangeRatio,
            deepRepairIntervalMs: configuration.deepRepairIntervalMs,
            snapshotRetryDelayMs: RESILIENCE_SETTINGS.snapshotRetryDelayMs,
            onDesynchronized: this.handleBookDesynchronized,
            onSynchronized: this.handleBookSynchronized,
        });

        this.recorder = new LiquidityRecorderService({
            orderBook: this.orderBook,
            archive: config.archive,
            instrumentSymbol: configuration.instrumentSymbol,
            priceBucketSize: configuration.priceBucketSize,
            frameIntervalMs: configuration.frameIntervalMs,
            flushIntervalMs: WRITE_SETTINGS.flushIntervalMs,
            framesPerFlush: config.framesPerFlush,
            maximumBufferedTradeClusters: WRITE_SETTINGS.maximumBufferedTradeClusters,
            onStatusChanged: this.handleRecorderStatus,
            ...config.wideRecordings === undefined ? {} : { wideRecordings: config.wideRecordings },
        });
    }

    /**
     * Connects every resource and begins recording.
     *
     * @throws ArchiveUnavailableError when the archive rejects the first write.
     */
    async start(): Promise<void> {
        // The archive is opened by whoever built it: several runtimes share
        // one, and closing it here would stop the others mid-write.
        await this.recorder.start();
        this.orderBook.start();
        this.feed.connect();

        const { priceBucketSize, frameIntervalMs } = this.configuration;
        this.log.info('Recording', { frameIntervalMs, priceBucketSize });
    }

    /**
     * Closes every resource, flushing whatever is still queued.
     */
    async stop(): Promise<void> {
        await this.feed.disconnect();
        this.orderBook.stop();
        await this.recorder.stop();
        this.log.info('Collector stopped');
    }

    private fetchDepthSnapshot(): Promise<DepthSnapshot> {
        return this.feed.fetchDepthSnapshot();
    }

    private handleDepthDiff(diff: DepthDiff): void {
        this.orderBook.ingestDiff(diff);
    }

    private handleExecutedTrade(trade: ExecutedTrade): void {
        this.recorder.ingestTrade(trade);
    }

    private handleFeedConnected(): void {
        this.log.info('Market data stream connected');
    }

    private handleFeedDisconnected(reason: string): void {
        this.log.warning('Market data stream lost', { reason });
        this.orderBook.invalidate(reason);
    }

    private handleBookDesynchronized(reason: string): void {
        this.log.warning('Order book desynchronized', { reason });
        this.recorder.noteInterruption(reason);
    }

    private handleBookSynchronized(): void {
        this.log.info('Order book synchronized', { restingLevels: this.orderBook.levelCount });
    }

    private handleRecorderStatus(status: string): void {
        this.log.warning(status);
    }

    /**
     * When this runtime last captured a frame, or null before its first.
     *
     * The capture clock, not the write: frames queued behind an archive that
     * will not answer are a degraded runtime, and restarting it would throw the
     * queue away without fixing anything.
     */
    get lastRecordedAtMs(): number | null {
        return this.recorder.lastFrameAtMs;
    }
}
