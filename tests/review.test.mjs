import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateState} from '../public/storage.js';
import {forecast,addDays,savePaymentEntry,incomeBreakdown} from '../public/finance.js';
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
    transaction('rent','2026-12-02','expense',3000),
    transaction('outside','2026-12-03','income',80000)
  ];
  const now='2026-11-02';
  const end=addDays(now,30);
  const plan=forecast(state,now,end);
  assert.deepEqual(plan.events.map(event=>event.id),['salary','A','rent']);
  assert.equal(plan.firstShortfall,null);
  assert.equal(state.balance,10000);
  const html=compactPlan({state,now,end,plan,dateLabel:String,shortDate:String,money:String,esc:String});
  assert.doesNotMatch(html,/unreceived|outside|month-next/);
  assert.match(html,/<tfoot>.*data-label="Приход">15000<.*data-label="Расход">4000<.*data-label="Остаток">21000</s);
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
