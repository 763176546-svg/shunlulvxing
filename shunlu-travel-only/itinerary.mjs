export function rankHotels(hotels, conditions, recommendations=[]){
 const interests=conditions.interests||'';
 const couple=/情侣|两位成人/.test(conditions.party||'');
 const airportRequested=/机场附近|住机场|住在机场|机场酒店|机场过夜|赶早班机/.test(interests);
 const metroRequested=/地铁/.test(interests);
 const recommendationRank=new Map(recommendations.map(({id},i)=>[id,i]));
 const score=hotel=>{
  const name=hotel.name||'';
  const address=hotel.address||'';
  if(couple&&/女生|男生|女性专属|男性专属|床位|胶囊/.test(name))return -2;
  const airport=/机场/.test(name)||/机场航站楼|机场航景路/.test(address);
  if(airport)return airportRequested?2:-1;
  return metroRequested&&/地铁/.test(name+' '+address)?1:0;
 };
 const rank=hotel=>recommendationRank.get(hotel.id)??recommendations.length;
 return [...hotels].sort((a,b)=>score(b)-score(a)||rank(a)-rank(b));
}

export function editPlan(plan,dayIndex,stopIndex,action,value){
 const p=structuredClone(plan),day=p.days[dayIndex],stop=day?.stops[stopIndex];
 if(action==='add'){
  if(!day||!p.scenic.some(s=>s.id===value))throw Error('只能添加本次查询候选');
  if(p.days.some(d=>d.stops.some(s=>s.id===value)))throw Error('该活动已在行程中');
  day.stops.push({id:value,note:'手动添加；开放、预约和交通需确认。'});return p;
 }
 if(!stop)throw Error('活动不存在');
 if(action==='lock'){stop.locked=!stop.locked;return p;}
 if(stop.locked)throw Error('请先解锁活动');
 if(action==='remove')day.stops.splice(stopIndex,1);
 else if(action==='move'){
  const to=p.days[Number(value)];if(!to)throw Error('目标日期不存在');
  day.stops.splice(stopIndex,1);to.stops.push(stop);
 }else if(action==='replace'){
  if(!p.scenic.some(s=>s.id===value))throw Error('只能使用本次查询候选');
  if(p.days.some(d=>d.stops.some(s=>s.id===value)))throw Error('该活动已在行程中');
  day.stops[stopIndex]={id:value,note:'手动替换的候选；开放时间及交通请确认。'};
 }else if(action==='up'||action==='down'){
  const to=stopIndex+(action==='up'?-1:1);
  if(to<0||to>=day.stops.length)return p;
  if(day.stops[to].locked)throw Error('不能移动锁定活动的位置');
  [day.stops[to],day.stops[stopIndex]]=[stop,day.stops[to]];
 }else throw Error('不支持的修改');
 return p;
}
export function retainLocks(previous,next){
 const p=structuredClone(next);
 if(!previous||['city','arrival','departure','demo'].some(k=>previous.conditions[k]!==p.conditions[k]))return p;
 const locks=previous.days.flatMap(d=>d.stops.filter(s=>s.locked).map((s,index)=>({date:d.date,stop:s,index:d.stops.indexOf(s)})));
 let kept=0;
 for(const l of locks){
  if(!p.scenic.some(s=>s.id===l.stop.id))continue;
  const target=p.days.find(d=>d.date===l.date);if(!target)continue;
  for(const d of p.days)d.stops=d.stops.filter(s=>s.id!==l.stop.id);
  target.stops.splice(Math.min(l.index,target.stops.length),0,l.stop);
  kept++;
 }
 if(kept)p.warnings=[...(p.warnings||[]),`已保留 ${kept} 个锁定活动，请核对交通与开放时间。`];
 if(kept<locks.length)p.warnings=[...(p.warnings||[]),`有 ${locks.length-kept} 个锁定活动不在新候选或新行程日期内，请从原方案核对。`];
 return p;
}
export function checkPlan(p){
 const warnings=[],seen=new Set();
 for(const d of p.days){if(!d.stops.length)warnings.push(`${d.date} 尚无活动安排`);for(const s of d.stops){if(!p.scenic.some(x=>x.id===s.id))warnings.push('存在未匹配的地点');if(seen.has(s.id))warnings.push('有重复活动，请确认是否需要多次前往');seen.add(s.id);}}
 return [...new Set(warnings)];
}
export function validateSaved(x){
 const p=x?.current;
 if(!p?.conditions||!Array.isArray(p.hotels)||!Array.isArray(p.scenic)||!Array.isArray(p.days)||p.days.length>14||p.hotels.length>200||p.scenic.length>300)throw Error('不是有效的住玩方案文件');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.conditions.arrival)||!/^\d{4}-\d{2}-\d{2}$/.test(p.conditions.departure))throw Error('方案日期无效');
 if(p.conditions.departure<=p.conditions.arrival||!Number.isFinite(Number(p.conditions.budget))||Number(p.conditions.budget)<=0)throw Error('方案日期或预算无效');
 if(p.hotelRecommendations!==undefined&&(!Array.isArray(p.hotelRecommendations)||p.hotelRecommendations.some(r=>!Array.isArray(r.checks))))throw Error('酒店建议格式无效');
 if(p.hotels.some(h=>!h||typeof h.id!=='string'||typeof h.name!=='string')||p.scenic.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'))throw Error('候选信息无效');
 for(const d of p.days)if(typeof d.date!=='string'||!Array.isArray(d.stops)||d.stops.length>100||d.stops.some(s=>!p.scenic.some(t=>t.id===s.id)))throw Error('方案活动不属于候选列表');
 return structuredClone(x);
}
