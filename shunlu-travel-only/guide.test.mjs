import assert from 'node:assert/strict';
import test from 'node:test';
import {extractPlaces,guideAction,readArticle} from './guide-api.mjs';
import {extractShareLinks,inspectDay,mergePlaces,suggestOrder} from './guide-rules.mjs';
import {buildArgs,searchTransport} from './provider.mjs';
import {normalize} from './normalize.mjs';

test('酒店数值报价保留且无 ID 时不会以列表位置误合并',()=>{
 const hotel=(name,price)=>normalize({status:0,data:{itemList:[{name,address:'镇宁',price}]}},'hotel')[0];
 assert.equal(hotel('甲',268.5).price,'268.5');
 assert.notEqual(hotel('甲',268.5).id,hotel('乙',300).id);
});

test('攻略短链临时断线时重试，并提取公开笔记正文',async()=>{
 const id='6a96638800000000260202f9';
 let attempts=0;
 const text=await readArticle('https://xhslink.cn/o/sample',async url=>{
  if(url.hostname==='xhslink.cn'){
   if(++attempts===1)throw new TypeError('fetch failed');
   return Response.redirect('https://www.xiaohongshu.com/discovery/item/'+id);
  }
  return new Response('<script>window.__INITIAL_STATE__='+JSON.stringify({noteId:id,desc:'DAY 1｜黄果树景区'})+'</script>',{headers:{'content-type':'text/html'}});
 });
 assert.equal(attempts,2);
 assert.equal(text,'DAY 1｜黄果树景区');
});

test('整段分享文案提取短链，登录跳转提示补截图',async()=>{
 const url='https://xhslink.cn/o/sample';
 assert.deepEqual(extractShareLinks('上海三天两晚 '+url+'，去【小红书】逛逛～\n'+url),[url]);
 await assert.rejects(readArticle(url,async target=>{
  assert.equal(target.href,url);
  return Response.redirect('https://www.xiaohongshu.com/login');
 }),/跳转到了登录页/);
});

test('小红书公开移动页只读取短链所指笔记的正文',async()=>{
 const noteUrl='https://www.xiaohongshu.com/discovery/item/6af55ec0000000002b037963?xsec_source=share';
 const visited=[];
 const read=async (url,options)=>{
  visited.push(url.href);
  assert.match(options.headers['user-agent'],/iPhone/);
  assert.equal(options.redirect,'manual');
  if(visited.length===1)return Response.redirect(noteUrl);
  return new Response(`<script>window.__INITIAL_STATE__={
   "noteData":{"other":{"noteId":"deadbeef","desc":"其他笔记"},
   "note":{"noteId":"6af55ec0000000002b037963","title":"上海攻略","desc":"Day 1 去外滩，保留原文 : undefined","other":undefined}}};</script>`,{headers:{'content-type':'text/html'}});
 };
 assert.equal(await readArticle('https://xhslink.cn/o/sample',read),'上海攻略\nDay 1 去外滩，保留原文 : undefined');
 assert.equal(visited[1],noteUrl);
});

test('多来源保留依据、读取失败提示补截图、拒绝模型捏造原文',async()=>{
 const result=await extractPlaces({sources:[
  {kind:'text',label:'笔记一',value:'Day 2\n推荐去白堤散步。'},
  {kind:'link',label:'笔记二',value:'https://example.com'},
  {kind:'text',label:'笔记三',value:'不推荐去白堤。'}
 ]},{
  read:async()=>{throw Error('failed');},
  model:async()=>({result:{places:[
   {source:0,name:'白堤',city:'杭州',quote:'推荐去白堤散步。',stance:'推荐',day:2},
   {source:1,name:'白堤',city:'杭州',quote:'不推荐去白堤。',stance:'不推荐',day:15},
   {source:0,name:'其他',quote:'原文不存在'}
  ]}})
 });
 const merged=mergePlaces([],result.places);
 assert.equal(merged.length,1);
 assert.equal(merged[0].city,'杭州');
 assert.deepEqual(merged[0].evidence.map(e=>e.stance),['推荐','不推荐']);
 assert.deepEqual(merged[0].evidence.map(e=>e.day),[2,undefined]);
 assert.match(result.warnings[0],/补截图/);
});

test('路程和预约冲突可核验，建议顺序保留锁定站点',()=>{
 const places=[0,10,1,3].map((lng,i)=>({id:String(i),name:'站点'+i,location:{lng,lat:30}}));
 const stops=places.map((p,i)=>({id:p.id,placeId:p.id,stay:60,start:i===0?'10:00':i===3?'10:30':'',locked:i===3}));
 const original=stops.map(s=>s.id);
 assert.deepEqual(suggestOrder(stops,places).map(s=>s.id),['0','2','1','3']);
 assert.deepEqual(stops.map(s=>s.id),original);
 assert.ok(inspectDay(stops,places).some(x=>x.includes('重叠')));
 const pair=[stops[0],{...stops[3],start:'11:10'}];
 assert.ok(inspectDay(pair,places,{'0|3':20}).some(x=>x.includes('20 分钟')));
});

test('酒店查价把地标和预算传给 FlyAI',async()=>{
 const found=await guideAction('hotels',{city:'杭州',name:'白堤',arrival:'2099-01-01',departure:'2099-01-02',budget:'600'},{
  query:async x=>({items:buildArgs(x)})
 });
 assert.ok(found.items.join(' ').includes('--poi-name 白堤 --sort distance_asc --max-price 600'));
});

test('地点详情可不设预算查询附近酒店',async()=>{
 const found=await guideAction('hotels',{city:'安顺',name:'黄果树大瀑布',arrival:'2099-01-01',departure:'2099-01-02'},{
  query:async input=>({items:buildArgs(input)})
 });
 assert.deepEqual(found.items.slice(-4),['--poi-name','黄果树大瀑布','--sort','distance_asc']);
 assert.ok(!found.items.includes('--max-price'));
});

test('酒店筛选传入实际的飞猪类型、星级、床型和排序参数',async()=>{
 const found=await guideAction('hotels',{
  city:'安顺',name:'黄果树景区',arrival:'2099-01-01',departure:'2099-01-02',
  keyword:'亚朵',hotelType:'hotel',hotelStar:'3,4',bedType:'twin',sort:'rate_desc',budget:'500'
 },{query:async input=>({items:buildArgs(input)})});
 for(const pair of ['--key-words 亚朵','--poi-name 黄果树景区','--sort rate_desc','--hotel-types hotel','--hotel-stars 3,4','--hotel-bed-types twin','--max-price 500']){
  assert.ok(found.items.join(' ').includes(pair),pair);
 }
});

test('按晚推荐只为已确认位置返回高德耗时',async()=>{
 const from={provider:'amap',lng:105.67,lat:25.99};
 const calls=[];
 const found=await guideAction('hotels',{
  city:'安顺',name:'黄果树景区',arrival:'2099-01-01',departure:'2099-01-02',budget:'500',
  itinerary:[{night:2,anchor:'黄果树景区',next:'安顺古城',from}],mode:'driving',smartRank:false
 },{
  query:async()=>({items:[{name:'同名酒店'},{name:'确认酒店'}]}),
  map:async(path,params)=>{
   calls.push({path,params});
   if(path==='/v5/place/text'){
    const result={name:params.keywords,location:'105.68,26'};
    return {pois:params.keywords==='同名酒店'?[result,result]:[result]};
   }
   return {route:{paths:[{cost:{duration:'421'}}]}};
  }
 });
 assert.equal(found.items[0].routes,undefined);
 assert.deepEqual(found.items[1].routes,[{night:2,direction:'in',minutes:8,mode:'driving'}]);
 assert.equal(calls.filter(call=>call.path.endsWith('driving')).length,1);
});

test('交通和排序不会丢失末站和同城次日首站，候选合并去重',async()=>{
 const input={city:'安顺',name:'黄果树大瀑布',walkingAnchor:'黄果树景区入口',
  arrival:'2099-01-01',departure:'2099-01-02',
  itinerary:[{anchor:'黄果树大瀑布',next:'安顺古城',nextCity:'安顺'},{anchor:'龙宫',next:'贵阳站',nextCity:'贵阳'}]};
 const query=async({nearby})=>{
  if(nearby==='龙宫')throw Error('模拟超时');
  return {items:[{id:'shared',name:'同时搜到的酒店'},{id:nearby,name:nearby+'附近的酒店'}]};
 };
 const walking=await guideAction('hotels',{...input,mode:'walking',sort:'price_asc',smartRank:false},{query});
 const driving=await guideAction('hotels',{...input,mode:'driving',smartRank:false},{query});
 assert.deepEqual(walking.landmarks,['黄果树大瀑布','安顺古城']);
 assert.deepEqual(driving.landmarks,['黄果树大瀑布','安顺古城']);
 assert.deepEqual(driving.items.map(item=>item.id),['shared','黄果树大瀑布','安顺古城']);
 assert.equal(driving.partialSearch,true);
});

test('附近酒店扩搜保留原地标，补查交通站和行政区并去重',async()=>{
 const calls=[];
 const result=await guideAction('hotels',{city:'上海',name:'陆家嘴',expand:true,budget:500},{
  map:async path=>({pois:path.endsWith('/around')?[{name:'陆家嘴地铁站'}]:[
   {id:'p',name:'陆家嘴',adname:'浦东新区',location:'121.5,31.2'}
  ]}),
  query:async input=>{
   calls.push(input);
   return {items:[{id:'common',name:'同一酒店'},{id:input.nearby||input.city,name:'其他酒店'}]};
  }
 });
 assert.deepEqual(result.landmarks,['陆家嘴','陆家嘴地铁站','上海浦东新区']);
 assert.equal(result.items.length,4);
 assert.equal(result.items[0].landmarkMatches.length,3);
 assert.equal(result.items.at(-1).landmarkMatches[0].area,true);
 assert.ok(calls.every(input=>input.maxPrice===500));
});

test('高德定位与步行耗时按服务字段解析',async()=>{
 const point={provider:'amap',lng:120.15,lat:30.25};
 const fakeMap=async path=>path.includes('walking')?{route:{paths:[{cost:{duration:'601'}}]}}:{
  pois:[{id:'a',name:'白堤',location:'120.15,30.25'},{id:'b',name:'无坐标'}]
 };
 const found=await guideAction('locate',{city:'杭州',name:'白堤'},{map:fakeMap});
 assert.equal(found.items.length,1);
 const route=await guideAction('route',{legs:[{id:'a|b',from:point,to:{...point,lng:120.16}}]},{map:fakeMap});
 assert.deepEqual(route.legs,[{id:'a|b',minutes:11}]);
});

test('路线核对自动选择最相关候选，仅在无相关地点时待确认',async()=>{
 const [a,b,c]=['南京东路站','人民广场站','同名站'].map((name,i)=>({id:String(i),name,city:'上海'}));
 const calls=[];
 const out=await guideAction('route',{legs:[{id:'a|b',fromLookup:a,toLookup:b},{id:'b|c',fromLookup:b,toLookup:c}]},{map:async(path,params)=>{
  if(path.includes('walking'))return {route:{paths:[{cost:{duration:'540'},steps:[{polyline:'121.48,31.23;121.47,31.23'}]}]}};
  calls.push(params.keywords);
  const poi={id:params.keywords,name:params.keywords,location:params.keywords===a.name?'121.48,31.23':'121.47,31.23'};
  return {pois:params.keywords===c.name?[{...poi,name:'无关地点'}]:params.keywords===b.name?[poi,{...poi,id:'other'}]:[poi]};
 }});
 assert.deepEqual(out.legs,[{id:'a|b',minutes:9,polyline:[{lng:121.48,lat:31.23},{lng:121.47,lat:31.23}]}]);
 assert.deepEqual(out.issues,[{id:'b|c',status:'location'}]);
 assert.equal(out.locations.length,2);
 assert.equal(calls.filter(name=>name===b.name).length,1);
});

test('攻略解析保留原文地名并保存高德近似匹配与坐标',async()=>{
 const places=[{name:'亚朵',city:'安顺',hint:'虹山湖路'},{name:'未知地点',city:'安顺'}];
 const result=await guideAction('extract',{},{
  extract:async()=>({places}),
  map:async()=>({pois:[
   {id:'a',name:'安顺高铁站亚朵酒店',location:'105.91,26.25'},
   {id:'b',name:'安顺古城虹山湖路亚朵酒店',location:'105.94,26.25'}
  ]})
 });
 assert.equal(result.places[0].name,'安顺古城虹山湖路亚朵酒店');
 assert.equal(result.places[0].originalName,'亚朵');
 assert.equal(result.places[0].location.id,'b');
 assert.equal(result.places[1].location,undefined);
});

test('长途直接驾车，短途没有步行路线时改查驾车',async()=>{
 const point=(lng,lat)=>({provider:'amap',lng,lat});
 const methods=[];
 const result=await guideAction('route',{legs:[
  {id:'long',from:point(105,26),to:point(106,26)},
  {id:'short',from:point(105,26),to:point(105.01,26)}
 ]},{map:async(path,params)=>{
  methods.push([path,params.destination]);
  return path.endsWith('/walking')?{route:{paths:[]}}:{route:{paths:[{cost:{duration:600}}]}};
 }});
 assert.equal(methods.filter(([path])=>path.endsWith('/walking')).length,1);
 assert.ok(result.legs.every(leg=>leg.mode==='driving'&&leg.minutes===10));
});

test('FlyAI 交通解析 journeys.segments，并按到达日期和分钟筛选',async()=>{
 const dep='2099-01-01';
 const result=await searchTransport({mode:'flight',direction:'outbound',origin:'上海',city:'成都',arrival:dep,arriveBy:'12:30'},{
  key:'demo-test-key',run:async()=>({stdout:JSON.stringify({status:0,data:{itemList:[
   {ticketPrice:'400',totalDuration:'150',journeys:[{segments:[{marketingTransportNo:'A1',depDateTime:dep+' 09:45:00',arrDateTime:dep+' 12:15:00'}]}]},
   {ticketPrice:'300',journeys:[{segments:[{marketingTransportNo:'A2',depDateTime:dep+' 12:00:00',arrDateTime:'2099-01-02 01:10:00'}]}]},
   {ticketPrice:'200',journeys:[{segments:[{marketingTransportNo:'A3',arrDateTime:dep+' 12:35:00'}]}]}
  ]}})})
 });
 assert.deepEqual(result.items.map(x=>[x.name,x.price,x.duration]),[['A1','400',150]]);
});
