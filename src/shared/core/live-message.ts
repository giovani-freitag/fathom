import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

/**
 * Everything a tail can say, whatever carries it.
 *
 * One union rather than one per transport: a socket writes it as bytes and a
 * worker hands it over by structured clone, but both ends read the same type,
 * so a message the gateway learns to send is one the page already understands.
 */
export type LiveMessage =
    | {
        readonly kind: 'subscribed';
        readonly instrumentSymbol: string;
        readonly priceBucketSize: number;
    }
    | { readonly kind: 'frames'; readonly window: LiquidityFrameWindow }
    | { readonly kind: 'trade-clusters'; readonly clusters: readonly TradeCluster[] }
    | { readonly kind: 'gap'; readonly gap: RecordingGap }
    | { readonly kind: 'stalled'; readonly lastFrameAtMs: number | null };
