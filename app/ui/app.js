const module_6 = (() => {
const {initDatePickers} = module_5;
const {browserStore,validateState,STORAGE_KEY} = module_3;
const {today,addDays,parseMoney,parseBalanceExpression,forecast,eventsBetween,settle,undoSettlement,closePastDays,plannedRepayments,unplannedDebtAmount,scheduleRepayment,loanPayment,loanPayments,incomeBreakdown,saveIncomeSource,paymentTiming,paymentEntries,savePaymentEntry,cardDebtAmount} = module_1;
const {compactPlan,compactDebts,compactIncome,headerForecast} = module_2;
const {demoStore} = module_4;
const isDemo=document.body.dataset.demo==='true';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(value,sign=false)=>`${sign&&value>0?'+':''}${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:value%100?2:0}).format(value/100)} ₽`;
const bigMoney=value=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:value%100?2:0}).format(value/100)}<span class="currency">₽</span>`;
const dateLabel=(value,year=false)=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',...(year?{year:'numeric'}:{})});
const shortDate=value=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','');
const icons={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m5 0h1"/>',payments:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',income:'<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>',debts:'<path d="m3 7 6 6 4-4 8 10m-6 0h6v-6"/>',history:'<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 2"/>',storage:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',down:'<path d="M12 4v16m-6-6 6 6 6-6"/>',up:'<path d="M12 20V4m-6 6 6-6 6 6"/>',wallet:'<path d="M19 8V5H6a3 3 0 0 0 0 6h15v9H6a3 3 0 0 1-3-3V8m14 7h4"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',check:'<path d="m5 12 4 4L19 6"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',moon:'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.payments}</svg>`;
const titles={income:'Приход',overview:'Обзор',calendar:'Календарь',payments:'Поступления и платежи',debts:'Расход',history:'История',storage:'Мои данные'};
let store;
let state,revision,page='overview',busy=false,dialogSubmit=null,toastTimer,editingBalance=false,showMortgageDebt=false;
const pageStorageKey=isDemo?'finroad-demo-page':'finroad-page';
try{const savedPage=sessionStorage.getItem(pageStorageKey);if(['overview','debts','income'].includes(savedPage))page=savedPage;}catch{}
let debtFilter='all',incomeFilter='all';
let forecastEnd=null, renderedDay, dayTimer;
const kindNames={loan:'Кредит',card:'Кредитная карта',personal:'Частный долг',mortgage:'Ипотека'};
const repeatNames={once:'Разово',monthly:'Каждый месяц',yearly:'Каждый год'};
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  const day=theme==='day',label=day?'Включить ночной режим':'Включить дневной режим';
  $('#theme-toggle').setAttribute('aria-label',label);
  $('#theme-toggle').setAttribute('aria-pressed',String(day));
  $('#theme-toggle').dataset.tooltip=label;
  $('meta[name="theme-color"]').content=day?'#d8eafb':'#0b1021';
}
let savedTheme='night';
try{if(!isDemo)savedTheme=localStorage.getItem('finroad-theme')==='day'?'day':'night';}catch{}
applyTheme(savedTheme);
$('#theme-toggle').onclick=()=>{
  const theme=document.documentElement.dataset.theme==='day'?'night':'day';
  applyTheme(theme);
  try{if(!isDemo)localStorage.setItem('finroad-theme',theme);}catch{}
};
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function save(next,message=isDemo?'Изменено в примере · до перезагрузки':'Сохранено на Mac',restore=false){
  if(busy) throw new Error('Дождись предыдущего сохранения');
  busy=true;
  try{
    const result=restore?store.restore(next):store.save(next,revision);
    revision=result.revision;state=result.state;render();notify(message);
  }finally{busy=false;}
}
function advancePastDays(){
  const next=structuredClone(state),result=closePastDays(next,today());
  if(!result.changed)return result;
  ({state,revision}=store.save(next,revision));
  return result;
}
function change(mutator,message){advancePastDays();const next=structuredClone(state);mutator(next);return save(next,message);}
function head(title,subtitle,actions=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
function button(label,action,primary=false,ic='plus'){return `<button type="button" class="button ${primary?'primary':''}" data-action="${action}">${icon(ic)}${label}</button>`;}
// Repaint the fixed sky behind rounded sticky corners, above scrolling rows.
const stickySky=$('.night').cloneNode(true);
stickySky.classList.add('sticky-sky');
document.body.append(stickySky);
const headerShield=$('.night').cloneNode(true);
headerShield.classList.add('header-shield');
document.body.append(headerShield);
function updateStickyShield(){
  const header=$('.terminal-header').getBoundingClientRect();
  const toolbar=$('.ledger-panel .ledger-toolbar')?.getBoundingClientRect();
  const gap=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-table-gap'))||0;
  const bottom=Math.max(0,header.bottom+gap,toolbar?Math.min(toolbar.bottom,header.bottom+gap+toolbar.height):0);
  stickySky.style.setProperty('--sticky-shield-height',bottom+'px');
  headerShield.style.setProperty('--header-shield-height',Math.max(0,header.bottom+gap)+'px');
}
window.addEventListener('scroll',updateStickyShield,{passive:true});
const headerSizeObserver=new ResizeObserver(()=>{
  const header=$('.terminal-header'),toolbar=$('.ledger-panel .ledger-toolbar');
  document.documentElement.style.setProperty('--app-header-height',header.getBoundingClientRect().height+'px');
  if(toolbar)document.documentElement.style.setProperty('--ledger-toolbar-height',toolbar.getBoundingClientRect().height+'px');
  updateStickyShield();
});
headerSizeObserver.observe($('.terminal-header'));
function render(){
  if(state&&!editingBalance&&!$('#editor').open){
    try{const result=advancePastDays();if(result.count)notify(`Автоматически учтено событий: ${result.count}`);}
    catch(error){notify('Не удалось автоматически учесть прошедшие события: '+error.message);}
  }
  const now=today();
  renderedDay=now;
  clearTimeout(dayTimer);
  const midnight=new Date();
  midnight.setHours(24,0,0,0);
  dayTimer=setTimeout(render,midnight.getTime()-Date.now()+100);
  if(forecastEnd && forecastEnd<now)forecastEnd=null;
  const end=forecastEnd||addDays(now,30);
  let plan;
  try{plan=forecast(state,now,end);}
  catch(error){plan={points:[],balance:0,income:0,expense:0,firstShortfall:null,error:error.message};}
  $('#current-date').innerHTML=`${icon('calendar')}<time datetime="${now}">${dateLabel(now,true)}</time>`;
  $('#page-name').textContent=titles[page];
  $('#navigation').innerHTML=[['overview','План'],['debts','Расход'],['income','Приход']].map(([key,title])=>`<button class="nav-button ${key===page?'active':''}" data-action="nav-${key}" ${key===page?'aria-current="page"':''}>${icon(key)}<span>${title}</span></button>`).join('');
  const ctx={state,now,end,plan,forecastEnd,forecast,dateLabel,shortDate,money,esc,icon,button,kindNames,debtFilter,incomeFilter,plannedRepayments,unplannedDebtAmount,loanPayment,incomeBreakdown,paymentEntries};
  if(!editingBalance)renderBalance();
  const hasMortgage=state.debts.some(debt=>debt.kind==='mortgage');
  if(!hasMortgage)showMortgageDebt=false;
  const debts=state.debts.filter(debt=>showMortgageDebt||debt.kind!=='mortgage'),knownDebts=debts.filter(debt=>debt.amount!==null);
  const debtSum=knownDebts.reduce((total,debt)=>total+BigInt(debt.amount),0n);
  const totalDebt=debtSum<=BigInt(Number.MAX_SAFE_INTEGER)?Number(debtSum):null,missingDebt=debts.length-knownDebts.length;
  const debtLabel=hasMortgage?(showMortgageDebt?'Долг с ипотекой':'Долг без ипотеки'):'Долг';
  const debtButton=$('#header-debt');debtButton.disabled=!hasMortgage;
  if(hasMortgage)debtButton.setAttribute('aria-pressed',String(showMortgageDebt));else debtButton.removeAttribute('aria-pressed');
  debtButton.dataset.tooltip=hasMortgage?(showMortgageDebt?'Показать долг без ипотеки':'Показать долг с ипотекой'):'';
  debtButton.innerHTML=`<small>${debtLabel}${missingDebt?' · указано':''}</small><strong data-tooltip="${missingDebt?'Сумма известных остатков; не заполнено: '+missingDebt:''}">${totalDebt===null?'Сумма вне диапазона':debts.length&&!knownDebts.length?'—':money(totalDebt)}</strong>`;
  $('#header-forecast').innerHTML=headerForecast(ctx);
  const previousToolbar=$('.ledger-panel .ledger-toolbar');
  if(previousToolbar)headerSizeObserver.unobserve(previousToolbar);
  $('#app').innerHTML=page==='debts'?compactDebts(ctx):page==='income'?compactIncome(ctx):compactPlan(ctx);
  const toolbar=$('.ledger-panel .ledger-toolbar');
  if(toolbar)headerSizeObserver.observe(toolbar);
  updateStickyShield();
}
function field(name,label,type='text',value='',extra=''){
  if(type==='number'&&['tax-rate','salary-share','advance-share','salary-day','advance-day'].includes(name)){
    const id='number-'+name;
    return `<div class="field"><label for="${id}">${label}</label><div class="number-stepper"><input id="${id}" name="${name}" type="number" value="${esc(value)}" ${extra}><span class="number-stepper-buttons"><button type="button" data-action="number-step" data-direction="up" aria-label="Увеличить: ${label}"></button><button type="button" data-action="number-step" data-direction="down" aria-label="Уменьшить: ${label}"></button></span></div></div>`;
  }
  return `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(name,label,options,value){return `<fieldset class="choice-field"><legend>${label}</legend><div class="choices">${Object.entries(options).map(([k,v])=>`<label><input type="radio" name="${name}" value="${k}" ${k===value?'checked':''}><span>${v}</span></label>`).join('')}</div></fieldset>`;}
function openDialog(title,fields,submit,label='Сохранить'){$('#delete-dialog').hidden=true;delete $('#delete-dialog').dataset.action;delete $('#delete-dialog').dataset.id;$('#dialog-title').textContent=title;$('#dialog-fields').innerHTML=fields;$('#submit-dialog').textContent=label;$('#form-error').textContent='';dialogSubmit=submit;if(!$('#editor').open)$('#editor').showModal();queueMicrotask(()=>{if(!$('#editor').open)return;const inputs=[...$('#dialog-fields').querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select')];inputs.find(input=>!input.disabled&&input.getClientRects().length)?.focus();});}
function dialogDelete(action,id){if(!id)return;const button=$('#delete-dialog');button.hidden=false;button.dataset.action=action;button.dataset.id=id;}
function closeDialog(){$('#editor').close();dialogSubmit=null;if(state)render();}
function incomeDialog(id=null){
  const source=(state.incomeSources||[]).find(item=>item.id===id);
  const type=source?(source.incomeType||'salary'):incomeFilter==='all'?'salary':incomeFilter;
  const salary=source&&type==='salary'?source:{amount:'',taxRate:1300,salaryShare:5000,repeat:'monthly',date:'',advanceDate:''};
  const other=source&&type!=='salary'?source:{amount:'',repeat:'monthly',date:'',salaryDay:null};
  const floating=(name,label,value,extra='')=>`<label class="expense-floating"><input name="${name}" type="text" value="${esc(value)}" placeholder=" " ${extra}><span>${label}</span></label>`;
  openDialog(id?'Изменить поступление':'Добавить поступление',
    `<div class="income-type">${select('income-type','Тип',incomeTypeNames,type)}</div>`+
    floating('name','Источник',source?.name||'','required maxlength="100"')+
    `<div id="income-salary" data-legacy-once="${salary.repeat==='once'}">${salary.repeat==='once'?'<p class="dialog-note">Эта запись ранее добавлена как разовое поступление.</p>':''}<div class="field-row">${field('gross','Сумма до налога, ₽','text',salary.amount===''?'':salary.amount/100,'required inputmode="decimal"')}${field('tax-rate','Налог, %','number',salary.taxRate/100,'required min="0" max="100" step="0.01"')}</div><div id="income-split"><div class="field-row">${field('salary-share','Зарплата, %','number',salary.salaryShare/100,'required min="0" max="100" step="0.01"')}${field('advance-share','Аванс, %','number',(10000-salary.salaryShare)/100,'required min="0" max="100" step="0.01"')}</div></div><div class="field-row" id="income-days"><div id="salary-day-field">${field('salary-day','Число зарплаты','number',salary.salaryDay??(salary.date?Number(salary.date.slice(8)):''),'min="1" max="31" step="1" placeholder="1–31" data-tooltip="31 — последний день месяца"')}</div><div id="advance-day-field">${field('advance-day','Число аванса','number',salary.advanceDay??(salary.advanceDate?Number(salary.advanceDate.slice(8)):''),'min="1" max="31" step="1" placeholder="1–31" data-tooltip="31 — последний день месяца"')}</div></div><div id="income-once-date">${field('income-date','Дата поступления','date',salary.repeat==='once'?salary.date:'','min="2000-01-01" max="2100-12-31"')}</div><div class="income-preview" id="income-preview" aria-live="polite"></div></div>`+
    `<div id="income-other"><div id="other-heading"><strong>Поступление</strong><label class="service-switch"><span>Регулярно</span><input type="checkbox" name="other-once-switch" value="once" ${other.repeat==='once'?'checked':''} role="switch" aria-label="Разовое поступление"><span class="switch-track" aria-hidden="true"></span><span>Разово</span></label></div><div class="service-fields">${floating('other-amount','Сумма, ₽',other.amount===''?'':other.amount/100,'required inputmode="decimal"')}<div id="other-monthly">${dayInput('other-day',other.repeat==='monthly'?(other.salaryDay??(other.date?Number(other.date.slice(8)):'')):'',true)}</div><div id="other-once"><label class="expense-floating"><input name="other-date" type="date" value="${esc(other.repeat==='once'?other.date||'':'')}" min="2000-01-01" max="2100-12-31"><span>Дата поступления</span></label></div></div></div>`,async data=>{
      const selected=data.get('income-type'),isSalary=selected==='salary';
      const original=isSalary?salary:other;
      const repeat=isSalary?(salary.repeat==='once'?'once':'monthly'):(data.has('other-once-switch')?'once':'monthly');
      const salaryShare=isSalary&&repeat==='monthly'?parseMoney(data.get('salary-share')):10000;
      const anchor=original.repeat==='monthly'&&original.date?original.date.slice(0,7)+'-01':today().slice(0,7)+'-01';
      await change(s=>saveIncomeSource(s,{id:id||crypto.randomUUID(),incomeType:selected,name:data.get('name').trim(),amount:parseMoney(data.get(isSalary?'gross':'other-amount')),taxRate:isSalary?parseMoney(data.get('tax-rate')):0,salaryShare,repeat,date:repeat==='monthly'?anchor:data.get(isSalary?'income-date':'other-date'),advanceDate:isSalary&&repeat==='monthly'&&salaryShare<10000?(original.advanceDate?original.advanceDate.slice(0,7)+'-01':anchor):null,salaryDay:repeat==='monthly'&&salaryShare>0?Number(data.get(isSalary?'salary-day':'other-day')):null,advanceDay:isSalary&&repeat==='monthly'&&salaryShare<10000?Number(data.get('advance-day')):null}),'Поступление сохранено');
    },id?'Сохранить':'Добавить');
  dialogDelete('delete-income',id);
  updateIncomeType();
}
function updateIncomeType(){
  if(!$('#income-salary'))return;
  const salary=$('#editor [name="income-type"]:checked').value==='salary';
  for(const [selector,enabled] of [['#income-salary',salary],['#income-other',!salary]]){
    const section=$(selector);section.hidden=!enabled;section.querySelectorAll('input').forEach(input=>input.disabled=!enabled);
  }
  if(salary)updateIncomeFields();else updateOtherIncomeFields();
}
function updateOtherIncomeFields(){
  if(!$('#income-other')||$('#income-other').hidden)return;
  const monthly=!$('#editor [name="other-once-switch"]').checked;
  for(const [selector,enabled] of [['#other-monthly',monthly],['#other-once',!monthly]]){const section=$(selector);section.hidden=!enabled;section.querySelectorAll('input').forEach(input=>{input.disabled=!enabled;input.required=enabled;});}
}
$('#editor-form').addEventListener('change',event=>{if(event.target.name==='income-type')updateIncomeType();else if(event.target.name==='other-once-switch')updateOtherIncomeFields();});
function updateIncomeFields(event){
  if(!$('#income-split')||$('#income-salary')?.hidden)return;
  if(['salary-share','advance-share'].includes(event?.target.name)){
    try{const value=parseMoney(event.target.value);if(value>=0&&value<=10000)$('#editor [name="'+(event.target.name==='salary-share'?'advance-share':'salary-share')+'"]').value=(10000-value)/100;}catch{}
  }
  const monthly=$('#income-salary').dataset.legacyOnce!=='true';
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
function dayInput(name,value,compact=false){
  const day=value==null||value===''?'':Math.max(1,Math.min(31,Number(value)||1));
  const input=`<input name="${name}" class="day-number" type="number" value="${day}" min="1" max="31" step="1" inputmode="numeric" placeholder=" " data-tooltip="Укажите число от 1 до 31. Если в месяце нет такого числа, событие будет показано в последний день месяца.">`;
  return compact?`<label class="expense-floating compact-day">${input}<span>Число от 1 до 31</span></label>`:`<label class="field">Число платежа${input}</label>`;
}
function paymentDateFields(prefix,item,useWheel=true){
  const day=item?.day??(item?.date?Number(item.date.slice(8)):'');
  return `<div id="${prefix}-day-field">${useWheel?dayInput(prefix+'-day',day):field(prefix+'-day','Число платежа','number',day,'min="1" max="31" step="1" placeholder="1–31" data-tooltip="31 — последний день месяца"')}</div><div id="${prefix}-date-field">${field(prefix+'-date','Дата платежа','date',item?.repeat!=='monthly'?item?.date||'':'','min="2000-01-01" max="2100-12-31"')}</div>`;
}
function loanDateRow(payment=null){
  const completed=Boolean(payment?.debtId&&state.completed[`${payment.id}:${payment.date}`]);
  return `<div class="loan-date-row" data-completed="${completed}" data-payment-id="${esc(payment?.id||'')}"><label class="field"><input name="loan-amount" type="text" value="${esc(payment?.amount!=null?payment.amount/100:'')}" inputmode="decimal" placeholder=" "><span class="loan-row-label">Сумма платежа, ₽</span></label><label class="field"><input name="loan-date" type="date" value="${esc(payment?.date||'')}" min="2000-01-01" max="2100-12-31"><span class="loan-row-label">Дата платежа</span><span class="repayment-status" hidden>Дата прошла</span></label><button type="button" class="icon-button" data-action="remove-loan-date" aria-label="Удалить дату платежа">${icon('trash')}</button></div>`;
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
}
$('#editor-form').addEventListener('change',event=>{if(['repeat','payment-repeat'].includes(event.target.name))updatePaymentDateFields();});
function paymentDialog({debtId=null,transactionId=null}={}){
  const transaction=state.transactions.find(t=>t.id===transactionId);
  const debt=state.debts.find(d=>d.id===(debtId||transaction?.debtId||transaction?.loanDebtId))||state.debts.find(d=>['loan','mortgage'].includes(d.kind)&&loanPayment(state,d)?.id===transactionId);
  const existing=debt?(['loan','mortgage'].includes(debt.kind)?loanPayments(state,debt):state.transactions.filter(t=>t.debtId===debt.id).sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))):[transaction].filter(Boolean);
  const item=existing[0],type=debt?.kind||'regular',name=debt?.name||transaction?.name||'';
  const repeat=type==='mortgage'?'monthly':item?.repeat||'monthly';
  const legacyLoan=type==='loan'&&existing.some(payment=>payment.repeat==='once');
  const legacyRegular=type==='regular'&&repeat==='yearly';
  const options={regular:'Услуги и покупки',personal:'Частный долг',card:'Кредитная карта',loan:'Кредит',mortgage:'Ипотека'};
  const floating=(name,label,value,extra='')=>`<label class="expense-floating"><input name="${name}" type="text" value="${esc(value)}" placeholder=" " ${extra}><span>${label}</span></label>`;
  openDialog(debt||transaction?'Изменить расход':'Добавить расход',
    `<div class="expense-type">${select('entry-type','Тип',options,type)}</div>`+
    floating('name','Название',name,'required maxlength="100"')+
    `<div id="entry-principal">${floating('principal','Остаток долга, ₽',debt?.amount!=null?debt.amount/100:'','inputmode="decimal"')}</div>`+
    `<div id="entry-card"><div class="field-row">${floating('credit-limit','Максимальный лимит, ₽',debt?.creditLimit!=null?debt.creditLimit/100:'','inputmode="decimal"')}${floating('card-balance','Текущий баланс, ₽',debt?.cardBalance!=null?debt.cardBalance/100:'','inputmode="decimal"')}</div><div id="card-debt-preview" data-saved-debt="${debt?.amount??''}" class="income-preview" aria-live="polite"></div></div>`+
    `<div id="service-entry"><div id="service-heading"><strong>Платёж</strong><label class="service-switch"><span>Регулярно</span><input type="checkbox" name="service-once" value="once" ${type==='regular'&&item?.repeat==='once'?'checked':''} role="switch" aria-label="Разовый платёж"><span class="switch-track" aria-hidden="true"></span><span>Разово</span></label></div><div class="service-fields">${floating('service-amount','Сумма, ₽',type==='regular'&&item?.amount!=null?item.amount/100:'','inputmode="decimal"')}<div id="service-monthly">${dayInput('service-day',type==='regular'&&item?.repeat==='monthly'?(item.day??(item.date?Number(item.date.slice(8)):'')):'',true)}</div><div id="service-once-date"><label class="expense-floating"><input name="service-date" type="date" value="${esc(type==='regular'&&item?.repeat==='once'?item.date||'':'')}" min="2000-01-01" max="2100-12-31"><span>Дата платежа</span></label></div></div></div>`+
    `<div id="entry-repeat">${select('entry-repeat','Платёж',{monthly:'Ежемесячно',once:'Определённая дата',...(type==='regular'&&repeat==='yearly'?{yearly:'Ежегодно'}:{})},repeat)}</div>`+
    `<div id="entry-payment">${field('entry-amount','Сумма платежа, ₽','text',item?.amount!=null?item.amount/100:'','inputmode="decimal"')}</div>`+
    `<div id="entry-day">${dayInput('entry-day',item?.day??(item?.date?Number(item.date.slice(8)):''))}</div>`+
    `<div id="credit-monthly"><strong>Платёж</strong><div class="credit-fields">${floating('credit-amount','Сумма, ₽',item?.repeat==='monthly'&&item.amount!=null?item.amount/100:'','inputmode="decimal"')}${dayInput('credit-day',item?.repeat==='monthly'?(item.day??(item.date?Number(item.date.slice(8)):'')):'',true)}</div></div>`+
    `<div id="entry-single-date">${field('entry-date','Дата платежа','date',item&&item.repeat!=='monthly'?item.date:'')}</div>`+
    `<div id="entry-due">${field('entry-due','Погасить до','date',debt?.due||'')}</div>`+
    `<div id="entry-split"><div id="entry-rows">${(existing.filter(p=>p.repeat==='once').length?existing.filter(p=>p.repeat==='once'):[null]).map(loanDateRow).join('')}</div><button type="button" class="button small" data-action="add-entry-date">Разбить платёж</button></div>`,async data=>{
      const type=data.get('entry-type'),repeat=type==='mortgage'?'monthly':data.get('entry-repeat');
      let payments=[];
      if(type==='regular'&&!legacyRegular){
        const amount=data.get('service-amount')?.trim(),once=data.has('service-once');
        payments=[{id:transaction?.id||item?.id,amount:amount?parseMoney(amount):null,repeat:once?'once':'monthly',day:once||!data.get('service-day')?.trim()?null:Number(data.get('service-day')),date:once?data.get('service-date'):null}];
      }else if(type==='mortgage'||type==='loan'&&!legacyLoan){
        const amount=data.get('credit-amount')?.trim(),day=data.get('credit-day')?.trim();
        payments=amount||day?[{id:item?.repeat==='monthly'?item.id:undefined,amount:amount?parseMoney(amount):null,repeat:'monthly',day:day?Number(day):null}]:[];
      }else if(type==='regular'||(['loan','mortgage'].includes(type)&&repeat==='monthly')){
        const amount=data.get('entry-amount')?.trim();
        payments=[{id:type==='regular'?transaction?.id||item?.id:(item?.repeat==='monthly'?item.id:undefined),amount:amount?parseMoney(amount):null,repeat,day:data.get('entry-day')?.trim()?Number(data.get('entry-day')):null,date:data.get('entry-date')}];
      }else payments=[...$('#entry-rows').children].map(row=>({id:row.dataset.paymentId||undefined,amount:row.querySelector('[name="loan-amount"]').value.trim(),date:row.querySelector('[name="loan-date"]').value})).filter(p=>p.amount||p.date).map(p=>({...p,amount:p.amount?parseMoney(p.amount):null,repeat:'once'}));
      await change(s=>savePaymentEntry(s,{debtId:debt?.id,transactionId:transaction?.id,type,name:data.get('name'),amount:type==='card'?debt?.amount??null:type==='regular'||!data.get('principal')?.trim()?null:parseMoney(data.get('principal')),creditLimit:type==='card'&&data.get('credit-limit')?.trim()?parseMoney(data.get('credit-limit')):null,cardBalance:type==='card'&&data.get('card-balance')?.trim()?parseMoney(data.get('card-balance')):null,payments}));
    },debt||transaction?'Сохранить':'Добавить');
  $('#editor').dataset.legacyLoan=String(legacyLoan);
  $('#editor').dataset.legacyRegular=String(legacyRegular);
  dialogDelete(debt?'delete-debt':'delete-transaction',debt?.id||transaction?.id);
  updateEntryFields();
}
function updateEntryFields(){
  if(!$('#entry-principal'))return;
  const type=$('#editor [name="entry-type"]:checked').value;
  const simpleRegular=type==='regular'&&$('#editor').dataset.legacyRegular!=='true';
  const simpleLoan=type==='mortgage'||type==='loan'&&$('#editor').dataset.legacyLoan!=='true';
  const monthly=type==='mortgage'||simpleLoan||$('#editor [name="entry-repeat"]:checked').value==='monthly';
  const split=['card','personal'].includes(type)||type==='loan'&&!monthly;
  for(const [selector,enabled] of [['#entry-principal',!['regular','card'].includes(type)],['#entry-card',type==='card'],['#entry-repeat',['regular','loan'].includes(type)&&!simpleLoan&&!simpleRegular],['#entry-payment',!split&&!simpleLoan&&!simpleRegular],['#entry-day',!split&&monthly&&!simpleLoan&&!simpleRegular],['#service-entry',simpleRegular],['#credit-monthly',simpleLoan],['#entry-single-date',type==='regular'&&!monthly&&!simpleRegular],['#entry-due',false],['#entry-split',split]]){
    const section=$(selector);section.hidden=!enabled;section.querySelectorAll('input').forEach(input=>input.disabled=!enabled);
  }
  const addDate=$('#entry-split [data-action="add-entry-date"]');
  addDate.hidden=['personal','card'].includes(type);
  $('#entry-split').dataset.personal=String(['personal','card'].includes(type));
  addDate.textContent=type==='loan'?'Добавить дату':'Разбить платёж';
  $('#entry-principal .expense-floating span').textContent=type==='personal'?'Сумма долга, ₽':'Остаток долга, ₽';
  if(['personal','card'].includes(type))updateRepaymentRows();
  else $('#entry-rows').querySelectorAll('[data-action="remove-loan-date"]').forEach(button=>button.hidden=false);
  updateServiceTiming();
  updateCardDebtPreview();
}
function updateServiceTiming(){
  const section=$('#service-entry');if(!section||section.hidden)return;
  const once=section.querySelector('[name="service-once"]').checked;
  const monthly=$('#service-monthly'),date=$('#service-once-date');
  monthly.hidden=once;date.hidden=!once;
  monthly.querySelectorAll('input').forEach(input=>input.disabled=once);
  date.querySelectorAll('input').forEach(input=>input.disabled=!once);
}
function updateRepaymentRows(changed=null,sort=false){
  const rows=$('#entry-rows');
  const type=$('#editor [name="entry-type"]:checked')?.value;
  if(!rows||!['personal','card'].includes(type))return;
  let total=null;
  try{
    if(type==='personal'){const principal=$('#editor [name="principal"]').value.trim();if(principal)total=parseMoney(principal);}
    else{const limit=$('#editor [name="credit-limit"]').value.trim(),balance=$('#editor [name="card-balance"]').value.trim(),saved=$('#card-debt-preview').dataset.savedDebt;total=cardDebtAmount(limit?parseMoney(limit):null,balance?parseMoney(balance):null)??(saved!==''?Number(saved):null);}
  }catch{return;}
  const amountOf=row=>{try{const value=row.querySelector('[name="loan-amount"]').value.trim();return value?Math.max(0,parseMoney(value)):0;}catch{return 0;}};
  const isPast=row=>{const date=row.querySelector('[name="loan-date"]').value;return row.dataset.completed==='true'||Boolean(date&&date<today()&&amountOf(row)>0);};
  const outstandingOf=row=>isPast(row)?0:amountOf(row);
  if(changed?.name==='loan-amount'&&total!==null){
    const changedRow=changed.closest('.loan-date-row');
    const others=[...rows.children].filter(row=>row!==changedRow).reduce((sum,row)=>sum+outstandingOf(row),0);
    try{if(!isPast(changedRow)&&changed.value&&parseMoney(changed.value)>Math.max(0,total-others))changed.value=String(Math.max(0,total-others)/100);}catch{}
  }
  let list=[...rows.children],sum=list.reduce((value,row)=>value+outstandingOf(row),0);
  const empty=row=>!row.dataset.paymentId&&!row.querySelector('[name="loan-amount"]').value.trim()&&!row.querySelector('[name="loan-date"]').value;
  const spare=list.filter(empty);
  const needsSpare=sum>0&&(total===null||sum<total);
  for(const row of spare.slice(needsSpare?1:0))if(rows.children.length>1)row.remove();
  if((needsSpare||list.every(row=>row.dataset.completed==='true'))&&!spare.length)rows.insertAdjacentHTML('beforeend',loanDateRow());
  if(sort){
    list=[...rows.children];
    list.sort((a,b)=>(a.querySelector('[name="loan-date"]').value||'9999-12-31').localeCompare(b.querySelector('[name="loan-date"]').value||'9999-12-31'));
    list.forEach(row=>rows.appendChild(row));
  }
  const single=rows.children.length===1;
  for(const row of rows.children){
    const amount=row.querySelector('[name="loan-amount"]'),date=row.querySelector('[name="loan-date"]');
    const completed=row.dataset.completed==='true';
    amount.disabled=completed;date.disabled=completed||amountOf(row)<=0;
    const past=isPast(row);row.classList.toggle('repayment-past',past);
    const status=row.querySelector('.repayment-status');status.hidden=!past;status.textContent=completed?'Оплачено':'Дата прошла';
    row.querySelector('[data-action="remove-loan-date"]').hidden=completed||single||(!amount.value.trim()&&!date.value);
  }
}
function updateCardDebtPreview(){
  const preview=$('#card-debt-preview');
  if(!preview||$('#entry-card').hidden)return;
  try{
    const limit=$('#editor [name="credit-limit"]').value.trim(),balance=$('#editor [name="card-balance"]').value.trim();
    const amount=cardDebtAmount(limit?parseMoney(limit):null,balance?parseMoney(balance):null);
    preview.textContent=amount===null?(preview.dataset.savedDebt!==''?'Сохранённый долг '+money(Number(preview.dataset.savedDebt)):'Долг —'):'Долг '+money(amount);
  }catch(error){preview.textContent=error.message;}
}
$('#editor-form').addEventListener('change',event=>{if(['entry-type','entry-repeat'].includes(event.target.name))updateEntryFields();else if(event.target.name==='service-once')updateServiceTiming();});
$('#editor-form').addEventListener('input',event=>{if(['principal','credit-limit','card-balance','loan-amount'].includes(event.target.name))updateRepaymentRows(event.target);});
$('#editor-form').addEventListener('change',event=>{if(event.target.name==='loan-date')updateRepaymentRows(null,true);});
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
function renderBalance(){
  $('#header-balance').innerHTML=`<small>Сейчас в наличии</small><button class="header-balance-edit" type="button" data-action="balance" aria-label="Изменить текущий остаток"><span class="header-balance-value"><strong>${money(state.balance??0)}</strong>${icon('edit')}</span></button>`;
}
function editBalance(){
  if(editingBalance)return;
  editingBalance=true;
  const container=$('#header-balance');
  container.innerHTML=`<label for="header-balance-input"><small>Сейчас в наличии</small></label><form id="header-balance-form" class="header-balance-form"><input id="header-balance-input" type="text" inputmode="text" value="${esc((state.balance??0)/100)}" aria-label="Сейчас в наличии, рублей" aria-describedby="header-balance-error"><span class="balance-unit" aria-hidden="true">₽</span></form><span id="header-balance-error" class="header-balance-error" role="alert"></span>`;
  const input=$('#header-balance-input'),form=$('#header-balance-form');
  let saving=false,cancelled=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving||cancelled)return;
    let value;
    try{value=parseBalanceExpression(input.value);}catch(error){$('#header-balance-error').textContent=error.message;return;}
    saving=true;editingBalance=false;
    try{await change(s=>{s.balance=value;s.balanceDate=today();},'Остаток обновлён');}
    catch(error){editingBalance=true;saving=false;$('#header-balance-error').textContent=error.message;}
  });
  input.addEventListener('input',()=>{$('#header-balance-error').textContent='';});
  input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelled=true;editingBalance=false;render();$('#header-balance .header-balance-edit')?.focus();}});
  input.addEventListener('blur',()=>{if(!cancelled&&!saving&&form.isConnected)form.requestSubmit();});
  input.focus();input.setSelectionRange(input.value.length,input.value.length);
}
function confirmDialog(title,text,action,label='Подтвердить'){openDialog(title,`<div class="dialog-note">${text}</div>`,action,label);}
async function handle(action,el){
  if(action==='undo-auto')return change(s=>undoSettlement(s,el.dataset.id),'Автоматический учёт отменён');
  if(action==='number-step'){const input=el.closest('.number-stepper').querySelector('input');if(input.disabled)return;try{el.dataset.direction==='up'?input.stepUp():input.stepDown();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}catch{}return;}
  if(action==='reset-demo'&&isDemo){
    store=demoStore(today());({state,revision}=store.load());
    forecastEnd=null;page='overview';try{sessionStorage.setItem(pageStorageKey,page);}catch{}debtFilter='all';render();notify('Исходный пример восстановлен');return;
  }
  if(action==='debt-filter'){debtFilter=el.dataset.kind;render();return;}
  if(action==='income-filter'){incomeFilter=el.dataset.kind;render();return;}
  if(action==='add-entry-date'){$('#entry-rows').insertAdjacentHTML('beforeend',loanDateRow());return;}
  if(action==='add-loan-date'){$('#loan-date-rows').insertAdjacentHTML('beforeend',loanDateRow());return;}
  if(action==='remove-loan-date'){const row=el.closest('.loan-date-row'),personal=row.parentElement.id==='entry-rows'&&['personal','card'].includes($('#editor [name="entry-type"]:checked')?.value);if(personal&&(row.dataset.completed==='true'||row.parentElement.children.length===1||(!row.querySelector('[name="loan-amount"]').value.trim()&&!row.querySelector('[name="loan-date"]').value)))return;row.remove();if(personal)updateRepaymentRows();return;}
  if(action==='repayment')return repaymentDialog(el.dataset.id);
  if(action==='repayment-full'){const input=$('#editor [name="amount"]');input.value=Number(el.dataset.amount)/100;input.dispatchEvent(new Event('input',{bubbles:true}));return;}
  if(action.startsWith('nav-')){const next=action.slice(4);if(!['overview','debts','income'].includes(next))return;page=next;try{sessionStorage.setItem(pageStorageKey,page);}catch{}render();window.scrollTo(0,0);return;}
  if(action==='add-income')return incomeDialog();
  if(action==='edit-income'){const source=state.incomeSources.find(item=>item.id===el.dataset.id),legacy=state.transactions.find(item=>item.id===el.dataset.id&&item.kind==='income');return legacy?transactionDialog('income',el.dataset.id):incomeDialog(el.dataset.id);}
  if(action==='add-payment')return paymentDialog();
  if(action==='add-expense')return transactionDialog('expense');
  if(action==='edit-transaction')return transactionDialog('expense',el.dataset.id);
  if(action==='add-debt'||action==='edit-debt')return debtDialog(el.dataset.id);
  if(action==='balance')return editBalance();
  if(action==='toggle-mortgage-debt'){if(state.debts.some(debt=>debt.kind==='mortgage')){showMortgageDebt=!showMortgageDebt;render();}return;}
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
    const result=JSON.parse(prompt('finroad-storage',JSON.stringify({op:'export',key:STORAGE_KEY,value:JSON.stringify(state,null,2)}))||'{}');if(result.error)notify(result.error);else if(result.value==='saved')notify('Резервная копия сохранена');return;
  }
  if(action==='import'){$('#import-file').click();return;}

}
async function togglePlan(row){
  if(!row||busy)return;
  const key=row.dataset.planKey,completed=Boolean(state.completed[key]);
  await change(s=>{
    if(completed){undoSettlement(s,key);return;}
    const end=forecastEnd||addDays(today(),30);
    const event=eventsBetween(s,today(),end).find(item=>item.key===key);
    if(!event)throw new Error('Событие больше не найдено в плане');
    settle(s,event);
  },completed?'Отметка отменена':'Событие выполнено');
  document.querySelectorAll('[data-plan-key]').forEach(item=>{if(item.dataset.planKey===key)item.focus({preventScroll:true});});
}
document.addEventListener('dblclick',event=>{
  if(event.target.closest('button'))return;
  const row=event.target.closest('[data-plan-key]');
  if(row)Promise.resolve(togglePlan(row)).catch(error=>notify(error.message));
});
document.addEventListener('keydown',event=>{
  const row=event.target.closest('[data-plan-key]');
  if(row&&event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();Promise.resolve(togglePlan(row)).catch(error=>notify(error.message));}
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!event.target.closest('#editor-form'))return;
  const selector='input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]),textarea,select';
  if(!event.target.matches(selector))return;
  const fields=[...$('#editor-form').querySelectorAll(selector)].filter(input=>!input.disabled&&input.getClientRects().length);
  const index=fields.indexOf(event.target);if(index<0||!fields.length)return;
  event.preventDefault();fields[(index+(event.shiftKey?-1:1)+fields.length)%fields.length].focus();
},true);
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
  if(input.matches('.day-number')&&Number(input.value)>31)input.value='31';
  if(['credit-limit','card-balance'].includes(input.name))updateCardDebtPreview();
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
  try{const imported=validateState(JSON.parse(await file.text()));confirmDialog('Восстановить данные?',`Файл «${esc(file.name)}»: ${imported.transactions.length} событий и ${imported.debts.length} долгов. Текущие данные будут заменены.`,async()=>save(imported,'Резервная копия восстановлена',true),'Восстановить');}catch(error){notify(error.message);}
};
function syncStoredState(){
  if(isDemo||!store||$('#editor').open||busy)return;
  try{const latest=store.read();if(latest&&latest.revision!==revision){({state,revision}=latest);render();}}
  catch(error){notify(error.message);}
}
// Validate every incoming document with the same rules as imports. Do not replace
// an editor or a local snapshot that changed while the file was being read.
window.finroadAcceptRemote = (remoteText, expectedText) => {
  if (!state || busy || $('#editor').open || editingBalance) return 'deferred';
  try {
    const latest=store.read();
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
    if (!latest || JSON.stringify(canonical(latest.state))!==JSON.stringify(canonical(JSON.parse(expectedText)))) return 'deferred';
    const next=validateState(JSON.parse(remoteText));
    ({state,revision}=store.restore(next));
    render(); notify('Получены изменения из iCloud Drive'); return 'applied';
  } catch (error) { notify('Не удалось применить данные из iCloud: '+error.message); return 'invalid'; }
};
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY)syncStoredState();});
window.addEventListener('focus',()=>{
  syncStoredState();
  if(state && (renderedDay!==today()||state.autoFromDate!==today())&&!editingBalance&&!$('#editor').open)render();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  syncStoredState();
  if(state&&(renderedDay!==today()||state.autoFromDate!==today())&&!editingBalance&&!$('#editor').open)render();
});
try{store=isDemo?demoStore(today()):browserStore(window.finroadNativeStorage);({state,revision}=store.load(today()));render();}
catch(error){$('#app').innerHTML=`<section class="panel empty"><h2>Не удалось открыть хранилище</h2><p>${esc(error.message)}</p><p>Открой файл в обычном окне браузера с разрешённым сохранением данных. Существующие записи не перезаписаны.</p>${store?button('Импорт резервной копии','import',true,'up'):''}</section>`;}

initDatePickers();
module_tooltip.initTooltips();

return {};
})();
