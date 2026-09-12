import {nearby,detail} from './rce.ts';
import {heritageMatches} from './heritage-areas.ts';
import {distance,validPoint,targetDistance,selectStops,themes,type Theme,type Mode,type Point,type Monument} from './routing.ts';
import {geocode,roadRoute,pois,boundedJson,HttpError,type RoadRoute} from './services.ts';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
function json(data: unknown,status=200){return Response.json(data,{status,headers});}
function pointFrom(params: URLSearchParams): Point {
  if(!params.has('lat')||!params.has('lon'))throw new HttpError(400,'Kies een vertrekpunt.');
  const p={lat:Number(params.get('lat')),lon:Number(params.get('lon'))};
  if(!validPoint(p))throw new HttpError(400,'Kies een vertrekpunt in Europees Nederland.');return p;
}
function themeFrom(value:unknown):Theme { if(typeof value!=='string'||!themes.includes(value as Theme))throw new HttpError(400,'Kies een geldig erfgoedthema.');return value as Theme; }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/favicon.ico')return Response.redirect(new URL('/favicon.svg',url).toString(),301);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    try {
      if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw new HttpError(403,'Open deze functie vanuit CHARGE.');
      const {success}=await env.API_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'local'});
      if(!success)throw new HttpError(429,'Te veel verzoeken. Wacht even en probeer het opnieuw.');
      if(request.method==='GET' && url.pathname==='/api/places')return json({places:await geocode(url.searchParams.get('q')||'')});
      if(request.method==='GET' && url.pathname==='/api/monuments'){
        const center=pointFrom(url.searchParams);const radius=Number(url.searchParams.get('radius')||2500);
        if(!Number.isFinite(radius)||radius<300||radius>22000)throw new HttpError(400,'Kies een kleiner zoekgebied.');
        return json(await nearby(env.RCE_MCP_URL,center,radius,themeFrom(url.searchParams.get('theme')||'all')));
      }
      if(request.method==='GET' && url.pathname==='/api/monument'){
        const number=url.searchParams.get('number')||'';if(!/^\d{1,8}$/.test(number))throw new HttpError(400,'Ongeldig monumentnummer.');
        return json(await detail(env.RCE_MCP_URL,number));
      }
      if(request.method==='GET' && url.pathname==='/api/pois'){
        const center=pointFrom(url.searchParams);const radius=Number(url.searchParams.get('radius')||2000);
        if(!Number.isFinite(radius)||radius<100||radius>4000)throw new HttpError(400,'Zoom verder in om voorzieningen te bekijken.');
        const kinds=[...new Set((url.searchParams.get('kinds')||'').split(','))];return json({pois:await pois(env.OVERPASS_URL,center,radius,kinds)});
      }
      if(request.method==='POST' && url.pathname==='/api/route'){
        const origin=request.headers.get('Origin');if(origin && origin!==url.origin)throw new HttpError(403,'Open deze functie vanuit CHARGE.');
        if(!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(415,'Gebruik JSON voor route-instellingen.');
        let b:unknown;try{b=await boundedJson(new Response(request.body),2048);}catch{throw new HttpError(400,'Ongeldige route-instellingen.');}
        if(!b||typeof b!=='object')throw new HttpError(400,'Ongeldige route-instellingen.');
        const body=b as Record<string,unknown>;const mode=body.mode as Mode;
        const start={lat:Number(body.lat),lon:Number(body.lon)};
        if(!validPoint(start)||!['foot','bike'].includes(mode)||typeof body.amount!=='number'||typeof body.budget!=='string')throw new HttpError(400,'Controleer je vertrekpunt en route-instellingen.');
        let target:number;try{target=targetDistance(mode,body.budget,body.amount);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Ongeldige afstand.');}
        const {monuments,truncated}=await nearby(env.RCE_MCP_URL,start,Math.min(22000,Math.max(1200,target*.36)),themeFrom(body.theme));
        if(monuments.length<2)throw new HttpError(422,'Te weinig passende monumenten in dit gebied. Kies een ander thema, een grotere afstand of een ander vertrekpunt.');
        let best: {route:RoadRoute;stops:Monument[]}|undefined;
        let adjusted=target;let lastSignature='';
        // Sequential, bounded routing calls: at most three requests, never parallel.
        for(let attempt=0;attempt<3;attempt++){
          const stops=selectStops(start,monuments,adjusted,attempt*.18);
          if(stops.length<2)break;
          const signature=stops.map(s=>s.number).join(',');if(signature===lastSignature)break;lastSignature=signature;
          if(attempt)await new Promise(resolve=>setTimeout(resolve,1100));
          let route:RoadRoute;
          try {route=await roadRoute(env.ROUTING_BASE_URL,mode,[start,...stops,start]);}catch(e){if(best)break;throw e;}
          // Don't claim to pass a monument when the route snaps to a distant road.
          if(route.snapDistances.length!==stops.length+2 || route.snapDistances.some(d=>d>120)){
            for(let i=0;i<stops.length;i++)if(route.snapDistances[i+1]>120){const index=monuments.findIndex(m=>m.number===stops[i].number);if(index>=0)monuments.splice(index,1);}
            if(route.snapDistances[0]>120)throw new HttpError(422,'Je vertrekpunt ligt te ver van een begaanbaar pad. Kies een punt op een straat of pad.');
            continue;
          }
          if(!best||Math.abs(route.distance-target)<Math.abs(best.route.distance-target))best={route,stops};
          if(Math.abs(route.distance-target)/target<.15)break;
          adjusted=Math.max(800,Math.min(target*2,adjusted*target/Math.max(1,route.distance)));
        }
        if(!best)throw new HttpError(422,'Geen geschikte rondroute gevonden. Probeer een ander vertrekpunt of thema.');
        const deviation=Math.abs(best.route.distance-target)/target;
        // Sparse monument areas can force a route far past what "richtwaarde" can defend; refuse rather than mislead.
        if(deviation>.5)throw new HttpError(422,'In dit gebied liggen te weinig rijksmonumenten dicht bij elkaar voor een route rond je gewenste afstand. Probeer een grotere afstand of tijd, een ander thema, of een ander vertrekpunt.');
        // Bijzondere gebieden zijn context, geen kernfunctie: een falende opzoeking mag de route niet blokkeren.
        const heritage=await heritageMatches(env.RCE_MCP_URL,best.route.geometry.coordinates).catch(()=>[]);
        return json({geometry:best.route.geometry,distance:best.route.distance,durationMinutes:Math.round(best.route.distance/(mode==='foot'?4500:15000)*60),stops:best.stops,target,mode,truncated,source:'RCE via RCE-MCP',deviation,heritage});
      }
      return json({error:'Deze functie bestaat niet.'},404);
    } catch(error){
      if(error instanceof HttpError)return json({error:error.message},error.status);
      return json({error:'De verbinding met de gegevensdienst lukt nu niet. Probeer het opnieuw; de eerste keer laden kan langer duren.'},502);
    }
  }
} satisfies ExportedHandler<Env>;
