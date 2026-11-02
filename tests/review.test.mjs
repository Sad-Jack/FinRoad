import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateState} from '../public/storage.js';
import {forecast,monthEnd,savePaymentEntry,incomeBreakdown} from '../public/finance.js';
import {compactPlan,compactIncome} from '../public/compact.js';

const transaction=(name,date,kind,amount)=>({name,id:name,date,kind,amount,repeat:'once'});

test('displayed cash flows stay chronological and reconcile with the forecast across a month boundary',()=>{
  const state=emptyState('2026-11-01');
  state.balance=10000;
  state.transactions=[
    transaction('Z','2026-11-01','expense',12000),
    transaction('A','2026-11-02','expense',1000),
    transaction('unreceived','2026-11-01','income',9000),
    transaction('salary','2026-11-02','income',15000),
    transaction('rent','2026-12-01','expense',3000)
  ];
  const now='2026-11-02';
  const projection=forecast(state,now,'2026-11-30');
  assert.deepEqual(projection.points.filter(p=>p.event).map(p=>p.event.id),['Z','salary','A']);
  assert.equal(projection.balance,12000);
  const context={state,today:()=>now,monthEnd,forecast,dateLabel:String,shortDate:String,money:String,esc:String,icon:()=>''};
  const november=compactPlan({...context,month:'2026-11'});
  assert.doesNotMatch(november,/unreceived|overdue-dot/);
  assert.match(november,/<tfoot>.*data-label="Приход">15000<.*data-label="Расход">13000<.*data-label="Остаток">12000</s);
  const december=compactPlan({...context,month:'2026-12'});
  assert.match(december,/<tfoot>.*data-label="Приход">0<.*data-label="Расход">3000<.*data-label="Остаток">9000</s);
});

test('saving a payment keeps unrelated imported transactions with explicit null links',()=>{
  const state=emptyState('2026-11-01');
  const existing={...transaction('Existing','2026-11-05','expense',1000),loanDebtId:null,debtId:null};
  state.transactions=[existing];
  savePaymentEntry(state,{name:'New',type:'regular'});
  assert.deepEqual(state.transactions.find(t=>t.id===existing.id),existing);
});

test('legacy income displays its validated payment day and ignores extra imported markup',()=>{
  const state=emptyState('2026-11-01');
  state.transactions=[{...transaction('Legacy','2026-11-01','income',200),repeat:'monthly',day:15,salaryDay:'<b>untrusted</b>'}];
  const html=compactIncome({state:validateState(state),button:()=>'',esc:String,money:String,incomeBreakdown});
  assert.match(html,/15-го/);
  assert.doesNotMatch(html,/untrusted/);
});

test('a new loan and a standalone payment can share a name without being edited together',()=>{
  const state=emptyState('2026-11-01');
  savePaymentEntry(state,{type:'regular',name:'Банк',payments:[{amount:2000,repeat:'once',date:'2026-11-10'}]});
  savePaymentEntry(state,{type:'loan',name:'Банк'});
  const [standalone]=state.transactions;
  savePaymentEntry(state,{type:'loan',name:'Банк',debtId:state.debts[0].id,payments:[{amount:3000,repeat:'monthly',day:10}]});
  assert.deepEqual(state.transactions.find(row=>row.id===standalone.id),standalone);
  assert.equal(state.transactions.length,2);
});
