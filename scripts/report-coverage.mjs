import { readFile } from 'node:fs/promises';

/** Where vitest writes the machine-readable summary. */
const SUMMARY_PATH = 'coverage/coverage-summary.json';

/** Kept beside the thresholds in vitest.config.ts, which is what enforces them. */
const FLOORS = { statements: 60, branches: 55, functions: 50, lines: 60 };

const summary = JSON.parse(await readFile(SUMMARY_PATH, 'utf8'));
const rows = Object.entries(FLOORS).map(([metric, floor]) => {
    const measured = summary.total[metric];
    const mark = measured.pct >= floor ? '✅' : '❌';
    return `| ${metric} | ${measured.pct.toFixed(2)}% | ${floor}% | ${measured.covered}/${measured.total} | ${mark} |`;
});

process.stdout.write([
    '## Coverage',
    '',
    '| | measured | floor | covered |  |',
    '|---|---:|---:|---:|:-:|',
    ...rows,
    '',
].join('\n'));
