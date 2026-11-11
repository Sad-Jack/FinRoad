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
  const handlers={},formHandlers={},input={value:'',addEventListener:(name,fn)=>handlers[name]=fn,focus(){},setSelectionRange(start,end){this.selection=[start,end];}},form={isConnected:true,addEventListener:(name,fn)=>formHandlers[name]=fn,requestSubmit(){return formHandlers.submit({preventDefault(){}})}},error={textContent:''},container={innerHTML:''};
  const s={balance:12345,balanceDate:'2026-11-01'},mapping={'#header-balance':container,'#header-balance-input':input,'#header-balance-form':form,'#header-balance-error':error};
  const ctx={state:s,editingBalance:false,$:selector=>mapping[selector],money:String,icon:()=>'',esc:String,parseBalanceExpression:finance.parseBalanceExpression,today:()=> '2026-11-10',change:async fn=>fn(s)};
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
  const button={attrs:{},dataset:{},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];}};
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

test('expense totals sum displayed payment amounts separately from unique debt totals', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'loan',name:'Кредит',amount:100000,payments:[{amount:10000,repeat:'monthly',day:5}]});
  finance.savePaymentEntry(s,{type:'personal',name:'Друг',amount:60000,payments:[{amount:20000,repeat:'once',date:'2026-11-20'},{amount:20000,repeat:'once',date:'2026-12-20'}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Связь',payments:[{amount:null,repeat:'monthly',day:5}]});
  const ctx={state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{loan:'Кредит',personal:'Частный долг'},paymentEntries:finance.paymentEntries};
  const footer=debtFilter=>views.compactDebts({...ctx,debtFilter}).split('<tfoot>')[1].split('</tfoot>')[0];
  assert.match(footer('all'),/class="numeric payments-total"[^>]*>50000</);assert.match(footer('all'),/class="numeric debt-total"[^>]*>160000</);
  assert.match(footer('personal'),/class="numeric payments-total"[^>]*>40000</);assert.match(footer('personal'),/class="numeric debt-total"[^>]*>60000</);
  assert.match(footer('regular'),/class="numeric payments-total"[^>]*>—</);
});

test('expense schedules omit monthly and one-time labels but retain annual recurrence', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'regular',name:'Ежемесячный',payments:[{amount:10000,repeat:'monthly',day:10}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Разовый',payments:[{amount:20000,repeat:'once',date:'2026-11-20'}]});
  s.transactions.push({id:'annual',name:'Ежегодный',kind:'expense',amount:5000,repeat:'yearly',date:'2026-12-01'});
  const ctx={state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},debtFilter:'all',paymentEntries:finance.paymentEntries};
  const out=views.compactDebts(ctx);
  assert(out.includes('>10-го</td>'));assert(out.includes('>2026-11-20</td>'));assert(out.includes('2026-12-01 · ежегодно'));
  assert(!out.includes('Ежемесячно ·'));assert(!out.includes(' · разово'));
});

test('new recurring expense and income day fields are empty while saved days remain', () => {
  const dayStart=script.indexOf('function dayInput('),dayEnd=script.indexOf('function paymentDateFields(',dayStart);
  const paymentStart=script.indexOf('function paymentDialog('),paymentEnd=script.indexOf('function updateEntryFields(',paymentStart);
  const incomeStart=script.indexOf('function incomeDialog('),incomeEnd=script.indexOf('function updateIncomeType(',incomeStart);
  let rendered='';const editor={dataset:{}},s=empty();
  const context={state:s,incomeFilter:'side',incomeTypeNames:{salary:'Зарплата',side:'Подработка'},
    esc:value=>String(value??''),select:()=>'',field:()=>'',icon:()=>'',loanDateRow:()=>'',
    $:selector=>selector==='#editor'?editor:null,openDialog:(_title,fields)=>{rendered=fields;},dialogDelete:()=>{},updateEntryFields:()=>{},updateIncomeType:()=>{},
    loanPayments:finance.loanPayments,loanPayment:finance.loanPayment,plannedRepayments:finance.plannedRepayments};
  vm.createContext(context);vm.runInContext(script.slice(dayStart,dayEnd)+script.slice(paymentStart,paymentEnd)+script.slice(incomeStart,incomeEnd),context);
  context.paymentDialog();assert.match(rendered,/name="service-day"[^>]*value=""/);assert.match(rendered,/name="credit-day"[^>]*value=""/);
  context.incomeDialog();assert.match(rendered,/name="other-day"[^>]*value=""/);
  finance.savePaymentEntry(s,{type:'regular',name:'Связь',payments:[{amount:10000,repeat:'monthly',day:15}]});
  context.paymentDialog({transactionId:s.transactions[0].id});assert.match(rendered,/name="service-day"[^>]*value="15"/);
  finance.saveIncomeSource(s,{id:'other-saved',incomeType:'side',name:'Заказ',amount:10000,taxRate:0,salaryShare:10000,repeat:'monthly',date:'2026-11-01',salaryDay:20,advanceDate:null});
  context.incomeDialog('other-saved');assert.match(rendered,/name="other-day"[^>]*value="20"/);
});

test('expense table groups undated items after dated items within the selected filter', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'regular',name:'Без даты 1',payments:[{amount:5000,repeat:'monthly',day:null}]});
  finance.savePaymentEntry(s,{type:'regular',name:'С датой',payments:[{amount:10000,repeat:'once',date:'2026-11-20'}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Без даты 2',payments:[{amount:4000,repeat:'once',date:null}]});
  finance.savePaymentEntry(s,{type:'personal',name:'Лена',amount:null,payments:[]});
  const ctx={state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries};
  const out=views.compactDebts({...ctx,debtFilter:'regular'}),group=out.indexOf('<strong>Без дат</strong>');
  assert(group>out.indexOf('data-id="'+s.transactions.find(t=>t.name==='С датой').id+'"'));
  assert(group<out.indexOf('data-id="'+s.transactions.find(t=>t.name==='Без даты 1').id+'"'));
  assert.equal((out.match(/<strong>Без дат<\/strong>/g)||[]).length,1);
  assert.match(out,/<td class="numeric payments-total"[^>]*>19000<\/td>/);
  const onlyDated=views.compactDebts({...ctx,debtFilter:'loan'});assert(!onlyDated.includes('<strong>Без дат</strong>'));
  const allUndated=views.compactDebts({...ctx,debtFilter:'personal'});assert(!allUndated.includes('<strong>Без дат</strong>'));
});

test('only undated expense rows receive the group indentation class', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'regular',name:'С датой',payments:[{amount:10000,repeat:'once',date:'2026-11-20'}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Без даты',payments:[{amount:5000,repeat:'once',date:null}]});
  const ctx={state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},debtFilter:'regular',paymentEntries:finance.paymentEntries};
  const out=views.compactDebts(ctx),dated=s.transactions.find(t=>t.name==='С датой'),undated=s.transactions.find(t=>t.name==='Без даты');
  assert(out.includes(`class="editable-row expense-undated-row" tabindex="0" data-action="edit-transaction" data-id="${undated.id}"`));
  assert(out.includes(`class="editable-row " tabindex="0" data-action="edit-transaction" data-id="${dated.id}"`));
});

test('indentation applies to all expense rows without affecting income rows', () => {
  assert(html.includes('.payments-panel:not(.income-panel) .payment-ledger .editable-row .name-cell .row-name{margin-inline-start:16px;'));
});

test('settling an occurrence updates cash once, preserves the forecast and can be undone', () => {
  const s=empty();s.balance=0;
  s.transactions=[{id:'salary',name:'Зарплата',kind:'income',amount:11527500,repeat:'monthly',date:'2026-11-01',day:10},{id:'bill',name:'Покупка',kind:'expense',amount:1600000,repeat:'once',date:'2026-11-10'}];
  const before=finance.forecast(s,'2026-11-10','2026-12-10');
  const salary=before.events.find(e=>e.id==='salary');finance.settle(s,salary,'2026-11-10');
  assert.equal(s.balance,11527500);assert.throws(()=>finance.settle(s,salary),/уже учтена/);
  let after=finance.forecast(s,'2026-11-10','2026-12-10');
  assert.equal(after.balance,before.balance);assert(!after.events.some(e=>e.key===salary.key));
  assert(after.events.some(e=>e.id==='salary'&&e.scheduledDate==='2026-12-10'));
  storage.validateState(JSON.parse(JSON.stringify(s)));
  const bill=after.events.find(e=>e.id==='bill');finance.settle(s,bill,'2026-11-10');assert.equal(s.balance,9927500);
  finance.undoSettlement(s,salary.key);assert.equal(s.balance,-1600000);
  finance.undoSettlement(s,bill.key);assert.equal(s.balance,0);
  assert.equal(finance.forecast(s,'2026-11-10','2026-12-10').balance,before.balance);
});

test('completed items stay visible above pending items and show their recalculated balance', () => {
  const s=empty();s.balance=0;
  s.transactions=[{id:'a',name:'А',kind:'expense',amount:500,repeat:'once',date:'2026-11-10'},{id:'b',name:'Б',kind:'expense',amount:700,repeat:'once',date:'2026-11-10'}];
  const event=finance.forecast(s,'2026-11-10','2026-12-10').events[1];finance.settle(s,event);
  const plan=finance.forecast(s,'2026-11-10','2026-12-10');
  const out=views.compactPlan({state:s,now:'2026-11-10',end:'2026-12-10',plan,dateLabel:String,money:String,esc:String,kindNames:{}});
  assert(out.indexOf('data-plan-key="b:2026-11-10"')<out.indexOf('data-plan-key="a:2026-11-10"'));
  assert.match(out,/plan-event completed/);assert.match(out,/>-700<\/td>/);
  assert.equal(plan.expense,500);assert.equal(plan.balance,-1200);
});

test('card and private debt repayments adjust debt and cash and undo safely', () => {
  for(const type of ['card','personal']){
    const s=empty();s.balance=100000;
    const entry={type,name:'Долг',amount:100000,payments:[{amount:30000,repeat:'once',date:'2026-11-20'}]};
    if(type==='card')Object.assign(entry,{creditLimit:200000,cardBalance:100000});
    finance.savePaymentEntry(s,entry);const event=finance.forecast(s,'2026-11-10','2026-12-10').events[0];
    finance.settle(s,event);assert.equal(s.balance,70000);assert.equal(s.debts[0].amount,70000);
    if(type==='card')assert.equal(s.debts[0].cardBalance,130000);
    storage.validateState(JSON.parse(JSON.stringify(s)));finance.undoSettlement(s,event.key);
    assert.equal(s.balance,100000);assert.equal(s.debts[0].amount,100000);storage.validateState(s);
  }
});


test('completed balances are rebuilt after another event is undone, as in the plan screenshot', () => {
  const s=empty();s.balance=0;
  s.transactions=[
    {id:'salary',name:'Зарплата',kind:'income',amount:11527500,repeat:'once',date:'2026-11-10'},
    {id:'gas',name:'Газовщик',kind:'expense',amount:1600000,repeat:'once',date:'2026-11-10'},
    {id:'debt',name:'Влад',kind:'expense',amount:500000,repeat:'once',date:'2026-11-10'}
  ];
  const get=id=>finance.forecast(s,'2026-11-10','2026-12-10').events.find(e=>e.id===id);
  finance.settle(s,get('salary'));finance.settle(s,get('gas'));finance.settle(s,get('debt'));
  finance.undoSettlement(s,'gas:2026-11-10');
  assert.equal(s.balance,11027500);
  assert.equal(s.completed['debt:2026-11-10'].balanceAfter,9427500); // Previously saved, now stale.
  const render=()=>views.compactPlan({state:s,now:'2026-11-10',end:'2026-12-10',plan:finance.forecast(s,'2026-11-10','2026-12-10'),dateLabel:String,money:String,esc:String,kindNames:{}});
  const row=(out,id)=>out.match(new RegExp(`<tr[^>]*data-plan-key="${id}:2026-11-10"[\\s\\S]*?</tr>`))[0];
  let out=render();
  assert.match(row(out,'salary'),/>11527500<\/td>/);
  assert.match(row(out,'debt'),/>11027500<\/td>/);
  assert.match(row(out,'gas'),/>9427500<\/td>/);
  s.balance+=100000;out=render();
  assert.match(row(out,'salary'),/>11627500<\/td>/);
  assert.match(row(out,'debt'),/>11127500<\/td>/);
  assert.match(row(out,'gas'),/>9527500<\/td>/);
});


test('tooltips stay inside the viewport and choose a side with space', () => {
  const start=script.indexOf('const module_tooltip ='),end=script.indexOf('const module_6 =',start);
  const {positionTooltip}=vm.runInNewContext(script.slice(start,end)+';module_tooltip');
  const box={width:150,height:40},viewport={width:300,height:200};
  const bottom=positionTooltip({x:290,top:170,bottom:185},box,viewport);
  assert.equal(bottom.left,142);assert.equal(bottom.top,120);
  const top=positionTooltip({x:-20,top:8,bottom:25},box,viewport);
  assert.equal(top.left,8);assert.equal(top.top,35);
});

test('keyboard focus displays a themed tooltip and Escape restores its description', () => {
  const start=script.indexOf('const module_tooltip ='),end=script.indexOf('const module_6 =',start);
  const handlers={},windowHandlers={};let tip,callback;
  const document={body:{append(el){tip=el;}},createElement(){return {style:{},hidden:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;},getBoundingClientRect(){return {width:100,height:40};}};},addEventListener(k,fn){handlers[k]=fn;}};
  const window={innerWidth:300,innerHeight:200,addEventListener(k,fn){windowHandlers[k]=fn;}};
  const ctx={document,window,setTimeout(fn){callback=fn;return 1;},clearTimeout(){callback=null;}};
  const tooltip=vm.runInNewContext(script.slice(start,end)+';module_tooltip',ctx);tooltip.initTooltips();
  const owner={dataset:{tooltip:'Подсказка'},attrs:{'aria-describedby':'existing'},isConnected:true,matches:()=>true,closest(selector){return selector==='[data-tooltip]'?this:null;},getAttribute(k){return this.attrs[k]||null;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},getBoundingClientRect(){return {left:250,top:150,bottom:170};},contains(node){return node===this;}};
  handlers.focusin({target:owner});callback();assert.equal(tip.textContent,'Подсказка');assert.equal(tip.hidden,false);
  assert.equal(owner.attrs['aria-describedby'],'existing app-tooltip');assert.equal(tip.style.left,'192px');assert.equal(tip.style.top,'100px');
  handlers.keydown({key:'Escape'});assert.equal(tip.hidden,true);assert.equal(owner.attrs['aria-describedby'],'existing');
});


test('balance expressions add and subtract exact kopecks, ignoring spaces', () => {
  for(const [expression,expected] of [['50000 + 3000',5300000],['50 000- 3 000 + 12,34',4701234],['-10.25 + 20,50 - 0,01',1024],[' + 0,10 + 0,20 ',30],['',0]])
    assert.equal(finance.parseBalanceExpression(expression),expected,expression);
  for(const expression of ['50000+', '1--2', '1*2', '1/2', '1.234', 'abc', '1+(2)', '100000000001'])
    assert.throws(()=>finance.parseBalanceExpression(expression));
});

test('submitting a balance expression saves the result and rejects invalid input', async () => {
  const start=script.indexOf('function renderBalance(){'),end=script.indexOf('function confirmDialog(',start);
  const handlers={},input={value:'50000',addEventListener(){},focus(){},setSelectionRange(start,end){this.selection=[start,end];}};
  const form={isConnected:true,addEventListener:(name,fn)=>handlers[name]=fn},error={textContent:''},container={innerHTML:''};
  const state={balance:5000000,balanceDate:'2026-11-01'},mapping={'#header-balance':container,'#header-balance-input':input,'#header-balance-form':form,'#header-balance-error':error};
  const ctx={state,editingBalance:false,$:selector=>mapping[selector],esc:String,parseBalanceExpression:finance.parseBalanceExpression,today:()=> '2026-11-10',change:async fn=>fn(state)};
  vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);ctx.editBalance();assert.deepEqual(input.selection,[5,5]);
  input.value='50000 + 3000';await handlers.submit({preventDefault(){}});assert.equal(state.balance,5300000);
  ctx.editBalance();input.value='53000 * 2';await handlers.submit({preventDefault(){}});assert.equal(state.balance,5300000);assert(error.textContent);
});

test('past days are settled once while today and previously settled items stay untouched', () => {
  const s=empty();s.balance=0;
  s.transactions=[
    {id:'salary',name:'Зарплата',kind:'income',amount:100000,repeat:'once',date:'2026-11-10'},
    {id:'early',name:'Оплачено',kind:'expense',amount:10000,repeat:'once',date:'2026-11-10'},
    {id:'recurring',name:'Связь',kind:'expense',amount:5000,repeat:'monthly',date:'2026-11-01',day:11},
    {id:'today',name:'Сегодня',kind:'expense',amount:2000,repeat:'once',date:'2026-11-13'}
  ];
  const early=finance.eventsBetween(s,'2026-11-10','2026-11-13').find(e=>e.id==='early');
  finance.settle(s,early,'2026-11-10');
  const result=finance.closePastDays(s,'2026-11-13');
  assert.equal(result.count,2);assert.equal(s.balance,85000);assert.equal(s.autoFromDate,'2026-11-13');
  assert(s.completed['salary:2026-11-10'].automatic);assert(s.completed['recurring:2026-11-11'].automatic);
  assert(!s.completed['today:2026-11-13']);assert(!s.completed['early:2026-11-10'].automatic);
  assert.equal(finance.closePastDays(s,'2026-11-13').changed,false);assert.equal(s.balance,85000);
  assert.equal(finance.forecast(s,'2026-11-13','2026-11-30').balance,83000);
  storage.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(finance.closePastDays(s,'2026-11-14').count,1);assert.equal(s.balance,83000);
});

test('automatic settlement uses the shifted salary date and survives a storage round trip', () => {
  const s=empty();s.balance=0;
  finance.saveIncomeSource(s,{id:'salary',name:'Работа',incomeType:'salary',amount:100000,taxRate:0,salaryShare:10000,repeat:'monthly',date:'2026-11-01',salaryDay:15,advanceDate:null});
  assert.equal(finance.closePastDays(s,'2026-11-13').count,0);
  assert.equal(finance.closePastDays(s,'2026-11-14').count,1);
  assert.equal(s.balance,100000);assert(s.completed['salary:2026-11-15']);
  const records=new Map(),mock={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)},store=storage.browserStore(mock);
  const saved=store.save(s,0),reopened=store.load('2026-11-14');assert.equal(reopened.revision,saved.revision);
  assert.equal(finance.closePastDays(reopened.state,'2026-11-14').changed,false);assert.equal(reopened.state.balance,100000);
});

test('automatic debt settlement tracks the cash expense and the debt adjustment separately', () => {
  for(const kind of ['card','personal']){
    const s=empty();s.balance=100000;
    s.debts=[{id:'d',kind,name:'Долг',amount:20000,...(kind==='card'?{creditLimit:100000,cardBalance:80000}:{})}];
    s.transactions=[{id:'p',name:'Долг',kind:'expense',amount:30000,repeat:'once',date:'2026-11-10',debtId:'d'}];
    assert.equal(finance.closePastDays(s,'2026-11-11').count,1);
    assert.equal(s.balance,70000);assert.equal(s.debts[0].amount,0);assert.equal(s.completed['p:2026-11-10'].debtDelta,20000);
    if(kind==='card')assert.equal(s.debts[0].cardBalance,100000);
    storage.validateState(s);finance.undoSettlement(s,'p:2026-11-10');
    assert.equal(s.balance,100000);assert.equal(s.debts[0].amount,20000);
    assert.equal(finance.closePastDays(s,'2026-11-11').count,0);
  }
});

test('existing backups begin automatic accounting on activation instead of replaying older events', () => {
  const s=empty();delete s.autoFromDate;s.balance=50000;
  s.transactions=[{id:'old',name:'Старый платёж',kind:'expense',amount:10000,repeat:'once',date:'2026-11-01'}];
  const activated=finance.closePastDays(s,'2026-11-10');assert(activated.activated);assert.equal(s.balance,50000);assert(!s.completed['old:2026-11-01']);
  assert.equal(finance.closePastDays(s,'2026-11-11').count,0);assert.equal(s.balance,50000);
});

test('automatic settlements remain saveable when a later planned repayment exceeds the reduced debt', () => {
  const s=empty();s.balance=100000;
  s.debts=[{id:'d',name:'Долг',kind:'personal',amount:100000}];
  s.transactions=[{id:'past',name:'Долг',kind:'expense',amount:80000,repeat:'once',date:'2026-11-10',debtId:'d'},
    {id:'future',name:'Долг',kind:'expense',amount:100000,repeat:'once',date:'2026-11-20',debtId:'d'}];
  finance.closePastDays(s,'2026-11-11');assert.equal(s.debts[0].amount,20000);assert.equal(s.balance,20000);
  storage.validateState(s);
  assert(finance.forecast(s,'2026-11-11','2026-11-30').events.some(e=>e.id==='future'));
});

test('automatic events are listed with an undo action', () => {
  const s=empty();s.balance=10000;
  s.transactions=[{id:'bill',name:'Связь',kind:'expense',amount:1000,repeat:'once',date:'2026-11-10'}];
  finance.closePastDays(s,'2026-11-11');
  const now='2026-11-11',end='2026-12-10',plan=finance.forecast(s,now,end);
  const out=views.compactPlan({state:s,now,end,plan,dateLabel:String,money:String,esc:String,kindNames:{}});
  assert.match(out,/Автоматически учтено: 1/);assert.match(out,/data-action="undo-auto" data-id="bill:2026-11-10"/);
});

test('long creditor names do not block automatic settlement', () => {
  const s=empty();s.balance=2000;const name='А'.repeat(120);
  s.debts=[{id:'d',name,kind:'personal',amount:1000}];
  s.transactions=[{id:'p',name,kind:'expense',amount:1000,repeat:'once',date:'2026-11-10',debtId:'d'}];
  assert.equal(finance.closePastDays(s,'2026-11-11').count,1);
  storage.validateState(s);assert.equal(s.balance,1000);
});


test('closed debts follow active dated and undated entries in the paid group', () => {
  const s=empty();
  finance.savePaymentEntry(s,{type:'personal',name:'Закрыт',amount:0,payments:[]});
  finance.savePaymentEntry(s,{type:'personal',name:'Не указан',amount:null,payments:[]});
  finance.savePaymentEntry(s,{type:'personal',name:'Открыт',amount:50000,payments:[]});
  finance.savePaymentEntry(s,{type:'regular',name:'По дате',payments:[{amount:1000,repeat:'once',date:'2026-11-20'}]});
  const ctx={state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{personal:'Частный долг'},paymentEntries:finance.paymentEntries};
  const out=views.compactDebts({...ctx,debtFilter:'all'}),row=name=>out.indexOf('>'+name+'</button>');
  assert(row('По дате')<out.indexOf('<strong>Без дат</strong>'));
  assert(out.indexOf('<strong>Без дат</strong>')<row('Не указан'));
  assert(row('Открыт')<out.indexOf('<strong>Выплатил</strong>'));
  assert(out.indexOf('<strong>Выплатил</strong>')<row('Закрыт'));
  const closed=s.debts.find(debt=>debt.name==='Закрыт');
  assert.match(out,new RegExp(`class="editable-row expense-undated-row expense-paid-row"[^>]+data-id="${closed.id}"`));
  const unknown=s.debts.find(debt=>debt.name==='Не указан');
  assert(!out.includes(`expense-paid-row" tabindex="0" data-action="edit-debt" data-id="${unknown.id}"`));
  assert.match(out,/class="numeric debt-total"[^>]*>50000<\/td>/);
});

test('a single paid or undated section has no heading', () => {
  for(const amount of [0,1000,null]){
    const s=empty();finance.savePaymentEntry(s,{type:'personal',name:'Долг',amount,payments:[]});
    const out=views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'personal'});
    assert(!out.includes('<strong>Без дат</strong>'));assert(!out.includes('<strong>Выплатил</strong>'));
    assert.equal(out.includes('expense-paid-row'),amount===0);
  }
});

test('closing and reopening a debt moves its rows between sections without changing the plan', () => {
  const s=empty();s.balance=0;
  finance.savePaymentEntry(s,{type:'loan',name:'Кредит',amount:10000,payments:[{amount:1000,repeat:'once',date:'2026-11-20'}]});
  const debt=s.debts[0],payment=s.transactions[0],render=()=>views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'all'});
  const before=finance.forecast(s,'2026-11-10','2026-12-10').balance;
  assert(!render().includes('expense-paid-row'));debt.amount=0;assert(render().includes('expense-paid-row'));
  assert.equal(finance.forecast(s,'2026-11-10','2026-12-10').balance,before);
  debt.amount=10000;assert(!render().includes('expense-paid-row'));
});

test('a paid one-time service moves to the paid group and undo restores it', () => {
  const s=empty();s.balance=5000000;
  finance.savePaymentEntry(s,{type:'regular',name:'Ивану газовщику',payments:[{amount:1600000,repeat:'once',date:'2026-11-10'}]});
  finance.savePaymentEntry(s,{type:'regular',name:'ММА',payments:[{amount:500000,repeat:'once',date:'2026-11-23'}]});
  const payment=s.transactions.find(t=>t.name==='Ивану газовщику');
  const event=finance.eventsBetween(s,'2026-11-10','2026-12-10').find(e=>e.id===payment.id);
  const render=()=>views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'all'});
  assert(!render().includes('expense-paid-row'));finance.settle(s,event);
  let out=render();assert(out.indexOf('<strong>Выплатил</strong>')<out.indexOf('>Ивану газовщику</button>'));
  assert.match(out,new RegExp(`expense-paid-row"[^>]*data-id="${payment.id}"`));
  finance.undoSettlement(s,event.key);out=render();assert(!out.includes('expense-paid-row'));assert(!out.includes('<strong>Выплатил</strong>'));
});

test('one paid recurring occurrence does not mark the entire schedule paid', () => {
  const s=empty();s.balance=20000;
  finance.savePaymentEntry(s,{type:'regular',name:'Связь',payments:[{amount:1000,repeat:'monthly',day:10}]});
  const event=finance.eventsBetween(s,'2026-11-10','2026-12-10')[0];finance.settle(s,event);
  const out=views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'all'});
  assert(!out.includes('expense-paid-row'));assert(finance.eventsBetween(s,'2026-12-01','2026-12-31').length);
});

test('paid partial debt repayments remain visible without hiding the outstanding debt', () => {
  const s=empty();s.balance=100000;
  finance.savePaymentEntry(s,{type:'personal',name:'Влад',amount:60000,payments:[{amount:10000,repeat:'once',date:'2026-11-10'}]});
  const event=finance.eventsBetween(s,'2026-11-10','2026-12-10')[0];finance.settle(s,event);
  const items=finance.paymentEntries(s,'2026-11-10');assert.equal(items.length,2);
  assert(items.some(e=>e.id===event.id));assert(items.some(e=>e.id===s.debts[0].id));
  const out=views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'all'});
  assert.match(out,new RegExp(`expense-paid-row"[^>]*data-id="${event.id}"`));
  assert(out.includes('<strong>Выплатил</strong>'));assert.equal(s.debts[0].amount,50000);
});


test('expense groups separate recurring, one-time, undated and completed entries in order', () => {
  const s=empty();s.balance=50000;
  finance.savePaymentEntry(s,{type:'regular',name:'Разовый',payments:[{amount:1000,repeat:'once',date:'2026-11-12'}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Ежемесячный',payments:[{amount:2000,repeat:'monthly',day:25}]});
  s.transactions.push({id:'yearly',name:'Ежегодный',kind:'expense',amount:3000,repeat:'yearly',date:'2025-12-01'});
  finance.savePaymentEntry(s,{type:'regular',name:'Без даты',payments:[{amount:4000,repeat:'monthly',day:null}]});
  finance.savePaymentEntry(s,{type:'regular',name:'Оплаченный',payments:[{amount:5000,repeat:'once',date:'2026-11-10'}]});
  const paid=s.transactions.find(row=>row.name==='Оплаченный');
  finance.settle(s,finance.eventsBetween(s,'2026-11-10','2026-12-10').find(e=>e.id===paid.id));
  const render=filter=>views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:filter});
  const out=render('regular'),at=text=>out.indexOf(text);
  assert(at('<strong>Регулярные</strong>')<at('>Ежемесячный</button>'));
  assert(at('>Ежемесячный</button>')<at('<strong>Разовые</strong>'));
  assert(at('>Ежегодный</button>')<at('<strong>Разовые</strong>'));
  assert(at('<strong>Разовые</strong>')<at('>Разовый</button>'));
  assert(at('>Разовый</button>')<at('<strong>Без дат</strong>'));
  assert(at('<strong>Без дат</strong>')<at('>Без даты</button>'));
  assert(at('>Без даты</button>')<at('<strong>Выплатил</strong>'));
  assert(at('<strong>Выплатил</strong>')<at('>Оплаченный</button>'));
  assert.equal((out.match(/expense-paid-row/g)||[]).length,1);
});

test('a single regular or one-time group hides its heading', () => {
  for(const payment of [{amount:1000,repeat:'monthly',day:25},{amount:1000,repeat:'once',date:'2026-11-12'}]){
    const s=empty();finance.savePaymentEntry(s,{type:'regular',name:'Платёж',payments:[payment]});
    const out=views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'all'});
    assert(!out.includes('<strong>Регулярные</strong>'));assert(!out.includes('<strong>Разовые</strong>'));
  }
});

test('expense total excludes paid items and restores them after undo', () => {
  const s=empty();s.balance=10000000;
  for(const [name,amount,repeat,day,date] of [['ММА',500000,'monthly',23,null],['Связь',80000,'monthly',26,null],['GPT',1000000,'monthly',1,null],['Форма',500000,'once',null,null],['Пошлина',1000000,'once',null,null],['Газовщик',1600000,'once',null,'2026-11-10']])
    finance.savePaymentEntry(s,{type:'regular',name,payments:[{amount,repeat,day,date}]});
  const gas=s.transactions.find(t=>t.name==='Газовщик'),event=finance.eventsBetween(s,'2026-11-10','2026-12-10').find(e=>e.id===gas.id);
  const footer=()=>views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'regular'}).split('<tfoot>')[1];
  assert.match(footer(),/class="numeric payments-total"[^>]*>4680000</);
  finance.settle(s,event);assert.match(footer(),/class="numeric payments-total"[^>]*>3080000</);
  finance.undoSettlement(s,event.key);assert.match(footer(),/class="numeric payments-total"[^>]*>4680000</);
});

test('expense totals distinguish no unpaid payments from an unknown unpaid amount', () => {
  const s=empty();s.balance=10000;
  finance.savePaymentEntry(s,{type:'regular',name:'Оплачен',payments:[{amount:1000,repeat:'once',date:'2026-11-10'}]});
  finance.settle(s,finance.eventsBetween(s,'2026-11-10','2026-11-10')[0]);
  const footer=()=>views.compactDebts({state:s,now:'2026-11-10',money:String,icon:()=>'',button:()=>'',esc:String,dateLabel:String,kindNames:{},paymentEntries:finance.paymentEntries,debtFilter:'regular'}).split('<tfoot>')[1];
  assert.match(footer(),/class="numeric payments-total"[^>]*>0</);
  finance.savePaymentEntry(s,{type:'regular',name:'Неизвестно',payments:[{amount:null,repeat:'once',date:null}]});
  assert.match(footer(),/class="numeric payments-total"[^>]*>—</);
});

test('an empty plan offers backup import without showing it for a calculation error', () => {
  const s=empty(),now='2026-11-10',end='2026-12-10';
  const context={state:s,now,end,dateLabel:String,money:String,esc:String,kindNames:{}};
  const html=views.compactPlan({...context,plan:finance.forecast(s,now,end)});
  assert.match(html,/<button type="button" class="button" data-action="import">Импортировать данные<\/button>/);
  assert(html.includes('восстанови данные из резервной копии'));
  const error=views.compactPlan({...context,plan:{points:[],error:'Ошибка',income:0,expense:0,balance:0}});
  assert(!error.includes('data-action="import"'));
});
