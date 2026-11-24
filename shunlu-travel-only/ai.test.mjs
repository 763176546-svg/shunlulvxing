import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAI,sanitizePlan,generateAIPlan} from './ai.mjs';
import {createServer} from './server.mjs';
const config={key:'test-only-key',model:'test-model',base:'https://dashscope.aliyuncs.com/compatible-mode/v1'};
const input={city:'杭州',arrival:'2099-01-01',departure:'2099-01-03',budget:600,party:'带孩子',pace:'适中',adjustments:[],demo:false};
const hotels=[{id:'h1',name:'测试住宿',price:''}];
const scenic=[{id:'outdoor',name:'西湖'},{id:'indoor',name:'浙江省博物馆'}];
const response=result=>new Response(JSON.stringify({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:20,completion_tokens:30}}),{status:200});
test('没有模型 Key 时不发起调用',async()=>{await assert.rejects(checkAI({config:{...config,key:''},request:()=>{throw Error('不应请求')}}),{code:'AI_NOT_CONFIGURED'})});
test('401 不透出服务端响应中的密钥或原始错误内容',async()=>{await assert.rejects(checkAI({config,request:async()=>new Response(JSON.stringify({error:{code:'invalid_api_key',message:'secret-from-provider'}}),{status:401})}),e=>e.code==='AI_AUTH'&&!e.message.includes('secret-from-provider'))});
test('拦截模型虚构的景点 ID',()=>{assert.throws(()=>sanitizePlan({days:[{date:input.arrival,stops:[{id:'invented'}]}]},input,hotels,scenic),{code:'AI_UNKNOWN_PLACE'})});
test('雨天、轻松和不重复约束在服务端生效',()=>{const result=sanitizePlan({days:[{date:input.arrival,stops:[{id:'outdoor'},{id:'indoor'}]},{date:'2099-01-02',stops:[{id:'indoor'}]}]}, {...input,pace:'轻松',adjustments:['孩子累了','改成雨天室内安排']},hotels,scenic);assert.deepEqual(result.days.flatMap(d=>d.stops.map(s=>s.id)),['indoor']);assert.equal(result.days.length,3)});
test('使用真实模型适配协议，保留历史调整和已选酒店',async()=>{const x={...input,selectedHotelId:'h1',adjustments:['孩子累了','第一天只去博物馆']};let payload;const result=await generateAIPlan(x,hotels,scenic,{config,request:async(url,init)=>{assert.equal(url,config.base+'/chat/completions');payload=JSON.parse(init.body);return response({summary:'按家庭节奏安排',hotelRecommendations:[{id:'h1',reason:'给定候选',checks:['报价待确认']}],days:[{date:x.arrival,stops:[{id:'indoor',note:'留出休息'}]}]})}});assert.equal(result.engine,'ai');assert.equal(result.model,'test-model');const passed=JSON.parse(payload.messages[1].content);assert.deepEqual(passed.requirements.adjustments,x.adjustments);assert.equal(passed.requirements.selectedHotelId,'h1');assert.equal(result.usage.inputTokens,20)});
test('HTTP 模式标记、缺配置、跨站拦截和配置文件保护',async()=>{
 let calls=0;const server=createServer({query:async({kind})=>({items:kind==='hotel'?hotels:scenic}),status:()=>({configured:false,verified:false,model:'test'}),planner:()=>{calls++;throw Error('未配置不应该调用')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 const post=(path,data,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  const missing=await post('/api/plan',{...input,useAI:true});assert.equal(missing.status,503);assert.equal((await missing.json()).code,'AI_NOT_CONFIGURED');assert.equal(calls,0);
  const rules=await post('/api/plan',{...input,useAI:false});const body=await rules.json();assert.equal(rules.status,200);assert.equal(body.engine,'rules');assert.match(body.source,/FlyAI/);assert.equal(body.conditions.useAI,false);
  assert.equal((await post('/api/plan',{...input,useAI:false},{Origin:'https://unexpected.example'})).status,403);
  assert.equal((await fetch(url+'/.env')).status,404);
  const invalid=await post('/api/plan',{...input,demo:true});assert.equal(invalid.status,400);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
