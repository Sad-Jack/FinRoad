import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateState,browserStore,STORAGE_KEY} from '../public/storage.js';
import {today,addDays,savePaymentEntry,forecast,cardDebtAmount} from '../public/finance.js';

const now=today();
const future=addDays(now,10);
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

for(const type of ['regular','loan','mortgage','personal','card']){
  test(`B01 optional payment fields and rename for ${type}`,()=>{
    const state=emptyState(now);
    savePaymentEntry(state,{type,name:'Initial'});
    const row=type==='regular'?state.transactions[0]:state.debts[0];
    assert.equal(row.name,'Initial');
    assert.doesNotThrow(()=>validateState(state));
    savePaymentEntry(state,{type,name:'Renamed',...(type==='regular'?{transactionId:row.id}:{debtId:row.id})});
    assert.equal((type==='regular'?state.transactions:state.debts)[0].name,'Renamed');
    assert.equal(state.debts.length+(type==='regular'?state.transactions.length:0),1);
    assert.equal(forecast(state,now,addDays(now,30)).expense,0);
  });
}

test('B02 incomplete payment rows stay draft and conversions retain selected identity',()=>{
  const state=emptyState(now);
  savePaymentEntry(state,{type:'regular',name:'A',payments:[{amount:1200,repeat:'once',date:null}]});
  const transactionId=state.transactions[0].id;
  assert.equal(state.transactions[0].draft,true);
  assert.equal(forecast(state,now,future).expense,0);
  savePaymentEntry(state,{type:'loan',transactionId,name:'A',amount:9000,payments:[{id:transactionId,amount:1200,repeat:'once',date:future}]});
  assert.equal(state.transactions[0].id,transactionId);
  assert.equal(state.transactions[0].loanDebtId,state.debts[0].id);
  assert.equal(forecast(state,now,future).expense,1200);
  assert.doesNotThrow(()=>validateState(state));
});

test('B03 mortgage rejects once schedules and loan principal is unchanged by forecast',()=>{
  const state=emptyState(now);
  assert.throws(()=>savePaymentEntry(state,{type:'mortgage',name:'Home',payments:[{amount:1000,repeat:'once',date:future}]}),/ежемесячно/);
  assert.deepEqual(state.debts,[]);
  savePaymentEntry(state,{type:'loan',name:'Loan',amount:100000,payments:[{amount:1000,repeat:'monthly',day:15}]});
  const before=structuredClone(state);
  forecast(state,now,addDays(now,90));
  assert.deepEqual(state,before);
});

test('B04 card debt handles kopecks, own money and invalid fields',()=>{
  assert.equal(cardDebtAmount(600001,38003),561998);
  assert.equal(cardDebtAmount(0,0),0);
  assert.equal(cardDebtAmount(600000,610000),0);
  assert.equal(cardDebtAmount(600000,-10),600010);
  assert.equal(cardDebtAmount(null,0),null);
  for(const [limit,balance] of [[-1,0],[NaN,0],[100.5,0],[100,Infinity],[1e13,-1]])assert.throws(()=>cardDebtAmount(limit,balance));
});

test('B05 legacy card keeps known debt through partial field updates and storage',()=>{
  const state=emptyState(now);
  state.debts=[{id:'legacy',name:'Legacy',kind:'card',amount:35000}];
  savePaymentEntry(state,{debtId:'legacy',type:'card',name:'Renamed',amount:35000,creditLimit:100000});
  assert.equal(state.debts[0].amount,35000);
  const store=browserStore(memory());store.load(now);
  const saved=store.save(state,1);
  assert.equal(store.read().state.debts[0].amount,35000);
  assert.deepEqual(saved.state,validateState(saved.state));
});

test('B06 split repayments reject overpayment without partially changing state',()=>{
  const state=emptyState(now);
  savePaymentEntry(state,{type:'personal',name:'Person',amount:10000,payments:[{amount:3000,repeat:'once',date:future},{amount:7000,repeat:'once',date:addDays(future,1)}]});
  const before=structuredClone(state);
  assert.throws(()=>savePaymentEntry(state,{debtId:state.debts[0].id,type:'personal',name:'Changed',amount:9000,payments:state.transactions.map(t=>({...t}))}),/превышает/);
  assert.deepEqual(state,before);
  assert.equal(forecast(state,now,addDays(future,1)).expense,10000);
});

test('B07 partial repayment and deadline charge the debt exactly once',()=>{
  const state=emptyState(now);
  savePaymentEntry(state,{type:'personal',name:'Person',amount:10000,due:addDays(future,2),payments:[{amount:3000,repeat:'once',date:future},{amount:1000,repeat:'once',date:null}]});
  const result=forecast(state,now,addDays(future,2));
  assert.deepEqual(result.events.map(t=>t.amount),[3000,7000]);
  assert.equal(result.expense,10000);
});

test('B07 historical repayments do not reduce a freshly entered current debt',()=>{
  const state=emptyState(now);
  state.balance=0;
  state.debts=[{id:'card',name:'Card',kind:'card',amount:10000,due:future}];
  state.transactions=[{id:'past',name:'Card',debtId:'card',kind:'expense',repeat:'once',date:addDays(now,-1),amount:6000}];
  assert.equal(forecast(state,now,future).expense,10000);
});

test('B07 manual card update ignores retained historical repayments when enforcing current cap',()=>{
  const state=emptyState(now);
  state.debts=[{id:'card',name:'Card',kind:'card',amount:10000}];
  const previous={id:'past',name:'Card',debtId:'card',kind:'expense',repeat:'once',date:addDays(now,-1),amount:6000};
  state.transactions=[previous];
  savePaymentEntry(state,{debtId:'card',type:'card',name:'Card',creditLimit:10000,cardBalance:5000,payments:[{id:'past',amount:6000,repeat:'once',date:previous.date}]});
  assert.equal(state.debts[0].amount,5000);
  assert.doesNotThrow(()=>validateState(state));
  assert.equal(state.transactions[0].amount,6000);
});

test('B08 equal names retain independent identities while linked schedules rename together',()=>{
  const state=emptyState(now);
  savePaymentEntry(state,{type:'regular',name:'Same',payments:[{amount:100,repeat:'once',date:future}]});
  const independent=structuredClone(state.transactions[0]);
  savePaymentEntry(state,{type:'loan',name:'Same',payments:[{amount:200,repeat:'once',date:future},{amount:300,repeat:'once',date:addDays(future,1)}]});
  const debtId=state.debts[0].id;
  const linked=state.transactions.filter(t=>t.loanDebtId===debtId);
  savePaymentEntry(state,{debtId,type:'loan',name:'Changed',payments:linked.map(t=>({...t}))});
  assert.deepEqual(state.transactions.find(t=>t.id===independent.id),independent);
  assert.deepEqual(state.transactions.filter(t=>t.loanDebtId===debtId).map(t=>t.name),['Changed','Changed']);
});

test('B09 state survives read/restore and previous format without incomeSources',()=>{
  const storage=memory(),store=browserStore(storage),initial=store.load(now);
  savePaymentEntry(initial.state,{type:'card',name:'Card',creditLimit:10000,cardBalance:3000});
  store.save(initial.state,initial.revision);
  const exported=JSON.stringify(store.read().state,null,2);
  assert.deepEqual(browserStore(storage).read().state,JSON.parse(exported));
  const target=browserStore(memory());target.restore(JSON.parse(exported));
  assert.deepEqual(target.read().state,store.read().state);
  const legacy=emptyState(now);delete legacy.incomeSources;
  assert.deepEqual(validateState(legacy).incomeSources,[]);
});

test('B10 malformed restore, quota and stale revisions preserve last saved state',()=>{
  const storage=memory(),store=browserStore(storage),initial=store.load(now);
  const saved=storage.getItem(STORAGE_KEY);
  assert.throws(()=>store.restore({...initial.state,balance:'bad'}));
  assert.equal(storage.getItem(STORAGE_KEY),saved);
  const stale=store.read();store.save({...stale.state,balance:100},stale.revision);
  assert.throws(()=>store.save({...stale.state,balance:200},stale.revision),/другой вкладке/);
  assert.equal(store.read().state.balance,100);
  const value=storage.getItem(STORAGE_KEY);
  const failing=browserStore({getItem:storage.getItem,setItem(){throw new Error('quota');}});
  assert.throws(()=>failing.save({...store.read().state,balance:300},store.read().revision),/не смог сохранить/);
  assert.equal(storage.getItem(STORAGE_KEY),value);
});

test('B02 legacy yearly expense preserves recurrence on rename and changes only when requested',()=>{
  const state=emptyState(now);
  const legacy={id:'annual',name:'Annual',kind:'expense',amount:1200,repeat:'yearly',date:'2026-04-15'};
  state.transactions=[legacy];
  savePaymentEntry(state,{type:'regular',transactionId:'annual',name:'Annual renamed',payments:[{id:'annual',amount:1200,repeat:'yearly',date:'2026-04-15'}]});
  assert.equal(state.transactions[0].repeat,'yearly');
  assert.equal(forecast(state,'2026-01-01','2027-12-31').expense,2400);
  assert.doesNotThrow(()=>validateState(state));
  savePaymentEntry(state,{type:'regular',transactionId:'annual',name:'Monthly',payments:[{id:'annual',amount:1200,repeat:'monthly',day:15}]});
  assert.equal(state.transactions[0].repeat,'monthly');
});
