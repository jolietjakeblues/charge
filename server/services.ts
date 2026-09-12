import type { Point, Mode } from './routing.ts';
export class HttpError extends Error { constructor(public status: number, message: string) {super(message);} }
export async function boundedJson(response: Response, limit=2500000): Promise<unknown> {
  if(!response.ok) throw new HttpError(502,'Een gegevensdienst is tijdelijk niet beschikbaar. Probeer het later opnieuw.');
  if(!response.body) throw new HttpError(502,'De gegevensdienst gaf een leeg antwoord.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new HttpError(502,'Het antwoord van de gegevensdienst is te groot. Kies een kleiner gebied.');chunks.push(value);} }
  finally {await reader.cancel();reader.releaseLock();}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
function record(v: unknown): Record<string,unknown> {if(!v||typeof v!=='object')throw new HttpError(502,'Onverwacht antwoord van de gegevensdienst.');return v as Record<string,unknown>;}
export async function geocode(q: string) {
  if(q.length<2 || q.length>150) throw new HttpError(400,'Vul een plaats of adres in.');
  const url=new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
  url.searchParams.set('q',q);url.searchParams.set('rows','5');url.searchParams.set('fq','type:(woonplaats OR adres OR weg)');
  const data=record(await boundedJson(await fetch(url,{signal:AbortSignal.timeout(15000)})));
  const docs=record(data.response).docs;
  if(!Array.isArray(docs)) throw new HttpError(502,'Plaatsen zoeken is tijdelijk niet beschikbaar.');
  return docs.flatMap(d=>{const r=record(d);const match=typeof r.centroide_ll==='string'?r.centroide_ll.match(/POINT\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/i):null;return match&&typeof r.weergavenaam==='string'?[{name:r.weergavenaam,lon:Number(match[1]),lat:Number(match[2])}]:[];});
}
export type RoadRoute = {distance:number;duration:number;geometry:{type:'LineString';coordinates:number[][]};snapDistances:number[]};
export async function roadRoute(base: string, mode: Mode, points: Point[]): Promise<RoadRoute> {
  const coords=points.map(p=>`${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url=`${base}/routed-${mode}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  const d=record(await boundedJson(await fetch(url,{headers:{'User-Agent':'CHARGE/0.1 (heritage walking and cycling prototype)'},signal:AbortSignal.timeout(20000)})));
  if(d.code!=='Ok'||!Array.isArray(d.routes)||!d.routes.length)throw new HttpError(422,'Geen begaanbare route gevonden. Probeer een ander vertrekpunt of thema.');
  const r=record(d.routes[0]);const geometry=record(r.geometry);
  if(typeof r.distance!=='number'||typeof r.duration!=='number'||geometry.type!=='LineString'||!Array.isArray(geometry.coordinates))throw new HttpError(502,'De routegegevens zijn onvolledig.');
  const coordinates=geometry.coordinates.map(p=>{if(!Array.isArray(p)||p.length<2||typeof p[0]!=='number'||typeof p[1]!=='number')throw new HttpError(502,'Ongeldige routecoördinaten.');return [p[0],p[1]];});
  const snapDistances=Array.isArray(d.waypoints)?d.waypoints.map(w=>{const distance=record(w).distance;return typeof distance==='number'?distance:Infinity;}):[];
  return {distance:r.distance,duration:r.duration,geometry:{type:'LineString',coordinates},snapDistances};
}
const amenityGroups: Record<string,string[]> = {cafe:['cafe','bar','pub'],parking:['parking'],toilets:['toilets']};
export async function pois(base: string, center: Point, radius: number, kinds: string[]) {
  if(kinds.length===0 || kinds.some(k=>!(k in amenityGroups)))throw new HttpError(400,'Kies een geldige kaartlaag.');
  const kindByAmenity=Object.fromEntries(kinds.flatMap(k=>amenityGroups[k].map(a=>[a,k])));
  const amenities=kinds.flatMap(k=>amenityGroups[k]);
  const query=`[out:json][timeout:15];nwr(around:${Math.round(radius)},${center.lat},${center.lon})[amenity~"^(${amenities.join('|')})$"];out center 250;`;
  const d=record(await boundedJson(await fetch(base,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'CHARGE/0.1 (heritage walking and cycling prototype)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(20000)})));
  if(!Array.isArray(d.elements))throw new HttpError(502,'Voorzieningen zijn tijdelijk niet beschikbaar.');
  return d.elements.flatMap(e=>{
    const r=record(e);const c=r.center?record(r.center):r;const tags=record(r.tags||{});
    const kind=kindByAmenity[typeof tags.amenity==='string'?tags.amenity:''];
    const access=typeof tags.access==='string'?tags.access:'';
    if(!kind || access==='private' || access==='no')return [];
    return typeof c.lat==='number'&&typeof c.lon==='number'?[{lat:c.lat,lon:c.lon,kind,name:typeof tags.name==='string'?tags.name:'',openingHours:typeof tags.opening_hours==='string'?tags.opening_hours:''}]:[];
  });
}
