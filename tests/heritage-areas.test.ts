import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWkt, rdToWgs84, routeMatchesGeometry, heritageQuery } from '../server/heritage-areas.ts';

test('parseWkt: parses a point', () => {
  assert.deepEqual(parseWkt('POINT (5.1 52.3)'), { kind: 'point', point: [5.1, 52.3] });
});

test('parseWkt: parses a linestring as a single path', () => {
  const geom = parseWkt('LINESTRING (5.1 52.3, 5.2 52.4)');
  assert.deepEqual(geom, { kind: 'line', paths: [[[5.1, 52.3], [5.2, 52.4]]] });
});

test('parseWkt: parses a multilinestring as multiple paths', () => {
  const geom = parseWkt('MULTILINESTRING ((5.0 52.0, 5.1 52.1), (6.0 53.0, 6.1 53.1))');
  assert.deepEqual(geom, { kind: 'line', paths: [[[5.0, 52.0], [5.1, 52.1]], [[6.0, 53.0], [6.1, 53.1]]] });
});

test('parseWkt: parses a polygon as a single ring', () => {
  const geom = parseWkt('POLYGON ((5.0 52.0, 5.1 52.0, 5.1 52.1, 5.0 52.0))');
  assert.deepEqual(geom, { kind: 'polygon', rings: [[[5.0, 52.0], [5.1, 52.0], [5.1, 52.1], [5.0, 52.0]]] });
});

test('parseWkt: flattens a multipolygon into one ring list', () => {
  const geom = parseWkt('MULTIPOLYGON (((5.0 52.0, 5.1 52.0, 5.1 52.1, 5.0 52.0)), ((6.0 53.0, 6.1 53.0, 6.1 53.1, 6.0 53.0)))');
  assert.equal(geom?.kind, 'polygon');
  assert.equal((geom as { rings: unknown[] }).rings.length, 2);
});

test('parseWkt: is case-insensitive and tolerates missing space before the parenthesis', () => {
  assert.deepEqual(parseWkt('Point(5.1 52.3)'), { kind: 'point', point: [5.1, 52.3] });
});

test('parseWkt: returns null for unrecognized text', () => {
  assert.equal(parseWkt('not wkt'), null);
});

test('rdToWgs84: the RD origin (Amersfoort) matches the published reference coordinate', () => {
  const [lon, lat] = rdToWgs84([155000, 463000]);
  assert.ok(Math.abs(lon - 5.387638889) < 1e-6);
  assert.ok(Math.abs(lat - 52.156160556) < 1e-6);
});

test('rdToWgs84: a point far from the origin still lands within a meter of the reference conversion', () => {
  // Referentiewaarde onafhankelijk opgehaald via een gezaghebbende RD->WGS84-conversie.
  const [lon, lat] = rdToWgs84([31585.6, 370966.9]);
  assert.ok(Math.abs(lon - 3.617077967515087) < 1e-8);
  assert.ok(Math.abs(lat - 51.31536818099526) < 1e-8);
});

test('routeMatchesGeometry: detects a route crossing a polygon', () => {
  const route: [number, number][] = [[4.9, 51.9], [5.05, 52.05], [5.2, 52.2]];
  const polygon = { kind: 'polygon' as const, rings: [[[5.0, 52.0], [5.1, 52.0], [5.1, 52.1], [5.0, 52.1], [5.0, 52.0]] as [number, number][]] };
  assert.equal(routeMatchesGeometry(route, polygon, [4.9, 51.9, 5.2, 52.2]), true);
});

test('routeMatchesGeometry: a distant polygon does not match', () => {
  const route: [number, number][] = [[4.9, 51.9], [5.05, 52.05], [5.2, 52.2]];
  const polygon = { kind: 'polygon' as const, rings: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50.1], [10, 50]] as [number, number][]] };
  assert.equal(routeMatchesGeometry(route, polygon, [4.9, 51.9, 5.2, 52.2]), false);
});

test('routeMatchesGeometry: a route entirely inside a polygon still matches', () => {
  const route: [number, number][] = [[5.02, 52.02], [5.03, 52.03]];
  const polygon = { kind: 'polygon' as const, rings: [[[5.0, 52.0], [5.1, 52.0], [5.1, 52.1], [5.0, 52.1], [5.0, 52.0]] as [number, number][]] };
  assert.equal(routeMatchesGeometry(route, polygon, [5.0, 52.0, 5.1, 52.1]), true);
});

test('routeMatchesGeometry: a point within the threshold distance matches', () => {
  const route: [number, number][] = [[5.0, 52.0], [5.01, 52.0]];
  const point = { kind: 'point' as const, point: [5.0005, 52.0] as [number, number] };
  assert.equal(routeMatchesGeometry(route, point, [5.0, 52.0, 5.01, 52.0]), true);
});

test('routeMatchesGeometry: a point well beyond the threshold distance does not match', () => {
  const route: [number, number][] = [[5.0, 52.0], [5.01, 52.0]];
  const point = { kind: 'point' as const, point: [6.0, 52.0] as [number, number] };
  assert.equal(routeMatchesGeometry(route, point, [5.0, 52.0, 5.01, 52.0]), false);
});

test('routeMatchesGeometry: detects a route crossing a line', () => {
  const route: [number, number][] = [[5.0, 52.0], [5.1, 52.1]];
  const line = { kind: 'line' as const, paths: [[[5.0, 52.1], [5.1, 52.0]] as [number, number][]] };
  assert.equal(routeMatchesGeometry(route, line, [5.0, 52.0, 5.1, 52.1]), true);
});

test('heritageQuery: unions gezicht, werelderfgoed and linie, and excludes withdrawn gezichten', () => {
  const query = heritageQuery([5.0, 52.0, 5.2, 52.2]);
  assert.ok(query.includes('ceo:Gezicht'));
  assert.ok(query.includes('ceo:Werelderfgoed'));
  assert.ok(query.includes('ceox:Linies'));
  assert.ok(query.includes('intrekkingsdatumGezicht'));
  assert.ok(query.includes('asWKT-RD'));
});

test('heritageQuery: filters gezicht/werelderfgoed on a padded route bounding box, but not linies', () => {
  const query = heritageQuery([5.0, 52.0, 5.2, 52.2], 10000);
  const matches = [...query.matchAll(/FILTER\(\?firstLon > ([\d.]+) && \?firstLon < ([\d.]+) && \?firstLat > ([\d.]+) && \?firstLat < ([\d.]+)\)/g)];
  assert.equal(matches.length, 2);
  const [minLon, maxLon, minLat, maxLat] = matches[0].slice(1).map(Number);
  assert.ok(minLon < 5.0 && maxLon > 5.2, 'the box should be padded outward from the route bbox');
  assert.ok(minLat < 52.0 && maxLat > 52.2);
});

test('heritageQuery: caps werelderfgoed WKT length to skip country-scale geometries', () => {
  const query = heritageQuery([5.0, 52.0, 5.2, 52.2]);
  assert.match(query, /STRLEN\(STR\(\?wkt\)\) < 50000/);
});
