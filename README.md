# CHARGE

**CHARGE** staat voor *Cultural HeritAge Route Generator*. Deze mobiele webapp maakt wandel- en fietsroutes langs Nederlandse rijksmonumenten.

## Wat CHARGE doet

Je kiest een vertrekpunt, wandelen of fietsen, een gewenste afstand of beschikbare tijd en een erfgoedthema. CHARGE haalt monumentgegevens op via de RCE CHO linked data voorziening en gebruikt OpenStreetMap voor de kaart, routes en voorzieningen zoals cafés, parkeerplaatsen en toiletten.

## Scope van deze eerste versie

CHARGE werkt zonder account. De app slaat geen gebruikersgegevens, routes of locatiegeschiedenis op.

De eerste versie bevat:

- routevoorstel langs rijksmonumenten
- wandel- en fietsroutes
- monumentinformatie
- kaartlagen voor voorzieningen
- gebruik op telefoon en desktop

Inloggen, opslaan, badges, quizzen, sociale functies en publicatie in de app stores vallen buiten deze versie.

## Aan de slag

```
npm install
npm run dev      # bouwt de app en start een lokale Cloudflare Worker op :8787
npm test         # draait de tests voor de routelogica
npm run check    # TypeScript-check zonder te compileren
npm run deploy   # bouwt en deployt naar Cloudflare
```

Geen extra configuratie nodig: de externe diensten (RCE-CHO, OSRM, Overpass) staan als publieke URL's in `wrangler.jsonc`.

## Bronnen

- Rijksdienst voor het Cultureel Erfgoed: https://www.cultureelerfgoed.nl/
- RCE CHO linked data: https://linkeddata.cultureelerfgoed.nl/rce/-/overview
- OpenStreetMap: https://www.openstreetmap.org/

## Status

CHARGE is een werkende proefversie in ontwikkeling.

## Herkomst en dank

CHARGE begon als opdracht van de Rijksdienst voor het Cultureel Erfgoed voor het vak Ontwerpen van Interactieve Systemen aan de Universiteit Utrecht (cursusjaar 2023-2024). Dank aan Ruben Schalk (RCE) voor de begeleiding, en aan de studenten van dat vak voor het oorspronkelijke ontwerpwerk waarop deze versie voortbouwt.