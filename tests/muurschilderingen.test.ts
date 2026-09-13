import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muralNumbers, muralNumbersQuery, muralDetails, muralDetailQuery } from '../server/muurschilderingen.ts';
import { HttpError } from '../server/services.ts';

async function withFetch<T>(fetchImpl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('muralNumbersQuery: asks for the rijksmonumentnummer of every gtm:Gebouw', () => {
  const query = muralNumbersQuery();
  assert.ok(query.includes('gtm:Gebouw'));
  assert.ok(query.includes('ceo:rijksmonumentnummer'));
});

test('muralNumbers: deduplicates numbers and drops rows without one', async () => {
  const body = { results: { bindings: [{ nummer: { value: '123' } }, { nummer: { value: '123' } }, { nummer: { value: '456' } }, {}] } };
  const fetchImpl = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  const numbers = await withFetch(fetchImpl, () => muralNumbers());
  assert.deepEqual(numbers.sort(), ['123', '456']);
});

test('muralNumbers: a failing endpoint surfaces as an HttpError', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 502 })) as typeof fetch;
  await assert.rejects(() => withFetch(fetchImpl, () => muralNumbers()), HttpError);
});

test('muralDetailQuery: filters on rijksmonumentnummer and joins Paintings by location', () => {
  const query = muralDetailQuery('30783');
  assert.ok(query.includes('ceo:rijksmonumentnummer "30783"'));
  assert.ok(query.includes('schema:Painting'));
  assert.ok(query.includes('schema:location'));
});

function muralDetailFetch(bindings: unknown[]): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes('/api/media/123')) return new Response(JSON.stringify({ thumbnail_display_urls: { medium: 'https://example.com/img.jpg' } }), { status: 200 });
    return new Response(JSON.stringify({ results: { bindings } }), { status: 200 });
  }) as typeof fetch;
}

test('muralDetails: combines Paintings for a building into an explorer link plus a painting list', async () => {
  const bindings = [
    { gebouwId: { type: 'literal', value: '10141' }, title: { type: 'literal', value: 'Engel' }, creatorName: { type: 'literal', value: 'Jan Schilder' }, temporal: { type: 'literal', value: '1400-1450' }, genre: { type: 'literal', value: 'religieus' }, description: { type: 'literal', value: 'Een engel.' }, mediaId: { type: 'literal', value: '123' } },
    { gebouwId: { type: 'literal', value: '10141' }, title: { type: 'literal', value: 'Wapenschild' } },
  ];
  const info = await withFetch(muralDetailFetch(bindings), () => muralDetails('30783'));
  assert.equal(info?.explorerUrl, 'https://muurschilderingendatabase.nl/s/muurschilderingen/item/10141');
  assert.equal(info?.paintings.length, 2);
  assert.equal(info?.paintings[0].creator, 'Jan Schilder');
  assert.equal(info?.paintings[0].image, 'https://example.com/img.jpg');
  assert.equal(info?.paintings[1].title, 'Wapenschild');
  assert.equal(info?.paintings[1].image, undefined);
});

test('muralDetails: falls back to a literal creator when there is no linked Person, but ignores an unresolved Person URI', async () => {
  const literalCreator = [{ gebouwId: { type: 'literal', value: '1' }, title: { type: 'literal', value: 'A' }, creatorLiteral: { type: 'literal', value: 'Onbekende meester' } }];
  const unresolvedCreator = [{ gebouwId: { type: 'literal', value: '1' }, title: { type: 'literal', value: 'A' }, creatorLiteral: { type: 'uri', value: 'https://muurschilderingendatabase.nl/api/items/999' } }];
  const withLiteral = await withFetch(muralDetailFetch(literalCreator), () => muralDetails('1'));
  const withUnresolved = await withFetch(muralDetailFetch(unresolvedCreator), () => muralDetails('1'));
  assert.equal(withLiteral?.paintings[0].creator, 'Onbekende meester');
  assert.equal(withUnresolved?.paintings[0].creator, undefined);
});

test('muralDetails: no matching bindings means no known building, so returns null', async () => {
  const info = await withFetch(muralDetailFetch([]), () => muralDetails('999999'));
  assert.equal(info, null);
});

test('muralDetails: a failing endpoint surfaces as an HttpError', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 502 })) as typeof fetch;
  await assert.rejects(() => withFetch(fetchImpl, () => muralDetails('30783')), HttpError);
});
