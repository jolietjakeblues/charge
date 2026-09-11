import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const assetDir = new URL('./assets/', root);
const names = await readdir(assetDir);
const cssName = names.find(name => name.endsWith('.css'));
if (!cssName) throw new Error('Vite CSS asset not found');
const indexUrl = new URL('./index.html', root);
const [html, css] = await Promise.all([readFile(indexUrl, 'utf8'), readFile(new URL(`./assets/${cssName}`, root), 'utf8')]);
const escapedName = cssName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const link = new RegExp(`<link rel="stylesheet"[^>]*href="/assets/${escapedName}"[^>]*>`, 'i');
if (!link.test(html)) throw new Error(`CSS link ${cssName} not found in index.html`);
await writeFile(indexUrl, html.replace(link, `<style data-charge-styles>${css}</style>`), 'utf8');
console.log(`Inlined ${cssName} into dist/index.html`);
