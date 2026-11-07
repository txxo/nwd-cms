const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../white-yard-club.user.js'), 'utf8');
const coreSource = '(' + source.slice(source.indexOf('(function reservationCore()') + 1).trim().replace(/\)\(\)\);$/, ')()');
const C = vm.runInThisContext(coreSource);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const booking = (id, status = 'PAID') => ({FacilityBookingID:id, Date:'2026-11-07', Status:status});

test('bounded workers preserve input order when requests finish out of order', async () => {
  let active = 0, peak = 0;
  const result = await C.mapLimit([30, 5, 1, 2], 2, async (delay, index) => {
    peak = Math.max(peak, ++active); await pause(delay); active--; return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3]); assert.equal(peak, 2);
});

test('abort stops queued work', async () => {
  const ac = new AbortController(); let calls = 0;
  await assert.rejects(C.mapLimit([1,2,3], 1, async () => { calls++; ac.abort(); }, ac.signal), {name:'AbortError'});
  assert.equal(calls, 1);
});

test('failure stops queued work', async () => {
  let calls = 0;
  await assert.rejects(C.mapLimit([1,2,3], 1, async () => {calls++; throw Error('failure');}), /failure/);
  assert.equal(calls, 1);
});

test('collect still rejects incomplete and duplicate pages', async () => {
  let call = 0;
  await assert.rejects(C.collect(async () => ++call === 1 ? {d:[booking(1)]} : {d:[]}, async () => ({d:2})), /筆數與總數不一致/);
  await assert.rejects(C.collect(async () => ({d:[booking(1)]}), async () => ({d:2})), /分頁重複/);
});

test('collect skips empty results and propagates count cancellation', async () => {
  let pages = 0;
  assert.deepEqual(await C.collect(async () => {pages++; return {d:[]};}, async () => ({d:0})), []);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(C.collect(async () => {pages++;}, async () => {throw ac.signal.reason;}), {name:'AbortError'});
  assert.equal(pages, 0);
});

function blockingHarness(query) {
  const context = vm.createContext({C:{...C, blockRuleReady:r=>!!r.ready}, queryBlockingGroups:query});
  vm.runInContext(section('  async function loadNoServices(', '\n  let syncingDates'), context);
  return context.loadNoServices;
}
const who = {estate:'E', user:'U'};
const group = id => ({NoServiceGroupID:id, EstateID:'E', NoServiceDateFrom:'2026-11-07', NoServiceDateTo:'2026-11-07'});

test('blocking details are deduplicated within one load but fetched afresh next time', async () => {
  const calls=[];
  const load = blockingHarness(async (_, id) => {
    calls.push(id); await pause(1);
    return id === '' ? [group('a'), group('a'), group('b')] : [{...group(id), ready:true, FacilityName:'Yoga Room'}];
  });
  assert.equal((await load(who,'2026-11-07')).length,3);
  assert.deepEqual(calls, ['', 'a', 'b']);
  await load(who,'2026-11-07');
  assert.deepEqual(calls, ['', 'a', 'b', '', 'a', 'b']);
});

test('blocking validation still rejects wrong estate, wrong group and missing rules', async () => {
  await assert.rejects(blockingHarness(async () => [{...group('a'),EstateID:'OTHER'}])(who,'2026-11-07'), /其他屋苑/);
  await assert.rejects(blockingHarness(async (_,id) => id === '' ? [group('a')] : [group('b')])(who,'2026-11-07'), /ID 不符/);
  await assert.rejects(blockingHarness(async (_,id) => id === '' ? [group('a')] : [])(who,'2026-11-07'), /規則未能讀取/);
});

function loadHarness(invoke, loadNoServices) {
  const paints=[]; const errors=[];
  const context=vm.createContext({C, AbortController, invoke, loadNoServices, identity:()=>who,
    syncOriginalDates(){},setScheduleLoading(){},queueOriginalRender(){},
    say(message,error){if(error)errors.push(message);},waitForSchedulePaint:async()=>{},
    render(){paints.push(JSON.parse(JSON.stringify({date:context.shownDate,data:context.data})));},
    serial:0,controller:null,bookingSave:null,busy:false,scheduleReady:false,shownDate:'',
    data:[booking('old')],noServiceData:[],refreshButton:{disabled:false},dateInput:{value:'2026-11-07'}});
  vm.runInContext(section('  async function load(options = {})', '\n  function paymentState'), context);
  return {context,paints,errors};
}

test('load merges statuses deterministically despite out-of-order responses', async () => {
  const h=loadHarness(async (method,payload) => {
    await pause(payload.strStatus === 'CAN' ? 10 : 1);
    return {d:method.includes('TotalNumber') ? 1 : [booking('same',payload.strStatus || 'PAID')]};
  }, async()=>[]);
  await h.context.load();
  assert.equal(h.paints.length,1); assert.equal(h.paints[0].data[0].Status,'EXPI');
  assert.equal(h.context.scheduleReady,true); assert.equal(h.context.busy,false);
});

test('one failed branch cancels siblings and leaves old data intact', async () => {
  let siblingAborted=false;
  const h=loadHarness(async (_,__,signal)=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{siblingAborted=true;reject(signal.reason);},{once:true});
  }),async()=>{await pause(2);throw Error('blocking failed');});
  await h.context.load(); await pause(1);
  assert.equal(siblingAborted,true); assert.equal(h.paints.length,0);
  assert.equal(h.context.data[0].FacilityBookingID,'old'); assert.equal(h.context.scheduleReady,false);
  assert.match(h.errors[0],/blocking failed/);
});

test('switching date cancels old work; only latest date can paint', async()=>{
  const h=loadHarness(async (method,_,signal)=>{
    await pause(5); signal.throwIfAborted(); return {d:method.includes('TotalNumber') ? 0 : []};
  }, async(_,__,signal)=>{await pause(5);signal.throwIfAborted();return [];});
  const old=h.context.load(); h.context.dateInput.value='2026-11-08';
  await Promise.all([old,h.context.load()]);
  assert.deepEqual(h.paints.map(p=>p.date),['2026-11-08']); assert.equal(h.errors.length,0);
});

test('combined load never exceeds three script requests in flight',async()=>{
  let active=0,peak=0;
  const request=async result=>{peak=Math.max(peak,++active);await pause(5);active--;return result;};
  const blocks=blockingHarness(async(_,id)=>request(id === '' ? ['a','b','c','d'].map(group) : [{...group(id),ready:true,FacilityName:'Yoga Room'}]));
  // Isolate scheduling from recurrence parsing, which has independent validation.
  const h=loadHarness(async(method,payload)=>request({d:method.includes('TotalNumber') ? 1 : [booking(payload.strStatus || 'active')]}),async(...args)=>{await blocks(...args);return [];});
  await h.context.load(); assert.equal(peak,3); assert.equal(h.paints.length,1);
});

test('native update index avoids repeat scans and detects changed/removed FPS values',()=>{
  let scans=0, rows=[['A 1','FPS'],['A1','duplicate ignored']];
  const oldTable={querySelectorAll(selector){scans++;return selector==='thead th' ? ['Ref No','Last Update'].map(textContent=>({textContent})) : rows.map(row=>({cells:row.map(textContent=>({textContent}))}));}};
  const context=vm.createContext({oldTable,setTimeout,clearTimeout,busy:false,bookingSave:null,shownDate:'2026-11-07',render(){}});
  vm.runInContext(section('  let originalUpdates =', '  function facilityIconLabel'),context);
  assert.equal(context.originalLastUpdate({RefNo:'a1'}),'FPS');
  assert.equal(context.hasFPS({RefNo:'a1'}),true);
  assert.equal(scans,2);
  rows=[['A1','cash']];vm.runInContext('originalUpdatesDirty=true',context);
  assert.equal(context.hasFPS({RefNo:'A1'}),false);assert.equal(scans,4);
  rows=[];vm.runInContext('originalUpdatesDirty=true',context);
  assert.equal(context.originalLastUpdate({RefNo:'A1'}),'');
});

test('native updates during saving are deferred until save completes, then coalesced',async()=>{
  let paints=0, value='FPS';
  const oldTable={querySelectorAll(selector){return selector==='thead th' ? ['Ref No','Last Update'].map(textContent=>({textContent})) : [{cells:[{textContent:'a'},{textContent:value}]}];}};
  const context=vm.createContext({oldTable,setTimeout,clearTimeout,busy:false,bookingSave:{},shownDate:'2026-11-07',render(){paints++;vm.runInContext('originalUpdatesChanged=false',context);}});
  vm.runInContext(section('  let originalUpdates =', '  function facilityIconLabel'),context);
  context.queueOriginalRender();await pause(120);assert.equal(paints,0);
  context.bookingSave=null; context.queueOriginalRender();await pause(120);assert.equal(paints,1);
  value='cash';vm.runInContext('originalUpdatesDirty=true',context);
  // Tooltip consumes index before deferred render; changed state must survive.
  context.originalLastUpdate({RefNo:'a'});
  context.queueOriginalRender();context.queueOriginalRender();await pause(120);assert.equal(paints,2);
  vm.runInContext('originalUpdatesDirty=true',context);
  context.queueOriginalRender();await pause(120);assert.equal(paints,2);
});
