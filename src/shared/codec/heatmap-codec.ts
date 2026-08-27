import type { DepthLadder, LiquidityFrame, LiquidityFrameWindow } from '../core/liquidity-frame.ts';

/** Raised when a payload is not a readable frame window. */
export class HeatmapCodecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HeatmapCodecError';
    }
}

const FORMAT_MAGIC = 0x4d485446;
const FORMAT_VERSION = 1;
const WINDOW_HEADER_BYTE_LENGTH = 32;
const FRAME_HEADER_BYTE_LENGTH = 40;
const BYTES_PER_QUANTITY = 4;

// Quantities are written through Float32Array, which uses platform byte order
// rather than the explicit little-endian the DataView fields use. Every platform
// this runs on is little-endian; refusing loudly beats emitting a payload whose
// header parses and whose depth is byte-swapped noise.
const IS_LITTLE_ENDIAN_PLATFORM = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Packs a frame window into its binary wire form.
 *
 * @param window - Frames to encode, expected in ascending capture order.
 * @returns A standalone buffer holding the whole window.
 * @throws HeatmapCodecError on a big-endian platform, or when a frame's capture
 *         time precedes the first frame's.
 */
export function encodeLiquidityFrameWindow(window: LiquidityFrameWindow): ArrayBuffer {
    assertLittleEndianPlatform();

    const buffer = new ArrayBuffer(measureEncodedByteLength(window));
    const view = new DataView(buffer);
    const baseTimestampMs = window.frames[0]?.capturedAtMs ?? 0;

    view.setUint32(0, FORMAT_MAGIC, true);
    view.setUint16(4, FORMAT_VERSION, true);
    view.setUint16(6, 0, true);
    view.setFloat64(8, window.priceBucketSize, true);
    view.setFloat64(16, baseTimestampMs, true);
    view.setUint32(24, window.frames.length, true);
    view.setUint32(28, window.sampleIntervalMs, true);

    let writeOffset = WINDOW_HEADER_BYTE_LENGTH;
    for (const frame of window.frames) {
        writeOffset = writeFrame({ buffer, view, writeOffset, frame, baseTimestampMs });
    }

    return buffer;
}

/**
 * Reads a frame window back from its binary wire form.
 *
 * @param buffer - A whole encoded window, starting at byte zero.
 * @returns The decoded window.
 * @throws HeatmapCodecError when the magic, version, or declared lengths do not
 * match the payload.
 */
export function decodeLiquidityFrameWindow(buffer: ArrayBuffer): LiquidityFrameWindow {
    assertLittleEndianPlatform();

    if (buffer.byteLength < WINDOW_HEADER_BYTE_LENGTH) {
        throw new HeatmapCodecError(`Payload of ${buffer.byteLength} bytes is shorter than the window header`);
    }

    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== FORMAT_MAGIC) {
        throw new HeatmapCodecError('Payload is not a Fathom frame window');
    }

    const formatVersion = view.getUint16(4, true);
    if (formatVersion !== FORMAT_VERSION) {
        throw new HeatmapCodecError(`Unsupported frame window version ${formatVersion}`);
    }

    const frameCount = view.getUint32(24, true);
    const frames: LiquidityFrame[] = [];
    let readOffset = WINDOW_HEADER_BYTE_LENGTH;

    for (let i = 0; i < frameCount; i += 1) {
        const decoded = readFrame({ buffer, view, readOffset, baseTimestampMs: view.getFloat64(16, true) });
        frames.push(decoded.frame);
        readOffset = decoded.nextOffset;
    }

    return {
        priceBucketSize: view.getFloat64(8, true),
        sampleIntervalMs: view.getUint32(28, true),
        frames,
    };
}

/**
 * Byte length `encodeLiquidityFrameWindow` will produce for a window.
 *
 * @param window - Frames that would be encoded.
 * @returns Total size in bytes, header included.
 */
export function measureEncodedByteLength(window: LiquidityFrameWindow): number {
    let totalByteLength = WINDOW_HEADER_BYTE_LENGTH;
    for (const frame of window.frames) {
        const quantityCount = frame.bids.quantities.length + frame.asks.quantities.length;
        totalByteLength += FRAME_HEADER_BYTE_LENGTH + quantityCount * BYTES_PER_QUANTITY;
    }
    return totalByteLength;
}

interface FrameWriteRequest {
    readonly buffer: ArrayBuffer;
    readonly view: DataView;
    readonly writeOffset: number;
    readonly frame: LiquidityFrame;
    readonly baseTimestampMs: number;
}

function writeFrame(request: FrameWriteRequest): number {
    const { buffer, view, writeOffset, frame, baseTimestampMs } = request;
    const bidCount = frame.bids.quantities.length;
    const askCount = frame.asks.quantities.length;
    const timeOffsetMs = frame.capturedAtMs - baseTimestampMs;

    if (timeOffsetMs < 0) {
        throw new HeatmapCodecError('Frames must be encoded in ascending capture order');
    }

    view.setUint32(writeOffset, timeOffsetMs, true);
    view.setInt32(writeOffset + 4, frame.bids.lowestBucketIndex, true);
    view.setInt32(writeOffset + 8, frame.asks.lowestBucketIndex, true);
    view.setUint32(writeOffset + 12, bidCount, true);
    view.setUint32(writeOffset + 16, askCount, true);
    view.setUint32(writeOffset + 20, 0, true);
    view.setFloat64(writeOffset + 24, frame.bestBidPrice, true);
    view.setFloat64(writeOffset + 32, frame.bestAskPrice, true);

    const bidByteOffset = writeOffset + FRAME_HEADER_BYTE_LENGTH;
    const askByteOffset = bidByteOffset + bidCount * BYTES_PER_QUANTITY;
    new Float32Array(buffer, bidByteOffset, bidCount).set(frame.bids.quantities);
    new Float32Array(buffer, askByteOffset, askCount).set(frame.asks.quantities);

    return askByteOffset + askCount * BYTES_PER_QUANTITY;
}

interface FrameReadResult {
    readonly frame: LiquidityFrame;
    readonly nextOffset: number;
}

/**
 * Where in the payload a frame starts, and what its instants are counted from.
 *
 * Named because the two are numbers side by side — a byte offset and a
 * millisecond — and transposed they compile into a decoder reading from the
 * wrong place and dating what it finds from nowhere.
 */
interface FrameRead {
    readonly buffer: ArrayBuffer;
    readonly view: DataView;
    readonly readOffset: number;
    readonly baseTimestampMs: number;
}

function readFrame(read: FrameRead): FrameReadResult {
    const { buffer, view, readOffset, baseTimestampMs } = read;
    if (readOffset + FRAME_HEADER_BYTE_LENGTH > buffer.byteLength) {
        throw new HeatmapCodecError('Payload ends inside a frame header');
    }

    const bidCount = view.getUint32(readOffset + 12, true);
    const askCount = view.getUint32(readOffset + 16, true);
    const bidByteOffset = readOffset + FRAME_HEADER_BYTE_LENGTH;
    const askByteOffset = bidByteOffset + bidCount * BYTES_PER_QUANTITY;
    const nextOffset = askByteOffset + askCount * BYTES_PER_QUANTITY;

    if (nextOffset > buffer.byteLength) {
        throw new HeatmapCodecError('Frame declares more depth than the payload holds');
    }

    const bids: DepthLadder = {
        lowestBucketIndex: view.getInt32(readOffset + 4, true),
        quantities: new Float32Array(buffer, bidByteOffset, bidCount),
    };
    const asks: DepthLadder = {
        lowestBucketIndex: view.getInt32(readOffset + 8, true),
        quantities: new Float32Array(buffer, askByteOffset, askCount),
    };

    return {
        frame: {
            capturedAtMs: baseTimestampMs + view.getUint32(readOffset, true),
            bestBidPrice: view.getFloat64(readOffset + 24, true),
            bestAskPrice: view.getFloat64(readOffset + 32, true),
            bids,
            asks,
        },
        nextOffset,
    };
}

function assertLittleEndianPlatform(): void {
    if (!IS_LITTLE_ENDIAN_PLATFORM) {
        throw new HeatmapCodecError('The frame window format requires a little-endian platform');
    }
}
