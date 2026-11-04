import test from 'node:test';
import assert from 'node:assert/strict';
import {today,addDays} from '../public/finance.js';
import {browserStore,emptyState,validateState,STORAGE_KEY} from '../public/storage.js';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('file storage persists changes across store instances and leaves original data immutable',()=>{
 const storage=memory(),first=browserStore(storage),original=first.load('2026-11-01');
 const next=structuredClone(original.state);next.balance=12345;
 const saved=first.save(next,original.revision);
 assert.equal(saved.revision,2);assert.equal(original.state.balance,null);
 assert.deepEqual(browserStore(storage).load('2026-11-02'),saved);
});
test('a stale tab cannot overwrite a newer saved version',()=>{
 const storage=memory(),a=browserStore(storage),b=browserStore(storage),old=a.load('2026-11-01');
 a.save({...old.state,balance:200},old.revision);
 assert.throws(()=>b.save({...old.state,balance:999},old.revision),/другой вкладке/);
 assert.equal(b.read().state.balance,200);
});
test('quota failure does not replace existing data or report success',()=>{
 const storage=memory(),store=browserStore(storage),original=store.load('2026-11-01');
 storage.setItem=()=>{throw new Error('QuotaExceededError');};
 assert.throws(()=>store.save({...original.state,balance:400},original.revision),/не смог сохранить/);
 assert.deepEqual(store.read(),original);
});
test('corrupt saved JSON is preserved, never silently reset to empty',()=>{
 const storage=memory();storage.setItem(STORAGE_KEY,'{invalid');
 assert.throws(()=>browserStore(storage).load('2026-11-01'),/повреждены/);
 assert.equal(storage.getItem(STORAGE_KEY),'{invalid');
});
test('invalid imported amounts, dates, ids and references are rejected without replacing data',()=>{
 const storage=memory(),store=browserStore(storage),original=store.load('2026-11-01');
 const payment={id:'one',name:'Test',kind:'expense',repeat:'once',amount:100,date:'2026-11-05'};
 for(const bad of [
  {...original.state,balance:1.5},
  {...original.state,transactions:[{...payment,date:'2026-02-30'}]},
  {...original.state,transactions:[payment,payment]},
  {...original.state,transactions:[{...payment,debtId:'missing'}]},
  {...original.state,incomeSources:[{id:'work',name:'Work',amount:100,taxRate:11000,salaryShare:10000,repeat:'once',date:'2026-11-05'}]},
 ])assert.throws(()=>store.save(bad,original.revision));
 assert.deepEqual(store.read(),original);
});
test('legacy backups retain partial schedules and remove retired reserve setting',()=>{
 const input={...emptyState('2026-11-01'),reserve:1000};delete input.incomeSources;
 input.debts=[{id:'debt',name:'Test',kind:'personal',amount:null}];
 input.transactions=[{id:'part',name:'Test',kind:'expense',repeat:'once',amount:null,date:null,draft:true,debtId:'debt'}];
 const output=validateState(input);
 assert.equal(output.transactions.length,1);assert.deepEqual(output.incomeSources,[]);
 assert.equal('reserve' in output,false);assert.equal(input.reserve,1000);
});
test('known debt balance caps repayments across multiple scheduled dates',()=>{
 const input=emptyState('2026-11-01');input.debts=[{id:'debt',name:'Test',kind:'card',amount:100}];
 input.transactions=[1,2].map(n=>({id:'part'+n,name:'Test',kind:'expense',repeat:'once',date:addDays(today(),n),amount:60,debtId:'debt'}));
 assert.throws(()=>validateState(input),/превышают/);
});
test('explicit import can recover corrupt storage but rejects an invalid backup first',()=>{
 const storage=memory(),store=browserStore(storage);storage.setItem(STORAGE_KEY,'bad');
 assert.throws(()=>store.restore({schema:99}));assert.equal(storage.getItem(STORAGE_KEY),'bad');
 const restored=store.restore(emptyState('2026-11-01'));assert.deepEqual(store.read(),restored);
});
