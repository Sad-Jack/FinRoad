import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../public/storage.js';
import {forecast,eventsBetween,incomeBreakdown} from '../public/finance.js';
import {isWorkingDay,previousWorkingDay} from '../public/work-calendar.js';
import {compactPlan,headerForecast} from '../public/compact.js';

const tx=(id,kind,amount,date,repeat='once',day)=>({id,name:id,kind,amount,date,repeat,...(day?{day}:{})});
const source=(id,amount,day)=>({id,name:id,amount,taxRate:0,salaryShare:10000,repeat:'monthly',date:'2026-01-01',salaryDay:day});
const stateWith=(transactions=[],incomeSources=[],balance=0)=>({...emptyState('2026-11-04'),balance,transactions,incomeSources});

test('A01 independent balances and immutable manual cash',()=>{
  for(const opening of [0,12000,-3000]){
    const state=stateWith([tx('credit','income',15000,'2026-11-05'),tx('expense','expense',4500,'2026-11-06')],[],opening);
    const before=structuredClone(state),result=forecast(state,'2026-11-04','2026-11-30');
    assert.equal(result.income,15000);assert.equal(result.expense,4500);assert.equal(result.balance,opening+10500);
    assert.deepEqual(state,before);
  }
});

test('A02 both interval endpoints included, outside events excluded',()=>{
  const state=stateWith([tx('past','expense',1,'2026-11-03'),tx('first','income',200,'2026-11-04'),tx('last','expense',100,'2026-12-04'),tx('future','income',999,'2026-12-05')]);
  const result=forecast(state,'2026-11-04','2026-12-04');
  assert.deepEqual(result.events.map(e=>e.id),['first','last']);assert.equal(result.balance,100);
});

test('A03 December repeats all monthly expenses at the wider horizon',()=>{
  const state=stateWith([tx('early','expense',1000,'2026-01-01','monthly',1),tx('middle','expense',2000,'2026-01-01','monthly',15),tx('late','expense',3000,'2026-01-01','monthly',31)]);
  const first=forecast(state,'2026-11-04','2026-12-01'),last=forecast(state,'2026-11-04','2026-12-31');
  assert.equal(first.expense,6000);assert.equal(last.expense,11000);
  assert.deepEqual(last.events.filter(e=>e.date.startsWith('2026-12')).map(e=>e.date),['2026-12-01','2026-12-15','2026-12-31']);
});

test('A04 January salary prepaid in December occurs once and has January scheduled date',()=>{
  const state=stateWith([tx('rent','expense',2000,'2026-01-01','monthly',15)],[source('salary',10000,10)]);
  const december=forecast(state,'2026-12-01','2026-12-31');
  assert.equal(december.income,20000);assert.equal(december.expense,2000);assert.equal(december.balance,18000);
  assert.deepEqual(december.events.filter(e=>e.kind==='income').map(e=>[e.date,e.scheduledDate]),[['2026-12-10','2026-12-10'],['2026-12-30','2027-01-10']]);
  const january=forecast(state,'2027-01-01','2027-01-31');
  assert.equal(january.events.some(e=>e.scheduledDate==='2027-01-10'),false);
  assert.equal(january.income,0);assert.equal(january.expense,2000);
});

test('A05 short February clamps each day and March restores it',()=>{
  for(const year of [2027,2028])for(const day of [28,29,30,31]){
    const state=stateWith([tx('monthly','expense',123,'2026-01-01','monthly',day)]);
    const dates=eventsBetween(state,`${year}-02-01`,`${year}-03-31`).map(e=>e.date);
    const febLast=year===2028?29:28;
    assert.deepEqual(dates,[`${year}-02-${Math.min(day,febLast)}`,`${year}-03-${day}`]);
  }
});

test('A06 calendar holidays, weekends, working Saturdays and fallback are respected',()=>{
  assert.equal(isWorkingDay('2025-11-01'),true);
  assert.equal(isWorkingDay('2027-02-20'),true);
  assert.equal(isWorkingDay('2026-11-04'),false);
  assert.equal(isWorkingDay('2026-11-07'),false);
  assert.deepEqual(previousWorkingDay('2025-11-04'),{date:'2025-11-01',estimated:false});
  assert.deepEqual(previousWorkingDay('2026-11-08'),{date:'2026-11-06',estimated:false});
  assert.deepEqual(previousWorkingDay('2027-01-10'),{date:'2026-12-30',estimated:false});
  assert.deepEqual(previousWorkingDay('2028-01-02'),{date:'2027-12-30',estimated:true});
  const state=stateWith([],[{...source('futureSalary',10000,2),date:'2028-01-01'}]);
  assert.equal(eventsBetween(state,'2027-12-01','2027-12-31').find(e=>e.scheduledDate==='2028-01-02').calendarEstimated,true);
});

test('A07 same-day incomes precede expenses; intermediate deficit keeps final balance',()=>{
  const state=stateWith([tx('earlier','expense',1000,'2026-11-05'),tx('z-expense','expense',700,'2026-11-10'),tx('a-income','income',2000,'2026-11-10')],[],500);
  const result=forecast(state,'2026-11-04','2026-11-30');
  assert.deepEqual(result.events.map(e=>e.id),['earlier','a-income','z-expense']);
  assert.equal(result.firstShortfall.date,'2026-11-05');assert.equal(result.firstShortfall.balance,-500);assert.equal(result.balance,800);
});

test('A08 independently rounded tax and splits add exactly to net kopecks',()=>{
  for(const amount of [1,101,1234567])for(const taxRate of [0,1300,10000,1325])for(const salaryShare of [0,5000,10000,3333]){
    const actual=incomeBreakdown({amount,taxRate,salaryShare,repeat:'monthly'});
    const expectedNet=Number((BigInt(amount)*BigInt(10000-taxRate)+5000n)/10000n);
    const expectedSalary=Number((BigInt(expectedNet)*BigInt(salaryShare)+5000n)/10000n);
    assert.equal(actual.net,expectedNet);assert.equal(actual.salary,expectedSalary);assert.equal(actual.advance,expectedNet-expectedSalary);
    assert.equal(actual.salary+actual.advance,actual.net);assert.equal(actual.tax+actual.net,amount);
  }
  assert.equal(incomeBreakdown({amount:101,taxRate:1300,salaryShare:2500,repeat:'once'}).advance,0);
});

test('A09 independent multi-year recurrence totals and future starting dates',()=>{
  const state=stateWith([tx('monthly','expense',100,'2026-01-01','monthly',15),tx('future-monthly','expense',200,'2027-06-01','monthly',20),tx('single','expense',300,'2027-01-01')],[{id:'one',name:'One',amount:1000,taxRate:0,salaryShare:10000,repeat:'once',date:'2027-03-01'}]);
  const result=forecast(state,'2026-01-01','2028-12-31');
  assert.equal(result.income,1000);assert.equal(result.expense,36*100+19*200+300);assert.equal(result.balance,-6700);
  assert.equal(result.events.filter(e=>e.id==='future-monthly').length,19);
});

test('A10 header and table render the independently calculated balance at a common horizon',()=>{
  const state=stateWith([tx('expense','expense',250,'2026-12-15')],[{id:'one',name:'One',amount:1000,taxRate:0,salaryShare:10000,repeat:'once',date:'2026-12-10'}],500);
  for(const end of ['2026-12-01','2026-12-31']){
    const plan=forecast(state,'2026-11-04',end),expected=end==='2026-12-01'?500:1250;
    const ctx={state,now:'2026-11-04',end,plan,forecastEnd:end,forecast,dateLabel:String,shortDate:String,money:String,esc:String};
    const header=headerForecast(ctx),table=compactPlan(ctx);
    assert.match(header,new RegExp(`<strong[^>]*>${expected}</strong>`));
    assert.match(table,new RegExp(`<tfoot>.*data-label="Остаток">${expected}</td>`, 's'));
  }
});
