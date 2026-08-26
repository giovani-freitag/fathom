import { readFile, writeFile } from 'node:fs/promises';

// A reader who pipes this into `head` closes the pipe halfway, and an unhandled
// EPIPE turns that into a stack trace that reads like a broken script.
process.stdout.on('error', () => undefined);

/** Where vitest writes the machine-readable summary. */
const SUMMARY_PATH = 'coverage/coverage-summary.json';

/** Where the shields.io endpoint document is left for the workflow to publish. */
const BADGE_PATH = 'coverage/badge.json';

/** Kept beside the thresholds in vitest.config.ts, which is what enforces them. */
const FLOORS = { statements: 78, branches: 66, functions: 71, lines: 78 };

/** What the badge is coloured by, read the way most tools report coverage. */
const HEADLINE_METRIC = 'lines';

const BANDS = [
    { atLeast: 70, colour: 'brightgreen' },
    { atLeast: 50, colour: 'yellow' },
    { atLeast: 0, colour: 'red' },
];

const summary = JSON.parse(await readFile(SUMMARY_PATH, 'utf8'));

const rows = Object.entries(FLOORS).map(([metric, floor]) => {
    const measured = summary.total[metric];
    const mark = measured.pct >= floor ? '✅' : '❌';
    return `| ${metric} | ${measured.pct.toFixed(2)}% | ${floor}% | ${measured.covered}/${measured.total} | ${mark} |`;
});

const headline = summary.total[HEADLINE_METRIC].pct;
await writeFile(BADGE_PATH, `${JSON.stringify({
    schemaVersion: 1,
    label: 'coverage',
    message: `${headline.toFixed(1)}%`,
    color: BANDS.find((band) => headline >= band.atLeast).colour,
}, null, 2)}\n`);

process.stdout.write([
    '## Coverage',
    '',
    '| | measured | floor | covered |  |',
    '|---|---:|---:|---:|:-:|',
    ...rows,
    '',
].join('\n'));
