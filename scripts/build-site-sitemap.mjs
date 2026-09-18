#!/usr/bin/env node
/**
 * Emits one sitemap for the whole published site, at the root of it.
 *
 * VitePress writes a sitemap for the guide, and it lands a directory down at
 * `/fathom/guide/sitemap.xml`. Two things are wrong with leaving it there as
 * the only one. A sitemap speaks for the directory it sits in and no higher,
 * so that file cannot name the chart at `/fathom/` — the page the whole site
 * is about is in no sitemap at all. And a submission of it is a submission of
 * a path below the verified prefix, which is the entry Search Console has
 * refused to read twice.
 *
 * So the guide's own list is read back and rewritten a level up, with the
 * chart added to the front. The guide's copy stays where it is: it costs
 * nothing and an address already handed to a crawler should keep answering.
 *
 * Run by `npm run build:sitemap`, after both builds have been moved into
 * place — it reads what they wrote rather than the sources they read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED = join(ROOT, 'dist', 'demo');

/** The chart, which is the site's front page and nothing else's descendant. */
const HOME = 'https://giovani-freitag.github.io/fathom/';

const guide = readFileSync(join(PUBLISHED, 'guide', 'sitemap.xml'), 'utf8');

/*
 * After the opening tag rather than by rebuilding the document: the namespaces
 * VitePress declares carry the `xhtml:link` alternates on the pages written in
 * both languages, and reassembling the file by hand is how those get dropped.
 */
const opening = /<urlset[^>]*>/.exec(guide);
if (!opening) throw new Error('The guide sitemap has no <urlset>: nothing to extend.');

const at = opening.index + opening[0].length;
const whole = `${guide.slice(0, at)}<url><loc>${HOME}</loc></url>${guide.slice(at)}`;

writeFileSync(join(PUBLISHED, 'sitemap.xml'), whole);

const urls = whole.match(/<loc>/g)?.length ?? 0;
console.log(`sitemap.xml written at the site root: ${urls} URLs.`);
