import { queryRce, prefix, graph } from './rce.ts';
import { distance, type Point } from './routing.ts';

export type LonLat = [number, number];
type Ring = LonLat[];
type Geom = { kind: 'point'; point: LonLat } | { kind: 'line'; paths: LonLat[][] } | { kind: 'polygon'; polygons: Ring[][] };
export type HeritageMatch = { kind: 'gezicht' | 'werelderfgoed' | 'linie'; name: string };
type Bbox = [number, number, number, number];

function numberPair(text: string): LonLat { const [lon, lat] = text.trim().split(/\s+/).map(Number); return [lon, lat]; }
function parseGroup(s: string, i: number): [unknown[], number] {
  i++; const items: unknown[] = [];
  while (i < s.length && s[i] !== ')') {
    if (s[i] === '(') { const [child, next] = parseGroup(s, i); items.push(child); i = next; }
    else if (s[i] === ',' || /\s/.test(s[i])) { i++; }
    else { let j = i; while (j < s.length && s[j] !== ',' && s[j] !== ')') j++; items.push(numberPair(s.slice(i, j))); i = j; }
  }
  if (s[i] !== ')') throw new Error('Onvolledige WKT-geometrie.');
  return [items, i + 1];
}
export function parseWkt(wkt: string): Geom | null {
  const match = wkt.trim().match(/^([A-Za-z]+)\s*\(/);
  if (!match || match.index === undefined) return null;
  const type = match[1].toLowerCase();
  let items: unknown[];
  try { [items] = parseGroup(wkt, wkt.indexOf('(', match.index)); } catch { return null; }
  if (type === 'point') return { kind: 'point', point: items[0] as LonLat };
  if (type === 'linestring') return { kind: 'line', paths: [items as LonLat[]] };
  if (type === 'multilinestring') return { kind: 'line', paths: items as LonLat[][] };
  // Eerste ring van een polygon is de buitenring, elke volgende ring is een gat (uitgesloten gebied).
  if (type === 'polygon') return { kind: 'polygon', polygons: [items as Ring[]] };
  if (type === 'multipolygon') return { kind: 'polygon', polygons: items as Ring[][] };
  return null;
}
// Benaderingsformule RD -> WGS84 (Schreutelkamp/Strang van Hees), coëfficiënten via regressie
// bepaald tegen een gezaghebbende RD->WGS84-conversie; op 24 controlepunten verspreid over
// Nederland (inclusief de hoeken van het RD-bereik) een afwijking van minder dan 1 mm.
export function rdToWgs84([x, y]: LonLat): LonLat {
  const dx = (x - 155000) * 1e-5, dy = (y - 463000) * 1e-5;
  const sum = (terms: [number, number, number][]) => terms.reduce((total, [p, q, k]) => total + k * dx ** p * dy ** q, 0);
  const lat = [[0, 0, 52.15616055599985], [0, 1, 0.898898101027457], [2, 0, -0.009053217249501968], [0, 2, -0.00006868927767041474], [2, 1, -0.00023614836067721335], [0, 3, 0.000015569666908227688], [2, 2, 0.000015564916520243595], [1, 0, 7.190555296534393e-7], [4, 0, 2.4577759051760676e-7], [2, 3, -1.850033293284189e-8], [4, 1, 2.4047033927414194e-14], [1, 1, -1.8111101094509513e-8]] as [number, number, number][];
  const lon = [[0, 0, 5.387638888999999], [1, 0, 1.4614730268332874], [1, 1, 0.029438340027824392], [1, 2, 0.0006826796945162162], [3, 0, -0.00022755988882058886], [1, 3, -0.000015579416707783623], [3, 1, -0.000015562972222027346], [0, 1, 7.14611110371459e-7], [3, 2, 6.17888882513691e-7], [1, 4, 1.836106825142782e-8], [0, 2, 5.083335352386133e-9], [2, 0, 1.9705041019805122e-15], [5, 0, -2.1884292075668867e-14]] as [number, number, number][];
  return [sum(lon), sum(lat)];
}
function mapGeom(geom: Geom, fn: (p: LonLat) => LonLat): Geom {
  if (geom.kind === 'point') return { kind: 'point', point: fn(geom.point) };
  if (geom.kind === 'line') return { kind: 'line', paths: geom.paths.map(path => path.map(fn)) };
  return { kind: 'polygon', polygons: geom.polygons.map(poly => poly.map(ring => ring.map(fn))) };
}
function bbox(points: LonLat[]): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY];
}
function bboxOverlap(a: Bbox, b: Bbox): boolean { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }
function orient(a: LonLat, b: LonLat, c: LonLat): number { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a: LonLat, b: LonLat, c: LonLat): boolean { return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]); }
export function segmentsIntersect(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}
export function pointInRing(p: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(p: LonLat, polygon: Ring[]): boolean {
  if (!polygon.length || !pointInRing(p, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) if (pointInRing(p, polygon[k])) return false;
  return true;
}
export function routeMatchesGeometry(route: LonLat[], geom: Geom, routeBbox: Bbox, thresholdMeters = 75): boolean {
  if (geom.kind === 'point') return route.some(p => distance({ lon: p[0], lat: p[1] } as Point, { lon: geom.point[0], lat: geom.point[1] } as Point) < thresholdMeters);
  const points = geom.kind === 'line' ? geom.paths.flat() : geom.polygons.flat(2);
  if (!points.length || !bboxOverlap(routeBbox, bbox(points))) return false;
  if (geom.kind === 'line') {
    for (let i = 0; i < route.length - 1; i++) for (const path of geom.paths) for (let j = 0; j < path.length - 1; j++) if (segmentsIntersect(route[i], route[i + 1], path[j], path[j + 1])) return true;
    return false;
  }
  if (geom.polygons.some(poly => pointInPolygon(route[0], poly))) return true;
  for (let i = 0; i < route.length - 1; i++) {
    if (geom.polygons.some(poly => pointInPolygon(route[i + 1], poly))) return true;
    for (const poly of geom.polygons) for (const ring of poly) for (let j = 0; j < ring.length - 1; j++) if (segmentsIntersect(route[i], route[i + 1], ring[j], ring[j + 1])) return true;
  }
  return false;
}
function defaultName(kind: HeritageMatch['kind']): string { return kind === 'gezicht' ? 'Beschermd stads- of dorpsgezicht' : kind === 'werelderfgoed' ? 'Werelderfgoed' : 'Historische linie'; }
// Live gemeten: alle 472 gezichten samen zijn al ~3MB aan WKT, en een handvol werelderfgoederen
// (Hollandse Waterlinies, Waddenzee, Neder-Germaanse Limes) individueel tot 2,25MB -- veel te
// veel om per route zomaar nationaal op te halen. Voorfilter daarom op een ruim opgerekte
// route-bbox met een regex op de EERSTE coördinaat in de WKT (geen echte spatial index
// beschikbaar; geof:sfWithin veroorzaakt bekend structurele timeouts op dit endpoint), en sluit
// voor werelderfgoed de enkele multi-honderdduizend-tekens-grote landschapsgeometrieën uit.
function bboxFilter(bbox: Bbox, padMeters: number): string {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const latPad = padMeters / 111320, lonPad = padMeters / (111320 * Math.cos(midLat * Math.PI / 180));
  return `BIND(xsd:double(REPLACE(STR(?wkt), "^[^0-9.-]*(-?[0-9.]+)[ ,]+(-?[0-9.]+).*$", "$1")) AS ?firstLon)
      BIND(xsd:double(REPLACE(STR(?wkt), "^[^0-9.-]*(-?[0-9.]+)[ ,]+(-?[0-9.]+).*$", "$2")) AS ?firstLat)
      FILTER(?firstLon > ${bbox[0] - lonPad} && ?firstLon < ${bbox[2] + lonPad} && ?firstLat > ${bbox[1] - latPad} && ?firstLat < ${bbox[3] + latPad})`;
}
export function heritageQuery(routeBbox: Bbox, padMeters = 12000): string {
  const areaFilter = bboxFilter(routeBbox, padMeters);
  return `${prefix}
PREFIX ceox: <https://linkeddata.cultureelerfgoed.nl/def/ceox#>
PREFIX schema: <https://schema.org/>
SELECT ?uri ?kind ?wkt ?naam WHERE {
  {
    GRAPH <${graph}> {
      ?uri a ceo:Gezicht; ceo:heeftGeometrie ?geom.
      FILTER NOT EXISTS { ?uri ceo:intrekkingsdatumGezicht ?ingetrokken }
      ?geom geo:asWKT ?wkt.
      ${areaFilter}
      OPTIONAL { ?uri ceo:heeftNaam/ceo:naam ?naam }
    }
    BIND("gezicht" AS ?kind)
  } UNION {
    GRAPH <${graph}> {
      ?uri a ceo:Werelderfgoed; ceo:heeftGeometrie ?geom.
      ?geom geo:asWKT ?wkt.
      FILTER(STRLEN(STR(?wkt)) < 50000)
      ${areaFilter}
      OPTIONAL { ?uri ceo:heeftNaam/ceo:naam ?naam }
    }
    BIND("werelderfgoed" AS ?kind)
  } UNION {
    GRAPH <https://linkeddata.cultureelerfgoed.nl/graph/linies> {
      ?uri a ceox:Linies.
      ?uri <https://linkeddata.cultureelerfgoed.nl/def/ceo#asWKT-RD> ?wkt.
      OPTIONAL { ?uri schema:name ?naam }
    }
    BIND("linie" AS ?kind)
  }
} LIMIT 500`;
}
export async function heritageMatches(url: string, route: number[][]): Promise<HeritageMatch[]> {
  const path = route.map(([lon, lat]) => [lon, lat] as LonLat);
  const routeBbox = bbox(path);
  const rows = await queryRce(url, heritageQuery(routeBbox));
  const seenUris = new Set<string>(), seenNames = new Set<string>();
  const matches: HeritageMatch[] = [];
  for (const r of rows) {
    const uri = r.uri?.value, kind = r.kind?.value as HeritageMatch['kind'] | undefined, wkt = r.wkt?.value;
    if (!uri || !kind || !wkt || seenUris.has(uri)) continue;
    seenUris.add(uri);
    let geom = parseWkt(wkt); if (!geom) continue;
    if (kind === 'linie') geom = mapGeom(geom, rdToWgs84);
    if (!routeMatchesGeometry(path, geom, routeBbox)) continue;
    const name = r.naam?.value || defaultName(kind);
    const key = `${kind}:${name}`; if (seenNames.has(key)) continue;
    seenNames.add(key); matches.push({ kind, name });
  }
  return matches;
}
