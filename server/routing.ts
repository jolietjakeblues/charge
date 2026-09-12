export type Point = { lat: number; lon: number };
export type Monument = Point & { uri: string; number: string; name: string; function: string };
export type Mode = 'foot' | 'bike';
export const themes = ['all', 'religious', 'industrial', 'defence', 'archaeology', 'castles', 'government', 'cemeteries', 'warehouses', 'culture'] as const;
export type Theme = typeof themes[number];
export function distance(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)));
}
export function validPoint(p: Point): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= 50.7 && p.lat <= 53.7 && p.lon >= 3.2 && p.lon <= 7.3;
}
export function targetDistance(mode: Mode, budget: string, amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Kies een geldige afstand of tijd.');
  if (budget === 'time') {
    if (amount < 30 || amount > 240) throw new Error('Kies 30 tot 240 minuten.');
    return amount / 60 * (mode === 'foot' ? 4500 : 15000);
  }
  if (budget !== 'distance' || amount < 2 || amount > (mode === 'foot' ? 15 : 60)) throw new Error('Kies een afstand binnen het bereik.');
  return amount * 1000;
}
export function selectStops(start: Point, candidates: Monument[], target: number, phase = 0): Monument[] {
  const radius = target / 9;
  const count = Math.min(6, candidates.length);
  const chosen: Monument[] = [];
  for (let i=0; i<count; i++) {
    const angle = phase + i * Math.PI*2/count;
    const goal = { lat:start.lat+Math.sin(angle)*radius/111320, lon:start.lon+Math.cos(angle)*radius/(111320*Math.cos(start.lat*Math.PI/180)) };
    let best: Monument | undefined;
    let score = Infinity;
    for (const m of candidates) {
      if (distance(start,m)<65 || chosen.some(p=>p.number===m.number || distance(p,m)<75)) continue;
      const next = distance(m,goal) + (m.name ? 0 : radius*.08);
      if (next < score) { best=m; score=next; }
    }
    if (best) chosen.push(best);
  }
  return chosen;
}
export function routeTitle(m: Monument): string { return m.name || `${m.function || 'Rijksmonument'} ${m.number}`; }
