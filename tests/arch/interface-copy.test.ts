import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Two words in a row is prose; one word is a token, a unit, or a class name. */
const PROSE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

/** Attributes a screen reader or a tooltip reads aloud. */
const SPOKEN_ATTRIBUTES = /\b(?:aria-label|title|placeholder|alt)="([^"]+)"/g;

/** At least one word, in any of the alphabets a translation may use. */
const HAS_WORD = /[A-Za-zÀ-ÿ]{2,}/;

/**
 * A line holding nothing but words and sentence punctuation: the shape a
 * phrase typed straight into JSX takes.
 *
 * Code punctuation is excluded rather than parsed, which keeps the rule from
 * reading a TypeScript generic as a pair of tags. A trailing comma is what
 * separates a phrase from an identifier standing alone in a destructuring.
 */
const PROSE_LINE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ,.!?'’&%—–-]*$/;

/**
 * A valueless JSX attribute, which is one token rather than a phrase.
 *
 * Written in either casing the platform uses: `aria-hidden` came from HTML and
 * `autoFocus` from the DOM property it sets.
 */
const BARE_ATTRIBUTE = /^(?:[a-z]+(?:-[a-z]+)*|[a-z]+[A-Za-z]*)$/;

/**
 * A line of code that the prose shape would otherwise accept.
 *
 * A statement broken across lines ends mid-expression, and a fragment like
 * `return indicator.parameters` is letters, spaces and full stops — which is
 * also what a sentence is. Property access and a leading keyword are what tell
 * them apart without parsing the file.
 */
const CODE_LINE = /^(?:return|const|let|import|export|new|typeof|await|default|case|throw|yield)\b|\.[a-z]/;

/** A phrase written between two tags on one line. */
const INLINE_JSX_TEXT = /<\/?[A-Za-z][^<>]*>([^<>{}]*[A-Za-zÀ-ÿ]{2,}[^<>{}]*)</;

describe('interface copy', () => {
    it('reaches the screen through the dictionary, never as a literal', () => {
        const offenders = listFiles('src/app/ui')
            .filter((path) => path.endsWith('.tsx'))
            .flatMap((path) => findLiterals(path));

        expect(offenders).toEqual([]);
    });

    it('is never assembled where the dictionary cannot be reached', () => {
        // The crosshair readout is drawn on a canvas, so no JSX rule covers it.
        // Prose built from a template there is invisible to every other check.
        const offenders = [...listFiles('src/app/painting'), ...listFiles('src/app/core')]
            .flatMap((path) => findProseLiterals(path));

        expect(offenders).toEqual([]);
    });
});

function findLiterals(path: string): string[] {
    const source = read(path);
    const found: string[] = [];

    for (const [, value] of source.matchAll(SPOKEN_ATTRIBUTES)) {
        if (HAS_WORD.test(value!)) {
            found.push(`${path}: ${value!}`);
        }
    }
    let isInsideComment = false;
    for (const [index, line] of source.split('\n').entries()) {
        // Tracked rather than pattern-matched: a block comment inside JSX has
        // no marker on its middle lines, which is exactly where prose lives.
        const wasInsideComment = isInsideComment;
        isInsideComment = readCommentState(line, isInsideComment);

        const phrase = wasInsideComment ? null : readPhrase(line);
        if (phrase !== null) {
            found.push(`${path}:${index + 1}: ${phrase}`);
        }
    }
    return found;
}

function readCommentState(line: string, wasInside: boolean): boolean {
    const opened = line.lastIndexOf('/*');
    const closed = line.lastIndexOf('*/');
    if (opened > closed) {
        return true;
    }
    if (closed > opened) {
        return false;
    }
    return wasInside;
}

/**
 * The phrase a line puts on screen, or null when it puts none there.
 */
function readPhrase(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) {
        return null;
    }
    const isPhrase = PROSE_LINE.test(trimmed)
        && HAS_WORD.test(trimmed)
        && !trimmed.endsWith(',')
        && !BARE_ATTRIBUTE.test(trimmed)
        && !CODE_LINE.test(trimmed);
    if (isPhrase) {
        return trimmed;
    }
    return INLINE_JSX_TEXT.exec(trimmed)?.[1]?.trim() ?? null;
}

function findProseLiterals(path: string): string[] {
    if (!path.endsWith('.ts')) {
        return [];
    }
    const found: string[] = [];

    for (const match of read(path).matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)) {
        const value = match[1] ?? match[2] ?? '';
        if (PROSE.test(value) && !isExempt(value, match)) {
            found.push(`${path}: ${value}`);
        }
    }
    return found;
}

/**
 * Whether a prose-shaped literal is something no reader will ever see.
 */
function isExempt(value: string, match: RegExpExecArray): boolean {
    // A font stack is prose by shape and CSS by purpose.
    if (/^\d+px /.test(value)) {
        return true;
    }
    // A thrown message names a wiring mistake for whoever wrote the wiring.
    return match.input.slice(Math.max(0, match.index - 40), match.index).includes('Error(');
}

function read(path: string): string {
    return readFileSync(join(ROOT, path), 'utf8');
}

function listFiles(directory: string): string[] {
    return readdirSync(join(ROOT, directory)).flatMap((entry) => {
        const path = `${directory}/${entry}`;
        return statSync(join(ROOT, path)).isDirectory() ? listFiles(path) : [path];
    });
}
