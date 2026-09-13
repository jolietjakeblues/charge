import { HttpError } from './services.ts';

const endpoint = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/Muurschilderingen/sparql';

export function muralNumbersQuery(): string {
  return `PREFIX gtm: <https://www.goudatijdmachine.nl/def#>
PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
SELECT DISTINCT ?nummer WHERE {
  GRAPH ?g { ?s a gtm:Gebouw; ceo:rijksmonumentnummer ?nummer. }
}`;
}
function isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object'; }
async function fetchMuralNumbers(): Promise<string[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query: muralNumbersQuery() }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(502, 'De muurschilderingendatabase is tijdelijk niet beschikbaar.');
  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.results) || !Array.isArray(data.results.bindings)) throw new HttpError(502, 'Onverwacht antwoord van de muurschilderingendatabase.');
  const numbers = data.results.bindings.flatMap((b: unknown) => {
    const nummer = isRecord(b) ? b.nummer : undefined;
    return isRecord(nummer) && typeof nummer.value === 'string' ? [nummer.value] : [];
  });
  return [...new Set(numbers)];
}
const numbersCacheKey = 'https://charge.internal/cache/muurschilderingen-nummers';
// Losse SPARQL-endpoint (RCE Muurschilderingendatabase), niet via de RCE-CHO-MCP-wrapper.
// De volledige nummerlijst verandert nauwelijks maar wordt sinds de "highlight achteraf"-aanpak
// bij élke gegenereerde route opgevraagd (niet meer alleen bij een aparte thema-keuze) — een
// dagcache via Cloudflare's Cache API scheelt latency en belasting op een dienst die niet van
// ons is. `caches` bestaat niet in de Node-testomgeving, dus daar valt dit terug op een verse fetch.
export async function muralNumbers(ctx?: ExecutionContext): Promise<string[]> {
  if (typeof caches === 'undefined') return fetchMuralNumbers();
  const cache = caches.default;
  const request = new Request(numbersCacheKey);
  const cached = await cache.match(request);
  if (cached) return await cached.json();
  const numbers = await fetchMuralNumbers();
  const response = new Response(JSON.stringify(numbers), { headers: { 'Cache-Control': 'max-age=86400', 'Content-Type': 'application/json' } });
  const store = cache.put(request, response);
  if (ctx) ctx.waitUntil(store); else await store;
  return numbers;
}
export type MuralPainting = { title: string; creator?: string; period?: string; genre?: string; description?: string; image?: string };
export type MuralInfo = { explorerUrl: string; paintings: MuralPainting[] };
export function muralDetailQuery(number: string): string {
  return `PREFIX gtm: <https://www.goudatijdmachine.nl/def#>
PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX schema: <https://schema.org/>
PREFIX o: <http://omeka.org/s/vocabs/o#>
SELECT ?gebouwId ?title ?description ?temporal ?genre ?creatorLiteral ?creatorName ?mediaId WHERE {
  ?gebouw a gtm:Gebouw; ceo:rijksmonumentnummer "${number}"; o:id ?gebouwId.
  ?painting a schema:Painting; schema:location ?gebouw.
  OPTIONAL { ?painting dc:title ?title. }
  OPTIONAL { ?painting dc:description ?description. }
  OPTIONAL { ?painting schema:temporal ?temporal. }
  OPTIONAL { ?painting schema:genre ?genre. }
  OPTIONAL { ?painting dc:creator ?creatorLiteral. }
  OPTIONAL { ?painting dc:creator/dc:title ?creatorName. }
  OPTIONAL { ?painting o:primary_media/o:id ?mediaId. }
} LIMIT 8`;
}
// Alleen o:id van de media staat in de SPARQL-graph; de eigenlijke afbeelding-URL zit in Omeka's
// eigen (publieke, niet-SPARQL) media-API en vraagt dus een losse plain-HTTP-call per schildering.
async function mediaImage(mediaId: string): Promise<string|undefined> {
  try {
    const res = await fetch(`https://muurschilderingendatabase.nl/api/media/${mediaId}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    const urls = isRecord(data) ? data.thumbnail_display_urls : undefined;
    return isRecord(urls) && typeof urls.medium === 'string' ? urls.medium : undefined;
  } catch { return undefined; }
}
export async function muralDetails(number: string): Promise<MuralInfo|null> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query: muralDetailQuery(number) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(502, 'De muurschilderingendatabase is tijdelijk niet beschikbaar.');
  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.results) || !Array.isArray(data.results.bindings)) throw new HttpError(502, 'Onverwacht antwoord van de muurschilderingendatabase.');
  const rows = data.results.bindings.filter(isRecord);
  if (!rows.length) return null;
  const text = (row: Record<string, unknown>, key: string, literalOnly=false) => {
    const v = row[key];
    if (!isRecord(v) || typeof v.value !== 'string') return undefined;
    if (literalOnly && v.type !== 'literal') return undefined;
    return v.value;
  };
  const gebouwId = rows.map(r=>text(r,'gebouwId')).find(Boolean);
  if (!gebouwId) return null;
  const paintings = await Promise.all(rows.map(async r=>{
    const mediaId=text(r,'mediaId');
    return {
      title: text(r,'title') || 'Muurschildering',
      creator: text(r,'creatorName') || text(r,'creatorLiteral',true),
      period: text(r,'temporal'),
      genre: text(r,'genre'),
      description: text(r,'description'),
      image: mediaId ? await mediaImage(mediaId) : undefined,
    };
  }));
  return { explorerUrl: `https://muurschilderingendatabase.nl/s/muurschilderingen/item/${gebouwId}`, paintings };
}
