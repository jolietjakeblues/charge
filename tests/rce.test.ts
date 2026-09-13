import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearbyQuery } from '../server/rce.ts';

const amersfoort = { lat: 52.1561, lon: 5.3878 };

test('nearbyQuery: "all" has neither a monument-aard nor a keyword function filter', () => {
  const query = nearbyQuery(amersfoort, 2000, 'all');
  assert.ok(!query.includes('heeftMonumentAard'));
  assert.ok(!query.includes('FILTER EXISTS'));
});

test('nearbyQuery: "archaeology" filters on monument aard, not a keyword regex', () => {
  const query = nearbyQuery(amersfoort, 2000, 'archaeology');
  assert.ok(query.includes('heeftMonumentAard'));
  assert.ok(!query.includes('FILTER EXISTS'));
});

test('nearbyQuery: keyword themes filter on the expected regex pattern', () => {
  const cases: [string, string][] = [
    ['religious', 'kerk'],
    ['industrial', 'molen'],
    ['defence', 'vesting'],
    ['castles', 'kasteel'],
    ['government', 'stadhuis'],
    ['cemeteries', 'begraafplaats'],
    ['warehouses', 'pakhuis'],
    ['culture', 'museum'],
  ];
  for (const [theme, keyword] of cases) {
    const query = nearbyQuery(amersfoort, 2000, theme as Parameters<typeof nearbyQuery>[2]);
    assert.ok(query.includes('FILTER EXISTS'), `${theme} should filter with FILTER EXISTS`);
    assert.ok(query.includes(keyword), `${theme} should mention "${keyword}"`);
    assert.ok(!query.includes('heeftMonumentAard'), `${theme} should not use the archaeology monument-aard filter`);
  }
});

test('nearbyQuery: "greenery" filters on graph membership, not a keyword regex or monument aard', () => {
  const query = nearbyQuery(amersfoort, 2000, 'greenery');
  assert.ok(query.includes('graph/groenaanleg'));
  assert.ok(query.includes('FILTER EXISTS'));
  assert.ok(!query.includes('heeftMonumentAard'));
  assert.ok(!query.includes('themeLabel'));
});

test('nearbyQuery: bounding box widens with a larger radius', () => {
  const narrow = nearbyQuery(amersfoort, 1000, 'all');
  const wide = nearbyQuery(amersfoort, 10000, 'all');
  assert.ok(wide.length !== narrow.length || wide !== narrow);
  const deltaOf = (q: string) => Number(q.match(/\?lat > ([\d.]+)/)?.[1]);
  assert.ok(deltaOf(wide) < deltaOf(narrow), 'a larger radius should push the lower lat bound further out');
});
