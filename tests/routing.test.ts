import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, validPoint, targetDistance, selectStops, routeTitle, type Monument } from '../server/routing.ts';

const amersfoort = { lat: 52.1561, lon: 5.3878 };

test('distance: zero between identical points', () => {
  assert.equal(distance(amersfoort, amersfoort), 0);
});

test('distance: Amersfoort to Utrecht is roughly 19km', () => {
  const utrecht = { lat: 52.0907, lon: 5.1214 };
  const meters = distance(amersfoort, utrecht);
  assert.ok(meters > 18000 && meters < 21000, `expected ~19km, got ${meters}`);
});

test('validPoint: accepts points inside continental NL', () => {
  assert.equal(validPoint(amersfoort), true);
});

test('validPoint: rejects points outside NL bounds', () => {
  assert.equal(validPoint({ lat: 48, lon: 5.3878 }), false);
  assert.equal(validPoint({ lat: 52.1561, lon: 20 }), false);
});

test('validPoint: rejects non-finite coordinates', () => {
  assert.equal(validPoint({ lat: NaN, lon: 5.3878 }), false);
});

test('targetDistance: distance budget converts km to meters', () => {
  assert.equal(targetDistance('foot', 'distance', 5), 5000);
});

test('targetDistance: time budget converts minutes to meters using mode speed', () => {
  assert.equal(targetDistance('foot', 'time', 60), 4500);
  assert.equal(targetDistance('bike', 'time', 60), 15000);
});

test('targetDistance: rejects out-of-range distance for the chosen mode', () => {
  assert.throws(() => targetDistance('foot', 'distance', 20));
  assert.throws(() => targetDistance('bike', 'distance', 1));
});

test('targetDistance: rejects out-of-range time', () => {
  assert.throws(() => targetDistance('foot', 'time', 15));
  assert.throws(() => targetDistance('foot', 'time', 300));
});

test('targetDistance: rejects a non-finite amount', () => {
  assert.throws(() => targetDistance('foot', 'distance', NaN));
});

function monument(number: string, lat: number, lon: number, name = ''): Monument {
  return { uri: `urn:test:${number}`, number, lat, lon, name, function: '' };
}

test('selectStops: never includes a monument right on the start point', () => {
  const candidates = [monument('1', amersfoort.lat, amersfoort.lon), monument('2', 52.16, 5.4)];
  const stops = selectStops(amersfoort, candidates, 3000);
  assert.ok(stops.every(s => s.number !== '1'));
});

test('selectStops: never picks the same monument twice', () => {
  const candidates = Array.from({ length: 6 }, (_, i) => monument(String(i), amersfoort.lat + i * 0.002, amersfoort.lon + i * 0.002));
  const stops = selectStops(amersfoort, candidates, 3000);
  assert.equal(new Set(stops.map(s => s.number)).size, stops.length);
});

test('selectStops: returns nothing when there are no candidates', () => {
  assert.deepEqual(selectStops(amersfoort, [], 3000), []);
});

test('routeTitle: prefers the monument name over its function and number', () => {
  assert.equal(routeTitle(monument('123', 0, 0, 'Zwarte Paard')), 'Zwarte Paard');
});

test('routeTitle: falls back to function and number when there is no name', () => {
  const m = monument('123', 0, 0);
  m.function = 'Kerk';
  assert.equal(routeTitle(m), 'Kerk 123');
});

test('routeTitle: falls back to a generic label when there is neither name nor function', () => {
  assert.equal(routeTitle(monument('123', 0, 0)), 'Rijksmonument 123');
});
