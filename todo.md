# CHARGE — todo & ideeën

## Openstaand

- **Echte help/uitleg in de app** — het huidige "Over je gegevens en deze versie"-blok is een privacyverklaring, geen gebruikshulp. Denk aan: wat de genummerde stops betekenen, waarom een route kan afwijken van je gewenste afstand, wat de kaartlagen (cafés/parkeren/toiletten) laten zien.
- **Testdekking uitbreiden naar de service-laag** — `tests/routing.test.ts` dekt de pure functies (afstand, stop-selectie, budgetvalidatie). `server/services.ts` (geocode, roadRoute, pois) en `server/index.ts` (request-validatie) zijn nog ongetest; dat vereist gemockte `fetch`-calls.
- **Overpass-betrouwbaarheid** — de publieke Overpass-instantie (overpass-api.de) is gedeeld en kan onder druk 429/504 geven. Overwegen: retry met backoff, of een eigen/betaalde Overpass-instantie voor productie.
- **Observability aanzetten** — `wrangler.jsonc` heeft `observability.enabled: false`. Handig om aan te zetten zodra de app echt gebruikt wordt, voor het opsporen van fouten in productie.
- **Dark mode handmatig doorlopen** — de `prefers-color-scheme`-variant is nooit los gecontroleerd (alleen de lichte modus is visueel getest); check radio-pills, slider, checkboxes en contrast.
- **Mobiel end-to-end testen** — geolocatie ("Gebruik mijn locatie") en "Kies op kaart" zijn alleen functioneel getest op desktop-breedte; nog niet op een echt mobiel toestel.

## Opschonen (lage prioriteit)

- Lokale branches `committ#5` en `committ#6` zijn restanten van eerdere sessies en kunnen weg zodra ze niet meer nodig zijn.
- `charge_old/` (774 MB, oude schoolproject-bestanden) staat al in `.gitignore` maar neemt lokaal schijfruimte in.
- Geen `LICENSE`-bestand — relevant zodra de repo publiek gedeeld wordt.
- Geen `engines`-veld in `package.json` om de verwachte Node-versie vast te leggen.

## Al gedaan (ter referentie)

- CSS volledig herschreven (was vrijwel leeg) — moderne opmaak met werkende kaart, navigatie en locatie.
- Cafés/parkeren/toiletten-bug gefixt (ontbrekende `User-Agent`-header naar Overpass).
- Rand-bug in kaartlagen-/formulier-legends gefixt (root cause, niet per component).
- Tests + `npm test` toegevoegd voor `server/routing.ts`.
- Oude gemergede branches (`commit#1`, `Committ#2`, `committ#3`, `Committ#4`) opgeruimd.
- README aangevuld met "Aan de slag"-sectie (dev/test/build/deploy-commando's).
