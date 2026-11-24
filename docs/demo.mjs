const originalFetch=window.fetch.bind(window);
const guideText='安顺两日游\nDAY 1｜安顺古城 → 黄果树景区\nDAY 2｜天星桥 → 龙宫风景区';
const stops=[
 ['安顺古城',105.949,26.252,1],
 ['黄果树景区',105.672,25.995,1],
 ['天星桥',105.683,25.967,2],
 ['龙宫风景区',105.885,26.104,2]
];
const places=stops.map(([name,lng,lat,day],index)=>({
 id:'demo-'+index,city:'安顺',name,type:'景点',hint:'',saved:false,
 location:{provider:'amap',name,lng,lat,address:'安顺市'},
 evidence:[{source:'参赛样例',quote:guideText.split('\n')[day],day,stance:'提及'}]
}));
const source='参赛样例数据';
const catalog=(items,extra={})=>({items,source,queriedAt:new Date().toISOString(),...extra});
const reply=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
window.fetch=async(input,options)=>{
 const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
 if(!path.startsWith('/api/guide/'))return originalFetch(input,options);
 const args=JSON.parse(options?.body||'{}');
 switch(path.split('/').at(-1)){
  case 'extract':return reply({title:'安顺两日游 · 参赛样例',places,warnings:[],dayCount:2});
  case 'locate':return reply({items:places.filter(p=>p.name.includes(args.name)).map(p=>p.location)});
  case 'route':return reply({locations:[],issues:[],legs:args.legs.filter(leg=>leg.from&&leg.to).map(leg=>({
   id:leg.id,minutes:45,mode:'driving',polyline:[leg.from,{lng:(leg.from.lng+leg.to.lng)/2,lat:(leg.from.lat+leg.to.lat)/2+.025},leg.to]
  }))});
  case 'tickets':return reply(catalog([{name:args.name,productName:args.name+' · 门票示例',price:'100'}]));
  case 'hotels':return reply(catalog([
   {id:'demo-hotel-1',name:'景区入口酒店（示例）',price:'268',rating:4.6},
   {id:'demo-hotel-2',name:'安顺古城住宿（示例）',price:'328',rating:4.8},
   ...(args.expand?[{id:'demo-hotel-3',name:'黄果树镇民宿（示例）',price:'208',rating:4.5}]:[])
  ],{landmarks:[args.name],partialSearch:false}));
  case 'transport':return reply(catalog([]));
  case 'map':return new Response(null,{status:503});
  default:return reply({explanation:'示例行程可按已知地点顺序核对。'});
 }
};
await import('./guide.js');
document.querySelector('#demo-start').onclick=()=>{
 const form=document.querySelector('#import');
 form.elements.text.value=guideText;
 form.elements.text.dispatchEvent(new Event('input',{bubbles:true}));
 document.querySelector('.home-header [data-action="open-import"]').click();
};
