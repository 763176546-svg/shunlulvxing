import {normalize,safeLink} from './normalize.mjs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
const exec=promisify(execFile)
export class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s
export function buildArgs(input={}){
 const {kind,city,keyword='',arrival,departure,nearby,maxPrice,hotelType,hotelStar,bedType,sort}=input
 if(!['hotel','scenic'].includes(kind)||typeof city!=='string'||!city.trim()||city.length>40||typeof keyword!=='string'||keyword.length>100)throw new ApiError(400,'请选择城市并检查搜索条件')
 if(kind==='hotel'){
   if(!validDate(arrival)||!validDate(departure)||arrival<day()||departure<=arrival)throw new ApiError(400,'请选择未来的入住、离店日期')
   const args=['search-hotel','--dest-name',city.trim(),'--check-in-date',arrival,'--check-out-date',departure]
   if(keyword.trim())args.push('--key-words',keyword.trim())
   const hasLandmark=typeof nearby==='string'&&nearby.trim()&&nearby.length<=100
   if(hasLandmark)args.push('--poi-name',nearby.trim())
   if(['distance_asc','rate_desc','price_asc','price_desc','no_rank'].includes(sort))args.push('--sort',sort)
   else if(hasLandmark)args.push('--sort','distance_asc')
   if(['hotel','homestay','inn'].includes(hotelType))args.push('--hotel-types',hotelType)
   if(/^[1-5](?:,[1-5]){0,4}$/.test(String(hotelStar)))args.push('--hotel-stars',[...new Set(String(hotelStar).split(','))].join(','))
   if(['king','twin','multi'].includes(bedType))args.push('--hotel-bed-types',bedType)
   if(Number.isFinite(maxPrice)&&maxPrice>=1&&maxPrice<=100000)args.push('--max-price',String(maxPrice))
   return args
 }
 return ['search-poi','--city-name',city.trim(),...(keyword.trim()?['--keyword',keyword.trim()]:[])]
}
async function runSearch(args,{key=process.env.FLYAI_API_KEY,run=exec,allowTrial=process.env.FLYAI_ALLOW_TRIAL==='1'}={}){
 if(!key||!key.trim()||key.includes('YOUR_'))throw new ApiError(503,'请先在电脑服务端配置 FlyAI API Key')
 const cli=fileURLToPath(new URL('./node_modules/@fly-ai/flyai-cli/dist/flyai-bundle.cjs',import.meta.url))
 const env={...process.env,FLYAI_API_KEY:key.trim(),FLYAI_JSON:'1',DEBUG_FLYAI_MCP:''}
 const invoke=()=>run(process.env.FLYAI_NODE_BIN||process.execPath,[cli,...args],{cwd:fileURLToPath(new URL('.',import.meta.url)),env,timeout:45000,maxBuffer:2*1024*1024,windowsHide:true})
 function queryError(error){
  const output=String(error.stderr||error.stdout||'')
  if(/HTTP\s+401\b|invalid api key/i.test(output))return new ApiError(502,'飞猪拒绝了当前 API Key，请在服务端更新 FlyAI API Key')
  if(/HTTP\s+429\b/.test(output))return new ApiError(429,'飞猪查询达到频率限制，请稍后重试')
  if(error.killed)return new ApiError(504,'飞猪查询超时，请稍后重试')
  return new ApiError(502,'飞猪查询未完成，请稍后重试')
 }
 let stdout,trial=false
 try{({stdout}=await invoke())}
 catch(error){
  if(!allowTrial||!/HTTP\s+401\b|invalid api key/i.test(String(error.stderr||error.stdout||'')))throw queryError(error)
  delete env.FLYAI_API_KEY
  delete env.DEBUG_FLYAI_API_KEY
  try{({stdout}=await invoke());trial=true}catch(retryError){throw queryError(retryError)}
 }
 let data
 try{data=JSON.parse(stdout.trim())}catch{throw new ApiError(502,'飞猪返回格式暂未识别')}
 if(!data||data.error||data.isError||data.tool&&data.arguments)throw new ApiError(502,'飞猪未返回有效搜索结果')
 return {data,trial}
}
export async function search(input,options){
 const {data,trial}=await runSearch(buildArgs(input),options)
 let items
 try{items=normalize(data,input.kind)}catch{throw new ApiError(502,'飞猪返回内容暂未识别，请稍后重试')}
 return {source:trial?'飞猪 FlyAI（体验模式）':'飞猪 FlyAI',queriedAt:new Date().toISOString(),conditions:{kind:input.kind,city:input.city,keyword:input.keyword||'',arrival:input.arrival,departure:input.departure},items}
}

export async function searchTransport(input,options){
 const {mode,direction,origin,city,departure,arrival,arriveBy,leaveAfter,maxHours}=input;
 if(!['train','flight'].includes(mode)||!['outbound','return'].includes(direction)||
    ![origin,city].every(v=>typeof v==='string'&&v.trim()&&v.length<=40))throw new ApiError(400,'请填写出发城市、目的地和交通方式');
 const outbound=direction==='outbound';
 const date=outbound?arrival:departure;
 if(typeof date!=='string'||!validDate(date)||date<day())throw new ApiError(400,'请选择有效的出行日期');
 const args=['search-'+mode,'--origin',outbound?origin:city,'--destination',outbound?city:origin,'--dep-date',date,'--sort-type','3'];
 if(outbound&&/^([01]\d|2[0-3]):[0-5]\d$/.test(arriveBy||''))args.push('--arr-hour-end',String(Math.min(24,Number(arriveBy.slice(0,2))+1)));
 if(!outbound&&/^([01]\d|2[0-3]):[0-5]\d$/.test(leaveAfter||''))args.push('--dep-hour-start',leaveAfter.slice(0,2));
 if(Number.isFinite(+maxHours)&&+maxHours>=1&&+maxHours<=48)args.push('--total-duration-hour',String(+maxHours));
 const {data:response,trial}=await runSearch(args,options);
 if(response.status!==0||!Array.isArray(response.data?.itemList))throw new ApiError(502,'当前账号未返回可识别的交通候选，请核对 FlyAI 权限和响应格式');
 const value=v=>['number','string'].includes(typeof v)?String(v).slice(0,120):'';
 const time=v=>value(v).match(/(?:^|[T\s])(\d{2}:\d{2})/)?.[1]||'';
 const dayOf=v=>value(v).match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'';
 const cutoff=outbound?arriveBy:leaveAfter;
 const items=response.data.itemList.slice(0,30).filter(p=>p&&typeof p==='object').map(p=>{
  const segments=p.journeys?.[0]?.segments;
  const first=segments?.[0],last=segments?.at(-1);
  const duration=Number(p.totalDuration);
  return {
   name:Array.isArray(segments)?segments.map(s=>value(s.marketingTransportNo)).filter(Boolean).join(' → '):value(p.name),
   departure:time(first?.depDateTime),arrival:time(last?.arrDateTime),
   departureDate:dayOf(first?.depDateTime),arrivalDate:dayOf(last?.arrDateTime),
   departureStation:value(first?.depStationName),arrivalStation:value(last?.arrStationName),
   duration:Number.isFinite(duration)&&duration>0?duration:null,
   price:value(p.price??p.ticketPrice),jumpUrl:safeLink(p.jumpUrl||p.detailUrl)
  };
 }).filter(p=>p.name&&(!cutoff||(outbound?p.arrival&&p.arrival<=cutoff&&p.arrivalDate===date:p.departure&&p.departure>=cutoff)));
 return {items,source:trial?'飞猪 FlyAI 交通候选（体验模式）':'飞猪 FlyAI 交通候选',queriedAt:new Date().toISOString()};
}


