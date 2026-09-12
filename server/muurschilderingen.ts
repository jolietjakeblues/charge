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
// Losse SPARQL-endpoint (RCE Muurschilderingendatabase), niet via de RCE-CHO-MCP-wrapper.
export async function muralNumbers(): Promise<string[]> {
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
