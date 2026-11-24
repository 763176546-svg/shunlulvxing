import test from 'node:test';import assert from 'node:assert/strict';
import{editPlan,retainLocks,validateSaved,checkPlan}from'./itinerary.mjs';
const plan=()=>({conditions:{city:'杭州',budget:600,arrival:'2099-01-01',departure:'2099-01-03'},hotels:[],scenic:[{id:'a',name:'甲'},{id:'b',name:'乙'},{id:'c',name:'丙'}],days:[{date:'2099-01-01',stops:[{id:'a',note:'原安排'},{id:'b'}]},{date:'2099-01-02',stops:[]}]});
test('编辑不修改原方案，跨天移动保持活动',()=>{const p=plan();const q=editPlan(p,0,0,'move',1);assert.equal(p.days[0].stops.length,2);assert.equal(q.days[1].stops[0].id,'a');assert.equal(q.days[0].stops[0].id,'b');});
test('锁定活动不可删除或被相邻活动交换',()=>{const p=editPlan(plan(),0,0,'lock');assert.throws(()=>editPlan(p,0,0,'remove'),/解锁/);assert.throws(()=>editPlan(p,0,1,'up'),/锁定/);});
test('替换仅允许真实候选且不重复',()=>{assert.throws(()=>editPlan(plan(),0,0,'replace','unknown'),/候选/);assert.throws(()=>editPlan(plan(),0,0,'replace','b'),/已在/);assert.equal(editPlan(plan(),0,0,'replace','c').days[0].stops[0].id,'c');});
test('AI 重规划保留原日期的锁定活动并去重，改变城市不继承',()=>{const p=editPlan(plan(),0,0,'lock'),q=plan();q.days[0].stops=[];q.days[1].stops=[{id:'a'}];const merged=retainLocks(p,q);assert.equal(merged.days[0].stops[0].id,'a');assert.equal(merged.days[1].stops.length,0);q.conditions.city='上海';assert.deepEqual(retainLocks(p,q),q);});
test('导入拒绝候选外的活动，空日给出提示',()=>{assert.equal(validateSaved({current:plan()}).current.days.length,2);const p=plan();p.days[0].stops[0].id='unknown';assert.throws(()=>validateSaved({current:p}),/候选/);assert.ok(checkPlan(plan()).some(s=>s.includes('尚无活动')));});

test('空白日可以添加候选，禁止重复添加',()=>{const p=editPlan(plan(),1,0,'add','c');assert.equal(p.days[1].stops[0].id,'c');assert.throws(()=>editPlan(p,1,0,'add','c'),/已在/);});
