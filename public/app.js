import {initDatePickers} from './date-picker.js';
import {browserStore,validateState,STORAGE_KEY} from './storage.js';
import {today,addDays,parseMoney,forecast,plannedRepayments,unplannedDebtAmount,scheduleRepayment,loanPayment,loanPayments,incomeBreakdown,saveIncomeSource,paymentTiming,paymentEntries,savePaymentEntry} from './finance.js';
import {compactPlan,compactDebts,compactIncome,headerForecast} from './compact.js';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(value,sign=false)=>`${sign&&value>0?'+':''}${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:value%100?2:0}).format(value/100)} ₽`;
const bigMoney=value=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:value%100?2:0}).format(value/100)}<span class="currency">₽</span>`;
const dateLabel=(value,year=false)=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',...(year?{year:'numeric'}:{})});
const shortDate=value=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','');
const icons={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m5 0h1"/>',payments:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',debts:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',history:'<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 2"/>',storage:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',down:'<path d="M12 4v16m-6-6 6 6 6-6"/>',up:'<path d="M12 20V4m-6 6 6-6 6 6"/>',wallet:'<path d="M19 8V5H6a3 3 0 0 0 0 6h15v9H6a3 3 0 0 1-3-3V8m14 7h4"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',check:'<path d="m5 12 4 4L19 6"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',moon:'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.payments}</svg>`;
const titles={income:'Доход',overview:'Обзор',calendar:'Календарь',payments:'Поступления и платежи',debts:'Платежи',history:'История',storage:'Мои данные'};
let store;
let state,revision,page='overview',busy=false,dialogSubmit=null,toastTimer;
let debtFilter='all';
let forecastEnd=null, renderedDay, dayTimer;
const kindNames={loan:'Кредит',card:'Кредитная карта',personal:'Личный долг',mortgage:'Ипотека'};
const repeatNames={once:'Разово',monthly:'Каждый месяц',yearly:'Каждый год'};
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  const day=theme==='day',label=day?'Включить ночной режим':'Включить дневной режим';
  $('#theme-toggle').setAttribute('aria-label',label);
  $('#theme-toggle').setAttribute('aria-pressed',String(day));
  $('#theme-toggle').title=label;
  $('meta[name="theme-color"]').content=day?'#d8eafb':'#0b1021';
}
let savedTheme='night';
try{savedTheme=localStorage.getItem('finroad-theme')==='day'?'day':'night';}catch{}
applyTheme(savedTheme);
$('#theme-toggle').onclick=()=>{
  const theme=document.documentElement.dataset.theme==='day'?'night':'day';
  applyTheme(theme);
  try{localStorage.setItem('finroad-theme',theme);}catch{}
};
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function save(next,message='Сохранено в браузере',restore=false){
  if(busy) throw new Error('Дождись предыдущего сохранения');
  busy=true;
  try{
    const result=restore?store.restore(next):store.save(next,revision);
    revision=result.revision;state=result.state;render();notify(message);
  }finally{busy=false;}
}
function change(mutator,message){const next=structuredClone(state);mutator(next);return save(next,message);}
function head(title,subtitle,actions=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
function button(label,action,primary=false,ic='plus'){return `<button type="button" class="button ${primary?'primary':''}" data-action="${action}">${icon(ic)}${label}</button>`;}
const headerSizeObserver=new ResizeObserver(()=>{
  const header=$('.terminal-header'),toolbar=$('.plan-panel .ledger-toolbar');
  document.documentElement.style.setProperty('--app-header-height',header.getBoundingClientRect().height+'px');
  if(toolbar)document.documentElement.style.setProperty('--plan-toolbar-height',toolbar.getBoundingClientRect().height+'px');
});
headerSizeObserver.observe($('.terminal-header'));
function render(){
  const now=today();
  renderedDay=now;
  clearTimeout(dayTimer);
  const midnight=new Date();
  midnight.setHours(24,0,0,0);
  dayTimer=setTimeout(render,midnight.getTime()-Date.now()+100);
  if(forecastEnd && forecastEnd<now)forecastEnd=null;
  const end=addDays(now,30);
  const plan=forecast(state,now,end);
  $('#current-date').textContent=new Date(today()+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  $('#page-name').textContent=titles[page];
  $('#navigation').innerHTML=[['overview','План'],['debts','Платежи'],['income','Доход']].map(([key,title])=>`<button class="nav-button ${key===page?'active':''}" data-action="nav-${key}" ${key===page?'aria-current="page"':''}>${icon(key)}<span>${title}</span></button>`).join('');
  const ctx={state,now,end,plan,forecastEnd,forecast,dateLabel,shortDate,money,esc,icon,button,kindNames,debtFilter,plannedRepayments,unplannedDebtAmount,loanPayment,incomeBreakdown,paymentEntries};
  $('#header-balance').innerHTML=`<small>Сейчас в наличии</small><strong>${state.balance===null?'Указать':money(state.balance)}</strong>${icon('edit')}`;
  const debts=state.debts.filter(d=>d.kind!=='mortgage'),knownDebts=debts.filter(d=>d.amount!==null);
  const totalDebt=knownDebts.reduce((total,debt)=>total+debt.amount,0),missingDebt=debts.length-knownDebts.length;
  $('#header-debt').innerHTML=`<small>Долг без ипотеки${missingDebt?' · указано':''}</small><strong title="${missingDebt?'Сумма известных остатков; не заполнено: '+missingDebt:'Кредиты, кредитные карты и личные долги'}">${debts.length&&!knownDebts.length?'—':money(totalDebt)}</strong>`;
  $('#header-forecast').innerHTML=headerForecast(ctx);
  const previousToolbar=$('.plan-panel .ledger-toolbar');
  if(previousToolbar)headerSizeObserver.unobserve(previousToolbar);
  $('#app').innerHTML=page==='debts'?compactDebts(ctx):page==='income'?compactIncome(ctx):compactPlan(ctx);
  const toolbar=$('.plan-panel .ledger-toolbar');
  if(toolbar)headerSizeObserver.observe(toolbar);
}
function field(name,label,type='text',value='',extra=''){return `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function select(name,label,options,value){return `<fieldset class="choice-field"><legend>${label}</legend><div class="choices">${Object.entries(options).map(([k,v])=>`<label><input type="radio" name="${name}" value="${k}" ${k===value?'checked':''}><span>${v}</span></label>`).join('')}</div></fieldset>`;}
function openDialog(title,fields,submit,label='Сохранить'){$('#delete-dialog').hidden=true;delete $('#delete-dialog').dataset.action;delete $('#delete-dialog').dataset.id;$('#dialog-title').textContent=title;$('#dialog-fields').innerHTML=fields;$('#submit-dialog').textContent=label;$('#form-error').textContent='';dialogSubmit=submit;if(!$('#editor').open)$('#editor').showModal();}
function dialogDelete(action,id){if(!id)return;const button=$('#delete-dialog');button.hidden=false;button.dataset.action=action;button.dataset.id=id;}
function closeDialog(){$('#editor').close();dialogSubmit=null;}
function incomeDialog(id=null){
  const legacy=state.transactions.find(t=>t.id===id&&t.kind==='income');
  if(legacy?.repeat==='yearly')return transactionDialog('income',id);
  const source=(state.incomeSources||[]).find(s=>s.id===id)||(legacy?{...legacy,taxRate:0,salaryShare:10000}:{name:'',amount:'',taxRate:1300,salaryShare:5000,repeat:'monthly',date:'',advanceDate:''});
  openDialog(id?'Изменить источник':'Новый источник дохода',field('name','Источник','text',source.name,'required maxlength="100"')+select('income-repeat','Периодичность',{monthly:'Ежемесячно',once:'Разово'},source.repeat)+`<div class="field-row">${field('gross','Сумма до налога, ₽','text',source.amount===''?'':source.amount/100,'required inputmode="decimal"')}${field('tax-rate','Налог, %','number',source.taxRate/100,'required min="0" max="100" step="0.01"')}</div><div id="income-split"><div class="field-row">${field('salary-share','Зарплата, %','number',source.salaryShare/100,'required min="0" max="100" step="0.01"')}${field('advance-share','Аванс, %','number',(10000-source.salaryShare)/100,'required min="0" max="100" step="0.01"')}</div></div><div class="field-row" id="income-days"><div id="salary-day-field">${field('salary-day','Число зарплаты','number',source.salaryDay??(source.date?Number(source.date.slice(8)):''),'min="1" max="31" step="1" placeholder="1–31" title="31 — последний день месяца"')}</div><div id="advance-day-field">${field('advance-day','Число аванса','number',source.advanceDay??(source.advanceDate?Number(source.advanceDate.slice(8)):''),'min="1" max="31" step="1" placeholder="1–31" title="31 — последний день месяца"')}</div></div><div id="income-once-date">${field('income-date','Дата поступления','date',source.repeat==='once'?source.date:'','min="2000-01-01" max="2100-12-31"')}</div><div class="income-preview" id="income-preview" aria-live="polite"></div>`,async data=>{
    const repeat=data.get('income-repeat'),salaryShare=repeat==='once'?10000:parseMoney(data.get('salary-share'));
    const anchor=source.repeat==='monthly'&&source.date?source.date.slice(0,7)+'-01':today().slice(0,7)+'-01';
    await change(s=>saveIncomeSource(s,{id:id||crypto.randomUUID(),name:data.get('name').trim(),amount:parseMoney(data.get('gross')),taxRate:parseMoney(data.get('tax-rate')),salaryShare,repeat,date:repeat==='monthly'?anchor:data.get('income-date'),advanceDate:repeat==='monthly'&&salaryShare<10000?(source.advanceDate?source.advanceDate.slice(0,7)+'-01':anchor):null,salaryDay:repeat==='monthly'&&salaryShare>0?Number(data.get('salary-day')):null,advanceDay:repeat==='monthly'&&salaryShare<10000?Number(data.get('advance-day')):null}),'Источник сохранён');
  });
  dialogDelete('delete-income',id);
  updateIncomeFields();
}
function updateIncomeFields(event){
  if(!$('#income-split'))return;
  if(['salary-share','advance-share'].includes(event?.target.name)){
    try{const value=parseMoney(event.target.value);if(value>=0&&value<=10000)$('#editor [name="'+(event.target.name==='salary-share'?'advance-share':'salary-share')+'"]').value=(10000-value)/100;}catch{}
  }
  const monthly=$('#editor [name="income-repeat"]:checked').value==='monthly';
  const share=Number($('#editor [name="salary-share"]').value);
  $('#income-split').hidden=!monthly;
  $('#income-split').querySelectorAll('input').forEach(i=>i.disabled=!monthly);
  $('#income-days').hidden=!monthly;
  $('#income-once-date').hidden=monthly;
  for(const [name,enabled] of [['salary-day',monthly&&share>0],['advance-day',monthly&&share<100],['income-date',!monthly]]){
    const input=$('#editor [name="'+name+'"]');input.disabled=!enabled;input.required=enabled;
  }
  $('#salary-day-field').hidden=share===0;
  $('#advance-day-field').hidden=share===100;
  try{
    const amounts=incomeBreakdown({amount:parseMoney($('#editor [name="gross"]').value),taxRate:parseMoney($('#editor [name="tax-rate"]').value),salaryShare:monthly?parseMoney($('#editor [name="salary-share"]').value):10000,repeat:monthly?'monthly':'once'});
    $('#income-preview').innerHTML=`<span>На руки <strong>${money(amounts.net)}</strong></span>${monthly?`<span>Зарплата ${money(amounts.salary)}</span><span>Аванс ${money(amounts.advance)}</span>`:''}`;
  }catch{$('#income-preview').textContent='На руки —';}
}
$('#editor-form').addEventListener('input',updateIncomeFields);
$('#editor-form').addEventListener('change',updateIncomeFields);
function dayWheel(name,value){
  const day=Math.max(1,Math.min(31,Number(value)||1));
  return `<div class="field day-picker"><span id="${name}-label">Число платежа</span><input type="hidden" name="${name}" value="${day}"><div class="day-wheel-frame"><div class="day-wheel" role="spinbutton" tabindex="0" aria-labelledby="${name}-label" aria-valuemin="1" aria-valuemax="31" aria-valuenow="${day}">${Array.from({length:31},(_,i)=>`<button type="button" tabindex="-1" data-day="${i+1}" class="day-option">${i+1}</button>`).join('')}</div></div><small class="day-wheel-caption">31 — последний день месяца</small></div>`;
}
function initDayWheels(){
  for(const wheel of document.querySelectorAll('#editor .day-wheel')){
    const input=wheel.closest('.day-picker').querySelector('input');
    const paint=day=>{input.value=day;wheel.setAttribute('aria-valuenow',day);wheel.setAttribute('aria-valuetext',day===31?'31 — последний день месяца':String(day));wheel.querySelectorAll('[data-day]').forEach(option=>option.classList.toggle('selected',Number(option.dataset.day)===day));};
    const choose=day=>{day=Math.max(1,Math.min(31,day));paint(day);wheel.scrollTop=(day-1)*36;};
    if(!wheel.dataset.ready){
      wheel.dataset.ready='true';
      wheel.addEventListener('scroll',()=>{if(wheel.getClientRects().length)paint(Math.max(1,Math.min(31,Math.round(wheel.scrollTop/36)+1)));});
      wheel.addEventListener('wheel',event=>{event.preventDefault();if(!event.deltaY)return;choose(Number(input.value)+Math.sign(event.deltaY));},{passive:false});
      wheel.addEventListener('click',event=>{const option=event.target.closest('[data-day]');if(option)choose(Number(option.dataset.day));});
      wheel.addEventListener('keydown',event=>{
        const day=Number(input.value),keys={ArrowUp:day-1,ArrowDown:day+1,PageUp:day-5,PageDown:day+5,Home:1,End:31};
        if(event.key in keys){event.preventDefault();choose(keys[event.key]);}
      });
    }
    if(wheel.getClientRects().length)choose(Number(input.value));
  }
}
function paymentDateFields(prefix,item,useWheel=true){
  const day=item?.day??(item?.date?Number(item.date.slice(8)):'');
  return `<div id="${prefix}-day-field">${useWheel?dayWheel(prefix+'-day',day):field(prefix+'-day','Число платежа','number',day,'min="1" max="31" step="1" placeholder="1–31" title="31 — последний день месяца"')}</div><div id="${prefix}-date-field">${field(prefix+'-date','Дата платежа','date',item?.repeat!=='monthly'?item?.date||'':'','min="2000-01-01" max="2100-12-31"')}</div>`;
}
function loanDateRow(payment=null){
  return `<div class="loan-date-row" data-payment-id="${esc(payment?.id||'')}">${field('loan-amount','Сумма платежа, ₽','text',payment?.amount!=null?payment.amount/100:'','inputmode="decimal"')}${field('loan-date','Дата платежа','date',payment?.date||'','min="2000-01-01" max="2100-12-31"')}<button type="button" class="icon-button" data-action="remove-loan-date" aria-label="Удалить дату платежа">${icon('trash')}</button></div>`;
}
function updatePaymentDateFields(){
  if($('#loan-monthly')){
    const enabled=!$('#loan-payment-fields').hidden,monthly=$('#editor [name="payment-repeat"]:checked')?.value==='monthly';
    for(const [selector,active] of [['#loan-monthly',monthly],['#loan-dates',!monthly]]){
      const section=$(selector);section.hidden=!active;section.querySelectorAll('input').forEach(input=>input.disabled=!enabled||!active);
    }
  }
  for(const [prefix,repeatName] of [['payment','payment-repeat'],['transaction','repeat']]){
    if(!$('#'+prefix+'-day-field'))continue;
    const monthly=$('#editor [name="'+repeatName+'"]:checked')?.value==='monthly';
    const enabled=prefix==='transaction'||!$('#loan-payment-fields').hidden;
    for(const [suffix,active] of [['day',monthly],['date',!monthly]]){
      const wrapper=$('#'+prefix+'-'+suffix+'-field'),input=wrapper.querySelector('input');
      wrapper.hidden=!active;input.disabled=!enabled||!active||(prefix==='payment'&&suffix==='date');input.required=prefix==='transaction'&&!input.disabled;
    }
  }
  initDayWheels();
}
$('#editor-form').addEventListener('change',event=>{if(['repeat','payment-repeat'].includes(event.target.name))updatePaymentDateFields();});
function paymentDialog({debtId=null,transactionId=null}={}){
  const transaction=state.transactions.find(t=>t.id===transactionId);
  const debt=state.debts.find(d=>d.id===(debtId||transaction?.debtId||transaction?.loanDebtId))||state.debts.find(d=>['loan','mortgage'].includes(d.kind)&&loanPayment(state,d)?.id===transactionId);
  const existing=debt?(['loan','mortgage'].includes(debt.kind)?loanPayments(state,debt):plannedRepayments(state,debt.id)):[transaction].filter(Boolean);
  const item=existing[0],type=debt?.kind||'regular',name=debt?.name||transaction?.name||'';
  const repeat=type==='mortgage'?'monthly':item?.repeat==='once'?'once':'monthly';
  openDialog(debt||transaction?'Изменить платёж':'Добавить платёж',
    field('name','Название','text',name,'required maxlength="100"')+
    select('entry-type','Тип',{regular:'Личное',loan:'Кредит',mortgage:'Ипотека',personal:'Личный долг',card:'Кредитная карта'},type)+
    `<div id="entry-principal">${field('principal','Остаток долга, ₽','text',debt?.amount!=null?debt.amount/100:'','inputmode="decimal"')}</div>`+
    `<div id="entry-repeat">${select('entry-repeat','Платёж',{monthly:'Ежемесячно',once:'Определённая дата'},repeat)}</div>`+
    `<div id="entry-payment">${field('entry-amount','Сумма платежа, ₽','text',item?.amount!=null?item.amount/100:'','inputmode="decimal"')}</div>`+
    `<div id="entry-day">${dayWheel('entry-day',item?.day??(item?.date?Number(item.date.slice(8)):1))}</div>`+
    `<div id="entry-single-date">${field('entry-date','Дата платежа','date',item?.repeat==='once'?item.date:'')}</div>`+
    `<div id="entry-due">${field('entry-due','Погасить до','date',debt?.due||'')}</div>`+
    `<div id="entry-split"><div id="entry-rows">${(existing.filter(p=>p.repeat==='once').length?existing.filter(p=>p.repeat==='once'):[null]).map(loanDateRow).join('')}</div><button type="button" class="button small" data-action="add-entry-date">Разбить платёж</button></div>`,async data=>{
      const type=data.get('entry-type'),repeat=type==='mortgage'?'monthly':data.get('entry-repeat');
      let payments=[];
      if(type==='regular'||(['loan','mortgage'].includes(type)&&repeat==='monthly')){
        const amount=data.get('entry-amount')?.trim();
        payments=[{id:type==='regular'?transaction?.id||item?.id:(item?.repeat==='monthly'?item.id:undefined),amount:amount?parseMoney(amount):null,repeat,day:Number(data.get('entry-day')),date:data.get('entry-date')}];
      }else payments=[...$('#entry-rows').children].map(row=>({id:row.dataset.paymentId||undefined,amount:row.querySelector('[name="loan-amount"]').value.trim(),date:row.querySelector('[name="loan-date"]').value})).filter(p=>p.amount||p.date).map(p=>({...p,amount:p.amount?parseMoney(p.amount):null,repeat:'once'}));
      await change(s=>savePaymentEntry(s,{debtId:debt?.id,transactionId:transaction?.id,type,name:data.get('name'),amount:type==='regular'||!data.get('principal')?.trim()?null:parseMoney(data.get('principal')),due:data.get('entry-due')||null,payments}));
    });
  dialogDelete(transaction?'delete-transaction':'delete-debt',transaction?.id||debt?.id);
  updateEntryFields();
}
function updateEntryFields(){
  if(!$('#entry-principal'))return;
  const type=$('#editor [name="entry-type"]:checked').value;
  const monthly=type==='mortgage'||$('#editor [name="entry-repeat"]:checked').value==='monthly';
  const split=['card','personal'].includes(type)||type==='loan'&&!monthly;
  for(const [selector,enabled] of [['#entry-principal',type!=='regular'],['#entry-repeat',['regular','loan'].includes(type)],['#entry-payment',!split],['#entry-day',!split&&monthly],['#entry-single-date',type==='regular'&&!monthly],['#entry-due',['card','personal'].includes(type)],['#entry-split',split]]){
    const section=$(selector);section.hidden=!enabled;section.querySelectorAll('input').forEach(input=>input.disabled=!enabled);
  }
  $('#entry-split [data-action="add-entry-date"]').textContent=type==='loan'?'Добавить дату':'Разбить платёж';
  initDayWheels();
}
$('#editor-form').addEventListener('change',event=>{if(['entry-type','entry-repeat'].includes(event.target.name))updateEntryFields();});
function transactionDialog(kind='expense',id=null,date=today()){
  const item=state.transactions.find(t=>t.id===id)||{name:'',kind,amount:'',date,repeat:'monthly'};
  if(item.kind==='expense')return paymentDialog({transactionId:id});
  if(item.debtId) return repaymentDialog(item.debtId,id);
  if(item.loanDebtId)return debtDialog(item.loanDebtId,id);
  const owner=id?state.debts.find(d=>['loan','mortgage'].includes(d.kind)&&loanPayment(state,d)?.id===id):null;
  if(owner)return debtDialog(owner.id,id);
  const isExpense=item.kind==='expense',repeatValue=isExpense&&item.repeat==='yearly'?'once':item.repeat;
  openDialog(id?(isExpense?'Изменить платёж':'Изменить событие'):kind==='income'?'Новое поступление':'Новый платёж',field('name','Название','text',item.name,'required maxlength="120"')+`<div class="${isExpense?'':'field-row'}">${field('amount','Сумма, ₽','text',item.amount===''?'':item.amount/100,'required inputmode="decimal" placeholder="0"')}${isExpense?'':select('kind','Тип события',{expense:'Платёж',income:'Поступление'},item.kind)}</div>${select('repeat','Повторение',isExpense?{once:'Разово',monthly:'Каждый месяц'}:repeatNames,repeatValue)}${paymentDateFields('transaction',id?{...item,repeat:repeatValue}:null,isExpense)}`,async data=>{
    const amount=parseMoney(data.get('amount'));if(amount<=0)throw new Error('Сумма должна быть больше нуля');
    const repeat=data.get('repeat');
    const next={id:id||crypto.randomUUID(),name:data.get('name').trim(),kind:isExpense?'expense':data.get('kind'),amount,repeat,...paymentTiming(repeat,Number(data.get('transaction-day')),data.get('transaction-date'),id?item:null)};
    await change(s=>{if(id)s.transactions=s.transactions.map(t=>t.id===id?next:t);else s.transactions.push(next);});
  });
  dialogDelete('delete-transaction',id);
  updatePaymentDateFields();
}
function debtDialog(id=null,selectedPaymentId=null){return paymentDialog({debtId:id,transactionId:selectedPaymentId});}
function repaymentDialog(debtId,id=null){return paymentDialog({debtId,transactionId:id});}
function balanceDialog(){
  openDialog('Сколько есть сейчас?',field('balance','Доступные деньги, ₽','text',state.balance===null?'':state.balance/100,'required inputmode="decimal" placeholder="Сумма на счетах и наличные"')+`<p class="dialog-note">Прогноз начнётся с указанной суммы и учтёт события с сегодняшнего дня.</p>`,async data=>{
    const balance=parseMoney(data.get('balance'));
    await change(s=>{s.balance=balance;s.balanceDate=today();},'Остаток обновлён');
  });
}
function confirmDialog(title,text,action,label='Подтвердить'){openDialog(title,`<div class="dialog-note">${text}</div>`,action,label);}
async function handle(action,el){
  if(action==='debt-filter'){debtFilter=el.dataset.kind;render();return;}
  if(action==='add-entry-date'){$('#entry-rows').insertAdjacentHTML('beforeend',loanDateRow());return;}
  if(action==='add-loan-date'){$('#loan-date-rows').insertAdjacentHTML('beforeend',loanDateRow());return;}
  if(action==='remove-loan-date'){el.closest('.loan-date-row').remove();return;}
  if(action==='repayment')return repaymentDialog(el.dataset.id);
  if(action==='repayment-full'){const input=$('#editor [name="amount"]');input.value=Number(el.dataset.amount)/100;input.dispatchEvent(new Event('input',{bubbles:true}));return;}
  if(action.startsWith('nav-')){page=action.slice(4);render();window.scrollTo(0,0);return;}
  if(action==='add-income'||action==='edit-income')return incomeDialog(el.dataset.id);
  if(action==='add-payment')return paymentDialog();
  if(action==='add-expense')return transactionDialog('expense');
  if(action==='edit-transaction')return transactionDialog('expense',el.dataset.id);
  if(action==='add-debt'||action==='edit-debt')return debtDialog(el.dataset.id);
  if(action==='balance')return balanceDialog();
  if(action==='delete-income'){
    const item=(state.incomeSources||[]).find(s=>s.id===el.dataset.id)||state.transactions.find(t=>t.id===el.dataset.id&&t.kind==='income');
    if(!item)return;
    return confirmDialog('Удалить источник?',`${esc(item.name)} исчезнет из плана.`,async()=>change(s=>{s.incomeSources=(s.incomeSources||[]).filter(x=>x.id!==item.id);s.transactions=s.transactions.filter(t=>t.id!==item.id);},'Источник удалён'),'Удалить');
  }
  if(action.startsWith('delete-')){
    const key=action==='delete-debt'?'debts':'transactions',item=state[key].find(x=>x.id===el.dataset.id);
    return confirmDialog('Удалить запись?',`${esc(item.name)} исчезнет из плана.${key==='debts'?' Связанные запланированные погашения тоже будут удалены.':''}`,async()=>change(s=>{s[key]=s[key].filter(x=>x.id!==item.id);if(key==='debts')s.transactions=s.transactions.filter(t=>t.debtId!==item.id&&t.loanDebtId!==item.id);},'Запись удалена'),'Удалить');
  }
  if(action==='export'){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`finroad-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Резервная копия скачана');return;
  }
  if(action==='import'){$('#import-file').click();return;}

}
document.addEventListener('keydown',event=>{const row=event.target.closest('tr[data-action]');if(row&&event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();row.click();}});
document.addEventListener('change',event=>{
  if(event.target.id!=='forecast-date')return;
  const input=event.target,date=input.value;
  if(!date||!input.validity.valid){input.value=forecastEnd||addDays(today(),30);return;}
  forecastEnd=date===addDays(today(),30)?null:date;
  render();
  $('#forecast-date').focus({preventScroll:true});
});
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target)Promise.resolve(handle(target.dataset.action,target)).catch(error=>notify(error.message));});
$('#editor-form').addEventListener('input',event=>{
  const input=event.target;
  if(input.name==='loan-amount'&&$('#entry-rows')&&['card','personal'].includes($('#editor [name="entry-type"]:checked')?.value)){
    try{
      if(!$('#editor [name="principal"]').value.trim())return;
      const total=parseMoney($('#editor [name="principal"]').value),other=[...$('#entry-rows').querySelectorAll('[name="loan-amount"]')].filter(el=>el!==input).reduce((sum,el)=>sum+(el.value?parseMoney(el.value):0),0);
      const max=Math.max(0,total-other);if(input.value&&parseMoney(input.value)>max)input.value=String(max/100);
    }catch{}
  }
  if(!input.matches('[data-repayment-max]'))return;
  const raw=input.value.replace(/\s/g,''),normalized=raw.replace(',','.');
  if(!/^\d*(?:\.\d{0,2})?$/.test(normalized)){
    input.value=input.dataset.lastValue||'';
    return;
  }
  const [rubles,kopecks='']=normalized.split('.');
  const amount=Number(rubles||0)*100+Number(kopecks.padEnd(2,'0'));
  const maximum=Number(input.dataset.repaymentMax);
  input.value=amount>maximum?String(maximum/100):(/^[.,]/.test(raw)?'0'+raw:raw);
  input.dataset.lastValue=input.value;
  $('#form-error').textContent='';
});
$('#close-dialog').onclick=closeDialog;$('#cancel-dialog').onclick=closeDialog;
$('#editor-form').onsubmit=async event=>{event.preventDefault();if(!dialogSubmit||busy)return;$('#submit-dialog').disabled=true;$('#form-error').textContent='';try{await dialogSubmit(new FormData(event.target));closeDialog();}catch(error){$('#form-error').textContent=error.message;}finally{$('#submit-dialog').disabled=false;}};
$('#import-file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{if(file.size>1_900_000)throw new Error('Файл слишком большой');const imported=validateState(JSON.parse(await file.text()));confirmDialog('Восстановить данные?',`Файл «${esc(file.name)}»: ${imported.transactions.length} событий и ${imported.debts.length} долгов. Текущие данные будут заменены.`,async()=>save(imported,'Резервная копия восстановлена',true),'Восстановить');}catch(error){notify(error.message);}
};
function syncStoredState(){
  if(!store||$('#editor').open||busy)return;
  try{const latest=store.read();if(latest&&latest.revision!==revision){({state,revision}=latest);render();}}
  catch(error){notify(error.message);}
}
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY)syncStoredState();});
window.addEventListener('focus',()=>{
  syncStoredState();
  if(state && renderedDay!==today())render();
});
try{store=browserStore(window.localStorage);({state,revision}=store.load(today()));render();}
catch(error){$('#app').innerHTML=`<section class="panel empty"><h2>Не удалось открыть хранилище</h2><p>${esc(error.message)}</p><p>Открой файл в обычном окне браузера с разрешённым сохранением данных. Существующие записи не перезаписаны.</p>${store?button('Импорт резервной копии','import',true,'up'):''}</section>`;}

initDatePickers();
