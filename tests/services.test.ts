import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pois } from '../server/services.ts';
import { HttpError } from '../server/services.ts';

const center = { lat: 52.1561, lon: 5.3878 };

function fakeOverpass(elements: unknown[]) {
  return async (_url: string, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ elements }), { status: 200 });
  };
}

async function withFetch<T>(fetchImpl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('pois: rejects a kind outside the known amenity groups', async () => {
  await assert.rejects(() => pois('https://overpass.example', center, 500, ['restaurant']), HttpError);
});

test('pois: expands "cafe" to also query bar and pub amenities', async () => {
  let sentQuery = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentQuery = String(new URLSearchParams(init?.body as string).get('data'));
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  }) as typeof fetch;
  await withFetch(fetchImpl, () => pois('https://overpass.example', center, 500, ['cafe']));
  assert.match(sentQuery, /amenity~"\^\(cafe\|bar\|pub\)\$"/);
});

test('pois: maps a bar/pub result back to the "cafe" kind the caller asked for', async () => {
  const elements = [
    { lat: 52.1, lon: 5.3, tags: { amenity: 'bar', name: 'De Kroeg' } },
    { lat: 52.1, lon: 5.3, tags: { amenity: 'pub', name: 'Het Vat' } },
  ];
  const result = await withFetch(fakeOverpass(elements), () => pois('https://overpass.example', center, 500, ['cafe']));
  assert.deepEqual(result.map(p => p.kind), ['cafe', 'cafe']);
});

test('pois: drops results with access=private or access=no', async () => {
  const elements = [
    { lat: 52.1, lon: 5.3, tags: { amenity: 'toilets', access: 'private' } },
    { lat: 52.1, lon: 5.3, tags: { amenity: 'parking', access: 'no' } },
    { lat: 52.1, lon: 5.3, tags: { amenity: 'toilets' } },
  ];
  const result = await withFetch(fakeOverpass(elements), () => pois('https://overpass.example', center, 500, ['toilets', 'parking']));
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'toilets');
});

test('pois: drops elements whose amenity was not part of the request', async () => {
  const elements = [{ lat: 52.1, lon: 5.3, tags: { amenity: 'restaurant' } }];
  const result = await withFetch(fakeOverpass(elements), () => pois('https://overpass.example', center, 500, ['cafe']));
  assert.equal(result.length, 0);
});

test('pois: "aed" queries the emergency tag namespace, not amenity', async () => {
  let sentQuery = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentQuery = String(new URLSearchParams(init?.body as string).get('data'));
    return new Response(JSON.stringify({ elements: [] }), { status: 200 });
  }) as typeof fetch;
  await withFetch(fetchImpl, () => pois('https://overpass.example', center, 500, ['aed']));
  assert.match(sentQuery, /emergency~"\^\(defibrillator\)\$"/);
});

test('pois: retries once after a failed Overpass request and still returns results', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) return new Response('bad gateway', { status: 502 });
    return new Response(JSON.stringify({ elements: [{ lat: 52.1, lon: 5.3, tags: { amenity: 'toilets' } }] }), { status: 200 });
  }) as typeof fetch;
  const result = await withFetch(fetchImpl, () => pois('https://overpass.example', center, 500, ['toilets']));
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
});

test('pois: gives up and surfaces an HttpError when both attempts fail', async () => {
  const fetchImpl = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;
  await assert.rejects(() => withFetch(fetchImpl, () => pois('https://overpass.example', center, 500, ['toilets'])), HttpError);
});

test('pois: combines amenity and emergency clauses when both are requested', async () => {
  const elements = [
    { lat: 52.1, lon: 5.3, tags: { amenity: 'cafe', name: 'Grand Café' } },
    { lat: 52.1, lon: 5.3, tags: { emergency: 'defibrillator' } },
  ];
  const result = await withFetch(fakeOverpass(elements), () => pois('https://overpass.example', center, 500, ['cafe', 'aed']));
  assert.deepEqual(result.map(p => p.kind).sort(), ['aed', 'cafe']);
});
