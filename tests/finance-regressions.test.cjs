const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'FinRoad.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
class FixedDate extends Date {
  constructor(...args) { if (args.length) super(...args); else super(2026, 10, 10, 12); }
}
const {finance, storage, views} = vm.runInNewContext(
  script.split('const module_6 =')[0] + ';({finance:module_1,storage:module_3,views:module_2})',
  {crypto: require('node:crypto').webcrypto, structuredClone, Date: FixedDate}
);
const empty = () => storage.emptyState('2026-11-10');

test('monthly expense draft can be completed later without losing its identifier', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'regular',name:'Связь',payments:[{amount:50000,repeat:'monthly',day:null}]});
  const old=s.transactions[0]; assert.equal(old.date,null); assert.equal(old.draft,true);
  finance.savePaymentEntry(s,{type:'regular',transactionId:old.id,name:'Связь',payments:[{id:old.id,amount:50000,repeat:'monthly',day:15}]});
  assert.equal(s.transactions[0].id,old.id);assert.equal(s.transactions[0].date,'2026-11-01');
  assert.equal(s.transactions[0].day,15);assert.equal(s.transactions[0].draft,undefined);
  storage.validateState(s);
});

test('loan and mortgage drafts can be completed later', () => {
  for(const type of ['loan','mortgage']){
    const s=empty();finance.savePaymentEntry(s,{type,name:type,amount:1000000,payments:[{amount:100000,repeat:'monthly',day:null}]});
    const debt=s.debts[0],p=s.transactions[0];
    finance.savePaymentEntry(s,{type,debtId:debt.id,name:type,amount:1000000,payments:[{id:p.id,amount:100000,repeat:'monthly',day:31}]});
    assert.equal(s.transactions[0].id,p.id);assert.equal(s.transactions[0].day,31);storage.validateState(s);
  }
});

test('name-only private debt remains editable and does not create a forecast payment', () => {
  const s=empty();s.balance=0;finance.savePaymentEntry(s,{type:'personal',name:'Лена',payments:[]});
  assert.equal(s.debts[0].amount,null);assert.equal(finance.forecast(s,'2026-11-10','2026-12-10').events.length,0);
  finance.savePaymentEntry(s,{type:'personal',debtId:s.debts[0].id,name:'Лена',amount:6000000,payments:[]});
  assert.equal(s.debts[0].amount,6000000);storage.validateState(s);
});

test('past repayments remain saved but do not count against current debt', () => {
  for(const type of ['personal','card']){
    const s=empty();
    const initial={type,name:type,amount:6000000,payments:[{amount:2000000,repeat:'once',date:'2026-11-01'},{amount:2000000,repeat:'once',date:'2026-11-20'},{amount:2000000,repeat:'once',date:'2026-12-20'}]};
    if(type==='card')Object.assign(initial,{creditLimit:10000000,cardBalance:4000000});
    finance.savePaymentEntry(s,initial);const id=s.debts[0].id,rows=s.transactions.map(t=>({id:t.id,amount:t.amount,repeat:'once',date:t.date}));
    const updated={type,debtId:id,name:type,amount:4000000,payments:rows};
    if(type==='card')Object.assign(updated,{creditLimit:10000000,cardBalance:6000000});
    finance.savePaymentEntry(s,updated);assert.equal(s.transactions.length,3);assert.equal(s.debts[0].amount,4000000);storage.validateState(s);
    assert.throws(()=>finance.savePaymentEntry(s,{...updated,payments:[...rows,{amount:1,repeat:'once',date:'2027-01-01'}]}),/превышать/);
    assert.equal(s.transactions.length,3);
  }
});

test('undated repayment amount still counts against debt', () => {
  const s=empty();assert.throws(()=>finance.savePaymentEntry(s,{type:'personal',name:'Лена',amount:10000,payments:[{amount:9000,repeat:'once',date:null},{amount:2000,repeat:'once',date:null}]}),/превышать/);
  assert.equal(s.debts.length,0);
});

test('expense list sorts recurring payments by next occurrence, including year boundary', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'regular',name:'5-го',payments:[{amount:100,repeat:'monthly',day:5}]});
  finance.savePaymentEntry(s,{type:'regular',name:'20 ноября',payments:[{amount:100,repeat:'once',date:'2026-11-20'}]});
  assert.deepEqual(Array.from(finance.paymentEntries(s,'2026-11-10'),e=>e.name),['20 ноября','5-го']);
  const y=empty();y.transactions=[{id:'yearly',name:'Январь',kind:'expense',amount:100,repeat:'yearly',date:'2020-01-05'},{id:'once',name:'Декабрь',kind:'expense',amount:100,repeat:'once',date:'2026-12-20'}];
  assert.deepEqual(Array.from(finance.paymentEntries(y,'2026-12-10'),e=>e.name),['Декабрь','Январь']);
});

test('past date is labelled in the expense list without asserting payment', () => {
  const s=empty();finance.savePaymentEntry(s,{type:'personal',name:'Лена',amount:10000,payments:[{amount:5000,repeat:'once',date:'2026-11-01'}]});
  const out=views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{personal:'Частный долг'},debtFilter:'all',paymentEntries:finance.paymentEntries});
  assert(out.includes('Дата прошла'));assert(!out.includes('Оплачено'));
});

test('Tab moves only between visible enabled form inputs and wraps', () => {
  const start=script.indexOf("document.addEventListener('keydown',event=>{\n  if(event.key!=='Tab'||!event.target.closest('#editor-form'))return;");
  assert(start>=0);const end=script.indexOf("document.addEventListener('keydown',event=>{const row=",start);assert(end>start);
  let handler,focused;const makeField=(name,options={})=>({name,disabled:Boolean(options.disabled),getClientRects:()=>options.hidden?[]:[{}],focus(){focused=name;},closest:()=>true,matches:()=>true});
  const first=makeField('first'),hidden=makeField('hidden',{hidden:true}),disabled=makeField('disabled',{disabled:true}),last=makeField('last');
  const context={document:{addEventListener:(_event,fn)=>handler=fn},$:()=>({querySelectorAll:()=>[first,hidden,disabled,last]})};
  vm.runInNewContext(script.slice(start,end),context);
  let prevented=false;handler({key:'Tab',target:first,shiftKey:false,preventDefault(){prevented=true;}});assert(prevented);assert.equal(focused,'last');
  handler({key:'Tab',target:last,shiftKey:false,preventDefault(){}});assert.equal(focused,'first');
  handler({key:'Tab',target:first,shiftKey:true,preventDefault(){}});assert.equal(focused,'last');
  prevented=false;handler({key:'Tab',target:{closest:()=>true,matches:()=>false},preventDefault(){prevented=true;}});assert.equal(prevented,false);
});

test('an empty day stays empty when reopening an unfinished monthly payment', () => {
  const start=script.indexOf('function dayInput('),end=script.indexOf('function paymentDateFields(',start);assert(start>=0&&end>start);
  const context={};vm.runInNewContext(script.slice(start,end),context);
  assert.match(context.dayInput('day','',true),/value=""/);
  assert.match(context.dayInput('day',1,true),/value="1"/);
});

test('an explicitly completed repayment stays intact when editing the same debt', () => {
  for(const type of ['personal','card']){
    const s=empty();const base={type,name:type,amount:6000000,payments:[{amount:2000000,repeat:'once',date:'2026-12-01'},{amount:2000000,repeat:'once',date:'2026-12-20'}]};
    if(type==='card')Object.assign(base,{creditLimit:10000000,cardBalance:4000000});
    finance.savePaymentEntry(s,base);const [paid,upcoming]=s.transactions;const debt=s.debts[0];
    s.completed[`${paid.id}:${paid.date}`]={delta:-2000000,paidOn:'2026-11-10',amount:2000000,debtId:debt.id};
    const next={type,debtId:debt.id,name:type,amount:2000000,payments:[{id:paid.id,amount:paid.amount,repeat:'once',date:paid.date},{id:upcoming.id,amount:upcoming.amount,repeat:'once',date:upcoming.date}]};
    if(type==='card')Object.assign(next,{creditLimit:10000000,cardBalance:8000000});
    finance.savePaymentEntry(s,next);assert.equal(s.transactions.length,2);assert(s.completed[`${paid.id}:${paid.date}`]);
    assert(s.transactions.some(row=>row.id===paid.id));storage.validateState(s);
  }
});

test('repayment editor keeps past and completed rows and only counts upcoming amounts', () => {
  const start=script.indexOf('function updateRepaymentRows('),end=script.indexOf('function updateCardDebtPreview(',start);assert(start>=0&&end>start);
  let rows;
  function row(amount,date,completed=false){
    const amountInput={name:'loan-amount',value:amount,disabled:false},dateInput={value:date,disabled:false};
    const status={hidden:true,textContent:''},remove={hidden:false},classes={};
    const item={dataset:{completed:String(completed),paymentId:amount||date?'saved':''},classList:{toggle:(name,on)=>classes[name]=on},querySelector(selector){return {'[name="loan-amount"]':amountInput,'[name="loan-date"]':dateInput,'.repayment-status':status,'[data-action="remove-loan-date"]':remove}[selector];},remove(){rows.children.splice(rows.children.indexOf(item),1);},amountInput,dateInput,status,removeButton:remove,classes};
    amountInput.closest=()=>item;return item;
  }
  const past=row('20000','2026-11-01'),upcoming=row('20000','2026-12-01'),paid=row('20000','2026-12-20',true);
  rows={children:[past,upcoming,paid],insertAdjacentHTML(){this.children.push(row('',''));},appendChild(item){this.children.splice(this.children.indexOf(item),1);this.children.push(item);}};
  const principal={value:'40000'},type={value:'personal'},items={'#entry-rows':rows,'#editor [name="entry-type"]:checked':type,'#editor [name="principal"]':principal};
  const ctx={$:key=>items[key],parseMoney:finance.parseMoney,today:()=> '2026-11-10',loanDateRow:()=>'<row>'};
  vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);ctx.updateRepaymentRows();
  assert.equal(past.status.textContent,'Дата прошла');assert.equal(paid.status.textContent,'Оплачено');assert(paid.amountInput.disabled&&paid.dateInput.disabled&&paid.removeButton.hidden);
  assert.equal(upcoming.status.hidden,true);assert.equal(rows.children.length,4);assert(rows.children[3].dateInput.disabled);assert(rows.children[3].removeButton.hidden);
  upcoming.amountInput.value='50000';ctx.updateRepaymentRows(upcoming.amountInput);assert.equal(upcoming.amountInput.value,'40000');
  assert.equal(rows.children.length,3);
});

test('all four income categories round-trip and distinguish salary weekends', () => {
  const s=empty();s.balance=0;
  for(const kind of ['salary','side','support','other'])finance.saveIncomeSource(s,{id:kind,incomeType:kind,name:kind,amount:100000,taxRate:0,salaryShare:10000,repeat:'monthly',date:'2026-11-01',salaryDay:14,advanceDate:null});
  const events=finance.eventsBetween(s,'2026-11-01','2026-11-30');assert.equal(events.find(e=>e.id==='salary').date,'2026-11-13');
  for(const kind of ['side','support','other'])assert.equal(events.find(e=>e.id===kind).date,'2026-11-14');
  assert.deepEqual(Array.from(storage.validateState(JSON.parse(JSON.stringify(s))).incomeSources,x=>x.incomeType),['salary','side','support','other']);
});

test('income totals follow filter and include net amounts only once', () => {
  const s=empty();
  finance.saveIncomeSource(s,{id:'salary',incomeType:'salary',name:'Работа',amount:100000,taxRate:1300,salaryShare:10000,repeat:'monthly',date:'2026-11-01',salaryDay:10,advanceDate:null});
  finance.saveIncomeSource(s,{id:'extra',incomeType:'side',name:'Заказ',amount:30000,taxRate:0,salaryShare:10000,repeat:'once',date:'2026-11-15',salaryDay:null,advanceDate:null});
  const ctx={state:s,money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,incomeBreakdown:finance.incomeBreakdown};
  const footer=incomeFilter=>views.compactIncome({...ctx,incomeFilter}).split('<tfoot>')[1].split('</tfoot>')[0];
  assert(footer('all').includes('117000'));assert(footer('salary').includes('87000'));assert(footer('side').includes('30000'));assert(footer('support').includes('>0<'));
});

test('inline balance accepts a decimal value and an empty value becomes zero', async () => {
  const start=script.indexOf('function renderBalance(){'),end=script.indexOf('function confirmDialog(',start);assert(start>=0&&end>start);
  const handlers={},formHandlers={},input={value:'',addEventListener:(name,fn)=>handlers[name]=fn,focus(){},select(){}},form={isConnected:true,addEventListener:(name,fn)=>formHandlers[name]=fn,requestSubmit(){return formHandlers.submit({preventDefault(){}})}},error={textContent:''},container={innerHTML:''};
  const s={balance:12345,balanceDate:'2026-11-01'},mapping={'#header-balance':container,'#header-balance-input':input,'#header-balance-form':form,'#header-balance-error':error};
  const ctx={state:s,editingBalance:false,$:selector=>mapping[selector],money:String,icon:()=>'',esc:String,parseMoney:finance.parseMoney,today:()=> '2026-11-10',change:async fn=>fn(s)};
  vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);ctx.editBalance();input.value='123,45';await formHandlers.submit({preventDefault(){}});
  assert.equal(s.balance,12345);assert.equal(s.balanceDate,'2026-11-10');
  ctx.editBalance();input.value='';await formHandlers.submit({preventDefault(){}});assert.equal(s.balance,0);
});

test('income frequency switch enables only the selected date field', () => {
  const start=script.indexOf('function updateOtherIncomeFields()'),end=script.indexOf("$('#editor-form').addEventListener('change'",start);assert(start>=0&&end>start);
  const day={disabled:false,required:false},date={disabled:false,required:false},monthly={hidden:false,querySelectorAll:()=>[day]},once={hidden:false,querySelectorAll:()=>[date]},toggle={checked:false};
  const items={'#income-other':{hidden:false},'#editor [name="other-once-switch"]':toggle,'#other-monthly':monthly,'#other-once':once};
  const ctx={$:key=>items[key]};vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);ctx.updateOtherIncomeFields();
  assert(!day.disabled&&date.disabled&&!monthly.hidden&&once.hidden);toggle.checked=true;ctx.updateOtherIncomeFields();
  assert(day.disabled&&!date.disabled&&monthly.hidden&&!once.hidden);
});

test('saved data rejects stale writes and restores a JSON backup', () => {
  const records=new Map(),mock={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)},store=storage.browserStore(mock);
  const first=store.load('2026-11-10'),state=first.state;state.balance=12345;const saved=store.save(state,first.revision);
  assert.throws(()=>store.save(state,first.revision),/другой вкладке/);
  const restored=store.restore(JSON.parse(JSON.stringify(saved.state)));assert.equal(restored.state.balance,12345);assert.equal(store.read().state.balance,12345);
});

test('author credits use the intended destinations and opposite corners', () => {
  assert.match(html,/class="author-credit github-credit"[^>]*>.*?href="https:\/\/github\.com\/Sad-Jack"/);
  assert.match(html,/class="author-credit"[^>]*>.*?href="https:\/\/t\.me\/jack_ripper"/);
  assert.match(html,/\.github-credit\{left:18px;right:auto\}/);
  assert.match(html,/\.author-credit\{position:fixed;right:18px;bottom:12px/);
});

test('debt header toggles mortgage and shows just debt when there is none', () => {
  const start=script.indexOf('  const hasMortgage=state.debts.some'),end=script.indexOf("  $('#header-forecast')",start);assert(start>=0&&end>start);
  const button={attrs:{},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];}};
  const ctx={state:{debts:[{kind:'loan',amount:10000},{kind:'mortgage',amount:50000}]},showMortgageDebt:false,$:()=>button,money:String};vm.createContext(ctx);
  const block='{'+script.slice(start,end)+'}';vm.runInContext(block,ctx);assert(button.innerHTML.includes('Долг без ипотеки'));assert(button.innerHTML.includes('10000'));
  ctx.showMortgageDebt=true;vm.runInContext(block,ctx);assert(button.innerHTML.includes('Долг с ипотекой'));assert(button.innerHTML.includes('60000'));
  ctx.state.debts=[{kind:'loan',amount:10000}];vm.runInContext(block,ctx);assert(button.disabled);assert(button.innerHTML.includes('Долг</small>'));assert.equal(ctx.showMortgageDebt,false);
});

test('repayment rows display the creditor name without a generated prefix', () => {
  for(const type of ['personal','card']){
    const s=empty(),item={type,name:'Влад',amount:100000,payments:[{amount:50000,repeat:'once',date:'2026-12-01'}]};
    if(type==='card')Object.assign(item,{creditLimit:200000,cardBalance:100000});
    finance.savePaymentEntry(s,item);
    assert.equal(finance.paymentEntries(s,'2026-11-10')[0].name,'Влад');
  }
});
