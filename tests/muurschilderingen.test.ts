import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muralNumbers, muralNumbersQuery } from '../server/muurschilderingen.ts';
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
