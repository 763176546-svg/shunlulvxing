import {extractShareLinks,huangguoshuPlace,inspectDay,mergePlaces,minutes,placeKey,suggestOrder} from '/guide-rules.mjs';

const $=s=>document.querySelector(s);
const storageKey='stay-play-guide-v1';
const id=()=>globalThis.crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=(offset=0)=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10);
const dateOffset=(start,offset)=>new Date(Date.parse(start)+offset*86400000).toISOString().slice(0,10);
const blank=()=>({city:'',start:date(),places:[],days:[{id:id(),stops:[]}]});
let state=blank();
try{
 const saved=JSON.parse(localStorage.getItem(storageKey));
 if(saved?.days?.length&&Array.isArray(saved.places)&&/^\d{4}-\d{2}-\d{2}$/.test(saved.start))state=saved;
}catch{}
const routeByDay=new Map(),routeIssues=new Map(),routeShapes=new Map(),routeModes=new Map(),proposals=new Map();
const streetImages=new Map();
const mapViews=new Map();
let currentMapView;
const transportResults=new Map();
let pending=false;
let batch=null,reviewTab='places',planTab='overview',editing=false,libraryBack='plans';
const selected=new Set();
state.plans??=[];
state.folders??=[];
let libraryFolder='';

function persist(){
 try{localStorage.setItem(storageKey,JSON.stringify(state));}
 catch{$('#storage-status').textContent='浏览器未能保存本次修改。';}
}
function backupState(raw){
 const data=JSON.parse(raw);
 const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
 const validDays=days=>Array.isArray(days)&&days.length>0&&days.every(day=>key(day?.id)&&Array.isArray(day.stops)&&day.stops.every(stop=>key(stop?.id)&&key(stop.placeId)));
 const validTrip=trip=>typeof trip?.city==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(trip.start)&&validDays(trip.days);
 if(!validTrip(data)||!Array.isArray(data.places)||!data.places.every(place=>key(place?.id)&&typeof place.name==='string'&&Array.isArray(place.evidence))||
    !Array.isArray(data.plans)||!data.plans.every(plan=>key(plan?.id)&&validTrip(plan))||
    (data.folders!=null&&!Array.isArray(data.folders)))throw Error('备份格式不正确。');
 return data;
}

async function api(action,data,timeout=115000){
 let response,body;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  response=await fetch('/api/guide/'+action,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(data),signal:controller.signal
  });
  body=await response.json();
 }catch(error){
  if(controller.signal.aborted)throw Error('请求超时，请稍后重试。');
  if(error instanceof TypeError&&location.hostname==='127.0.0.1')
   throw Error('与电脑上的顺路旅行服务断开。请连接 USB，在电脑运行「安卓预览修复」后重试。');
  if(error instanceof TypeError)throw Error('无法连接顺路旅行服务，请检查网络后重试。');
  throw Error('顺路旅行服务返回异常，请稍后重试。');
 }finally{clearTimeout(timer);}
 if(!response.ok)throw Error(body.error||'暂时无法完成查询。');
 return body;
}

function safeURL(raw){
 try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}
 catch{return '';}
}
const link=(raw,label)=>{
 const href=safeURL(raw);
 return href?'<a href="'+escape(href)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+' ↗</a>':'';
};
document.addEventListener('click',event=>{
 const anchor=event.target.closest('a[target="_blank"]');
 const href=anchor&&safeURL(anchor.href);
 if(!href||!globalThis.plus?.runtime?.openURL)return;
 event.preventDefault();
 globalThis.plus.runtime.openURL(href,()=>window.open(href,'_blank','noopener,noreferrer'));
});
const button=(action,label,key='',extra='')=>'<button type="button" class="secondary" data-action="'+action+'" data-key="'+escape(key)+'" '+extra+'>'+escape(label)+'</button>';
const placeById=key=>state.places.find(p=>p.id===key);
const dateOfDay=day=>dateOffset(state.start,state.days.indexOf(day));
const routeKey=(a,b)=>a.id+'|'+b.id;
const steps=[...document.querySelectorAll('[data-step]')];
let hotelBack=null;
function showStep(){
 const hash=location.hash.slice(1);
 const page=steps.some(p=>p.dataset.step===hash)&&!(hash==='confirm-places'&&!batch)&&!(hash==='hotel-search'&&!hotelBack)?hash:'plans';
 steps.forEach(p=>{p.hidden=p.dataset.step!==(page==='import-guide'?'plans':page)&&p.dataset.step!=='import-guide';});
 document.body.dataset.page=page;
 const nav=$('#travel-nav');
 nav.hidden=!['plans','library','profile'].includes(page)||page==='library'&&libraryBack==='plan-days';
 nav.querySelectorAll('a').forEach(a=>{
  if(a.getAttribute('href')==='#'+page)a.setAttribute('aria-current','page');
  else a.removeAttribute('aria-current');
 });
 if(page==='import-guide'&&!$('#import-sheet').open)$('#import-sheet').showModal();
 if(page!=='import-guide'&&$('#import-sheet').open)$('#import-sheet').close();
 if(page!=='hotel-search'&&hotelBack){
  const back=hotelBack;hotelBack=null;
  if(page===back.page&&back.detail&&!$('#detail').open)$('#detail').showModal();
 }
}
window.addEventListener('hashchange',()=>{
 showStep();
 window.scrollTo({top:0});
 if(document.body.dataset.page==='check-route')void checkVisibleRoutes();
 if(document.body.dataset.page==='plan-days')void checkSelectedRoute();
});
showStep();
$('#import-sheet').addEventListener('close',()=>{if(location.hash==='#import-guide')location.hash='plans';});

const stopFor=placeId=>({id:id(),placeId,start:'',stay:60,locked:false});
const planName=(city,days)=>city?city+' · '+days.length+'日游':days.length+'日出游计划';
const hasPlan=()=>Boolean(state.planId||state.days.some(d=>d.stops.length));
const reviewed=()=>batch?.ids.map(placeById).filter(Boolean)||[];
const makeDays=rows=>{
 const count=Math.max(batch.dayCount||0,...rows.map(p=>batch.days[p.id]||0));
 return Array.from({length:Math.max(1,count)},(_,i)=>({id:id(),stops:rows.filter(p=>batch.days[p.id]===i+1).map(p=>stopFor(p.id))}));
};
function openReview(rows,{title,thumb='',warnings=[],days=[],dayCount=0}){
 state.places=mergePlaces(state.places,rows);
 const mapped=rows.map(p=>placeById(p.id)||state.places.find(x=>placeKey(x)===placeKey(p)));
 batch={title,thumb,warnings,dayCount,ids:[...new Set(mapped.filter(Boolean).map(p=>p.id))],days:{},flags:{}};
 rows.forEach((row,i)=>{if(mapped[i]&&row.preview)mapped[i].preview=row.preview;});
 mapped.forEach((p,i)=>{
  if(!p)return;
  const n=days[i];if(n>=1&&n<=14&&!batch.days[p.id])batch.days[p.id]=n;
  const stances=rows[i].evidence.map(e=>e.stance);
  if(stances.includes('不推荐'))batch.flags[p.id]='原攻略有不推荐记录';
  else if(stances.every(s=>s==='提及'))batch.flags[p.id]||='原攻略仅提及';
 });
 reviewTab='places';selected.clear();
 rows.forEach((row,i)=>{if(mapped[i]&&row.evidence.some(e=>e.stance!=='不推荐')&&batch.flags[mapped[i].id]!=='原攻略有不推荐记录')selected.add(mapped[i].id);});
 render();
 location.hash='confirm-places';
}
function placeRow(p,{pick=false,index=0,stop=null}={}){
 const label=escape(p.type||'地点'),name=escape(p.location?.name||p.name);
 const checked=selected.has(p.id);
 const note=stop?.note?escape(stop.note):'备注';
 const flag=pick&&batch.flags?.[p.id]||'';
 const detailAttrs=' type="button" data-action="detail" data-key="'+escape(p.id)+'"';
 const photo=safeURL(p.preview?.image);
 return '<div class="place-row"><button class="place-thumb"'+detailAttrs+' aria-label="查看'+name+'">'+(photo?'<img alt="" loading="lazy" src="'+escape(photo)+'">':p.type==='餐厅'?'♨':p.type==='街巷'?'▥':'⌖')+'</button>'+
  '<div class="place-info">'+(stop?'<span class="place-kind">'+label+'</span>':'')+
  '<button class="place-name"'+detailAttrs+'>'+(index?index+'. ':'')+name+'</button>'+
  (stop?'<button class="note-button secondary" data-action="note" data-key="'+stop.id+'">'+note+' ✎</button>':
   (p.originalName?'<small class="original-name">原文：'+escape(p.originalName)+'</small>':'')+
   '<small><span class="place-kind">'+label+'</span> ｜ '+escape(p.location?.address||p.preview?.address||[p.city,p.hint].filter(Boolean).join(' · ')||'位置待确认')+'</small>'+
   (flag&&flag!=='原攻略仅提及'?'<small>'+escape(flag)+'</small>':'')+
   (pick&&p.evidence.length?'<details class="row-evidence"><summary>原文依据</summary>'+p.evidence.map(e=>'<p>'+escape(e.stance+' · '+e.quote)+' '+link(e.url,'原攻略')+'</p>').join('')+'</details>':''))+
  '</div>'+(pick?'<button class="check-dot" type="button" aria-label="'+escape(p.name)+'" aria-pressed="'+checked+'" data-action="pick" data-key="'+p.id+'">'+(checked?'✓':'')+'</button>':
  '<button class="icon-button place-open" aria-label="查看'+escape(p.name)+'" data-action="detail" data-key="'+p.id+'">›</button>')+'</div>';
}
function renderReview(){
 if(!batch)return;
 const rows=reviewed(),days=Math.max(batch.dayCount||0,...Object.values(batch.days));
 $('#import-source').innerHTML='<div class="source-card">'+(batch.thumb?'<img alt="攻略截图" src="'+escape(batch.thumb)+'">':'<span class="source-icon">↗</span>')+'<strong>'+escape(batch.title)+'</strong></div>'+
 batch.warnings.map(w=>'<p class="muted">'+escape(w)+'</p>').join('');
 $('#place-tab').textContent='地点 · '+rows.length;
 $('#day-tab').textContent=days?'行程 · '+days+'天':'行程';
 for(const [selector,tab] of [['#place-tab','places'],['#day-tab','days']])$(selector).setAttribute('aria-pressed',reviewTab===tab);
 $('#select-all').textContent=rows.length&&rows.every(p=>selected.has(p.id))?'取消全选':'全选';
 const list=group=>group.map(p=>placeRow(p,{pick:true})).join('');
 if(reviewTab==='places')$('#review-list').innerHTML=list(rows);
 else if(!days)$('#review-list').innerHTML='<p class="muted">攻略里没有明确的分天安排。创建后可在行程里按天编辑。</p>'+list(rows);
 else $('#review-list').innerHTML=Array.from({length:days},(_,i)=>'<h2>Day'+(i+1)+'</h2>'+(list(rows.filter(p=>batch.days[p.id]===i+1))||'<p class="muted">暂无地点</p>')).join('')+
 (rows.some(p=>!batch.days[p.id])?'<h2>待计划</h2>'+list(rows.filter(p=>!batch.days[p.id])):'');
 $('#review-actions').innerHTML=reviewTab==='places'?
 button('choose-plan','添加至计划','','')+button('collect','收藏地点'):
 button('recommend-hotels','按行程推荐酒店','draft')+button('create-plan','创建为新计划');
 for(const b of $('#review-actions').querySelectorAll('button'))b.disabled=selected.size===0;
}
function planChoices(){
 const plans=hasPlan()?[{id:'current',city:state.city,days:state.days,placeIds:state.planPlaceIds},...state.plans]:state.plans;
 return plans.map((plan,index)=>{
  const scheduled=plan.days.flatMap(day=>day.stops.map(stop=>stop.placeId));
  const pending=(plan.placeIds||[]).filter(key=>!scheduled.includes(key));
  const choice=(label,keys,dayId)=>{
   const names=keys.map(placeById).filter(Boolean).map(place=>place.name);
   return '<button type="button" class="day-destination" data-action="append-plan" data-key="'+escape(plan.id)+'" data-day="'+escape(dayId)+'"><b>'+label+'</b><small>'+escape(names.join(' → ')||'暂无地点')+'</small></button>';
  };
  return '<details class="plan-destination" '+(index===0?'open':'')+'><summary><strong>'+escape(planName(plan.city,plan.days))+'</strong><small>'+plan.days.length+' 天 · '+new Set([...scheduled,...pending]).size+' 个地点</small></summary>'+
   plan.days.map((day,i)=>choice('第 '+(i+1)+' 天',day.stops.map(stop=>stop.placeId),day.id)).join('')+choice('待计划',pending,'pending')+'</details>';
 }).join('')||'<p class="muted">暂无计划，可以用所选地点新建一份。</p>';
}
function folders(){
 return [{id:'default',title:'默认收藏夹',icon:'📍'},...state.folders];
}
function inFolder(place,key){
 return place.saved&&(place.folderIds||['default']).includes(key);
}
function showCollectionChoices(key='default'){
 $('#folder-editor').hidden=true;
 $('#collection-pick').hidden=false;
 $('#collection-title').textContent='加入收藏夹';
 $('#collection-choices').innerHTML=folders().map(folder=>'<label class="folder-choice"><span><b>'+escape(folder.icon+' '+folder.title)+'</b><small>'+state.places.filter(place=>inFolder(place,folder.id)).length+' 个地点</small></span><input type="radio" name="folder" value="'+escape(folder.id)+'" '+(key===folder.id?'checked':'')+'></label>').join('');
}
function parkPlan(){
 if(hasPlan())state.plans.push({id:state.planId||id(),city:state.city,start:state.start,days:state.days,placeIds:state.planPlaceIds});
}
function loadPlan(key){
 if(key!=='current'){
  const index=state.plans.findIndex(p=>p.id===key);
  if(index<0)return false;
  const [plan]=state.plans.splice(index,1);
  parkPlan();
  state.planId=plan.id;state.city=plan.city;state.start=plan.start;state.days=plan.days;state.planPlaceIds=plan.placeIds;
 }
 planTab=state.days.find(d=>d.stops.length)?.id||(state.planPlaceIds?.length?'pending':'overview');
 editing=false;routeByDay.clear();routeIssues.clear();routeShapes.clear();routeModes.clear();proposals.clear();transportResults.clear();mapViews.clear();
 $('#transport-result').replaceChildren();$('#trip-date').value=state.start;
 return true;
}
function openPlan(){
 $('#add-sheet').close();render();location.hash='plan-days';
}
function createReviewedPlan(rows,days,start){
 parkPlan();
 rows.forEach(place=>{place.saved=true;});
 state.planId=id();state.start=start;state.days=days;state.planPlaceIds=rows.map(place=>place.id);
 loadPlan('current');openPlan();
}
function renderPlan(){
 if(!['overview','pending'].includes(planTab)&&!state.days.some(d=>d.id===planTab))planTab='overview';
 const ready=hasPlan();
 const plans=[...(ready?[{...state,id:'current',placeIds:state.planPlaceIds}]:[]),...state.plans];
 $('#plans-list').innerHTML=plans.map(plan=>{
  const ids=[...new Set([...(plan.placeIds||[]),...plan.days.flatMap(day=>day.stops.map(stop=>stop.placeId))])];
  const image=ids.map(id=>safeURL(placeById(id)?.preview?.image)).find(Boolean);
  return '<button type="button" class="trip-card" data-action="resume-plan" data-key="'+escape(plan.id)+'">'+
   (image?'<img alt="" class="trip-cover" src="'+escape(image)+'" loading="lazy">':'<span class="trip-cover trip-cover-empty" aria-hidden="true"></span>')+
   '<span class="trip-card-body"><strong>'+escape(planName(plan.city,plan.days))+'</strong><small>'+escape(plan.days.length+' 天 · '+ids.length+' 个地点')+'</small><span class="trip-arrow" aria-hidden="true">↗</span></span></button>';
 }).join('')||'<div class="empty-plan"><p>还没有旅行计划</p><button type="button" data-action="open-import">导入攻略</button></div>';
 $('#profile-stats').innerHTML='<a href="#plans"><strong>'+plans.length+'</strong><span>旅行计划</span></a><a href="#library" data-action="open-library"><strong>'+state.places.filter(place=>place.saved).length+'</strong><span>收藏地点</span></a>';
 $('#plan-title').textContent=planName(state.city,state.days);
 $('#plan-length').innerHTML=state.days.length+'天'+Math.max(0,state.days.length-1)+'晚 '+button('recommend-hotels','按行程推荐酒店');
 $('#plan-tabs').innerHTML=[['overview','总览'],...state.days.map((d,i)=>[d.id,'DAY '+(i+1)]),['pending','待计划']]
 .map(([key,label])=>button('plan-tab',label,key,'aria-pressed="'+(key===planTab)+'"')).join('')+button('new-day','＋','','aria-label="加一天"');
 const visible=state.days.filter(d=>planTab==='overview'||planTab===d.id);
 const remaining=state.places.filter(p=>p.saved&&(!state.planPlaceIds||state.planPlaceIds.includes(p.id))&&!state.days.some(d=>d.stops.some(s=>s.placeId===p.id)));
 $('#plan-stops').innerHTML=planTab==='pending'?(remaining.map(p=>placeRow(p)).join('')||'<p class="muted">暂无待计划地点</p>'):
 visible.map(day=>'<h2>DAY '+(state.days.indexOf(day)+1)+'</h2>'+(day.stops.map((s,i)=>{
  const p=placeById(s.placeId),prev=day.stops[i-1],duration=prev&&routeByDay.get(day.id)?.[routeKey(prev,s)];
  return (prev?'<p class="leg">⌁　'+(Number.isFinite(duration)?routeLabel(day.id,routeKey(prev,s),duration):'路程待核对')+'</p>':'')+(p?placeRow(p,{stop:s,index:i+1}):'');
 }).join('')||'<p class="muted">自由安排</p>')+(day.hotel?'<article class="card hotel-stay"><b>当晚住宿 · '+escape(day.hotel.name)+'</b><p>'+escape(day.hotel.address)+'</p>'+
 (day.hotel.reason?'<p class="hotel-reason">'+escape(day.hotel.reason)+'</p>':'')+link(day.hotel.jumpUrl,'去飞猪核对')+button('remove-stay','移除住宿',day.id)+'</article>':'')).join('');
 $('#plan-edit').hidden=!editing;
 $('#plan-stops').hidden=editing;
 $('#edit-button').textContent=editing?'完成':'编辑';
 renderPlanMap();
}

function renderPlanMap(){
 const stops=state.days.filter(d=>planTab==='overview'||planTab===d.id).flatMap(d=>d.stops),canvas=$('#overview-map');
 const mapped=stops.filter(s=>placeById(s.placeId)?.location).length;
 canvas.hidden=!mapped;
 $('.map-controls').hidden=!mapped;
 canvas.parentElement.classList.toggle('map-empty',!mapped);
 canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
 const paths=planTab==='overview'?new Map():routeShapes.get(planTab);
 if(mapped)drawDay(canvas,{stops},planTab!=='overview',paths);
 $('#map-caption').textContent=mapped?mapped+'/'+stops.length+' 站已定位 · '+(paths?.size?'实线为已核对路线':'站点位置示意'):'';
}

function renderPlaces(){
 const container=$('#places');
 const search=$('#library-search').value.trim().toLowerCase();
 const rows=state.places.filter(p=>(!libraryFolder||inFolder(p,libraryFolder))&&
  (!search||[p.name,p.originalName,p.city,p.location?.address,p.hint].some(value=>value?.toLowerCase().includes(search))));
 const map=$('#library-map');
 const stops=rows.filter(p=>p.saved&&p.location).map(p=>({placeId:p.id}));
 map.hidden=!stops.length||libraryBack==='plan-days';
 if(!map.hidden)drawDay(map,{stops},false);
 const currentFolder=folders().find(folder=>folder.id===libraryFolder);
 const navigation='<div class="folder-tabs">'+button('filter-folder','全部地点','','aria-pressed="'+(!libraryFolder)+'"')+
  folders().map(folder=>button('filter-folder',folder.icon+' '+folder.title,folder.id,'aria-pressed="'+(libraryFolder===folder.id)+'"')).join('')+'</div>';
 container.innerHTML=navigation+(currentFolder?.description?'<p class="muted">'+escape(currentFolder.description)+'</p>':'')+(rows.map(p=>{
  const flags=[...new Set(p.evidence.map(e=>e.stance))].join(' · ')||'手动添加';
  const location=p.location?escape(p.location.name+' · '+p.location.address):'位置待确认';
  const evidence=p.evidence.map(e=>'<blockquote><b>'+escape(e.stance)+'</b> · '+escape(e.source)+
   '<br>'+escape(e.quote)+' '+link(e.url,'原攻略')+'</blockquote>').join('');
  const other=state.places.filter(x=>x.id!==p.id&&x.city===p.city);
  const sameSite=other.length?'<label>确认同一地点后合并至<select data-merge="'+escape(p.id)+'"><option value="">选择地点</option>'+
   other.map(x=>'<option value="'+escape(x.id)+'">'+escape(x.name+(x.hint?' · '+x.hint:''))+'</option>').join('')+'</select></label>':'';
  const canAdd=libraryBack==='plan-days'&&!state.days.some(d=>d.stops.some(s=>s.placeId===p.id));
  return '<article class="card"><h3>'+escape(p.name)+'</h3><span class="tag">'+escape((p.city||'城市待确认')+' · '+p.type+' · '+flags)+'</span>'+
   '<label>所在城市<input data-place-city="'+p.id+'" maxlength="40" value="'+escape(p.city)+'" placeholder="仅查地图或门票时需要"></label>'+
   (p.hint?'<p class="muted">'+escape(p.hint)+'</p>':'')+'<p class="muted">'+location+'</p>'+
   (evidence?'<details><summary>原文依据（'+p.evidence.length+'）</summary>'+evidence+'</details>':'')+
   '<div class="actions">'+button('locate',p.location?'更换地图地点':'确认地图地点',p.id)+
   button('save',p.saved?'取消收藏':'收藏此处',p.id)+(canAdd?button('add-from-library','加入当前行程',p.id):'')+'</div>'+
   (sameSite?'<details><summary>合并别名或重复记录</summary>'+sameSite+'</details>':'')+'</article>';
 }).join('')||'<p class="muted">这里还没有地点。</p>');
}

$('#library-search').addEventListener('input',renderPlaces);

function routeLabel(dayId,key,minutes){
 return (routeModes.get(dayId)?.[key]==='driving'?'驾车':'步行')+'约 '+minutes+' 分钟';
}

function changeMapView(change,dx=0,dy=0){
 if($('#overview-map').hidden||!currentMapView)return;
 const {x,y,zoom}=currentMapView;
 const next=Math.max(1,Math.min(17,zoom+change));
 const scale=256*2**zoom;
 mapViews.set(planTab,{x:Math.max(-.5,Math.min(.5,x-dx/scale)),y:Math.max(-.49,Math.min(.49,y+dy/scale)),zoom:next});
 renderPlanMap();
}

const overviewMap=$('#overview-map');
const mapPointers=new Map();
overviewMap.addEventListener('pointerdown',event=>{
 if(event.button!==0||mapPointers.size>=2)return;
 overviewMap.setPointerCapture(event.pointerId);
 const {clientX:x,clientY:y}=event;
 mapPointers.set(event.pointerId,{x,y,startX:x,startY:y});
});
overviewMap.addEventListener('pointermove',event=>{
 const pointer=mapPointers.get(event.pointerId);
 if(pointer)Object.assign(pointer,{x:event.clientX,y:event.clientY});
});
overviewMap.addEventListener('pointercancel',()=>mapPointers.clear());
overviewMap.addEventListener('pointerup',event=>{
 const first=mapPointers.get(event.pointerId);
 if(!first)return;
 const second=[...mapPointers.values()].find(pointer=>pointer!==first);
 mapPointers.clear();
 const dx=event.clientX-first.startX,dy=event.clientY-first.startY;
 if(second){
  const start=Math.hypot(first.startX-second.startX,first.startY-second.startY);
  const end=Math.hypot(event.clientX-second.x,event.clientY-second.y);
  if(start>=10&&end>0){
   const change=Math.round(Math.log2(end/start)*1.5);
   if(change)changeMapView(change);
  }
 }else if(Math.hypot(dx,dy)>5){
  const rect=overviewMap.getBoundingClientRect();
  const ratio=Math.min(rect.width/overviewMap.width,rect.height/overviewMap.height);
  if(ratio)changeMapView(0,dx/ratio,dy/ratio);
 }
});

function drawDay(canvas,day,connect=true,paths){
 const points=day.stops.flatMap((s,i)=>{
  const p=placeById(s.placeId)?.location;
  return p?[{...p,index:i+1}]:[];
 });
 if(!points.length){canvas.hidden=true;return;}
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 const all=[...points,...(paths?[...paths.values()].flat():[])];
 const mercator=lat=>Math.asinh(Math.tan(Math.min(85,Math.max(-85,lat))*Math.PI/180))/(2*Math.PI);
 const box=all.reduce((b,p)=>{
  const x=p.lng/360,y=mercator(p.lat);
  return [Math.min(b[0],x),Math.max(b[1],x),Math.min(b[2],y),Math.max(b[3],y)];
 },[Infinity,-Infinity,Infinity,-Infinity]);
 const [left,right,bottom,top]=box;
 const fittedZoom=Math.max(1,Math.min(17,Math.floor(Math.log2(Math.min(
  (w-116)/Math.max(right-left,1e-9),(h-88)/Math.max(top-bottom,1e-9))/256))));
 const interactive=canvas.id==='overview-map';
 const {x:centerX,y:centerY,zoom}= (interactive&&mapViews.get(planTab))||{x:(left+right)/2,y:(bottom+top)/2,zoom:fittedZoom};
 if(interactive){
  currentMapView={x:centerX,y:centerY,zoom};
  $('.map-controls [data-action="map-in"]').disabled=zoom===17;
  $('.map-controls [data-action="map-out"]').disabled=zoom===1;
 }
 const scale=256*2**zoom;
 const x=p=>w/2+(p.lng/360-centerX)*scale;
 const y=p=>h/2+(centerY-mercator(p.lat))*scale;
 const center={lng:Number((centerX*360).toFixed(6)),lat:Number((Math.atan(Math.sinh(centerY*2*Math.PI))*180/Math.PI).toFixed(6)),zoom};
 const signature=JSON.stringify(center);
 const frame=String(Number(canvas.dataset.mapFrame||0)+1);
 canvas.dataset.mapFrame=frame;
 function paint(background){
 if(canvas.dataset.mapFrame!==frame||canvas.hidden)return;
 canvas.dataset.basemap=background?'amap':'schematic';
 ctx.clearRect(0,0,w,h);
 if(background)ctx.drawImage(background,0,0,w,h);
 if(connect)for(let i=1;i<points.length;i++){
  const p=points[i],prev=points[i-1];
  if(prev.index!==p.index-1)continue;
  const path=paths?.get(routeKey(day.stops[prev.index-1],day.stops[p.index-1]));
  ctx.strokeStyle=path?'#247653':'#607e73';ctx.lineWidth=path?5:2;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(path?[]:[5,4]);ctx.beginPath();
  (path||[prev,p]).forEach((point,i)=>i?ctx.lineTo(x(point),y(point)):ctx.moveTo(x(point),y(point)));
  if(path){ctx.strokeStyle='#fff';ctx.lineWidth=8;ctx.stroke();ctx.strokeStyle='#247653';ctx.lineWidth=5;}
  ctx.stroke();ctx.setLineDash([]);
 }
 const clusters=[];
 for(const p of points){
  if(x(p)<0||x(p)>w||y(p)<0||y(p)>h)continue;
  const group=clusters.find(g=>Math.hypot(x(g.point)-x(p),y(g.point)-y(p))<34);
  if(group)group.indices.push(p.index);
  else clusters.push({point:p,indices:[p.index]});
 }
 for(const {point:p,indices} of clusters){
  const label=indices.length===1?String(indices[0]):indices.join('·');
  const shown=label.length>11?'+'+indices.length:label;
  ctx.font='bold 14px sans-serif';
  const width=Math.max(26,ctx.measureText(shown).width+16),px=Math.min(w-width/2,Math.max(width/2,x(p)));
  ctx.fillStyle='#23483b';ctx.beginPath();ctx.roundRect(px-width/2,y(p)-13,width,26,9);ctx.fill();
  ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='white';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(shown,px,y(p));
 }
 }
 if(!['overview-map','library-map'].includes(canvas.id)){paint();return;}
 if(!streetImages.has(signature)){
  if(streetImages.size>=8)streetImages.delete(streetImages.keys().next().value);
  streetImages.set(signature,(async()=>{
   // Route checks and images share the local API, so retry a busy response briefly.
   for(let attempt=0;attempt<6;attempt++){
    const response=await fetch('/api/guide/map',{method:'POST',headers:{'Content-Type':'application/json'},body:signature});
    if(response.ok)return createImageBitmap(await response.blob());
    if(response.status!==429)throw Error('地图暂不可用');
    await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
   }
   throw Error('地图暂不可用');
  })().catch(()=>{streetImages.delete(signature);return null;}));
 }
 paint();void streetImages.get(signature).then(image=>{if(image)paint(image);});
}

function renderDays(){
 const saved=state.places.filter(p=>p.saved&&(!state.planPlaceIds||state.planPlaceIds.includes(p.id))&&!state.days.some(d=>d.stops.some(s=>s.placeId===p.id)));
 $('#saved-places').innerHTML=saved.length?'<h3>从收藏加入路线</h3>'+saved.map(p=>'<label>'+escape(p.name)+'<select data-add="'+escape(p.id)+'"><option value="">选择日期</option>'+
  state.days.map((d,i)=>'<option value="'+d.id+'">第 '+(i+1)+' 天 · '+dateOfDay(d)+'</option>').join('')+
  '</select></label>').join(''):'';
 $('#days').innerHTML=state.days.map((day,index)=>{
  const durations=routeByDay.get(day.id)||{};
  const cards=day.stops.map((s,i)=>{
   const p=placeById(s.placeId),from=day.stops[i-1],duration=from&&durations[routeKey(from,s)];
   const previous=s.locked?'':' '+button('up','上移',s.id,i===0?'disabled':'')+button('down','下移',s.id,i===day.stops.length-1?'disabled':'');
   return (from?'<p class="muted">上一站 → 此站 · '+(Number.isFinite(duration)?'高德'+routeLabel(day.id,routeKey(from,s),duration):'路程待核对')+'</p>':'')+
    '<article class="card"><h3>'+(i+1)+'. '+escape(p?.name)+'</h3>'+
    '<div class="row"><label>开始 / 预约时间<input type="time" data-start="'+s.id+'" value="'+escape(s.start)+'" '+(s.locked?'disabled':'')+'></label>'+
    '<label>停留分钟<input type="number" min="5" max="720" data-stay="'+s.id+'" value="'+s.stay+'" '+(s.locked?'disabled':'')+'></label></div>'+
    '<div class="actions">'+button('lock',s.locked?'解锁':'锁定',s.id)+previous+
    (s.locked?'':button('remove','移回收藏',s.id))+'</div>'+
    (!s.locked&&state.days.length>1?'<label>移到其他天<select data-move="'+s.id+'"><option value="">选择日期</option>'+
     state.days.filter(d=>d!==day).map(d=>'<option value="'+d.id+'">'+dateOfDay(d)+'</option>').join('')+'</select></label>':'')+
    '<p class="muted">开放及预约要求待核对</p></article>';
  }).join('');
  return '<article class="card"><div class="title-row"><h3>第 '+(index+1)+' 天 · '+dateOfDay(day)+'</h3>'+
   (!day.stops.length&&state.days.length>1?button('remove-day','移除空白天',day.id):'')+'</div>'+
   (cards||'<p class="muted">自由安排。可从上方收藏选择地点加入这一天。</p>')+
   (day.stops.some(s=>placeById(s.placeId)?.location)?'<canvas width="490" height="130" data-canvas="'+day.id+'" aria-label="按坐标绘制的游览顺序"></canvas><p class="muted">已确认地点的顺序示意，虚线表示游览顺序。</p>':'')+
   '<p class="muted" id="edit-'+day.id+'" role="status"></p></article>';
 }).join('');
 document.querySelectorAll('[data-canvas]').forEach(c=>drawDay(c,state.days.find(d=>d.id===c.dataset.canvas)));
 $('#checks').innerHTML=state.days.map((day,index)=>{
  const durations=routeByDay.get(day.id)||{};
  const warnings=inspectDay(day.stops,state.places,durations);
  const proposal=proposals.get(day.id);
  const stops=day.stops.map((stop,i)=>{
   const from=day.stops[i-1],key=from&&routeKey(from,stop),duration=durations[key];
   const place=placeById(stop.placeId);
   const issue=routeIssues.get(day.id)?.[key];
   const label=Number.isFinite(duration)?'高德'+routeLabel(day.id,key,duration):
    issue==='unavailable'?'高德未返回可用路线':!place?.location||!placeById(from?.placeId)?.location?'未匹配到可靠站点':
    routeByDay.has(day.id)?'本次未取得路线':'待自动核对';
   return (from?'<p class="muted">'+label+'</p>':'')+
    '<div class="title-row route-stop"><span>'+escape(place?.name)+(stop.start?' · '+escape(stop.start):'')+'</span>'+
    (place?button('locate',place.location?'修改位置':'确认位置',place.id):'')+'</div>';
  }).join('');
  return '<article class="card"><h3>第 '+(index+1)+' 天 · '+dateOfDay(day)+'</h3>'+
   (stops||'<p class="muted">自由安排。</p>')+
   (warnings.length?warnings.map(w=>'<p class="notice">'+escape(w)+'</p>').join(''):
    day.stops.length?'<p class="muted">已填时段暂无冲突。开放时间及未查询路段待核对。</p>':'')+
   (day.stops.length>1?'<div class="actions">'+button('route','重新核对路线',day.id)+button('suggest','建议顺序',day.id)+'</div>':'')+
   (proposal?'<div class="notice"><p>建议按直线距离调整未锁定、未填时间的地点：</p><p>'+
    proposal.map(s=>escape(placeById(s.placeId)?.name)).join(' → ')+'</p><div class="actions">'+button('apply','确认调整',day.id)+button('discard','保留现有顺序',day.id)+button('explain','AI 解释调整',day.id)+'</div><p id="explain-'+day.id+'" role="status"></p></div>':'')+
   '<p class="muted" id="route-'+day.id+'" role="status"></p></article>';
 }).join('');
 $('#visits').innerHTML=state.days.filter(d=>d.stops.length).map(day=>'<article class="card"><h3>'+dateOfDay(day)+'</h3>'+
  day.stops.map(s=>'<div class="title-row"><span>'+escape(placeById(s.placeId)?.name)+'</span>'+button('detail','门票',s.placeId)+'</div>').join('')+'</article>').join('')||
  '<p class="muted">暂无已安排地点。</p>';
 renderPlan();
}

function updateServiceHints(){
 const anchors=state.days.flatMap(d=>[d.stops[0],d.stops.at(-1)]).filter(Boolean).map(s=>placeById(s.placeId)).filter(p=>p?.city===state.city);
 const counts=new Map();
 for(const p of anchors){
  const name=p.location?.district||p.hint||p.location?.name||p.name;
  counts.set(name,(counts.get(name)||0)+1);
 }
 const areas=[...counts].sort((a,b)=>b[1]-a[1]).map(([name])=>name);
 $('#areas').textContent=areas.length?'可优先查首末站附近：'+areas.slice(0,3).join('、'):'';
 const hotel=$('#hotel'),transport=$('#transport');
 if(areas.length&&(!hotel.area.value||hotel.area.value===hotel.area.dataset.suggested)){
  hotel.area.value=areas[0];hotel.area.dataset.suggested=areas[0];
 }
 const first=state.days[0].stops.filter(s=>s.start).map(s=>s.start).sort()[0];
 const last=state.days.at(-1).stops.filter(s=>s.start).map(s=>minutes(s.start)+s.stay).sort((a,b)=>b-a)[0];
 const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const defaults=[
  [hotel.arrival,state.start],[hotel.departure,dateOffset(state.start,Math.max(1,state.days.length-1))],
  [transport.arrival,state.start],[transport.departure,dateOffset(state.start,state.days.length-1)],
  [transport.arriveBy,first?clock(Math.max(0,minutes(first)-90)):''],
  [transport.leaveAfter,Number.isFinite(last)&&last+90<1440?clock(last+90):'']
 ];
 for(const [field,value] of defaults){
  if(!field.value||field.value===field.dataset.suggested){field.value=value;field.dataset.suggested=value;}
 }
 $('#transport-hint').textContent=first||last?'初始时刻按当天首末活动预留 90 分钟，请结合实际接驳修改。':'';
}

function render(){
 const planned=state.days.flatMap(d=>d.stops.map(s=>placeById(s.placeId)));
 const cities=[...new Set((planned.length?planned:state.places.filter(p=>p.saved&&(!state.planPlaceIds||state.planPlaceIds.includes(p.id)))).map(p=>p?.city).filter(Boolean))];
 state.city=cities.length===1?cities[0]:'';
 renderPlaces();renderReview();renderDays();updateServiceHints();persist();
}

function invalidate(day){
 routeByDay.delete(day.id);routeIssues.delete(day.id);routeShapes.delete(day.id);routeModes.delete(day.id);proposals.delete(day.id);
}
function clearChecks(){state.days.forEach(invalidate);}
function findStop(key){
 const day=state.days.find(d=>d.stops.some(s=>s.id===key));
 return day?{day,stop:day.stops.find(s=>s.id===key)}:{};
}
function addPlaces(places){
 state.places=mergePlaces(state.places,places);
 render();
}

async function imageData(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15_000_000)throw Error('截图须为 JPEG、PNG 或 WebP，单张原图不超过 15 MB。');
 const image=await createImageBitmap(file);
 try{
  const ratio=Math.min(1,2400/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
  const context=canvas.getContext('2d');
  context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const value=canvas.toDataURL('image/jpeg',.84);
  if(value.length>1500000)throw Error('截图压缩后仍过大，请裁出包含地点的部分。');
  return value;
 }finally{image.close();}
}

function message(target,text){target.textContent=text;}
async function run(target,task){
 if(pending)return;
 pending=true;
 updateRecognize();
 const active=document.activeElement;
 const button=active instanceof HTMLButtonElement?active:null;
 if(button)button.disabled=true;
 try{await task();}
 catch(e){message(target,e.message||'操作未完成。');}
 finally{pending=false;if(button?.isConnected)button.disabled=false;updateRecognize();}
}

$('#trip-date').value=state.start;
$('#trip-date').onchange=e=>{
 if(!e.target.value||pending||state.days.some(d=>d.stops.some(s=>s.locked))&&!confirm('改变开始日期会移动所有天，包括锁定站点。确定修改？')){e.target.value=state.start;return;}
 state.start=e.target.value;clearChecks();render();
};
const importForm=$('#import');
const recognize=$('#recognize');
const importPlaceholder=importForm.text.placeholder;
let bodyOnly=false;
function setBodyOnly(enabled){
 bodyOnly=enabled;
 $('#import-title').textContent=enabled?'正文识别':'文本或链接识别';
 importForm.text.placeholder=enabled?'粘贴笔记正文，可保留正文里的链接。':importPlaceholder;
 $('#back-to-link').hidden=!enabled;
}
const updateRecognize=()=>{
 recognize.disabled=pending;
 recognize.textContent=pending?'处理中…':'开始识别';
};
updateRecognize();
importForm.onsubmit=e=>{e.preventDefault();submitImport([]);};
importForm.images.onchange=()=>{
 const files=[...importForm.images.files];
 importForm.images.value='';
 if(files.length)submitImport(files);
};
function submitImport(files){
 const form=importForm,target=$('#import-status');
 run(target,async()=>{
  const recovery=$('#link-recovery');
  const value=files.length?'':form.text.value.trim();
  const lines=bodyOnly?[]:extractShareLinks(value);
  const texts=!lines.length&&value?value.split(/\r?\n\s*\r?\n/):[];
  if(!lines.length&&!texts.length&&!files.length)throw Error('请先添加链接、截图或正文。');
  if(lines.length+texts.length+files.length>8||files.length>4)throw Error('每批最多 8 个来源，其中最多 4 张图。');
  message(target,'正在识别…');
  const sources=[
   ...lines.map((value,i)=>({kind:'link',label:'链接 '+(i+1),value})),
   ...texts.map((value,i)=>({kind:'text',label:'粘贴正文 '+(i+1)+' · '+value.slice(0,35),value})),
   ...await Promise.all(files.map(async file=>({kind:'image',label:file.name,value:await imageData(file)})))
  ];
  const result=await api('extract',{sources});
  if(!$('#import-sheet').open)return;
  message(target,result.warnings.join(' ')||'未找到可确认的地点。');
  if(lines.length&&!result.places.length){
   recovery.innerHTML=lines.map((url,i)=>link(url,lines.length===1?'打开原文':'打开原文 '+(i+1))).join('')+
    button('choose-image','改用截图')+button('focus-text','改用正文');
   recovery.hidden=false;
  }
  if(result.places.length){
   const heading=value.split(/\r?\n|https?:\/\//i)[0].trim().slice(0,64);
   openReview(result.places,{title:(result.title||heading||files[0]?.name||'导入的攻略')+(sources.length>1?' · 共 '+sources.length+' 份':''),
    thumb:result.cover||(sources[0].kind==='image'?sources[0].value:''),warnings:result.warnings,dayCount:result.dayCount,
    days:result.places.map(p=>p.evidence.find(e=>e.day)?.day)});
  }
 });
}
$('#manual').onsubmit=e=>{
 e.preventDefault();
 if(pending)return;
 const input=e.currentTarget.elements.name;
 const name=input.value.trim();
 if(!name)return;
 addPlaces([{id:id(),city:'',name,hint:'',type:'其他',evidence:[],saved:false}]);
 input.value='';
};

function productList(data,{transport=false}={}){
 const items=data.items||[];
 return '<p class="muted">'+escape(data.source)+' · '+escape(new Date(data.queriedAt).toLocaleString('zh-CN'))+'</p>'+
  (items.length?items.map(p=>'<article class="card"><b>'+escape(p.name)+'</b>'+
   (p.productName?'<p>'+escape(p.productName)+'</p>':'')+
   (p.address?'<p>'+escape(p.address)+'</p>':'')+
   (transport?'<p>'+escape([p.departureDate,p.departure,p.departureStation].filter(Boolean).join(' ')+' → '+
    [p.arrivalDate,p.arrival,p.arrivalStation].filter(Boolean).join(' ')+(p.duration?' · '+p.duration+' 分钟':''))+'</p>':'')+
   '<p class="muted">'+escape(p.price?'飞猪参考价 '+p.price+' · 计价请核对':'暂无报价')+'</p>'+link(p.jumpUrl,'去飞猪核对')+'</article>').join(''):'<p>未找到符合条件的候选。</p>');
}

const ticketQueries=new Map();
function queryPlaceTickets(place){
 const city=place.city?.trim();
 const name=place.location?.name||place.name;
 const key=JSON.stringify([city,name]);
 const previous=ticketQueries.get(key);
 if(previous&&Date.now()-previous.time<300000)return previous.request;
 const request=api('tickets',{city,name},100000).catch(error=>{
  ticketQueries.delete(key);
  throw error;
 });
 if(ticketQueries.size>=40)ticketQueries.delete(ticketQueries.keys().next().value);
 ticketQueries.set(key,{request,time:Date.now()});
 return request;
}

const comparePlaceName=name=>String(name||'').normalize('NFKC').replace(/[\s·・]/g,'').toLowerCase();
async function loadPlaceTickets(place){
 const target=$('#ticket-results');
 if(!target)return;
 if(!place.city?.trim()){
  target.textContent='补充地点所在城市后可查票。';
  return;
 }
 target.textContent='正在查询飞猪门票…';
 try{
  const data=await queryPlaceTickets(place);
  if(!target.isConnected||!$('#detail').open)return;
  const names=[place.name,place.location?.name,data.matchName].filter(Boolean).map(comparePlaceName);
  const matches=data.items.filter(item=>names.includes(comparePlaceName(item.name)));
  const info=matches.find(item=>item.description||item.image||item.address);
  if(info){
   if(info.image)$('#detail-photo').innerHTML='<img alt="'+escape(info.name)+'" src="'+escape(info.image)+'" referrerpolicy="no-referrer">';
   if(info.description){
    $('#provider-intro').textContent=info.description;
    $('#provider-intro-source').hidden=false;
   }
   if(!place.location?.address&&info.address)$('#detail-address').textContent=info.address;
  }
  const products=matches.filter(item=>item.price||item.productName);
  const sourceLink=matches.map(item=>link(item.jumpUrl,'去飞猪查看景点')).find(Boolean)||'';
  const related=data.items.filter(item=>item.name===data.relatedName&&(item.price||item.productName)&&!matches.includes(item));
  const noQuote=matches.length?'飞猪已找到该地点，暂未返回该景点的门票报价。':'飞猪暂未匹配到该景点。';
  if(!products.length&&!related.length){
   target.innerHTML='<p class="muted">'+noQuote+'</p>'+sourceLink+
    (data.relatedUnavailable?'<p class="muted">关联夜游查询暂未完成。</p>':'');
   return;
  }
  target.innerHTML=(!products.length?'<p class="muted">'+noQuote+'</p>'+sourceLink:'')+[...products,...related].map(item=>{
   const price=item.price&&(/^\d/.test(item.price)?'¥'+item.price:item.price);
   return '<article class="ticket-card"><strong>'+escape((related.includes(item)?item.name+' · ':'')+(item.productName||'飞猪关联门票'))+'</strong>'+
    '<p class="ticket-price">'+escape(price?'参考价 '+price:'暂无报价')+'</p>'+
    '<p class="muted">'+escape(item.priceDate?'适用日期 '+item.priceDate+' · 票种和余票以飞猪为准':'适用日期、票种和余票以飞猪为准')+'</p>'+
    link(item.jumpUrl,'去飞猪核对')+'</article>';
  }).join('');
 }catch(error){
  const message=error.name==='TimeoutError'?'飞猪查询超时，请重试。':error.message||'飞猪暂时无法查询。';
  if(target.isConnected&&$('#detail').open)target.innerHTML='<p class="muted">'+escape(message)+'</p>'+button('ticket','重新查询',place.id);
 }
}

function hotelPrice(item){
 const value=String(item.price??'').trim().match(/^[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)$/);
 return value?Number(value[1]):null;
}

function hotelCards(items,canSave,reasons){
 return items.map((item,index)=>'<article class="hotel-card">'+
  (safeURL(item.image)?'<img loading="lazy" alt="" src="'+escape(item.image)+'">':'<span class="hotel-image-empty" aria-hidden="true">住</span>')+
  '<div class="hotel-card-content"><h3>'+escape(item.name)+'</h3>'+
  (item.category?'<span class="tag">'+escape(item.category)+'</span>':'')+
  (item.rating?'<span class="tag">评分 '+escape(item.rating)+'</span>':'')+
  (item.address?'<p>'+escape(item.address)+'</p>':'')+
  (item.nearby&&item.nearby!==item.address?'<p class="muted">'+escape(item.nearby)+'</p>':'')+
  (reasons.has(item)?'<div class="hotel-reason">'+(reasons.get(item).startsWith('查询范围 · ')?'':'<b>推荐依据</b>')+'<p>'+escape(reasons.get(item)).replaceAll('\n','<br>')+'</p></div>':'')+
  '<div class="hotel-card-footer"><div class="actions">'+link(item.jumpUrl,'查看房价')+
  (canSave?'<button type="button" class="secondary" data-hotel-index="'+index+'">加入计划</button>':'')+'</div>'+
  (item.price?'<p class="hotel-price"><small>飞猪参考价</small><strong>'+escape(hotelPrice(item)!==null?'¥'+hotelPrice(item):item.price)+'</strong></p>':
   '<p class="muted">暂无报价</p>')+'</div></div></article>').join('');
}

const hotelBudgetPresets=[[0,200],[200,350],[350,450],[450,550],[550,850],[850,1400],[1400,1900],[1900,'']];
function hotelPriceFilters(){
 return '<details class="hotel-price-filters"><summary>价格与星级 <small id="hotel-price-summary"></small></summary>'+
  '<div class="hotel-range" id="hotel-range"><input type="range" min="0" max="1900" step="10" name="minSlider" aria-label="最低预算">'+
  '<input type="range" min="0" max="1900" step="10" name="maxSlider" aria-label="最高预算"></div>'+
  '<div class="hotel-search-filters"><label>最低预算<input type="number" name="minBudget" min="0" max="100000" placeholder="¥0"></label>'+
  '<label>最高预算<input type="number" name="maxBudget" min="1" max="100000" placeholder="不限"></label></div>'+
  '<div class="hotel-filter-grid" aria-label="预算区间">'+hotelBudgetPresets.map(([min,max])=>
   '<button type="button" class="secondary" aria-pressed="false" data-budget-min="'+min+'" data-budget-max="'+max+'">'+
   (min===0?'¥'+max+'以内':max===''?'¥'+min+'以上':'¥'+min+'–'+max)+'</button>').join('')+'</div>'+
  '<fieldset class="hotel-stars"><legend>星级</legend><div class="hotel-filter-grid">'+
  [['1,2','二星及以下'],['3','三星'],['4','四星'],['5','五星']].map(([value,label])=>
   '<label class="hotel-filter-chip"><input type="checkbox" name="hotelStars" value="'+value+'"><span>'+label+'</span></label>').join('')+
  '</div></fieldset></details>';
}

function openHotelSearch({place,recommend=false,draft=false,initial}){
 const body=$('#hotel-search-body');
 const rows=draft?reviewed().filter(p=>selected.has(p.id)):[];
 const days=draft?makeDays(rows):state.days;
 const planId=state.planId;
 const tripDay=place?days.findIndex(day=>day.stops.some(stop=>stop.placeId===place.id)):-1;
 const start=draft?date():state.start;
 const planned=dateOffset(start,Math.max(0,tripDay));
 const arrival=initial?.arrival||(planned>=date()?planned:date());
 const dayPlaces=day=>day.stops.map(stop=>placeById(stop.placeId)).filter(Boolean);
 const nights=days.slice(0,-1).map((day,index)=>{
  const stops=dayPlaces(day);
  const next=dayPlaces(days[index+1])[0];
  const anchor=stops.findLast(p=>p.city?.trim())||stops.at(-1);
  return {index,anchor,next,end:stops.at(-1)};
 });
 const usable=nights.filter(n=>n.anchor);
 const sameCity=usable.length===nights.length&&usable.length>1&&usable.every(n=>n.anchor.city)&&new Set(usable.map(n=>n.anchor.city)).size===1;
 const anchorName=p=>p.location?.name||p.name;
 hotelBack={page:document.body.dataset.page,detail:$('#detail').open};
 if(hotelBack.detail)$('#detail').close();
 location.hash='hotel-search';
 $('#hotel-search-title').textContent=recommend?'按行程推荐酒店':'附近酒店';
 if(recommend&&!usable.length){
  body.innerHTML='<p>请先为住宿当天添加地点。</p>';
  return;
 }
 const regions=recommend?'<label>住宿方案<select name="stay">'+
  (sameCity?'<option value="all">连续入住 · 尽量不换酒店</option>':'')+
  usable.map(n=>'<option value="'+n.index+'">第 '+(n.index+1)+' 晚 · '+escape(anchorName(n.anchor))+'</option>').join('')+'</select></label><p id="hotel-anchor" class="muted"></p><label id="hotel-city-needed">住宿城市<input name="recommendCity" maxlength="40"></label>':
  '<div class="hotel-search-filters hotel-location-row">'+
  '<label>城市<input name="city" required maxlength="40" value="'+escape(place.city||'')+'"></label>'+
  '<label>查询地标<input name="landmark" required maxlength="100" value="'+escape(anchorName(place))+'"></label>'+
  '<label>酒店名称或品牌<input name="keyword" maxlength="100"></label></div>';
 body.innerHTML='<div id="hotel-result-toolbar" hidden><strong id="hotel-result-anchor"></strong><div class="actions">'+
  '<button type="button" class="secondary" id="hotel-edit-search">修改搜索</button><button type="button" class="secondary" id="hotel-edit-filters">价格与星级</button></div></div>'+
  '<form id="hotel-search-form">'+regions+
  '<div class="hotel-search-dates"><label>'+(recommend?'出发日期':'入住')+'<input type="date" name="arrival" required min="'+date()+'" value="'+arrival+'"></label>'+
  (recommend?'':'<label>离店<input type="date" name="departure" required min="'+dateOffset(arrival,1)+'" value="'+dateOffset(arrival,1)+'"></label>')+'</div>'+
  '<div class="hotel-search-filters">'+
  (recommend?'<label id="hotel-travel-mode">交通方式<select name="mode"><option value="driving">驾车</option><option value="walking">步行</option></select></label>':'')+
  '<label>排序<select name="sort">'+(recommend?'<option value="recommend">推荐顺序</option>':'')+'<option value="distance">离地标近</option><option value="rate_desc">好评优先</option><option value="price_asc">低价优先</option><option value="price_desc">高价优先</option></select></label></div>'+
  (recommend?'<div class="hotel-search-filters" id="hotel-route-preferences"><label>推荐偏好<select name="preference"><option value="route">少走回头路</option><option value="price">优先控预算</option></select></label>'+
  '<label id="hotel-walking-anchor" hidden>步行查询地标<input name="walkingAnchor" maxlength="100"></label></div>':'')+
  hotelPriceFilters()+'<details><summary>住宿类型与床型</summary><div class="hotel-search-filters">'+
  '<label>住宿类型<select name="hotelType"><option value="">不限</option><option value="hotel">酒店</option><option value="homestay">民宿</option><option value="inn">客栈</option></select></label>'+
  '<label>床型<select name="bedType"><option value="">不限</option><option value="king">大床</option><option value="twin">双床</option><option value="multi">多床</option></select></label></div></details>'+
  '<div class="hotel-search-actions"><button>'+(recommend?'生成住宿建议':'搜索酒店')+'</button><button type="button" class="secondary" id="reset-hotel-filters">重置筛选</button></div></form><div id="hotel-search-results" aria-live="polite"></div>';
 const form=$('#hotel-search-form'),target=$('#hotel-search-results'),fields=form.elements,toolbar=$('#hotel-result-toolbar');
 const resultSort=document.createElement('select');
 resultSort.setAttribute('aria-label','酒店排序');
 resultSort.innerHTML=fields.sort.innerHTML;
 toolbar.querySelector('.actions').prepend(resultSort);
 resultSort.onchange=()=>{fields.sort.value=resultSort.value;if(options)drawHotels();};
 function editSearch(openFilters){
  form.hidden=false;toolbar.hidden=true;
  if(openFilters){
   const filters=form.querySelector('.hotel-price-filters');
   filters.open=true;filters.scrollIntoView({block:'start'});
  }else form.scrollIntoView({block:'start'});
 }
 $('#hotel-edit-search').onclick=()=>editSearch(false);
 $('#hotel-edit-filters').onclick=()=>editSearch(true);
 if(initial){
  fields.departure.value=initial.departure;
  fields.maxBudget.value=initial.budget;
 }
 let results=[],options=null;
 function selection(){
  return fields.stay.value==='all'?usable:[nights[Number(fields.stay.value)]];
 }
 function updatePriceFilters(){
  const min=Number(fields.minBudget.value),max=fields.maxBudget.value;
  fields.maxBudget.setCustomValidity(max&&Number(max)<min?'最高预算不能低于最低预算。':'');
  fields.minSlider.value=Math.min(min,1900);
  fields.maxSlider.value=Math.min(max||1900,1900);
  const range=$('#hotel-range');
  range.style.setProperty('--low',100*Number(fields.minSlider.value)/1900+'%');
  range.style.setProperty('--high',100*Number(fields.maxSlider.value)/1900+'%');
  for(const chip of form.querySelectorAll('[data-budget-min]')){
   chip.setAttribute('aria-pressed',Number(chip.dataset.budgetMin)===min&&chip.dataset.budgetMax===max);
  }
  const stars=form.querySelectorAll('input[name="hotelStars"]:checked').length;
  $('#hotel-price-summary').textContent=[max?'¥'+min+'–'+max:min?'¥'+min+'以上':'',stars?'已选 '+stars+' 档':''].filter(Boolean).join(' · ');
 }
 for(const chip of form.querySelectorAll('[data-budget-min]'))chip.onclick=()=>{
  const selected=chip.getAttribute('aria-pressed')==='true';
  fields.minBudget.value=selected?'':chip.dataset.budgetMin;
  fields.maxBudget.value=selected?'':chip.dataset.budgetMax;
  form.onchange();
 };
 for(const slider of [fields.minSlider,fields.maxSlider])slider.oninput=()=>{
  const value=Number(slider.value);
  if(slider===fields.minSlider)fields.minBudget.value=Math.min(value,Number(fields.maxSlider.value));
  else fields.maxBudget.value=value===1900?'':Math.max(1,value,Number(fields.minSlider.value));
  form.onchange();
 };
 for(const field of [fields.minBudget,fields.maxBudget])field.oninput=()=>form.onchange();
 function walkingLandmark(place){
  return huangguoshuPlace(place.city,anchorName(place))?'黄果树景区':anchorName(place);
 }
 function updateAnchor(){
  if(!recommend)return;
  const picked=selection(),first=picked[0];
  $('#hotel-city-needed').hidden=Boolean(first.anchor.city?.trim());
  fields.recommendCity.required=!first.anchor.city?.trim();
  $('#hotel-walking-anchor').hidden=fields.mode.value!=='walking';
  fields.walkingAnchor.placeholder=walkingLandmark(first.anchor);
  const interval=fields.arrival.value?' · '+dateOffset(fields.arrival.value,first.index)+' 至 '+dateOffset(fields.arrival.value,picked.at(-1).index+1):'';
  message($('#hotel-anchor'),(picked.length>1?'连住地标 · ':'住宿查询地标 · ')+anchorName(first.anchor)+
   (first.next?' · 次日首站 '+anchorName(first.next):'')+interval);
 }
 function drawHotels(){
  const sorted=[...results];
  const reasons=new Map();
  if(!recommend)for(const hotel of sorted){
   const names=(hotel.landmarkMatches||[]).map(match=>match.name);
   if(names.length)reasons.set(hotel,'查询范围 · '+names.join('、'));
  }
  if(recommend&&sorted.length){
   const expected=options.nights.flatMap(n=>[
    ...(n.end?.location?.provider==='amap'?[n.index+1+':in']:[]),
    ...(n.next?.location?.provider==='amap'?[n.index+1+':out']:[])
   ]);
   const comparedLegs=expected.slice(0,6);
   const comparable=sorted.filter(hotel=>comparedLegs.length&&comparedLegs.every(key=>hotel.routes?.some(route=>route.night+':'+route.direction===key)));
   const minutes=hotel=>hotel.routes.reduce((sum,leg)=>sum+leg.minutes,0);
   const byRoute=[...comparable].sort((a,b)=>minutes(a)-minutes(b));
   const byPrice=sorted.filter(hotel=>hotelPrice(hotel)!==null).sort((a,b)=>hotelPrice(a)-hotelPrice(b));
   if(byRoute.length>=2&&minutes(byRoute[0])<minutes(byRoute.at(-1)))reasons.set(byRoute[0],'已核实 '+comparedLegs.length+' 段中用时最短 · 约 '+minutes(byRoute[0])+' 分钟');
   for(const hotel of byRoute.slice(1)){
    const reference=byRoute[0];
    const tradeoff=options.nights.map(({index})=>{
     const leg=(item,direction)=>item.routes.find(route=>route.night===index+1&&route.direction===direction)?.minutes;
     const inbound=leg(hotel,'in')-leg(reference,'in');
     const outbound=leg(hotel,'out')-leg(reference,'out');
     return inbound*outbound<0?'第 '+(index+1)+' 晚比 '+reference.name+' · 末站'+(inbound<0?'少':'多')+Math.abs(inbound)+' 分钟，次日首站'+(outbound<0?'少':'多')+Math.abs(outbound)+' 分钟':'';
    }).find(Boolean);
    if(tradeoff)reasons.set(hotel,tradeoff);
   }
   if(byPrice.length>=2&&hotelPrice(byPrice[0])<hotelPrice(byPrice[1])){
    const cheaper=Number((hotelPrice(byPrice[1])-hotelPrice(byPrice[0])).toFixed(2));
    reasons.set(byPrice[0],[reasons.get(byPrice[0]),'参考价比次低候选少 ¥'+cheaper].filter(Boolean).join(' · '));
   }
   for(const hotel of sorted){
    const matches=hotel.landmarkMatches||[];
    const evidence=matches.map(match=>match.area?'由「'+match.name+'」范围补充':'按「'+match.name+'」查到，飞猪距离排序第 '+match.rank+' 位').join('；')||
     '飞猪按「'+options.landmark+'」返回的住宿候选。';
    const routes=options.nights.map(night=>{
     const legs=[['in',night.end],['out',night.next]].filter(([,place])=>place);
     return '第 '+(night.index+1)+' 晚，'+legs.map(([direction,place])=>{
      const route=hotel.routes?.find(leg=>leg.night===night.index+1&&leg.direction===direction);
      const name=anchorName(place);
      const segment=direction==='in'?name+' → 酒店':'酒店 → '+name;
      return segment+'，'+(route?'高德'+(route.mode==='driving'?'驾车':'步行')+'约 '+route.minutes+' 分钟':'耗时待核对');
     }).join('；')+'。';
    });
    const price=hotelPrice(hotel);
    const budgetEvidence=options.budget&&price!==null?'飞猪参考价 ¥'+price+'，低于或等于所设上限 ¥'+options.budget+'。':'';
    reasons.set(hotel,[reasons.get(hotel),evidence,...routes,budgetEvidence].filter(Boolean).join('\n'));
   }
   if(fields.sort.value==='recommend'){
    const preferred=fields.preference.value==='price'?byPrice:byRoute;
    sorted.splice(0,sorted.length,...preferred,...sorted.filter(hotel=>!preferred.includes(hotel)));
   }
  }
  if(fields.sort.value==='distance'&&options.distanceOrder){
   const order=new Map(options.distanceOrder.map((id,index)=>[id,index]));
   sorted.sort((a,b)=>order.get(a.id)-order.get(b.id));
  }
  if(['price_asc','price_desc','rate_desc'].includes(fields.sort.value)){
   const value=fields.sort.value==='rate_desc'?hotel=>hotel.rating||null:hotelPrice;
   const direction=fields.sort.value==='price_asc'?1:-1;
   sorted.sort((a,b)=>{
    const av=value(a),bv=value(b);
    return av==null||bv==null?Number(av==null)-Number(bv==null):(av-bv)*direction;
   });
  }
  const canSave=options?.nights.length>0;
  target.innerHTML='<p class="muted">'+escape(options.arrival+' 入住 · '+options.departure+' 离店 · '+options.source+' · 找到 '+options.returned+' 家 · 符合预算 '+sorted.length+' 家')+'</p>'+
   (options.landmarks?.length?'<p class="muted">'+escape('查询范围 · '+options.landmarks.join('、')+(options.partialSearch?' · 部分范围查询失败':''))+'</p>':'')+
   (!options.expanded?'<div class="actions"><button type="button" class="secondary" id="expand-hotel-search">扩大搜索范围</button></div>':'')+
   (options.agent?'<p class="muted">'+escape(options.agent)+'</p>':'')+
   (!recommend&&options.nights.length>1?'<label>加入哪一晚<select id="hotel-save-night">'+
    options.nights.map(n=>'<option value="'+n.index+'">第 '+(n.index+1)+' 晚</option>').join('')+'</select></label>':'')+
   (sorted.length?hotelCards(sorted,canSave,reasons):'<p>暂无符合筛选条件的酒店。</p>');
  const expand=target.querySelector('#expand-hotel-search');
  if(expand)expand.onclick=()=>searchHotels(true);
  target.querySelectorAll('[data-hotel-index]').forEach(control=>control.onclick=()=>{
   const hotel=sorted[Number(control.dataset.hotelIndex)];
   if(!draft&&state.planId!==planId)return;
   const selectedNights=options.nights;
   const choice=$('#hotel-save-night')?.value;
   const selected=choice==null?selectedNights:selectedNights.filter(n=>String(n.index)===choice);
   if(!selected.length)return;
   if(selected.some(n=>days[n.index].hotel)&&!confirm('替换对应晚的住宿？'))return;
   if(recommend&&!draft&&state.start!==options.start){
    if(!confirm('加入住宿时，将整份计划的出发日期改为 '+options.start+'，包括已锁定的站点。继续吗？'))return;
    state.start=options.start;$('#trip-date').value=state.start;clearChecks();
   }
   for(const n of selected)days[n.index].hotel={name:hotel.name,address:hotel.address||'',jumpUrl:hotel.jumpUrl||'',reason:reasons.get(hotel)||''};
   hotelBack=null;
   history.replaceState(null,'','#plan-days');
   if(draft)createReviewedPlan(rows,days,options.start);
   else{$('#detail').close();planTab=days[selected[0].index].id;openPlan();}
   showStep();window.scrollTo({top:0});
  });
 }
 form.onchange=event=>{
  options=null;target.replaceChildren();
  if(recommend&&event?.target===fields.stay)fields.walkingAnchor.value='';
  updatePriceFilters();
  if(fields.departure&&fields.arrival.value){
   fields.departure.min=dateOffset(fields.arrival.value,1);
   if(fields.departure.value<fields.departure.min)fields.departure.value=fields.departure.min;
  }
  updateAnchor();
 };
 $('#reset-hotel-filters').onclick=()=>{
  for(const key of ['minBudget','maxBudget','hotelType','bedType','keyword','walkingAnchor'])if(fields[key])fields[key].value='';
  form.querySelectorAll('input[name="hotelStars"]').forEach(input=>{input.checked=false;});
  fields.sort.selectedIndex=0;
  if(fields.preference)fields.preference.selectedIndex=0;
  form.onchange();
 };
 async function searchHotels(expand=false){
  if(form.dataset.busy)return;
  const picked=recommend?selection():[];
  const queryStart=fields.arrival.value;
  const first=picked[0],last=picked.at(-1);
  const checkIn=first?dateOffset(queryStart,first.index):queryStart;
  const checkOut=last?dateOffset(queryStart,last.index+1):fields.departure.value;
  const city=recommend?first.anchor.city?.trim()||fields.recommendCity.value.trim():fields.city.value.trim();
  const name=recommend?anchorName(first.anchor):fields.landmark.value.trim();
  const minBudget=Number(fields.minBudget.value),budget=fields.maxBudget.value;
  const hotelStar=[...form.querySelectorAll('input[name="hotelStars"]:checked')].map(input=>input.value).join(',');
  const previous=options;
  form.dataset.busy='true';
  resultSort.disabled=true;
  const controls=[...form.elements].filter(control=>!control.disabled);
  controls.forEach(control=>{control.disabled=true;});
  message(target,'正在查询飞猪酒店…');
  try{
   const data=await api('hotels',{city,name,arrival:checkIn,departure:checkOut,budget,sort:'distance_asc',expand,hotelType:fields.hotelType.value,hotelStar,bedType:fields.bedType.value,keyword:fields.keyword?.value,
    ...(recommend?{preference:fields.preference.value,mode:fields.mode.value,smartRank:!expand&&fields.sort.value==='recommend',
     walkingAnchor:fields.walkingAnchor.value.trim()||walkingLandmark(first.anchor),
     itinerary:picked.map(n=>({night:n.index+1,anchor:anchorName(n.anchor),next:n.next?anchorName(n.next):'',nextCity:n.next?.city,from:n.end?.location,to:n.next?.location}))}:{})});
   const candidates=data.items||[];
   results=candidates.filter(hotel=>{
    if(!budget&&!minBudget)return true;
    const price=hotelPrice(hotel);
    return price!==null&&price>=minBudget&&(!budget||price<=Number(budget));
   });
   const eligible=recommend?picked:hasPlan()?nights.filter(n=>{
    const day=dateOffset(start,n.index);
    return day>=checkIn&&day<checkOut&&(!n.anchor?.city||n.anchor.city.trim().replace(/市$/,'')===city.replace(/市$/,''));
   }):[];
   options={nights:eligible,arrival:checkIn,departure:checkOut,source:data.source||'飞猪 FlyAI',start:queryStart,agent:data.agent,distanceOrder:data.distanceOrder,landmarks:data.landmarks,partialSearch:data.partialSearch,returned:candidates.length,landmark:name,budget,expanded:expand};
   resultSort.value=fields.sort.value;
   drawHotels();
   if(document.body.dataset.page==='hotel-search'&&target.isConnected){
    form.hidden=true;toolbar.hidden=false;
    $('#hotel-result-anchor').textContent=city+' · '+name;
    window.scrollTo({top:0});
   }
  }catch(error){
   if(expand&&previous){drawHotels();const notice=document.createElement('p');notice.className='muted';notice.textContent=error.message;target.prepend(notice);}
   else message(target,error.message);
  }
  finally{delete form.dataset.busy;resultSort.disabled=false;controls.forEach(control=>{control.disabled=false;});}
 }
 form.onsubmit=event=>{event.preventDefault();void searchHotels();};
 form.onchange();
 if(initial&&form.checkValidity())form.requestSubmit();
}

function openDetail(place,locate){
 const dialog=$('#detail'),body=$('#detail-body');
 dialog.classList.toggle('poi-detail',!locate);
 $('#detail-title').textContent=place.name;
 const evidence=place.evidence?.find(entry=>entry.quote?.trim());
 body.innerHTML=locate?'<form id="locate-form"><label>城市<input name="city" required maxlength="40" value="'+escape(place.city||'')+'"></label><label>地图搜索关键词<input name="keyword" required maxlength="100" value="'+escape(place.name)+'"></label><button>搜索高德地点</button></form><div id="locate-results" aria-live="polite"></div>':
  '<div class="poi-meta"><span class="tag">'+escape(place.type||'地点')+'</span> <span class="tag">'+escape(place.city||'城市待确认')+'</span></div>'+
  '<p class="muted" id="detail-address">'+escape(place.location?.address||place.preview?.address||place.hint||'位置待确认')+'</p><div id="detail-photo">'+
  (safeURL(place.preview?.image)?'<img alt="" src="'+escape(place.preview.image)+'">':'')+'</div>'+
  '<div class="poi-section"><h3>地点介绍</h3><p id="provider-intro">'+escape(evidence?.quote||'暂无地点介绍。')+'</p>'+
  '<small id="provider-intro-source" class="muted" hidden>来源：飞猪 FlyAI</small>'+
  (evidence?'<details><summary>查看攻略原文</summary><p>'+escape(evidence.quote)+' '+link(evidence.url,'打开原攻略')+'</p></details>':'')+'</div>'+
  '<div class="poi-section"><h3>门票与预约</h3><div id="ticket-results" aria-live="polite"></div></div>'+
  '<div class="poi-section">'+button('nearby-hotel-search','查看附近酒店',place.id)+'</div>';
 if(!dialog.open)dialog.showModal();
 if(locate){
  $('#locate-form').onsubmit=e=>{
   e.preventDefault();
   const target=$('#locate-results'),name=e.currentTarget.keyword.value,city=e.currentTarget.city.value.trim();
   run(target,async()=>{
    message(target,'正在查找地点…');
    const data=await api('locate',{name,city});
    target.innerHTML=data.items.map((p,i)=>'<article class="card"><b>'+escape(p.name)+'</b><p>'+escape(p.district+' '+p.address)+'</p>'+
     button('choose-location','确认这一处',String(i))+'</article>').join('')||'<p>未找到匹配地点。可以换关键词，或先按原名收藏。</p>';
    target.querySelectorAll('[data-action="choose-location"]').forEach(b=>b.onclick=()=>{
     place.city=city;place.location=data.items[Number(b.dataset.key)];clearChecks();render();dialog.close();
     if(document.body.dataset.page==='check-route')void checkVisibleRoutes();
    });
   });
  };
 }else{
  void loadPlaceTickets(place);
 }
}

async function checkVisibleRoutes(){
 for(const day of state.days){
  if(document.body.dataset.page!=='check-route'||pending)break;
  if(day.stops.length>1&&!routeByDay.has(day.id))await checkDayRoute(day);
 }
}
async function checkSelectedRoute(){
 const day=state.days.find(item=>item.id===planTab);
 if(day&&day.stops.length>1&&!routeByDay.has(day.id)&&!pending)await checkDayRoute(day);
}

function checkDayRoute(day){
  const target=$('#route-'+day.id);
  return run(target,async()=>{
   const lookup=p=>p&&!p.location?{id:p.id,name:p.name,city:p.city||state.city,hint:p.hint,type:p.type,address:p.preview?.address}:undefined;
   const legs=day.stops.slice(1).map((s,i)=>{
    const from=placeById(day.stops[i].placeId),to=placeById(s.placeId);
    return {id:routeKey(day.stops[i],s),from:from?.location,to:to?.location,fromLookup:lookup(from),toLookup:lookup(to)};
   });
   message(target,'正在匹配地点并核对路线…');
   const result=[],issues=[];
   for(let i=0;i<legs.length;i+=12){
    const batch=await api('route',{legs:legs.slice(i,i+12)});
    result.push(...batch.legs);issues.push(...(batch.issues||[]));
    for(const match of batch.locations||[]){
     const place=placeById(match.id);
     if(place&&!place.location)place.location=match.location;
    }
    persist();
   }
   routeByDay.set(day.id,Object.fromEntries(result.map(l=>[l.id,l.minutes])));
   routeIssues.set(day.id,Object.fromEntries(issues.map(l=>[l.id,l.status])));
   routeShapes.set(day.id,new Map(result.filter(leg=>leg.polyline?.length).map(leg=>[leg.id,leg.polyline])));
   routeModes.set(day.id,Object.fromEntries(result.map(leg=>[leg.id,leg.mode||'walking'])));
   renderDays();message($('#route-'+day.id),'已核对 '+result.length+'/'+legs.length+' 段路线。');
  });
}

function moveStop(day,stop,direction){
 const i=day.stops.indexOf(stop),j=i+direction;
 if(stop.locked||!day.stops[j]||day.stops[j].locked)return;
 [day.stops[i],day.stops[j]]=[day.stops[j],day.stops[i]];
 invalidate(day);render();
}

document.addEventListener('change',e=>{
 const field=e.target;
 if(pending){if(field.closest('#days,#places,#saved-places'))render();return;}
 if(field.dataset.placeCity){
  const place=placeById(field.dataset.placeCity);
  const city=field.value.trim();
  if(place&&city!==place.city){place.city=city;delete place.location;clearChecks();render();}
 }
 if(field.dataset.add&&field.value){
  const place=placeById(field.dataset.add),day=state.days.find(d=>d.id===field.value);
  if(!place?.saved||!day)return;
  if(state.days.some(d=>d.stops.some(s=>s.placeId===place.id))){
   field.value='';return;
  }
  day.stops.push({id:id(),placeId:place.id,start:'',stay:60,locked:false});invalidate(day);render();
 }
 if(field.dataset.merge&&field.value){
  const from=placeById(field.dataset.merge),to=placeById(field.value);
  const plans=[state.days,...state.plans.map(p=>p.days)];
  const occurrences=plans.map(days=>days.flatMap(d=>d.stops).filter(s=>[from?.id,to?.id].includes(s.placeId)));
  if(!from||!to||occurrences.some(stops=>stops.length>1)||!confirm('确认这两条记录指向同一地点？')){
   field.value='';
   if(occurrences.some(stops=>stops.length>1))message($('#place-status'),'两处都已排入同一个计划，请先移出其中一处。');
   return;
  }
  to.evidence.push(...from.evidence);
  to.folderIds=[...new Set([to,from].flatMap(p=>p.saved?(p.folderIds||['default']):[]))];
  to.saved||=from.saved;to.location||=from.location;to.guide||=from.guide;
  for(const stops of occurrences)if(stops[0])stops[0].placeId=to.id;
  const replaceIds=ids=>ids&&[...new Set(ids.map(key=>key===from.id?to.id:key))];
  state.planPlaceIds=replaceIds(state.planPlaceIds);
  for(const plan of state.plans)plan.placeIds=replaceIds(plan.placeIds);
  state.places=state.places.filter(p=>p!==from);clearChecks();render();
 }
 if(field.dataset.start||field.dataset.stay||field.dataset.move){
  const {day,stop}=findStop(field.dataset.start||field.dataset.stay||field.dataset.move);
  if(!stop||stop.locked)return;
  if(field.dataset.start)stop.start=field.value;
  if(field.dataset.stay)stop.stay=Math.min(720,Math.max(5,Math.round(Number(field.value)||60)));
  if(field.dataset.move&&field.value){
   const target=state.days.find(d=>d.id===field.value);
   if(target){target.stops.push(stop);day.stops=day.stops.filter(s=>s!==stop);invalidate(target);}
  }
  if(field.dataset.move)invalidate(day);
  else proposals.delete(day.id);
  render();
 }
});

document.addEventListener('click',e=>{
 const b=e.target.closest('button[data-action],a[data-action]');
 if(b?.dataset.action==='backup-plans'){
  const field=$('#plan-backup');
  field.value=JSON.stringify(state);field.focus();field.select();
  message($('#backup-status'),'复制选中的备份文本，粘贴到新入口后恢复。');
  return;
 }
 if(b?.dataset.action==='restore-plans'){
  try{
   const restored=backupState($('#plan-backup').value);
   if((hasPlan()||state.plans.length||state.places.length||state.folders.length)&&!confirm('恢复备份将替换当前入口的计划和收藏。确定恢复？'))return;
   localStorage.setItem(storageKey,JSON.stringify(restored));
   location.reload();
  }catch{message($('#backup-status'),'恢复失败，请检查文本是否完整和本机存储是否可用。');}
  return;
 }
 if(!b)return;
 const {action,key}=b.dataset;
 if(action==='close'){$('#detail').close();return;}
 if(action==='close-hotel-search'){if(hotelBack)history.back();return;}
 if(pending)return;
 const place=placeById(key),day=state.days.find(d=>d.id===key);
 if(action==='nearby-hotel-search'&&place)openHotelSearch({place});
 if(action==='recommend-hotels'){$('#plan-tools').close();openHotelSearch({recommend:true,draft:key==='draft'});}
 if(action==='remove-stay'&&day){delete day.hotel;render();}
 if(action==='home'){editing=false;renderPlan();location.hash='plans';}
 if(action==='map-in'||action==='map-out')changeMapView(action==='map-in'?1:-1);
 if(action==='map-fit'){mapViews.delete(planTab);renderPlanMap();}
 if(action==='open-import'){message($('#import-status'),'');$('#link-recovery').hidden=true;setBodyOnly(false);location.hash='import-guide';}
 if(action==='close-import')$('#import-sheet').close();
 if(action==='choose-image')importForm.images.click();
 if(action==='focus-text'){
  if(!bodyOnly)importForm.text.value='';
  setBodyOnly(true);message($('#import-status'),'');updateRecognize();importForm.text.focus();
 }
 if(action==='reset-import-mode'){setBodyOnly(false);importForm.text.focus();}
 if(action==='plan-add')$('#plan-tools').showModal();
 if(action==='close-plan-tools')$('#plan-tools').close();
 if(action==='open-library'||action==='plan-library'){
  $('#plan-tools').close();
  libraryBack=action==='plan-library'?'plan-days':document.body.dataset.page==='profile'?'profile':'plans';
  renderPlaces();location.hash='library';
 }
 if(action==='add-from-library'&&place&&!state.days.some(d=>d.stops.some(s=>s.placeId===key))){
  const target=state.days.find(d=>d.id===planTab)||state.days[0];
  place.saved=true;if(state.planPlaceIds&&!state.planPlaceIds.includes(key))state.planPlaceIds.push(key);
  target.stops.push(stopFor(key));planTab=target.id;invalidate(target);render();location.hash='plan-days';
 }
 if(action==='library-back')location.hash=libraryBack;
 if(action==='review-places'||action==='review-days'){reviewTab=action==='review-places'?'places':'days';renderReview();}
 if(action==='pick'&&place){if(selected.has(key))selected.delete(key);else selected.add(key);renderReview();$('#review-list [data-action="pick"][data-key="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});}
 if(action==='select-all'){const rows=reviewed();if(rows.every(p=>selected.has(p.id)))selected.clear();else rows.forEach(p=>selected.add(p.id));renderReview();}
 if(action==='collect'&&selected.size){showCollectionChoices();$('#collection-sheet').showModal();}
 if(action==='close-collection')$('#collection-sheet').close();
 if(action==='new-folder'){
  $('#folder-editor').reset();$('#folder-editor').hidden=false;$('#collection-pick').hidden=true;
  $('#collection-title').textContent='新建收藏夹';$('#folder-editor').elements.title.focus();
 }
 if(action==='cancel-folder')showCollectionChoices();
 if(action==='filter-folder'){libraryFolder=key;renderPlaces();}
 if(action==='choose-plan'&&selected.size){$('#plan-choices').innerHTML=planChoices();$('#add-sheet').showModal();}
 if(action==='close-add')$('#add-sheet').close();
 if(action==='create-plan'&&selected.size){
  const rows=reviewed().filter(p=>selected.has(p.id));
  if(!rows.length)return;
  createReviewedPlan(rows,makeDays(rows),date());
 }
 if(action==='append-plan'&&selected.size&&loadPlan(key)){
  const target=state.days.find(day=>day.id===b.dataset.day);
  state.planPlaceIds??=[...new Set([...state.days.flatMap(day=>day.stops.map(stop=>stop.placeId)),...state.places.filter(p=>p.saved).map(p=>p.id)])];
  for(const p of reviewed().filter(p=>selected.has(p.id))){
   p.saved=true;
   if(state.planPlaceIds&&!state.planPlaceIds.includes(p.id))state.planPlaceIds.push(p.id);
   if(target&&!state.days.some(d=>d.stops.some(s=>s.placeId===p.id)))target.stops.push(stopFor(p.id));
  }
  planTab=target?.id||'pending';
  openPlan();
 }
 if(action==='resume-plan'&&loadPlan(key))openPlan();
 if(action==='plan-tab'){planTab=key;editing=false;renderPlan();void checkSelectedRoute();}
 if(action==='plan-edit'){editing=!editing;renderPlan();}
 if(action==='note'){
  const {stop}=findStop(key);
  if(stop){const note=prompt('站点备注',stop.note||'');if(note!==null){stop.note=note.trim().slice(0,200);render();}}
 }
 if(action==='new-day'&&state.days.length<14){state.days.push({id:id(),stops:[]});render();}
 if(action==='remove-day'&&day&&!day.stops.length&&state.days.length>1){
  const later=state.days.slice(state.days.indexOf(day)+1);
  if(later.some(d=>d.stops.some(s=>s.locked))){message($('#edit-'+day.id),'后续日期有锁定站点，无法移除此天。');return;}
  if(later.some(d=>d.stops.length)&&!confirm('移除这天会将后续行程提前一天。确定？'))return;
  state.days=state.days.filter(d=>d!==day);invalidate(day);render();
 }
 if(action==='save'&&place){
  if(place.saved&&[state.days,...state.plans.map(p=>p.days)].some(days=>days.some(d=>d.stops.some(s=>s.placeId===place.id)))){message($('#place-status'),'这个地点还在行程中，请先移回收藏。');return;}
  place.saved=!place.saved;
  delete place.folderIds;
  render();
 }
 if(action==='locate'&&place){
  openDetail(place,true);
 }
 if(action==='detail'&&place)openDetail(place,false);
 if(action==='ticket'&&place)void loadPlaceTickets(place);
 if(action==='route'&&day)void checkDayRoute(day);
 if(action==='suggest'&&day){
  const suggestion=suggestOrder(day.stops,state.places);
  if(suggestion.every((s,i)=>s===day.stops[i])){message($('#route-'+key),'没有可建议的改序。请确认地图位置，或手动移动未锁定的地点。');return;}
  proposals.set(key,suggestion);renderDays();
 }
 if(action==='apply'&&day&&proposals.has(key)){day.stops=proposals.get(key);invalidate(day);render();}
 if(action==='explain'&&day&&proposals.has(key)){
  const target=$('#explain-'+key);
  const names=stops=>stops.map(s=>placeById(s.placeId)?.name||'地点');
  run(target,async()=>{
   message(target,'正在解释调整依据…');
   const result=await api('explain',{before:names(day.stops),after:names(proposals.get(key)),warnings:inspectDay(day.stops,state.places,routeByDay.get(key))});
   message(target,result.explanation);
  });
 }
 if(action==='discard'&&day){proposals.delete(key);renderDays();}
 if(['lock','up','down','remove'].includes(action)){
  const found=findStop(key),stop=found.stop;
  if(!stop)return;
  if(action==='lock'){stop.locked=!stop.locked;proposals.delete(found.day.id);render();}
  if(action==='up'||action==='down')moveStop(found.day,stop,action==='up'?-1:1);
  if(action==='remove'&&!stop.locked){found.day.stops=found.day.stops.filter(s=>s!==stop);invalidate(found.day);render();}
 }
});

$('#folder-editor').onsubmit=event=>{
 event.preventDefault();
 const fields=new FormData(event.currentTarget);
 const title=fields.get('title').trim();
 if(!title){event.currentTarget.elements.title.focus();return;}
 const folder={id:id(),title,description:fields.get('description').trim(),icon:fields.get('icon')};
 state.folders.push(folder);persist();showCollectionChoices(folder.id);
};
$('#collection-pick').onsubmit=event=>{
 event.preventDefault();
 const key=new FormData(event.currentTarget).get('folder');
 if(!folders().some(folder=>folder.id===key))return;
 for(const place of reviewed().filter(p=>selected.has(p.id))){
  const previous=place.saved?(place.folderIds||['default']):[];
  place.folderIds=[...new Set([...previous,key])];place.saved=true;
 }
 $('#collection-sheet').close();render();
 const status=$('#collection-status');
 status.textContent='已加入'+folders().find(folder=>folder.id===key).title;
 status.hidden=false;
 clearTimeout(status.dismissTimer);
 status.dismissTimer=setTimeout(()=>{status.hidden=true;},3000);
};
$('#hotel').onsubmit=e=>{
 e.preventDefault();
 const initial=Object.fromEntries(new FormData(e.currentTarget));
 openHotelSearch({place:{name:initial.area,city:state.city},initial});
};
$('#transport').onsubmit=e=>{
 e.preventDefault();
 const fields=Object.fromEntries(new FormData(e.currentTarget)),target=$('#transport-result');
 run(target,async()=>{
  if(!state.city)throw Error('请先在「确认与收藏」补充所在城市，并安排同一城市的地点。');
  message(target,'正在查询所选方向和交通方式…');
  const data=await api('transport',{...fields,city:state.city});
  const {direction,mode,...conditions}=fields;
  const signature=JSON.stringify({...conditions,city:state.city});
  for(const [key,result] of transportResults)if(result.signature!==signature)transportResults.delete(key);
  const label=(direction==='outbound'?'去程':'返程')+' · '+(mode==='train'?'火车':'飞机');
  transportResults.set(direction+'/'+mode,{signature,label,data});
  target.innerHTML=[...transportResults.values()].map(r=>'<h3>'+r.label+'</h3>'+productList(r.data,{transport:true})).join('');
 });
};
render();
if(document.body.dataset.page==='check-route')void checkVisibleRoutes();
if(document.body.dataset.page==='plan-days')void checkSelectedRoute();
