export function extractShareLinks(value) {
 const links=new Set();
 for(const match of String(value??'').matchAll(/https?:\/\/[^\s<>"'，。；！？、【】《》（）]+/gi)){
  try{
   const url=new URL(match[0].replace(/[)\]}.!,;]+$/g,''));
   if(url.protocol==='https:'&&!url.username&&!url.password)links.add(url.href);
  }catch{}
 }
 return [...links];
}

export function placeKey(place) {
 return [place.city,place.name,place.hint].map(v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'')).join('|');
}

export function mergePlaces(places, incoming) {
 const merged=structuredClone(places);
 for(const candidate of incoming){
  const existing=merged.find(p=>placeKey(p)===placeKey(candidate)&&!p.location);
  if(!existing){merged.push(candidate);continue;}
  if(candidate.location)existing.location=candidate.location;
  if(candidate.originalName)existing.originalName||=candidate.originalName;
  for(const evidence of candidate.evidence){
   if(!existing.evidence.some(e=>e.source===evidence.source&&e.quote===evidence.quote&&e.stance===evidence.stance))existing.evidence.push(evidence);
  }
 }
 return merged;
}

export function minutes(time) {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return null;
 const [h,m]=time.split(':').map(Number);
 return h*60+m;
}

export function directDistance(a,b) {
 if(!a||!b)return null;
 const rad=Math.PI/180;
 const h=Math.sin((b.lat-a.lat)*rad/2)**2+
  Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}

export function inspectDay(stops, places, routeMinutes={}) {
 const byId=new Map(places.map(p=>[p.id,p]));
 const warnings=[];
 const timed=stops.filter(s=>minutes(s.start)!==null);
 const name=s=>byId.get(s.placeId)?.name||'地点';
 for(const [index,stop] of timed.entries()){
  const start=minutes(stop.start);
  if(start+stop.stay>1440)warnings.push(name(stop)+'的停留跨过当天午夜，请调整。');
  if(timed.slice(0,index).some(p=>minutes(p.start)>start))warnings.push(name(stop)+'的预约早于前一站，与游览顺序不符。');
  const end=start+stop.stay;
  for(const other of timed.slice(index+1)){
   const otherStart=minutes(other.start);
   if(start<otherStart+other.stay&&otherStart<end)warnings.push(name(stop)+'与'+name(other)+'时间重叠。');
  }
 }
 for(const [i,stop] of stops.entries()){
  const from=stops[i-1];
  if(!from)continue;
  const duration=routeMinutes[from.id+'|'+stop.id];
  const a=minutes(from.start),b=minutes(stop.start);
  if(Number.isFinite(duration)){
   if(a!==null&&b!==null&&b-a-from.stay<duration)warnings.push(name(from)+' → '+name(stop)+'预留移动时间少于地图估算 '+duration+' 分钟。');
  }else{
   const distance=directDistance(byId.get(from.placeId)?.location,byId.get(stop.placeId)?.location);
   if(distance!==null&&distance>=5)warnings.push(name(from)+' → '+name(stop)+'直线约 '+distance.toFixed(1)+' 公里，实际路线待查。');
  }
 }
 return [...new Set(warnings)];
}

export function suggestOrder(stops, places) {
 const positions=new Map(places.map(p=>[p.id,p.location]));
 const location=s=>positions.get(s.placeId);
 const result=[...stops];
 for(let i=1;i<result.length;i++){
  if(result[i].locked||result[i].start||!location(result[i])||!location(result[i-1]))continue;
  let best=i;
  for(let j=i+1;j<result.length;j++){
   if(result[j].locked||result[j].start||!location(result[j]))break;
   if(directDistance(location(result[i-1]),location(result[j]))<directDistance(location(result[i-1]),location(result[best])))best=j;
  }
  result.splice(i,0,...result.splice(best,1));
 }
 return result;
}
const huangguoshuNames={
 '黄果树':['黄果树景区','黄果树风景名胜区'],
 '黄果树景区':['黄果树景区','黄果树风景名胜区'],
 '黄果树风景名胜区':['黄果树景区','黄果树风景名胜区'],
 '黄果树大瀑布':['黄果树景区–黄果树大瀑布','黄果树景区-黄果树大瀑布'],
 '陡坡塘瀑布':['黄果树景区–陡坡塘瀑布','陡坡塘瀑布'],
 '水帘洞':['黄果树景区大瀑布区域–水帘洞','黄果树瀑布景区-水帘洞'],
 '天星桥':['黄果树景区–天星桥','黄果树景区-天星桥']
};
export function huangguoshuPlace(city,name){
 if(!/^安顺市?$/.test(city))return null;
 for(const [original,[title,providerName]] of Object.entries(huangguoshuNames)){
  if([original,title,providerName].includes(name))return {title,providerName};
 }
 return null;
}

