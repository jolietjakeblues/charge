import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { distance, type Point, type Monument, type Theme } from './routing.ts';

const prefix = `PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>`;
const graph = 'https://linkeddata.cultureelerfgoed.nl/graph/instanties-rce';
type Row = Record<string, {value:string}>;
function isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v==='object'; }
export function parseBindings(data: unknown): Row[] {
  if (!isRecord(data) || !isRecord(data.results) || !Array.isArray(data.results.bindings)) throw new Error('Onverwacht antwoord van de erfgoedbron.');
  return data.results.bindings.map((r:unknown)=> {
    if (!isRecord(r)) throw new Error('Ongeldig erfgoedrecord.');
    const row: Row={};
    for(const [k,v] of Object.entries(r)) if(isRecord(v) && typeof v.value==='string') row[k]={value:v.value};
    return row;
  });
}
export async function queryRce(url: string, query: string): Promise<Row[]> {
  const client = new Client({name:'CHARGE',version:'0.1.0'});
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport, {timeout:20000});
    const result = await client.callTool({name:'query_sparql_json', arguments:{sparql_query:query}}, undefined, {timeout:55000});
    if(result.isError) throw new Error('De erfgoedbron kon deze vraag niet verwerken. Probeer opnieuw.');
    const structured = result.structuredContent;
    if(isRecord(structured) && 'results' in structured) return parseBindings(structured);
    if(isRecord(structured) && typeof structured.result==='string') return parseBindings(JSON.parse(structured.result));
    const content=Array.isArray(result.content) ? result.content.find((c:unknown)=>isRecord(c) && c.type==='text') : undefined;
    if(!isRecord(content) || typeof content.text!=='string') throw new Error('De erfgoedbron gaf geen gegevens terug.');
    return parseBindings(JSON.parse(content.text));
  } finally { await client.close().catch(()=>{}); }
}
const themePatterns = {
  religious:'kerk|kapel|klooster|synagoge|moskee|abdij|bedehuis',
  industrial:'molen|fabriek|industrie|gemaal|werkplaats|watertoren',
  defence:'fort|vesting|poort|kazerne|bunker|kazemat|verdediging'
};
export function nearbyQuery(center: Point, radius: number, theme: Theme): string {
  const latDelta=radius/111000, lonDelta=radius/(111000*Math.cos(center.lat*Math.PI/180));
  const typeFilter=theme==='archaeology' ? `?uri ceo:heeftMonumentAard <https://data.cultureelerfgoed.nl/term/id/rn/2/b673c8c1-5d93-496d-8f9e-89133d579d77>.` : '';
  const functionFilter=theme in themePatterns ? `FILTER EXISTS {
    ?uri (ceo:heeftOorspronkelijkeFunctie/ceo:heeftFunctieNaam|ceo:heeftHuidigeFunctie/ceo:heeftFunctieNaam|ceo:heeftType/ceo:heeftTypeNaam) ?concept.
    ?concept skos:prefLabel ?themeLabel.
    FILTER(REGEX(STR(?themeLabel),"${themePatterns[theme as keyof typeof themePatterns]}","i"))
  }` : '';
  return `${prefix}
SELECT ?uri ?number ?lat ?lon (MIN(STR(?n)) AS ?name) (MIN(STR(?f)) AS ?function) WHERE {
 { SELECT DISTINCT ?uri ?number ?lat ?lon WHERE {
   GRAPH <${graph}> {
    ?uri ceo:rijksmonumentnummer ?number;
      ceo:heeftJuridischeStatus <https://data.cultureelerfgoed.nl/term/id/rn/2/b2d9a59a-fe1e-4552-9a05-3c2acddff864>;
      ceo:heeftGeometrie ?geometry.
    ${typeFilter}
    ?geometry geo:asWKT ?wkt.
    FILTER(REGEX(STR(?wkt),"^POINT","i"))
    BIND(STRAFTER(STR(?wkt),"(") AS ?xy)
    BIND(xsd:double(STRBEFORE(?xy," ")) AS ?lon)
    BIND(xsd:double(STRBEFORE(STRAFTER(?xy," "),")")) AS ?lat)
    FILTER(?lat > ${center.lat-latDelta} && ?lat < ${center.lat+latDelta} && ?lon > ${center.lon-lonDelta} && ?lon < ${center.lon+lonDelta})
   }
   ${functionFilter}
 } ORDER BY ?number LIMIT 600 }
 OPTIONAL { { ?uri ceo:heeftNaam/ceo:naam ?n. } UNION { ?uri ceo:heeftOorspronkelijkeFunctie/ceo:heeftFunctieNaam/skos:prefLabel ?f. } }
} GROUP BY ?uri ?number ?lat ?lon`;
}
export async function nearby(url: string, center: Point, radius: number, theme: Theme) {
  const rows=await queryRce(url, nearbyQuery(center,radius,theme));
  const seen=new Set<string>();
  const monuments: Monument[]=[];
  for(const r of rows){
    const m={uri:r.uri?.value??'',number:r.number?.value??'',lat:Number(r.lat?.value),lon:Number(r.lon?.value),name:r.name?.value??'',function:r.function?.value??''};
    if(!m.number || !Number.isFinite(m.lat) || !Number.isFinite(m.lon) || seen.has(m.number) || distance(center,m)>radius) continue;
    seen.add(m.number);monuments.push(m);
  }
  return {monuments,truncated:rows.length>=600};
}
export async function detail(url: string, number: string) {
  if(!/^\d{1,8}$/.test(number)) throw new Error('Ongeldig monumentnummer.');
  const rows=await queryRce(url, `${prefix}
SELECT DISTINCT ?description WHERE {
 GRAPH <${graph}> { ?uri ceo:rijksmonumentnummer "${number}"; ceo:heeftOmschrijving ?descriptionNode. }
 ?descriptionNode ceo:omschrijving ?description.
} LIMIT 8`);
  return {number,descriptions:[...new Set(rows.map(r=>r.description?.value).filter(Boolean))],source:`https://monumentenregister.cultureelerfgoed.nl/monumenten/${number}`};
}
