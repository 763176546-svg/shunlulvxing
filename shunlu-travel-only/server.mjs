import './config.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {search} from './provider.mjs';
import {aiStatus,checkAI,generateAIPlan,datesOf,AIError} from './ai.mjs';
import {guideAction,streetMap} from './guide-api.mjs';
const port=Number(process.env.STAY_PLAY_PORT||8790);
function httpsOrigin(value){
 if(!value)return '';
 const url=new URL(value);
 if(url.protocol!=='https:'||value!==url.origin)throw Error('STAYPLAY_PUBLIC_ORIGIN 必须是 HTTPS 域名，不含路径或末尾斜杠');
 return url.origin;
}
export function validate(x){
 if(!x||typeof x.city!=='string'||!x.city.trim()||x.city.length>40)throw Error('请填写目的地城市');
 for(const k of ['arrival','departure'])if(typeof x[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x[k])||isNaN(Date.parse(x[k]))||new Date(x[k]).toISOString().slice(0,10)!==x[k])throw Error('日期格式不正确');
 if(x.departure<=x.arrival||(+new Date(x.departure)-new Date(x.arrival))/864e5>14)throw Error('请选择 1—14 晚的旅行');
 if(x.arrival<new Date(Date.now()+8*36e5).toISOString().slice(0,10))throw Error('入住日期不能早于今天');
 if(!Number.isFinite(+x.budget)||+x.budget<1||+x.budget>100000)throw Error('请填写有效的每间每晚住宿预算');
 for(const k of ['interests','party','pace'])if(x[k]!==undefined&&(typeof x[k]!=='string'||x[k].length>500))throw Error('需求格式不正确或超过 500 字');
 if((x.demo!==undefined&&x.demo!==false)||x.useAI!==undefined&&typeof x.useAI!=='boolean')throw Error('模式参数不正确');
 const adjustments=x.adjustments??(x.adjustment?[x.adjustment]:[]);
 if(!Array.isArray(adjustments)||adjustments.length>8||adjustments.some(a=>typeof a!=='string'||a.length>500))throw Error('最多保留 8 次调整，每次不超过 500 字');
 if(x.selectedHotelId!==undefined&&(typeof x.selectedHotelId!=='string'||x.selectedHotelId.length>100))throw Error('酒店选择不正确');
 return {city:x.city.trim(),arrival:x.arrival,departure:x.departure,budget:+x.budget,party:x.party||'两位成人',pace:x.pace||'轻松',interests:x.interests||'',demo:false,useAI:x.useAI===true,adjustments,selectedHotelId:x.selectedHotelId||'',planId:typeof x.planId==='string'?x.planId:''};
}
function fallback(x,scenic){let places=[...scenic];const all=x.adjustments.join(' '),quiet=/累|少走|轻松|休息/.test(all)||x.pace==='轻松';if(/室内|下雨|雨天/.test(all))places=places.filter(p=>/博物馆|美术馆|展览|科技馆|室内/.test(p.name));const cap=quiet?1:2;return {engine:'rules',mode:'规则排程 · 飞猪搜索候选',summary:'按候选顺序安排，尚未使用 AI 理解偏好。',hotelRecommendations:[],warnings:[],days:datesOf(x).map((date,i)=>({date,title:i===0?'抵达后，留一点余地':'按自己的节奏探索',stops:places.slice(i*cap,(i+1)*cap).map(p=>({id:p.id,note:quiet?'安排一个主要停留点，休息时间自行掌握。':'候选游览点；开放及预约信息需确认。'}))}))};}
export function createServer({query=search,planner=generateAIPlan,check=checkAI,status=aiStatus,publicOrigin=httpsOrigin(process.env.STAYPLAY_PUBLIC_ORIGIN)}={}){
 let busy=false,windowStart=Date.now(),used=0;const snapshots=new Map();
 return http.createServer(async(req,res)=>{
 const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
  if(req.method==='GET'&&req.url==='/api/status')return json(200,{flyai:!!process.env.FLYAI_API_KEY?.trim(),ai:status()});
  if(req.method==='GET'){const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/workbench.js':'workbench.js','/itinerary.mjs':'itinerary.mjs','/guide':'guide.html','/guide.css':'guide.css','/guide.js':'guide.js','/guide-rules.mjs':'guide-rules.mjs'}[req.url];if(!file)return json(404,{error:'页面不存在'});const data=await readFile(new URL(file,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(data)}
  const guide=req.url.match(/^\/api\/guide\/(extract|locate|route|tickets|guide|hotels|transport|explain|map)$/)?.[1];
  if(req.method!=='POST'||(!guide&&!['/api/candidates','/api/plan','/api/ai/check'].includes(req.url)))return json(404,{error:'接口不存在'});
  const localPort=req.socket.localPort;
  const localHosts=[`127.0.0.1:${localPort}`,`localhost:${localPort}`];
  const devicePort=Number(process.env.STAYPLAY_PREVIEW_DEVICE_PORT);
  if(req.socket.remoteAddress==='127.0.0.1'&&Number.isInteger(devicePort)&&devicePort>0&&devicePort<=65535)
   localHosts.push(`127.0.0.1:${devicePort}`);
  const expectedOrigins=localHosts.includes(req.headers.host)?localHosts.map(host=>'http://'+host):
   publicOrigin&&new URL(publicOrigin).host===req.headers.host?[publicOrigin]:[];
  if(!expectedOrigins.length)return json(403,{error:'请从已配置的顺路旅行入口访问'});
  if(req.headers.origin&&!expectedOrigins.includes(req.headers.origin))return json(403,{error:'不允许跨站调用'});
  if(Date.now()-windowStart>3600e3){windowStart=Date.now();used=0}
  if(busy||used>=60)return json(429,{error:'正在处理其他请求，或已达到本小时调用上限，请稍后再试。'});
  const chunks=[];let size=0;
  for await(const c of req){size+=c.length;if(size>(guide==='extract'?8_000_000:16_384))return json(413,{error:'请求过大'});chunks.push(c)}
  let input,request;if(req.url!=='/api/ai/check')try{request=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!guide)input=validate(request)}catch(e){return json(400,{error:e.message})}
  if(busy||used>=60)return json(429,{error:'正在处理其他请求，或已达到本小时调用上限，请稍后再试。'});
  busy=true;used++;
  try{
   if(req.url==='/api/ai/check')return json(200,await check());
   if(guide==='map'){
    const image=await streetMap(request);
    res.writeHead(200,{'Content-Type':image.type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});
    return res.end(image.bytes);
   }
   if(guide)return json(200,await guideAction(guide,request,{query}));
   const x=input;
   const candidatesOnly=req.url==='/api/candidates';
   if(!candidatesOnly&&x.useAI&&!status().configured)throw new AIError('AI_NOT_CONFIGURED','请先在 stay-play/.env 填写百炼模型 Key；也可以取消“使用 AI 规划”体验规则排程。',503);
   let hotels,scenic,queriedAt,warnings=[];
   for(const [id,s] of snapshots)if(Date.now()-s.created>30*60e3)snapshots.delete(id);
   const cache=snapshots.get(x.planId);const same=!candidatesOnly&&cache&&['city','arrival','departure','demo'].every(k=>cache.conditions[k]===x[k]);
   if(!candidatesOnly&&request.reuseCandidates===true&&!same)return json(409,{error:'候选已过期或查询条件已改变，请点击「查候选」重新获取。'});
   if(same){({hotels,scenic,queriedAt}=cache);warnings.push('本次调整沿用上次候选，报价未重新查询；打开平台后请再次确认。')}
   else{
    const h=await query({kind:'hotel',city:x.city,arrival:x.arrival,departure:x.departure,keyword:''});hotels=h.items;
    // Natural-language preferences are for the model, not a literal POI query.
    try{scenic=(await query({kind:'scenic',city:x.city,keyword:''})).items}catch{scenic=[];warnings.push('景点搜索未完成，可稍后重试。')}
    queriedAt=new Date().toISOString();
   }
   if(x.selectedHotelId&&!hotels.some(h=>h.id===x.selectedHotelId))x.selectedHotelId='';
   const planId=same?x.planId:randomUUID();snapshots.set(planId,{hotels,scenic,queriedAt,conditions:x,created:Date.now()});if(snapshots.size>30)snapshots.delete(snapshots.keys().next().value);
   if(candidatesOnly)return json(200,{planId,hotels,scenic,warnings,source:'飞猪 FlyAI 搜索',queriedAt,conditions:x});
   const itinerary=x.useAI?await planner(x,hotels,scenic):fallback(x,scenic);
   return json(200,{...itinerary,planId,hotels,scenic,warnings:[...warnings,...itinerary.warnings],source:'飞猪 FlyAI 搜索',queriedAt,conditions:{...x,planId}});
  }finally{busy=false}
 }catch(e){if(e instanceof AIError)return json(e.status,{error:e.message,code:e.code});json(e.status||502,{error:e.status?e.message:'查询或规划服务暂不可用，请稍后重试。'})}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createServer().listen(port,'127.0.0.1',()=>console.log(`顺路旅行规划独立模块：http://127.0.0.1:${port}`));
