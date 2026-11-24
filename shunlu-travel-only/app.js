import {retainLocks,validateSaved,rankHotels} from '/itinerary.mjs';
import {mountWorkbench} from '/workbench.js';
const $=s=>document.querySelector(s),form=$('#brief');let current=null,selected='',working=false,batch=null,candidateHotelId='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=new Date(Date.now()+8*36e5).toISOString().slice(0,10);form.arrival.min=today;form.departure.min=today;form.arrival.value=today;form.departure.value=new Date(Date.parse(today)+2*864e5).toISOString().slice(0,10);
async function refreshStatus(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();const s=await r.json();$('#connection').textContent=`飞猪搜索：${s.flyai?'已配置':'未配置'} · AI：${s.ai.verified?'连接已验证':s.ai.configured?'已配置，待验证':'尚未配置'}${s.ai.configured?' · '+s.ai.model:''}${s.ai.lastError?' · '+s.ai.lastError:''}`}catch{$('#connection').textContent='本地服务不可用，请重新启动。'}}
refreshStatus();
$('#check-ai').onclick=async()=>{if(working)return;working=true;$('#check-ai').disabled=true;$('#find-candidates').disabled=true;$('#connection').textContent='正在向百炼发起连接测试…';try{const r=await fetch('/api/ai/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});const d=await r.json();if(!r.ok)throw Error(d.error);await refreshStatus();$('#status').textContent='AI 连接成功，可以生成或调整行程。'}catch(e){$('#connection').textContent=e.name==='TimeoutError'?'AI 连接测试超时，请稍后重试。':e.message;$('#status').textContent='本次连接未通过；请检查 Key、服务地域和模型权限。'}finally{working=false;$('#check-ai').disabled=false;$('#find-candidates').disabled=false}};
const link=item=>{try{const u=new URL(item.jumpUrl);return u.protocol==='https:'&&['router.feizhu.com','www.fliggy.com','h5.m.taobao.com','market.m.taobao.com'].includes(u.hostname)?`<a target="_blank" rel="noopener noreferrer" href="${esc(u.href)}">去飞猪确认商品与日期 ↗</a>`:''}catch{return ''}};
function render(){
 const d=current;if(!d)return;const c=d.conditions;const stay=d.hotels.find(h=>h.id===selected);

 $('#result').innerHTML=`<span class="badge">${esc(d.source)}</span><div class="section-head"><h2>${esc(c.city)}，按你的节奏出发</h2><span>${esc(c.arrival)} — ${esc(c.departure)}</span></div>
 <p class="hint">${esc(d.mode)}${d.engine==='ai'&&d.model?' · '+esc(d.model):''} · ${esc(c.party)} · 每间每晚预算 ¥${esc(c.budget)}</p>
 ${d.summary?`<div class="ai-summary"><strong>${d.engine==='ai'?'AI 的安排建议':'安排说明'}</strong><p>${esc(d.summary)}</p></div>`:''}
 <div class="notice">价格、房型和开放时间请以供应商页面为准。</div>
 ${(c.adjustments||[]).length?`<p class="hint">已保留的调整：${c.adjustments.map(esc).join('；')}</p>`:''}
 ${(d.warnings||[]).map(w=>`<p class="notice">${esc(w)}</p>`).join('')}
 <h2>每日行程</h2>${stay?`<p class="notice">已选住处：${esc(stay.name)}</p>`:''}<p class="hint">下方工作台可逐站编辑。住处用于记录住宿选择，路线和通勤时间需另行核对。</p>
 ${d.days.map(day=>`<article class="day"><h3>${esc(day.date)} · ${esc(day.title)}</h3>${day.stops.length?day.stops.map(s=>{const p=d.scenic.find(p=>p.id===s.id);return `<p><strong>${esc(p?.name)}</strong><br>${esc(s.note)}<br>${link(p||{})}</p>`}).join(''):'<p>自由安排或休息。当前可确认候选不足，尚未补齐游览点。</p>'}</article>`).join('')}
 <div class="actions"><button id="save">保存在这台设备</button><button id="print">打印 / 导出 PDF</button></div><p id="saved" class="hint">仅本机保存。恢复方案不会自动更新价格与日期。</p>`;
 renderCandidates(batch||d);
 $('#save').onclick=()=>{try{localStorage.setItem('stay-play-v1',JSON.stringify({current,selected}));$('#saved').textContent='已保存，可从左侧恢复。'}catch{$('#saved').textContent='保存失败，请检查浏览器存储权限。'}};
 $('#print').onclick=()=>window.print();
 mountWorkbench(current,selected,next=>{current=next;render();$('#status').textContent='行程已修改，记得保存。'});
}
async function generate(input){
 if(working)return;working=true;$('#find-candidates').disabled=true;$('#check-ai').disabled=true;$('#result').setAttribute('aria-busy','true');$('#result').querySelectorAll('button').forEach(b=>b.disabled=true);
 $('#status').textContent=input.useAI?'正在使用已选候选生成 AI 行程…':'正在用已有候选安排…';
 try{const r=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(155000)});const d=await r.json();if(!r.ok)throw Error(d.error||'生成失败');current=retainLocks(current,d);selected=d.conditions.selectedHotelId||'';render();$('#result').scrollIntoView({block:'start'});$('#status').textContent=d.engine==='ai'?'AI 已生成。可继续调整或保存。':'规则排程已生成（未调用 AI）。';await refreshStatus()}
 catch(e){$('#status').textContent='本次安排未完成，已有方案仍保留。';const candidateStatus=$('#candidate-status');if(candidateStatus)candidateStatus.textContent=e.message;$('#result').querySelector('.error')?.remove();const p=document.createElement('p');p.className='error';p.setAttribute('role','alert');p.textContent=e.name==='TimeoutError'?'请求超时，请稍后重试。':e.message;$('#result').prepend(p)}
 finally{working=false;$('#find-candidates').disabled=false;$('#check-ai').disabled=false;$('#result').setAttribute('aria-busy','false');$('#result').querySelectorAll('button').forEach(b=>{if(!b.hasAttribute('data-undo')&&!b.hasAttribute('data-redo'))b.disabled=false})}
}
const importButton=document.createElement('label');importButton.className='import-plan';importButton.textContent='导入本助手导出的方案文件（JSON） ';const upload=document.createElement('input');upload.type='file';upload.accept='.json,application/json';upload.onchange=async()=>{if(working||!upload.files[0])return;try{if(upload.files[0].size>2000000)throw Error('文件不能超过 2MB');const saved=validateSaved(JSON.parse(await upload.files[0].text()));current=saved.current;batch=null;selected=saved.selected||'';render();$('#status').textContent='方案已导入，价格、房态和日期未刷新。';}catch(e){$('#status').textContent='仅支持导入本助手导出的有效 JSON 方案文件。';}finally{upload.value='';}};importButton.append(upload);form.append(importButton);

function readBrief(){
 const input=Object.fromEntries(new FormData(form));
 return {...input,demo:false,useAI:form.useAI.checked};
}
function renderCandidates(d){
 const panel=$('#candidates');
 const recommendations=current?.planId===d.planId?current.hotelRecommendations||[]:[];
 d={...d,hotels:rankHotels(d.hotels,current?.planId===d.planId?current.conditions:d.conditions,recommendations)};
 const choice=batch?candidateHotelId:selected;
 panel.hidden=false;
 panel.innerHTML=`<span class="badge">${esc(d.source)} · ${esc(d.conditions.city)} · ${esc(d.conditions.arrival)} 至 ${esc(d.conditions.departure)}</span><h2>酒店候选</h2>${d.hotels.length?d.hotels.map(h=>{const rec=recommendations.find(r=>r.id===h.id);return `<article class="card ${choice===h.id?'selected':''}"><h3>${esc(h.name)}</h3><p>${esc(h.address||'地址待确认')}</p><p class="price">${h.price?'供应商参考价 ¥'+esc(h.price)+' · 计价及房型请确认':'未提供报价'}</p>${rec?`<p><strong>AI 候选理由：</strong>${esc(rec.reason)}</p>${rec.checks.length?`<p>待确认：${rec.checks.map(esc).join('；')}</p>`:''}`:''}${link(h)}<br><button data-hotel="${esc(h.id)}">${choice===h.id?'已选为住处':'选作住处'}</button></article>`}).join(''):'<p class="notice">未找到酒店候选，可修改城市或日期重试。</p>'}
 <h3>景点候选（${d.scenic.length}）</h3><p>${d.scenic.map(p=>esc(p.name)).join('、')||'暂无景点候选'}</p>
 ${(d.warnings||[]).map(w=>`<p class="hint">${esc(w)}</p>`).join('')}
 <p id="candidate-selection" class="hint">${choice?'已选候选住处：'+esc(d.hotels.find(h=>h.id===choice)?.name||'未选择'):'可先选一家住处，再生成行程。'}</p>
 ${batch?' <button type="button" id="plan-from-candidates">用这批候选生成行程</button><p id="candidate-status" class="hint" role="status"></p>':''}`;
 const heading=panel.querySelector('h2');
 heading.insertAdjacentHTML('afterend',recommendations.length
  ?'<p class="hint">AI 建议优先核对的住宿排在前面。请到飞猪确认所选日期和房型的每晚价格。</p>'
  :'<p class="hint">初选已按同行人和住宿偏好调整顺序。实际每晚房价需到飞猪核对。</p>');
 panel.querySelectorAll('[data-hotel]').forEach(button=>button.onclick=()=>{
  if(working)return;
  if(batch){
   candidateHotelId=candidateHotelId===button.dataset.hotel?'':button.dataset.hotel;
   renderCandidates(d);
  }else{
   selected=selected===button.dataset.hotel?'':button.dataset.hotel;
   current={...current,conditions:{...current.conditions,selectedHotelId:selected}};
   render();
  }
 });
 const button=$('#plan-from-candidates');
 if(button)button.onclick=()=>{
  if(working||!form.reportValidity())return;
  const input=readBrief();
  if(['city','arrival','departure','demo'].some(key=>(key==='city'?input.city.trim():input[key])!==batch.conditions[key])){
   $('#candidate-status').textContent='城市、日期或数据模式已变，请重新查候选。';return;
  }
  if(!batch.hotels.length&&!batch.scenic.length){
   $('#candidate-status').textContent='这批查询没有可用候选，请修改条件后再查。';return;
  }
  if(current&&!confirm('生成新行程会替换当前安排。需要保留的版本请先保存或导出。继续生成？'))return;
  generate({...input,selectedHotelId:candidateHotelId,planId:batch.planId,reuseCandidates:true});
 };
}
form.onsubmit=async event=>{
 event.preventDefault();
 if(working)return;
 const input=readBrief();
 working=true;
 $('#find-candidates').disabled=true;
 $('#status').textContent='正在查询飞猪候选…';
 try{
  const response=await fetch('/api/candidates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(90000)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'查询失败');
  batch=data;
  candidateHotelId='';
  renderCandidates(batch);
  $('#status').textContent=`查到 ${data.hotels.length} 家住宿和 ${data.scenic.length} 个景点候选。`;
  $('#candidates').scrollIntoView({block:'start'});
 }catch(error){$('#status').textContent=error.message;}
 finally{working=false;$('#find-candidates').disabled=false;}
};

$('#restore').onclick=()=>{if(working)return;try{const d=validateSaved(JSON.parse(localStorage.getItem('stay-play-v1')));if(!d?.current?.conditions||d.current.conditions.demo||!Array.isArray(d.current.days)||!Array.isArray(d.current.hotels)||!Array.isArray(d.current.scenic))throw Error();current=d.current;batch=null;selected=d.selected||'';for(const k of ['city','arrival','departure','budget','party','pace','interests'])if(form.elements[k])form.elements[k].value=current.conditions[k]||'';form.useAI.checked=false;render();$('#status').textContent='已恢复本地方案，价格和日期未重新查询。'}catch{$('#status').textContent='暂无可恢复的有效方案。'}};
