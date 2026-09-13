import L from 'leaflet';
import './style.css';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const startDefault={lat:52.1561,lon:5.3878,name:'centrum Amersfoort'};
const state={start:startDefault,selectedText:'Amersfoort',monuments:[],route:null,pick:false,watch:null,position:null,revision:0,controller:null,searchId:0,poiId:0,detailId:0};
const map=L.map('map',{zoomControl:false}).setView([state.start.lat,state.start.lon],14);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
const monumentsLayer=L.layerGroup().addTo(map),poisLayer=L.layerGroup().addTo(map),routeLayer=L.layerGroup().addTo(map);
const startMarker=L.marker([state.start.lat,state.start.lon],{icon:L.divIcon({className:'marker-start',html:'V',iconSize:[30,30]}),zIndexOffset:1000}).addTo(map).bindTooltip('Vertrekpunt');
let positionMarker,accuracyCircle,poiTimer,monumentTimer;
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function mapStatus(message){$('#map-status').textContent=message;$('#map-status').hidden=!message;}
function mode(){return $('input[name="mode"]:checked').value;}
function budget(){return $('input[name="budget"]:checked').value;}
function targetMeters(){return budget()==='time'?Number($('#amount').value)/60*(mode()==='foot'?4500:15000):Number($('#amount').value)*1000;}
function title(m){return m.name||`${m.function||'Rijksmonument'} ${m.number}`;}
function km(value){return `${(value/1000).toLocaleString('nl-NL',{maximumFractionDigits:1})} km`;}
function minutes(value){return value<60?`${value} min`:`${Math.floor(value/60)} u${value%60?` ${value%60} min`:''}`;}
async function api(path,options={}){
  const timeout=AbortSignal.timeout(120000);
  const signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
  const response=await fetch(path,{...options,signal});
  const data=await response.json();if(!response.ok){const error=new Error(data.error||'Dit lukt nu niet. Probeer opnieuw.');error.status=response.status;throw error;}return data;
}
function invalidate(){
  state.revision++;state.controller?.abort();state.controller=null;state.route=null;
  routeLayer.clearLayers();$('#route-result').hidden=true;$('#generate').disabled=false;
  $('#generate').replaceChildren(el('span','Maak mijn rondje'),el('span','↗'));
  clearTimeout(monumentTimer);
}
function settingsChanged(){invalidate();status('Je instellingen zijn aangepast. Maak je nieuwe rondje.');monumentTimer=setTimeout(loadMonuments,350);}
function setStart(point){
  invalidate();state.searchId++;$('#search').disabled=false;state.start=point;state.selectedText=point.name;
  $('#start').value=point.name;$('#selected-start').textContent=`Vertrek: ${point.name}`;$('#map-caption').textContent=point.name;
  $('#search-results').hidden=true;startMarker.setLatLng([point.lat,point.lon]);map.setView([point.lat,point.lon],mode()==='foot'?14:12);
  status('Vertrekpunt aangepast. Kies je route.');void loadMonuments();
}
function renderMonuments(monuments,stops=[]){
  monumentsLayer.clearLayers();const stopNumbers=new Map(stops.map((m,i)=>[m.number,i+1]));
  const list=stops.length?stops:monuments;
  for(const m of list){
    const nr=stopNumbers.get(m.number);
    // Before a route exists there can be hundreds of monuments on screen; making each one an
    // individual tab stop would force keyboard users through the whole list before reaching the
    // map controls. Keyboard/screen-reader access to a monument's detail is available via the
    // stop list once a route (and its handful of numbered stops) exists.
    const marker=L.marker([m.lat,m.lon],{keyboard:!!nr,icon:L.divIcon({className:'marker-monument',html:nr?String(nr):'•',iconSize:nr?[28,28]:[18,18]})});
    const popup=el('div');popup.append(el('strong',title(m)),el('div',`Rijksmonument ${m.number}`));
    const button=el('button','Bekijk monument');button.type='button';button.addEventListener('click',()=>void showDetail(m));popup.append(button);
    marker.bindPopup(popup).addTo(monumentsLayer);
    if(nr)marker.getElement()?.setAttribute('aria-label',title(m));
  }
}
async function loadMonuments(){
  const revision=state.revision;state.controller?.abort();const controller=new AbortController();state.controller=controller;
  mapStatus('Rijksmonumenten ophalen…');
  const radius=Math.min(22000,Math.max(1200,targetMeters()*.36));
  try{
    const data=await api(`/api/monuments?${new URLSearchParams({lat:state.start.lat,lon:state.start.lon,radius,theme:$('#theme').value})}`,{signal:controller.signal});
    if(revision!==state.revision)return;state.monuments=data.monuments;renderMonuments(state.monuments);
    mapStatus(data.monuments.length?`${data.monuments.length} rijksmonumenten in de selectie${data.truncated?' · Dit gebied bevat meer monumenten':''}`:'Geen monumenten voor dit thema in het zoekgebied. Kies een ander thema of een grotere afstand.');
  }catch(error){if(controller.signal.aborted||revision!==state.revision)return;state.monuments=[];monumentsLayer.clearLayers();mapStatus(error.status===429?error.message:'Monumenten laden lukt nu niet. Met ‘Maak mijn rondje’ probeer je het opnieuw.');}
}
async function searchPlaces(){
  const query=$('#start').value.trim();if(query.length<2){status('Vul een plaats of adres in.',true);return;}
  const id=++state.searchId;$('#search').disabled=true;$('#search-results').hidden=true;status('Vertrekpunt zoeken…');
  try{
    const data=await api(`/api/places?q=${encodeURIComponent(query)}`);if(id!==state.searchId)return;
    const list=$('#search-results');list.replaceChildren();
    for(const place of data.places){const li=el('li');const button=el('button',place.name);button.type='button';button.addEventListener('click',()=>setStart(place));li.append(button);list.append(li);}
    list.hidden=!data.places.length;status(data.places.length?'Kies je vertrekpunt uit de zoekresultaten.':'Geen plaats gevonden. Probeer een plaatsnaam of volledig adres.',!data.places.length);
    list.querySelector('button')?.focus();
  }catch(error){if(id===state.searchId)status(error.message,true);}finally{if(id===state.searchId)$('#search').disabled=false;}
}
$('#search').addEventListener('click',()=>void searchPlaces());
$('#start').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchPlaces();}});
$('#start').addEventListener('input',()=>{state.searchId++;$('#search').disabled=false;$('#search-results').hidden=true;invalidate();status('Zoek en selecteer je nieuwe vertrekpunt.');});
$('#pick-start').addEventListener('click',()=>{state.pick=!state.pick;$('#pick-start').setAttribute('aria-pressed',String(state.pick));$('#map').style.cursor=state.pick?'crosshair':'';mapStatus(state.pick?'Tik op een straat of pad om daar te vertrekken.':'');if(state.pick)$('#map').scrollIntoView({behavior:'smooth',block:'center'});});
map.on('click',event=>{if(!state.pick)return;state.pick=false;$('#pick-start').setAttribute('aria-pressed','false');$('#map').style.cursor='';setStart({lat:event.latlng.lat,lon:event.latlng.lng,name:'Gekozen punt op de kaart'});});
function stopLocation(){if(state.watch!==null)navigator.geolocation.clearWatch(state.watch);state.watch=null;$('#location').textContent='Gebruik mijn locatie';if(positionMarker)map.removeLayer(positionMarker);if(accuracyCircle)map.removeLayer(accuracyCircle);positionMarker=null;accuracyCircle=null;}
$('#location').addEventListener('click',()=>{
  if(state.watch!==null){stopLocation();status('Locatiegebruik gestopt. Je vertrekpunt blijft staan.');return;}
  if(!navigator.geolocation){status('Je browser ondersteunt geen locatiegebruik. Zoek een plaats of kies op de kaart.',true);return;}
  let first=true;$('#location').textContent='Stop mijn locatie';status('Wachten op je locatie…');
  state.watch=navigator.geolocation.watchPosition(position=>{
    const {latitude:lat,longitude:lon,accuracy}=position.coords;
    state.position={lat,lon};if(!positionMarker){accuracyCircle=L.circle([lat,lon],{radius:accuracy,color:'#336bb5',fillOpacity:.08,weight:1}).addTo(map);positionMarker=L.circleMarker([lat,lon],{radius:7,color:'white',weight:3,fillColor:'#2868bc',fillOpacity:1}).addTo(map).bindTooltip('Jouw locatie');}
    positionMarker.setLatLng([lat,lon]);accuracyCircle.setLatLng([lat,lon]).setRadius(accuracy);
    if(first){first=false;setStart({lat,lon,name:'Mijn locatie'});status(`Locatie gevonden. Nauwkeurigheid ongeveer ${Math.round(accuracy)} meter.`);}
  },error=>{stopLocation();status(error.code===1?'Geen toestemming voor je locatie. Je kunt ook een plaats zoeken of op de kaart kiezen.':'Je locatie is niet beschikbaar. Probeer opnieuw of zoek een plaats.',true);},{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
});
window.addEventListener('pagehide',stopLocation);
function configureRange(){
  const time=budget()==='time';const foot=mode()==='foot';const input=$('#amount');
  Object.assign(input,time?{min:'30',max:'240',step:'15',value:foot?'60':'90'}:foot?{min:'2',max:'15',step:'1',value:'5'}:{min:'5',max:'60',step:'5',value:'20'});
  $('#range-label').textContent=time?'Beschikbare tijd':'Gewenste afstand';$('#range-min').textContent=`${input.min} ${time?'min':'km'}`;$('#range-max').textContent=time?'4 uur':`${input.max} km`;updateAmount();
}
function updateAmount(){$('#amount-output').textContent=budget()==='time'?minutes(Number($('#amount').value)):`${$('#amount').value} km`;}
$$('input[name="mode"],input[name="budget"]').forEach(input=>input.addEventListener('change',()=>{configureRange();settingsChanged();}));
$('#amount').addEventListener('input',()=>{updateAmount();invalidate();status('Je afstand of tijd is aangepast. Maak je nieuwe rondje.');});
$('#amount').addEventListener('change',settingsChanged);$('#theme').addEventListener('change',settingsChanged);
$('#route-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('#start').value.trim()!==state.selectedText){await searchPlaces();return;}
  invalidate();const revision=state.revision;const controller=new AbortController();state.controller=controller;
  $('#generate').disabled=true;$('#generate').textContent='Je rondje samenstellen…';status('We zoeken passende monumenten en berekenen een route over wegen en paden.');mapStatus('Je route wordt berekend…');
  try{
    const data=await api('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:state.start.lat,lon:state.start.lon,mode:mode(),budget:budget(),amount:Number($('#amount').value),theme:$('#theme').value}),signal:controller.signal});
    if(revision!==state.revision)return;state.route=data;
    L.geoJSON(data.geometry,{style:{color:'#163f45',weight:5,opacity:.92}}).addTo(routeLayer);
    renderMonuments(state.monuments,data.stops);renderRoute(data);fit();
    status(`Je rondje is klaar: ${km(data.distance)} langs ${data.stops.length} monumenten.`);mapStatus('');
    $('#route-result').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(error){if(controller.signal.aborted||revision!==state.revision)return;status(error.message,true);mapStatus('Geen route berekend. Pas je keuzes aan en probeer opnieuw.');}
  finally{if(revision===state.revision){$('#generate').disabled=false;$('#generate').replaceChildren(el('span','Maak mijn rondje'),el('span','↗'));}}
});
function renderRoute(data){
  const section=$('#route-result');section.replaceChildren();section.hidden=false;
  const heading=el('h2',mode()==='foot'?'Jouw erfgoedwandeling':'Jouw erfgoedfietstocht');heading.id='result-heading';section.append(heading);
  const stats=el('div',undefined,'route-stats');for(const [value,label] of [[km(data.distance),'berekende afstand'],[minutes(data.durationMinutes),'zonder bezoekstops'],[String(data.stops.length),'monumenten']]){const item=el('div');item.append(el('strong',value),el('span',label));stats.append(item);}section.append(stats);
  const heritageText={gezicht:n=>`Je route loopt door beschermd stadsgezicht ${n}.`,werelderfgoed:n=>`Je route passeert Werelderfgoed: ${n}.`,linie:n=>`Je route doorkruist historische linie ${n}.`};
  (data.heritage||[]).forEach(h=>section.append(el('p',(heritageText[h.kind]||(n=>n))(h.name),'route-heritage')));
  if(data.deviation>.15)section.append(el('p',`Dit rondje wijkt af van je wens van ${km(data.target)}. Met deze monumenten en paden kwamen we uit op ${km(data.distance)}.`, 'route-note'));
  if(data.truncated)section.append(el('p','Deze route gebruikt een selectie uit de monumenten in dit gebied.','route-note'));
  const list=el('ol',undefined,'stop-list');data.stops.forEach((m,i)=>{const li=el('li');const button=el('button');button.type='button';const copy=el('span');copy.append(el('strong',title(m)),el('small',`Rijksmonument ${m.number}`));button.append(el('span',String(i+1),'number'),copy);button.addEventListener('click',()=>{map.setView([m.lat,m.lon],16);void showDetail(m);});li.append(button);list.append(li);});section.append(list);
  section.append(el('p','Je komt terug bij je vertrekpunt. De lijn volgt wegen en paden; het monument zelf is niet altijd toegankelijk. Locatievolging toont je positie, zonder afslagaanwijzingen.','route-note'));
  const actions=el('div',undefined,'route-actions');const overview=el('button','Bekijk hele route','secondary');overview.type='button';overview.addEventListener('click',()=>{fit();$('#map').scrollIntoView({behavior:'smooth',block:'center'});});actions.append(overview);section.append(actions);
}
function fit(){if(state.route){const bounds=L.geoJSON(state.route.geometry).getBounds();map.fitBounds(bounds,{padding:[50,65]});}else map.setView([state.start.lat,state.start.lon],mode()==='foot'?14:12);}
$('#fit').addEventListener('click',fit);
$('#locate-map').addEventListener('click',()=>$('#location').click());
async function showDetail(m){
  const id=++state.detailId;const dialog=$('#monument-dialog');const content=$('#monument-content');content.replaceChildren();
  content.append(el('span',`RIJKSMONUMENT ${m.number}`,'eyebrow'));const heading=el('h2',title(m));heading.id='monument-title';content.append(heading);
  if(m.function)content.append(el('p',m.function,'hint'));
  const description=el('p','Omschrijving ophalen…','description');content.append(description);
  const source=el('a','Bekijk in het Monumentenregister','source-link');source.href=`https://monumentenregister.cultureelerfgoed.nl/monumenten/${encodeURIComponent(m.number)}`;source.target='_blank';source.rel='noopener noreferrer';content.append(source);
  if(!dialog.open)dialog.showModal();
  try{
    const data=await api(`/api/monument?number=${encodeURIComponent(m.number)}`);if(id!==state.detailId)return;
    description.textContent=data.descriptions.length?data.descriptions.join('\n\n'):'Voor dit monument is geen omschrijving opgehaald. Bekijk de bron voor meer informatie.';
    if(data.kennisbank){const kennisbank=el('a','Bekijk in de Kennisbank Cultureel Erfgoed','source-link');kennisbank.href=data.kennisbank;kennisbank.target='_blank';kennisbank.rel='noopener noreferrer';content.append(kennisbank);}
  }
  catch(error){if(id===state.detailId)description.textContent=error.status===429?error.message:'De omschrijving is nu niet beschikbaar. Je kunt het Monumentenregister openen.';}
}
$('#close-dialog').addEventListener('click',()=>$('#monument-dialog').close());
$('#monument-dialog').addEventListener('click',event=>{if(event.target===$('#monument-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
function schedulePois(){clearTimeout(poiTimer);state.poiId++;poisLayer.clearLayers();poiTimer=setTimeout(loadPois,700);}
async function loadPois(){
  const kinds=$$('input[name="poi"]:checked').map(i=>i.value);if(!kinds.length){if(!state.controller||state.route)mapStatus('');return;}
  const center=map.getCenter(),bounds=map.getBounds();const radius=Math.ceil(center.distanceTo(bounds.getNorthEast()));
  if(radius>4000){mapStatus('Zoom verder in om cafés, parkeerplaatsen, toiletten en AED\'s te bekijken.');return;}
  const id=state.poiId;mapStatus('Voorzieningen ophalen…');
  try{
    const data=await api(`/api/pois?${new URLSearchParams({lat:center.lat,lon:center.lng,radius:Math.max(100,radius),kinds:kinds.join(',')})}`);if(id!==state.poiId)return;
    poisLayer.clearLayers();const labels={cafe:'Café',parking:'Parkeerplaats',toilets:'Toilet',aed:'AED'},symbols={cafe:'C',parking:'P',toilets:'WC',aed:'+'};
    for(const poi of data.pois){const popup=el('div');popup.append(el('strong',poi.name||labels[poi.kind]));if(poi.name)popup.append(el('div',labels[poi.kind]));if(poi.openingHours)popup.append(el('p',`Openingstijden volgens OpenStreetMap: ${poi.openingHours}`));
      const marker=L.marker([poi.lat,poi.lon],{icon:L.divIcon({className:`marker-poi marker-poi-${poi.kind}`,html:symbols[poi.kind]||'P',iconSize:[28,28]})}).bindPopup(popup).addTo(poisLayer);marker.getElement()?.setAttribute('aria-label',poi.name||labels[poi.kind]);}
    mapStatus(data.pois.length?'': 'Geen voorzieningen van dit type gevonden in dit kaartgebied.');
  }catch(error){if(id===state.poiId)mapStatus(error.message||'Voorzieningen laden lukt nu niet. Probeer het later opnieuw.');}
}
$$('input[name="poi"]').forEach(input=>input.addEventListener('change',schedulePois));map.on('moveend',()=>{if($$('input[name="poi"]:checked').length)schedulePois();});
tiles.on('tileerror',()=>mapStatus('Niet alle kaarttegels konden laden. Controleer je verbinding.'));
// No cookies, localStorage, analytics or saved location history.
void loadMonuments();
