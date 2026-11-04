import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
mock.timers.enable({apis:['Date'],now:new Date('2026-11-04T12:00:00Z')});
import {parseMoney,eventsBetween,forecast,settle,addDays,nextIncomeDate} from '../public/finance.js';
const base=()=>({schema:1,demo:false,balance:10000,balanceDate:'2026-11-01',transactions:[],debts:[],completed:{}});
const expense=(id,date,amount,repeat='once')=>({id,name:id,date,amount,repeat,kind:'expense'});
test('money uses exact kopecks and rejects extra decimals',()=>{assert.equal(parseMoney('1 234,56'),123456);assert.equal(parseMoney('0.29'),29);assert.throws(()=>parseMoney('1.234'));assert.throws(()=>parseMoney('NaN'));});
test('safe spending respects a cash gap before later income',()=>{const s=base();s.transactions=[expense('rent','2026-11-02',8000),{...expense('salary','2026-11-10',20000),kind:'income'}];const p=forecast(s,'2026-11-01','2026-11-30');assert.equal(p.free,2000);assert.equal(p.balance,22000);});
test('same-day income precedes expenses in the plan and forecast regardless of input order',()=>{
 const s=base(),income={...expense('salary','2026-11-10',20000),kind:'income'},debit=expense('rent','2026-11-10',15000);
 for(const transactions of [[debit,income],[income,debit]]){
  s.transactions=transactions;const p=forecast(s,'2026-11-01','2026-11-10');
  assert.deepEqual(p.events.map(e=>e.kind),['income','expense']);
  assert.deepEqual(p.points.filter(p=>p.event).map(p=>p.balance),[30000,15000]);
  assert.equal(p.free,10000);assert.equal(p.shortfall,0);assert.equal(p.firstShortfall,null);
 }
});
test('31st recurring date clamps to February, returns to 31st in March',()=>{const s=base();s.balanceDate='2027-01-01';s.transactions=[expense('month','2027-01-31',100,'monthly')];assert.deepEqual(eventsBetween(s,'2027-01-01','2027-03-31').map(e=>e.date),['2027-01-31','2027-02-28','2027-03-31']);});
test('yearly leap-day expense clamps in non-leap year',()=>{const s=base();s.balanceDate='2028-01-01';s.transactions=[expense('year','2024-02-29',100,'yearly')];assert.deepEqual(eventsBetween(s,'2028-01-01','2029-03-01').map(e=>e.date),['2028-02-29','2029-02-28']);});
test('future start is respected and date math crosses year boundaries',()=>{const s=base();s.transactions=[expense('future','2027-01-05',100,'monthly')];assert.equal(eventsBetween(s,'2026-11-01','2026-12-31').length,0);assert.equal(addDays('2026-12-31',1),'2027-01-01');});
test('credit-card deadline reserved, undated debts are not cashflows',()=>{const s=base();s.debts=[{id:'card',name:'Card',amount:7000,due:'2026-11-05',kind:'card'},{id:'loan',name:'Loan',amount:900000,due:null,kind:'loan'}];assert.equal(forecast(s,'2026-11-01','2026-11-04').free,10000);assert.equal(forecast(s,'2026-11-01','2026-11-05').free,3000);});
test('paid expense reduces actual balance once and disappears from forecast',()=>{const s=base();s.transactions=[expense('rent','2026-11-02',2000,'monthly')];const event=eventsBetween(s,'2026-11-01','2026-11-30')[0];settle(s,event,'2026-11-02');assert.equal(s.balance,8000);assert.equal(forecast(s,'2026-11-01','2026-11-30').free,8000);assert.throws(()=>settle(s,event));assert.equal(eventsBetween(s,'2026-11-01','2026-12-31').length,1);});
test('debt settlement clears outstanding balance',()=>{const s=base();s.debts=[{id:'card',name:'Card',kind:'card',amount:5000,due:'2026-11-05'}];settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);assert.equal(s.debts[0].amount,0);assert.equal(s.balance,5000);});
test('past one-off expense does not reduce the manually entered starting balance',()=>{const s=base();s.transactions=[expense('old','2026-10-10',4000)];const p=forecast(s,'2026-11-01','2026-11-30');assert.equal(p.balance,10000);assert.equal(p.events.length,0);});
test('legacy reserve is ignored; only negative cash reports shortfall',()=>{const s=base();s.reserve=15000;const p=forecast(s,'2026-11-01','2026-11-30');assert.equal(p.free,10000);assert.equal(p.shortfall,0);delete s.reserve;s.balance=-100;const negative=forecast(s,'2026-11-01','2026-11-30');assert.equal(negative.free,0);assert.equal(negative.shortfall,100);});
test('next income skips today, includes next monthly occurrence',()=>{const s=base();s.transactions=[{...expense('salary','2026-11-01',20000,'monthly'),kind:'income'}];assert.equal(nextIncomeDate(s,'2026-11-01'),'2026-12-01');});
test('late expected income never disguises a shortage',()=>{const s=base();s.transactions=[{...expense('late salary','2026-10-30',50000),kind:'income'},expense('rent','2026-11-02',15000)];const p=forecast(s,'2026-11-01','2026-11-30');assert.equal(p.shortfall,5000);assert.equal(p.income,0);});

// Scheduled repayments must affect cash and debt only once, including deadlines.
const repaymentState=()=>({...base(),debts:[{id:'friend',name:'Friend',kind:'personal',amount:5000,due:null}]});
const {scheduleRepayment,plannedRepayments,unplannedDebtAmount,undoSettlement}=await import('../public/finance.js');
test('full personal repayment is one dated expense, planning preserves actual balances',()=>{
  const s=repaymentState();scheduleRepayment(s,{id:'pay',debtId:'friend',amount:5000,date:'2026-11-10'});
  assert.equal(s.balance,10000);assert.equal(s.debts[0].amount,5000);
  assert.equal(forecast(s,'2026-11-01','2026-11-09').expense,0);
  assert.equal(forecast(s,'2026-11-01','2026-11-10').expense,5000);
  assert.equal(eventsBetween(s,'2026-11-01','2027-01-31').length,1);
  const key=settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);
  assert.equal(s.balance,5000);assert.equal(s.debts[0].amount,0);assert.equal(plannedRepayments(s,'friend').length,0);
  undoSettlement(s,key);assert.equal(s.balance,10000);assert.equal(s.debts[0].amount,5000);assert.equal(plannedRepayments(s,'friend').length,1);
});
test('multiple partial payments and a full deadline never double-count',()=>{
  const s=repaymentState();s.debts[0].kind='card';s.debts[0].due='2026-11-30';
  scheduleRepayment(s,{id:'p1',debtId:'friend',amount:1000,date:'2026-11-10'});
  scheduleRepayment(s,{id:'p2',debtId:'friend',amount:1500,date:'2026-11-20'});
  assert.equal(unplannedDebtAmount(s,'friend'),2500);
  const p=forecast(s,'2026-11-01','2026-11-30');assert.deepEqual(p.events.map(e=>e.amount),[1000,1500,2500]);assert.equal(p.expense,5000);
  settle(s,p.events[0]);assert.equal(s.debts[0].amount,4000);assert.equal(forecast(s,'2026-11-01','2026-11-30').expense,4000);
});
test('editing and deleting a partial repayment updates deadline remainder',()=>{
  const s=repaymentState();s.debts[0].due='2026-11-30';
  scheduleRepayment(s,{id:'p1',debtId:'friend',amount:1000,date:'2026-11-10'});
  scheduleRepayment(s,{id:'p1',debtId:'friend',amount:2000,date:'2026-11-12'});
  assert.equal(s.transactions.length,1);assert.equal(unplannedDebtAmount(s,'friend'),3000);
  s.transactions=[];assert.equal(forecast(s,'2026-11-01','2026-11-30').expense,5000);
});
test('rejects overpayment, repeating repayments through helper, invalid dates and date beyond deadline',()=>{
  const s=repaymentState();s.debts[0].due='2026-11-30';
  scheduleRepayment(s,{id:'p1',debtId:'friend',amount:4000,date:'2026-11-10'});
  for(const patch of [{amount:1001},{amount:0},{date:'2026-12-01'},{date:'2026-02-30'}])assert.throws(()=>scheduleRepayment(s,{id:'p2',debtId:'friend',amount:1000,date:'2026-11-20',...patch}));
  assert.equal(s.transactions.length,1);
});
test('fully scheduled debt has no additional deadline debit',()=>{
  const s=repaymentState();s.debts[0].due='2026-11-10';scheduleRepayment(s,{id:'p',debtId:'friend',amount:5000,date:'2026-11-10'});
  assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,1);
});
test('early settlement of deadline remainder preserves pending repayments and can be undone',()=>{
  const s=repaymentState();s.debts[0].due='2026-11-30';scheduleRepayment(s,{id:'p',debtId:'friend',amount:1000,date:'2026-11-10'});
  const deadline=eventsBetween(s,'2026-11-01','2026-11-30').find(e=>e.debt),key=settle(s,deadline);
  assert.equal(s.debts[0].amount,1000);assert.equal(forecast(s,'2026-11-01','2026-11-30').expense,1000);
  s.transactions=[];assert.equal(forecast(s,'2026-11-01','2026-11-30').expense,1000);
  const second=settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);
  assert.equal(s.debts[0].amount,0);assert.equal(Object.keys(s.completed).length,2);
  undoSettlement(s,second);undoSettlement(s,key);assert.equal(s.debts[0].amount,5000);assert.equal(s.balance,10000);
});

test('first shortfall reports the first negative date before a later income',()=>{
  const s=base();s.transactions=[expense('rent','2026-11-05',15000),expense('bill','2026-11-07',1000),{...expense('salary','2026-11-08',20000),kind:'income'}];
  const before=forecast(s,'2026-11-01','2026-11-04');assert.equal(before.firstShortfall,null);
  const p=forecast(s,'2026-11-01','2026-11-30');
  assert.equal(p.firstShortfall.date,'2026-11-05');assert.equal(p.firstShortfall.balance,-5000);
  assert.equal(p.balance,14000);assert.equal(p.free,0);
  assert.equal(forecast(s,'2026-11-01','2026-11-08').balance,14000);
});
test('only an actual or projected negative balance in the period produces a warning',()=>{
  const s=base();s.balance=0;
  assert.equal(forecast(s,'2026-11-01','2026-11-30').firstShortfall,null);
  s.balance=-100;assert.equal(forecast(s,'2026-11-01','2026-11-30').firstShortfall.date,'2026-11-01');
  s.balance=0;s.transactions=[expense('overdue','2026-10-20',200)];
  assert.equal(forecast(s,'2026-11-01','2026-11-30').firstShortfall,null);
});

const {loanPayment,saveLoanPayment}=await import('../public/finance.js');
test('loan monthly payments affect cash only and preserve history when edited',()=>{
 const s=base(),debt={id:'loan',name:'Loan',kind:'loan',amount:900000,due:'2026-11-30'};s.debts=[debt];
 s.transactions=[expense('existing','2026-11-05',2000,'monthly')];s.transactions[0].name='Loan';
 assert.equal(loanPayment(s,debt).id,'existing');
 saveLoanPayment(s,debt,{amount:3000,repeat:'monthly',date:'2026-11-05'},'existing');
 assert.equal(s.transactions.length,1);
 const events=eventsBetween(s,'2026-11-01','2026-12-31');assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.amount),[3000,3000]);
 const key=settle(s,events[0]);assert.equal(s.balance,7000);assert.equal(debt.amount,900000);
 saveLoanPayment(s,debt,{amount:4000,repeat:'monthly',date:'2026-11-05'},'existing');
 assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,0);
 undoSettlement(s,key);assert.equal(s.balance,10000);assert.equal(debt.amount,900000);
});
test('loan schedule can be one-off or absent; principal is independent of payment',()=>{
 const s=base(),debt={id:'mortgage',name:'Mortgage',kind:'mortgage',amount:100,due:null};s.debts=[debt];
 saveLoanPayment(s,debt,{amount:2000,repeat:'once',date:'2026-11-05'});
 assert.equal(eventsBetween(s,'2026-11-01','2027-11-30').length,1);
 const id=s.transactions[0].id;
 assert.throws(()=>saveLoanPayment(s,debt,{amount:2000,repeat:'monthly',date:'2026-02-30'},id));
 saveLoanPayment(s,debt,null,id);assert.equal(s.transactions.length,0);assert.equal(debt.amount,100);
});

const {incomeBreakdown,incomeTransactions,saveIncomeSource}=await import('../public/finance.js');
const incomeSource=()=>({id:'job',name:'Работа',amount:10000000,taxRate:1300,salaryShare:5000,repeat:'monthly',date:'2026-11-10',advanceDate:'2026-11-25'});
test('income sources deduct tax and split net income into salary and advance',()=>{
 const s=base(),source=incomeSource();saveIncomeSource(s,source);
 assert.deepEqual(incomeBreakdown(source),{net:8700000,tax:1300000,salary:4350000,advance:4350000});
 const events=eventsBetween(s,'2026-11-01','2026-11-30');assert.deepEqual(events.map(e=>[e.date,e.amount]),[['2026-11-10',4350000],['2026-11-25',4350000]]);
 assert.equal(forecast(s,'2026-11-01','2026-11-30').income,8700000);
 const key=settle(s,events[0]);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,1);
 undoSettlement(s,key);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,2);
});
test('income rounding conserves kopecks including percent limits and large amounts',()=>{
 for(const amount of [1,101,10000000000000])for(const taxRate of [0,1357,10000])for(const salaryShare of [0,3333,10000]){
  const b=incomeBreakdown({...incomeSource(),amount,taxRate,salaryShare});
  assert.equal(b.salary+b.advance,b.net);assert.equal(b.tax+b.net,amount);assert.ok(Number.isSafeInteger(b.net));
 }
 for(const patch of [{taxRate:-1},{salaryShare:10001},{taxRate:1.5},{amount:0}])assert.throws(()=>incomeBreakdown({...incomeSource(),...patch}));
});
test('one-off income and single monthly payout create no extra events',()=>{
 const s=base();saveIncomeSource(s,{...incomeSource(),repeat:'once',advanceDate:null});
 assert.equal(eventsBetween(s,'2026-11-01','2027-11-30').length,1);
 assert.equal(eventsBetween(s,'2026-11-01','2027-11-30')[0].amount,8700000);
 for(const share of [0,10000])assert.equal(incomeTransactions({...incomeSource(),salaryShare:share}).length,1);
});
test('legacy income conversion keeps identity and completion; monthly dates clamp',()=>{
 const s=base();s.transactions=[{id:'job',name:'Работа',kind:'income',repeat:'monthly',date:'2026-11-10',amount:5000}];
 settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);
 saveIncomeSource(s,{...incomeSource(),salaryShare:10000});
 assert.equal(s.transactions.length,0);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,0);
 saveIncomeSource(s,{...incomeSource(),salaryShare:10000,date:'2027-01-31'});
 assert.equal(s.incomeSources.length,1);
 assert.deepEqual(eventsBetween(s,'2027-01-01','2027-03-31').map(e=>e.date),['2027-01-29','2027-02-26','2027-03-31']);
 assert.throws(()=>saveIncomeSource(s,{...incomeSource(),advanceDate:'2026-02-30'}));
 s.incomeSources=[];assert.equal(eventsBetween(s,'2026-11-01','2027-03-31').length,0);assert.equal(Object.keys(s.completed).length,1);
});

const {previousWorkingDay,isWorkingDay}=await import('../public/work-calendar.js');
test('Russian calendar respects holidays, shortened days and working Saturdays',()=>{
 assert.deepEqual(previousWorkingDay('2026-11-04'),{date:'2026-11-03',estimated:false});
 assert.deepEqual(previousWorkingDay('2026-11-15'),{date:'2026-11-13',estimated:false});
 assert.deepEqual(previousWorkingDay('2027-02-22'),{date:'2027-02-20',estimated:false});
 assert.equal(isWorkingDay('2027-02-20'),true);
 assert.deepEqual(previousWorkingDay('2026-01-01'),{date:'2025-12-30',estimated:false});
 assert.deepEqual(previousWorkingDay('2027-01-10'),{date:'2026-12-30',estimated:false});
 assert.equal(previousWorkingDay('2028-02-29').estimated,true);
});
test('day 31 follows month end, leap year and calendar without shifting expenses',()=>{
 const s=base();saveIncomeSource(s,{...incomeSource(),salaryShare:10000,salaryDay:31});
 assert.deepEqual(eventsBetween(s,'2026-11-01','2027-02-28').map(e=>[e.scheduledDate,e.date]),[
 ['2026-11-30','2026-11-30'],['2026-12-31','2026-12-30'],['2027-01-31','2027-01-29'],['2027-02-28','2027-02-26']]);
 s.balanceDate='2028-02-01';
 assert.equal(eventsBetween(s,'2028-02-01','2028-02-29')[0].scheduledDate,'2028-02-29');
 s.transactions=[expense('bill','2028-02-27',100)];
 assert.equal(eventsBetween(s,'2028-02-01','2028-02-29').find(e=>e.id==='bill').date,'2028-02-27');
});
test('next-month salary paid early appears once before month/year boundary and settles by nominal key',()=>{
 const s=base();s.balanceDate='2026-12-01';
 saveIncomeSource(s,{...incomeSource(),salaryShare:10000,salaryDay:1,date:'2026-12-01'});
 const events=eventsBetween(s,'2026-12-01','2026-12-30');
 assert.deepEqual(events.map(e=>[e.scheduledDate,e.date]),[['2026-12-01','2026-12-01'],['2027-01-01','2026-12-30']]);
 assert.equal(eventsBetween(s,'2026-12-01','2026-12-29').length,1);
 const key=settle(s,events[1]);assert.equal(key,'job:2027-01-01');
 assert.equal(eventsBetween(s,'2026-12-01','2027-01-31').length,1);
 undoSettlement(s,key);assert.equal(eventsBetween(s,'2026-12-01','2027-01-31').length,2);
 s.completed['job:2027-01-01']={delta:8700000,paidOn:'2027-01-01'};
 assert.equal(eventsBetween(s,'2026-12-01','2027-01-31').length,1);
});
test('monthly day validation and separate salary/advance schedule',()=>{
 const s=base();
 for(const value of [0,32,1.5,'10',null])assert.throws(()=>saveIncomeSource(s,{...incomeSource(),salaryDay:value}));
 saveIncomeSource(s,{...incomeSource(),salaryDay:15,advanceDay:31,date:'2026-11-01',advanceDate:'2026-11-01'});
 assert.deepEqual(eventsBetween(s,'2026-11-01','2026-11-30').map(e=>e.date),['2026-11-13','2026-11-30']);
});

const {paymentTiming}=await import('../public/finance.js');
test('monthly payments need only a day; 31 clamps to month end without calendar shifts',()=>{
 const s=base();const timing=paymentTiming('monthly',31,null,null,'2026-11-15');
 assert.deepEqual(timing,{date:'2026-11-01',day:31});
 s.transactions=[{...expense('bill',timing.date,100,'monthly'),...timing}];
 assert.deepEqual(eventsBetween(s,'2026-11-01','2027-03-31').map(e=>e.date),['2026-11-30','2026-12-31','2027-01-31','2027-02-28','2027-03-31']);
 s.balanceDate='2028-02-01';assert.equal(eventsBetween(s,'2028-02-01','2028-02-29')[0].date,'2028-02-29');
 for(const day of [0,32,1.5,NaN])assert.throws(()=>paymentTiming('monthly',day,null));
 assert.deepEqual(paymentTiming('once',null,'2026-11-15'),{date:'2026-11-15'});
 assert.throws(()=>paymentTiming('once',null,''));
});
test('editing existing loan as day-of-month keeps paid occurrences and principal',()=>{
 const s=base(),debt={id:'loan',name:'Loan',kind:'loan',amount:900000,due:null};s.debts=[debt];
 s.transactions=[{...expense('existing','2026-11-10',2000,'monthly'),name:'Loan'}];
 const existing=s.transactions[0];const key=settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);
 saveLoanPayment(s,debt,{amount:2000,repeat:'monthly',...paymentTiming('monthly',10,null,existing)},existing.id);
 assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,0);assert.equal(s.transactions.length,1);assert.equal(debt.amount,900000);
 undoSettlement(s,key);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30')[0].date,'2026-11-10');
});

const {paymentEntries}=await import('../public/finance.js');
test('payment settings cover every projected expense, including deadlines and partial repayments',()=>{
 const s=base();s.debts=[{id:'loan',name:'Loan',kind:'loan',amount:90000,due:null},{id:'card',name:'Card',kind:'card',amount:5000,due:'2026-11-30'},{id:'friend',name:'Friend',kind:'personal',amount:3000,due:null}];
 s.transactions=[{...expense('loan-pay','2026-11-05',1000,'monthly'),name:'Loan'},expense('subscription','2026-11-01',100,'monthly'),expense('purchase','2026-11-15',200)];
 scheduleRepayment(s,{id:'partial',debtId:'card',amount:2000,date:'2026-11-10'});
 const entries=paymentEntries(s),events=eventsBetween(s,'2026-11-01','2026-12-31');
 for(const e of events.filter(e=>e.kind==='expense'))assert.ok(entries.some(row=>row.id===e.id),e.name);
 assert.equal(entries.filter(e=>e.id==='loan-pay').length,1);
 assert.equal(entries.find(e=>e.id==='loan-pay').kind,'loan');
 assert.equal(entries.find(e=>e.id==='subscription').kind,'regular');
 assert.equal(entries.find(e=>e.id==='card').amount,3000);
 assert.equal(entries.find(e=>e.id==='partial').amount,2000);
 assert.equal(entries.find(e=>e.id==='friend').amount,null);
});
test('fully scheduled debt is not duplicated, and settled repayment settings remain accessible via debt',()=>{
 const s=repaymentState();s.debts[0].due='2026-11-30';scheduleRepayment(s,{id:'pay',debtId:'friend',amount:5000,date:'2026-11-10'});
 let entries=paymentEntries(s);assert.equal(entries.length,1);assert.equal(entries[0].debt.id,'friend');
 settle(s,eventsBetween(s,'2026-11-01','2026-11-30')[0]);
 entries=paymentEntries(s);assert.equal(entries.length,1);assert.equal(entries[0].id,'friend');assert.equal(entries[0].amount,null);
});

const {loanPayments,saveLoanPayments}=await import('../public/finance.js');
test('loan dated schedule adds, edits, removes and switches to monthly without duplicates',()=>{
 const s=base(),debt={id:'split',name:'Split',kind:'loan',amount:3400000,due:null};s.debts=[debt];
 saveLoanPayments(s,debt,[{repeat:'once',date:'2026-11-08',amount:700000},{repeat:'once',date:'2026-11-23',amount:1200000}]);
 const saved=loanPayments(s,debt);assert.equal(saved.length,2);assert.equal(debt.amount,3400000);
 assert.deepEqual(eventsBetween(s,'2026-11-01','2026-11-30').map(e=>[e.date,e.amount]),[['2026-11-08',700000],['2026-11-23',1200000]]);
 saveLoanPayments(s,debt,saved.map(p=>({...p,amount:p.amount+100})));assert.deepEqual(loanPayments(s,debt).map(p=>p.id),saved.map(p=>p.id));
 const before=structuredClone(s);assert.throws(()=>saveLoanPayments(s,debt,[{repeat:'once',date:'2026-11-08',amount:100},{repeat:'once',date:'2026-02-30',amount:100}]));assert.deepEqual(s,before);
 saveLoanPayments(s,debt,[loanPayments(s,debt)[1]]);assert.equal(loanPayments(s,debt).length,1);
 saveLoanPayments(s,debt,[{repeat:'monthly',date:'2026-11-01',day:12,amount:10000}]);assert.equal(loanPayments(s,debt).length,1);assert.equal(eventsBetween(s,'2026-11-01','2026-12-31').length,2);
 saveLoanPayments(s,debt,[]);assert.equal(loanPayments(s,debt).length,0);
});

const {savePaymentEntry}=await import('../public/finance.js');
test('unified payment editor creates expenses, converts types and preserves schedule IDs',()=>{
 const s=base();savePaymentEntry(s,{type:'regular',name:'Personal',payments:[{repeat:'monthly',day:5,amount:1000}]});
 const tx=s.transactions[0];assert.equal(tx.kind,'expense');assert.equal(s.debts.length,0);
 savePaymentEntry(s,{transactionId:tx.id,type:'loan',name:'Loan',amount:10000,payments:[{id:tx.id,repeat:'once',date:'2026-11-08',amount:3000}]});
 assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].id,tx.id);const debt=s.debts[0];assert.equal(s.transactions[0].loanDebtId,debt.id);
 savePaymentEntry(s,{debtId:debt.id,type:'personal',name:'Friend',amount:10000,payments:[{id:tx.id,repeat:'once',date:'2026-11-08',amount:3000},{repeat:'once',date:'2026-11-23',amount:7000}]});
 assert.equal(s.transactions.length,2);assert.equal(s.transactions[0].debtId,debt.id);assert.equal(unplannedDebtAmount(s,debt.id),0);
 const original=structuredClone(s);assert.throws(()=>savePaymentEntry(s,{debtId:debt.id,type:'card',name:'Card',amount:100,payments:[{repeat:'once',date:'2026-11-08',amount:3000}]}));assert.deepEqual(s,original);
 savePaymentEntry(s,{debtId:debt.id,type:'regular',name:'Expense',payments:[{id:tx.id,repeat:'monthly',day:31,amount:2000}]});
 assert.equal(s.debts.length,0);assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].debtId,undefined);
});
test('unified mortgage only accepts monthly schedule; split card appears once per date',()=>{
 const s=base();assert.throws(()=>savePaymentEntry(s,{type:'mortgage',name:'Mortgage',amount:10000,payments:[{repeat:'once',date:'2026-11-08',amount:1000}]}));assert.equal(s.debts.length,0);
 savePaymentEntry(s,{type:'mortgage',name:'Mortgage',amount:10000,payments:[{repeat:'monthly',day:31,amount:1000}]});assert.equal(s.transactions[0].day,31);
 const card=base();savePaymentEntry(card,{type:'card',name:'Card',amount:1900000,payments:[{repeat:'once',date:'2026-11-08',amount:700000},{repeat:'once',date:'2026-11-23',amount:1200000}]});assert.deepEqual(eventsBetween(card,'2026-11-01','2026-11-30').map(e=>e.amount),[700000,1200000]);
});

test('payment entries can be saved with only name and type, without entering the forecast',()=>{
 for(const type of ['regular','loan','mortgage','personal','card']){
  const s=base();savePaymentEntry(s,{type,name:'Incomplete'});
  assert.equal(paymentEntries(s).length,1);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,0);
  if(type!=='regular')assert.equal(s.debts[0].amount,null);
 }
});
test('partial amounts and dates persist, then a completed schedule enters the forecast once',()=>{
 const s=base();savePaymentEntry(s,{type:'loan',name:'Loan',payments:[{repeat:'once',amount:12345,date:null},{repeat:'once',amount:null,date:'2026-11-24'}]});
 assert.equal(s.transactions.length,2);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30').length,0);
 const debt=s.debts[0],first=s.transactions[0];
 savePaymentEntry(s,{debtId:debt.id,type:'loan',name:'Loan',payments:[{id:first.id,repeat:'once',amount:12345,date:'2026-11-24'}]});
 assert.equal(s.transactions[0].draft,undefined);assert.equal(eventsBetween(s,'2026-11-01','2026-11-30')[0].amount,12345);
 const card=base();savePaymentEntry(card,{type:'card',name:'Card',payments:[{repeat:'once',amount:2000,date:'2026-11-10'}]});assert.equal(eventsBetween(card,'2026-11-01','2026-11-30')[0].amount,2000);
});
