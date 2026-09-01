import { describe, expect, it } from 'vitest';
import {
    countSteps,
    packTile,
    quantiseQuantity,
    readQuantisedQuantity,
    readTileColumnRows,
    type TileGrid,
    type TilePlanes,
} from '../../../src/shared/codec/tile-codec.ts';

/** Every row of one column, which is what most of these assert about. */
function wholeColumn(planes: TilePlanes, grid: TileGrid, column: number): Float32Array {
    return readTileColumnRows(planes, grid, { column, fromRow: 0, rowCount: grid.rowCount });
}

const GRID: TileGrid = {
    rowCount: 4,
    columnCount: 3,
    stepRatio: 1.02,
    smallestQuantity: 0.001,
};

describe('quantiseQuantity', () => {
    it('reads a price nothing is resting at as empty', () => {
        expect(quantiseQuantity(0, GRID, 255)).toBe(0);
    });

    it('reads the smallest size that exists as a step rather than as empty', () => {
        expect(quantiseQuantity(GRID.smallestQuantity, GRID, 255)).toBe(1);
    });

    it('places a larger size on a higher step', () => {
        expect(quantiseQuantity(10, GRID, 65_535))
            .toBeGreaterThan(quantiseQuantity(1, GRID, 65_535));
    });

    it('holds a size past the top of the scale at the top', () => {
        expect(quantiseQuantity(1e9, GRID, 255)).toBe(255);
    });

    it('will not read a negative size as anything but empty', () => {
        expect(quantiseQuantity(-5, GRID, 255)).toBe(0);
    });
});

describe('readQuantisedQuantity', () => {
    it('gives back a size within the precision it was written at', () => {
        const written = 42.5;
        const step = quantiseQuantity(written, GRID, 65_535);

        const read = readQuantisedQuantity(step, GRID);

        expect(Math.abs(read - written) / written).toBeLessThan(GRID.stepRatio - 1);
    });

    it('reads an empty cell as nothing, not as the smallest size', () => {
        expect(readQuantisedQuantity(0, GRID)).toBe(0);
    });
});

describe('countSteps', () => {
    it('needs more steps of a finer scale to reach the same size', () => {
        const fine = countSteps({ ...GRID, stepRatio: 1.02 }, 700);
        const coarse = countSteps({ ...GRID, stepRatio: 1.07 }, 700);

        expect(fine).toBeGreaterThan(coarse);
    });

    it('needs one step for a range that never leaves the floor', () => {
        expect(countSteps(GRID, GRID.smallestQuantity)).toBe(1);
    });
});

describe('packTile', () => {
    const columns = [[0, 1, 2, 3], [0, 0, 40, 0], [5, 5, 5, 5]];

    it('writes one cell per row of every column', () => {
        const planes = packTile(columns, GRID);

        expect(planes.lowPlane).toHaveLength(GRID.rowCount * GRID.columnCount);
    });

    it('spends a second byte per cell only when the precision needs one', () => {
        const coarse = packTile(columns, { ...GRID, stepRatio: 1.5 });

        expect(coarse.highPlane).toBeNull();
    });

    it('spends the second byte when the scale runs past one byte of steps', () => {
        const planes = packTile(columns, GRID);

        expect(planes.highPlane).not.toBeNull();
    });

    it('pads a column the caller left short rather than refusing it', () => {
        const planes = packTile([[1, 2]], { ...GRID, columnCount: 1 });

        expect(wholeColumn(planes, { ...GRID, columnCount: 1 }, 0).slice(2)).toEqual(
            Float32Array.from([0, 0]),
        );
    });
});

describe('reading a whole column back', () => {
    const columns = [[0, 1, 2, 3], [0, 0, 40, 0], [5, 5, 5, 5]];

    it('gives every size back within the precision it was written at', () => {
        const planes = packTile(columns, GRID);

        const read = [...wholeColumn(planes, GRID, 0)];

        read.forEach((size, row) => {
            const written = columns[0]![row]!;
            expect(Math.abs(size - written)).toBeLessThan(Math.max(written * 0.02, 1e-6));
        });
    });

    it('keeps the columns apart, so one does not read as another', () => {
        const planes = packTile(columns, GRID);

        const wall = wholeColumn(planes, GRID, 1)[2]!;

        expect(wall).toBeGreaterThan(30);
    });

    it('reads a column past the end of the tile as empty', () => {
        const planes = packTile(columns, GRID);

        expect([...wholeColumn(planes, GRID, 99)]).toEqual([0, 0, 0, 0]);
    });

    describe('reading only part of a column', () => {
        const planes = packTile(columns, GRID);

        it('hands back only the rows asked for', () => {
            expect(readTileColumnRows(planes, GRID, { column: 0, fromRow: 1, rowCount: 2 }))
                .toHaveLength(2);
        });

        it('starts at the row asked for, not at the bottom of the picture', () => {
            // Off by one here and every price in the window is read from its
            // neighbour, which draws a book that never stood.
            const part = readTileColumnRows(planes, GRID, { column: 0, fromRow: 1, rowCount: 2 });
            const whole = wholeColumn(planes, GRID, 0);

            expect([part[0], part[1]]).toEqual([whole[1], whole[2]]);
        });

        it('stops at the top of the picture rather than reading past it', () => {
            expect(readTileColumnRows(planes, GRID, { column: 0, fromRow: 2, rowCount: 99 }))
                .toHaveLength(2);
        });

        it('trims a stretch reaching under the picture to what is there', () => {
            // Handed back from the first row that exists, not padded to the row
            // that was asked for: a caller holding its own offset has to clamp
            // it the same way or read every price off its neighbour.
            const part = readTileColumnRows(planes, GRID, { column: 2, fromRow: -2, rowCount: 4 });
            const whole = wholeColumn(planes, GRID, 2);

            expect([...part]).toEqual([whole[0], whole[1]]);
        });
    });
});

describe('packTile laying the plane out', () => {
    const columns = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];
    const grid: TileGrid = { ...GRID, rowCount: 3, columnCount: 3, stepRatio: 2, smallestQuantity: 1 };

    it('reads every column back the same either way it was laid out', () => {
        // The two layouts hold the same cells; the choice is free, which is what
        // makes it a choice about compression rather than about the reading.
        const read = (layout: 'byRow' | 'byColumn') => {
            const laid = { ...grid, layout };
            const planes = packTile(columns, laid);
            return [0, 1, 2].map((column) => [...wholeColumn(planes, laid, column)]);
        };

        expect(read('byRow')).toEqual(read('byColumn'));
    });

    it('puts one price next to itself through the tile', () => {
        // A price changes far less across a tile than an instant changes across
        // the book, so a row of the plane is where the repetition is.
        const planes = packTile([[5, 1], [5, 2], [5, 3]], { ...grid, rowCount: 2, layout: 'byRow' });

        expect([planes.lowPlane[0], planes.lowPlane[1], planes.lowPlane[2]])
            .toEqual([planes.lowPlane[0], planes.lowPlane[0], planes.lowPlane[0]]);
    });

    it('puts one instant next to itself when laid out the other way', () => {
        const planes = packTile([[5, 1], [5, 2], [5, 3]], { ...grid, rowCount: 2, layout: 'byColumn' });

        expect(planes.lowPlane[0]).not.toBe(planes.lowPlane[1]);
    });

    it('reads a column laid out one way as nonsense when read the other', () => {
        // Which is why the layout has to travel with the picture rather than be
        // assumed: a plane read under the wrong one is silently wrong, not empty.
        const tall = { ...grid, rowCount: 2, columnCount: 3, layout: 'byRow' as const };
        const planes = packTile([[5, 1], [5, 2], [5, 3]], tall);

        expect([...wholeColumn(planes, { ...tall, layout: 'byColumn' }, 0)])
            .not.toEqual([...wholeColumn(planes, tall, 0)]);
    });

    it('lays out by row unless told otherwise, which is the cheaper default', () => {
        expect(packTile(columns, grid).lowPlane)
            .toEqual(packTile(columns, { ...grid, layout: 'byRow' }).lowPlane);
    });
});
