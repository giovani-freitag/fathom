import { LiquidityArchiveService, PostgresService } from '@fathom/persistence';
import {
    BINANCE_ENDPOINTS,
    type CollectorConfiguration,
    RESILIENCE_SETTINGS,
    WRITE_SETTINGS,
} from './configuration/collector-configuration.ts';
import { logInfo, logWarning } from './logging/collector-log.ts';
import { BinanceDepthFeedService } from './services/binance-depth-feed/binance-depth-feed-service.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade } from './services/order-book/depth-types.ts';
import { OrderBookService } from './services/order-book/order-book-service.ts';
import { LiquidityRecorderService } from './services/liquidity-recorder/liquidity-recorder-service.ts';

const DATABASE_POOL_SIZE = 4;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * The collector's object graph and its lifecycle, wired by hand in one place.
 *
 * Reading the constructor tells you the whole wiring. The one knot is a callback
 * pointing back: the order book asks the feed for ladders, and the feed hands
 * the order book its updates.
 */
export class CollectorRuntime {
    private readonly configuration: CollectorConfiguration;
    private readonly postgres: PostgresService;
    private readonly feed: BinanceDepthFeedService;
    private readonly orderBook: OrderBookService;
    private readonly recorder: LiquidityRecorderService;

    constructor(configuration: CollectorConfiguration) {
        this.configuration = configuration;
        this.handleDepthDiff = this.handleDepthDiff.bind(this);
        this.handleExecutedTrade = this.handleExecutedTrade.bind(this);
        this.handleFeedConnected = this.handleFeedConnected.bind(this);
        this.handleFeedDisconnected = this.handleFeedDisconnected.bind(this);
        this.handleBookDesynchronized = this.handleBookDesynchronized.bind(this);
        this.handleBookSynchronized = this.handleBookSynchronized.bind(this);
        this.handleRecorderStatus = this.handleRecorderStatus.bind(this);
        this.fetchDepthSnapshot = this.fetchDepthSnapshot.bind(this);

        this.postgres = new PostgresService({
            connectionString: configuration.databaseUrl,
            maximumPoolSize: DATABASE_POOL_SIZE,
            statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
        });

        const archive = new LiquidityArchiveService({ postgres: this.postgres });

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
            archive,
            instrumentSymbol: configuration.instrumentSymbol,
            priceBucketSize: configuration.priceBucketSize,
            frameIntervalMs: configuration.frameIntervalMs,
            recordedPriceRangeRatio: configuration.recordedPriceRangeRatio,
            flushIntervalMs: WRITE_SETTINGS.flushIntervalMs,
            framesPerFlush: WRITE_SETTINGS.framesPerFlush,
            maximumBufferedFrames: WRITE_SETTINGS.maximumBufferedFrames,
            maximumBufferedTradeClusters: WRITE_SETTINGS.maximumBufferedTradeClusters,
            onStatusChanged: this.handleRecorderStatus,
        });
    }

    /**
     * Connects every resource and begins recording.
     *
     * @throws PostgresQueryError when the archive cannot be reached.
     */
    async start(): Promise<void> {
        await this.postgres.connect();
        await this.recorder.start();
        this.orderBook.start();
        this.feed.connect();

        const { instrumentSymbol, priceBucketSize, frameIntervalMs } = this.configuration;
        logInfo(`Recording ${instrumentSymbol} at ${frameIntervalMs}ms x ${priceBucketSize} quote units`);
    }

    /**
     * Closes every resource, flushing whatever is still queued.
     */
    async stop(): Promise<void> {
        await this.feed.disconnect();
        this.orderBook.stop();
        await this.recorder.stop();
        await this.postgres.close();
        logInfo('Collector stopped');
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
        logInfo('Market data stream connected');
    }

    private handleFeedDisconnected(reason: string): void {
        logWarning(`Market data stream lost: ${reason}`);
        this.orderBook.invalidate(reason);
    }

    private handleBookDesynchronized(reason: string): void {
        logWarning(`Order book desynchronized: ${reason}`);
        this.recorder.noteInterruption(reason);
    }

    private handleBookSynchronized(): void {
        logInfo(`Order book synchronized with ${this.orderBook.levelCount} resting levels`);
    }

    private handleRecorderStatus(status: string): void {
        logWarning(status);
    }
}
