const module_1 = (() => {
const {previousWorkingDay} = module_0;
// All money is represented by integer kopecks; dates are local calendar dates.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(value, count) {
  const d = new Date(value + 'T12:00:00'); d.setDate(d.getDate()+count);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function monthEnd(value) {
  const [y,m] = value.split('-').map(Number);
  return `${y}-${String(m).padStart(2,'0')}-${new Date(y,m,0).getDate()}`;
}
function parseMoney(value) {
  const text = String(value).replace(/\s/g,'').replace(',','.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error('Введи сумму с точностью до копеек');
  const amount = Math.round(Number(text)*100);
  if (!Number.isSafeInteger(amount) || Math.abs(amount)>1e13) throw new Error('Слишком большая сумма');
  return amount;
}
function parseBalanceExpression(value) {
  const text=String(value).replace(/\s/g,'');
  if(!text)return 0;
  if(text.length>1000||!/^[+-]?\d+(?:[.,]\d{1,2})?(?:[+-]\d+(?:[.,]\d{1,2})?)*$/.test(text))
    throw new Error('Введи суммы через + или −, не больше двух знаков после запятой');
  let total=0n;
  for(const part of text.match(/[+-]?\d+(?:[.,]\d{1,2})?/g)){
    const negative=part[0]==='-',number=part.replace(/^[+-]/,''),[rubles,kopecks='']=number.split(/[.,]/);
    const amount=BigInt(rubles)*100n+BigInt(kopecks.padEnd(2,'0'));
    total+=negative?-amount:amount;
  }
  if(total>10000000000000n||total< -10000000000000n)throw new Error('Слишком большая сумма');
  return Number(total);
}
function cardDebtAmount(limit,balance) {
  for(const value of [limit,balance]){
    if(value!==null&&(!Number.isSafeInteger(value)||Math.abs(value)>1e13))throw new Error('Укажи корректную сумму карты');
  }
  if(limit!==null&&limit<0)throw new Error('Лимит карты должен быть не меньше нуля');
  if(limit===null||balance===null)return null;
  const amount=Math.max(0,limit-balance);
  if(amount>1e13)throw new Error('Слишком большая сумма долга');
  return amount;
}
function occurrenceDate(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,new Date(year,month,0).getDate())).padStart(2,'0')}`;
}
function plannedRepayments(state, debtId, excludeId=null) {
  return state.transactions.filter(t=>t.debtId===debtId && t.id!==excludeId && !state.completed[`${t.id}:${t.date}`]).sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'));
}
function unplannedDebtAmount(state, debtId, excludeId=null,referenceDate=today()) {
  const debt=state.debts.find(d=>d.id===debtId);
  return Math.max(0,(debt?.amount??0)-plannedRepayments(state,debtId,excludeId).filter(t=>!t.draft&&t.date>=referenceDate).reduce((sum,t)=>sum+t.amount,0));
}
function scheduleRepayment(state,{id,debtId,amount,date}) {
  const debt=state.debts.find(d=>d.id===debtId);
  if(!debt || !['card','personal'].includes(debt.kind)) throw new Error('Погашение доступно для кредитных карт и частных долгов');
  const existing=state.transactions.find(t=>t.id===id);
  if(existing && (existing.debtId!==debtId || state.completed[`${id}:${existing.date}`])) throw new Error('Нельзя изменить учтённое погашение');
  if(!Number.isSafeInteger(amount) || amount<=0) throw new Error('Сумма должна быть больше нуля');
  if(amount>unplannedDebtAmount(state,debtId,id)) throw new Error('Сумма превышает остаток с учётом других запланированных погашений');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date<'2000-01-01' || date>'2100-12-31' || Number.isNaN(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) throw new Error('Укажи корректную дату');
  const item={id,debtId,name:debt.name,kind:'expense',repeat:'once',amount,date};
  if(existing) state.transactions=state.transactions.map(t=>t.id===id?item:t);else state.transactions.push(item);
}
// Loan payments change cash only; the outstanding principal is edited manually.
function loanPayment(state,debt) {
  const linked=state.transactions.find(t=>t.loanDebtId===debt.id);
  if(linked || debt.explicitSchedule) return linked ?? null;
  // Old backups may only have names. Infer ownership only for a unique pair.
  const loans=state.debts.filter(row=>['loan','mortgage'].includes(row.kind));
  const singleMortgage=loans.filter(row=>row.kind==='mortgage').length===1;
  const matches=(transaction,owner)=>transaction.name.toLowerCase()===owner.name.toLowerCase() ||
    (singleMortgage && owner.kind==='mortgage' && transaction.name.toLowerCase()==='ипотека');
  const candidates=state.transactions.filter(row=>row.kind==='expense' && !row.debtId &&
    !row.loanDebtId && !row.explicitSchedule && matches(row,debt));
  if(candidates.length!==1) return null;
  const owners=loans.filter(owner=>!owner.explicitSchedule && matches(candidates[0],owner));
  return owners.length===1 ? candidates[0] : null;
}
function loanPayments(state,debt) {
  const linked=state.transactions.filter(t=>t.loanDebtId===debt.id);
  return linked.length?linked:[loanPayment(state,debt)].filter(Boolean);
}
function saveLoanPayments(state,debt,payments,previous=loanPayments(state,debt)) {
  const ids=new Set(previous.map(t=>t.id));
  if(payments.length>1&&payments.some(p=>p.repeat!=='once'))throw new Error('Выбери один ежемесячный платёж или несколько разовых');
  const draft={...state,transactions:[...state.transactions]};
  const retained=new Set();
  for(const payment of payments){
    const {id,...values}=payment;
    if(id&&(!ids.has(id)||retained.has(id)))throw new Error('Некорректная строка платежа');
    saveLoanPayment(draft,debt,values,id||null);
    if(id)retained.add(id);
  }
  draft.transactions=draft.transactions.filter(t=>!ids.has(t.id)||retained.has(t.id));
  state.transactions=draft.transactions;
}
function paymentTiming(repeat,day,date,existing=null,now=today()) {
  if(repeat==='monthly'){
    if(!Number.isInteger(day)||day<1||day>31)throw new Error('Выбери число платежа от 1 до 31');
    const anchor=existing?.repeat==='monthly'&&existing.date?existing.date:now;
    return {date:anchor.slice(0,7)+'-01',day};
  }
  if(!['once','yearly'].includes(repeat))throw new Error('Выбери повторение платежа');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2000-01-01'||date>'2100-12-31'||Number.isNaN(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Укажи дату платежа');
  return {date};
}
function saveLoanPayment(state,debt,payment,existingId=null) {
  if(!['loan','mortgage'].includes(debt.kind))throw new Error('Выбери кредит или ипотеку');
  const existing=existingId?state.transactions.find(t=>t.id===existingId):null;
  if(existing&&(existing.debtId||existing.kind!=='expense'||(existing.loanDebtId&&existing.loanDebtId!==debt.id)))throw new Error('Платёж связан с другим долгом');
  if(!payment){state.transactions=state.transactions.filter(t=>t.id!==existingId);return;}
  if(!Number.isSafeInteger(payment.amount)||payment.amount<=0)throw new Error('Сумма платежа должна быть больше нуля');
  if(!['once','monthly'].includes(payment.repeat))throw new Error('Выбери повторение платежа');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(payment.date)||payment.date<'2000-01-01'||payment.date>'2100-12-31'||Number.isNaN(Date.parse(payment.date))||new Date(payment.date+'T12:00:00Z').toISOString().slice(0,10)!==payment.date)throw new Error('Укажи дату платежа');
  if(payment.repeat==='monthly'&&'day' in payment&&(!Number.isInteger(payment.day)||payment.day<1||payment.day>31))throw new Error('Выбери число платежа от 1 до 31');
  const next={id:existing?.id||crypto.randomUUID(),name:debt.name,kind:'expense',loanDebtId:debt.id,...payment};
  if(existing)state.transactions=state.transactions.map(t=>t.id===existing.id?next:t);else state.transactions.push(next);
}
function eventsBetween(state, start, end) {
  const events = [];
  const push = (item, date, debt=false, scheduledDate=date) => {
    if (date < start || date > end) return;
    const key = `${item.id}:${scheduledDate}`;
    if (debt || !state.completed[key]) events.push({...item, date, scheduledDate, key, debt, kind:debt?'expense':item.kind});
  };
  for (const item of [...state.transactions,...(state.incomeSources||[]).flatMap(incomeTransactions)]) {
    if(item.draft)continue;
    if (item.repeat==='once') {
      const linked=state.debts.find(d=>d.id===item.debtId);
      push(linked?{...item,name:`Погашение · ${linked.name}`}:item,item.date); continue;
    }
    const [sy,sm,sd] = item.date.split('-').map(Number);
    const shiftIncome=item.kind==='income'&&item.repeat==='monthly'&&(item.incomeType==null||item.incomeType==='salary');
    const until=shiftIncome?addDays(monthEnd(end),1):end;
    const [ey,em] = until.split('-').map(Number);
    for(let year=Number(start.slice(0,4));year<=ey;year++) {
      for(let month=1;month<=12;month++) {
        if(year===ey && month>em) break;
        if(item.repeat==='yearly' && month!==sm) continue;
        const scheduledDate = occurrenceDate(year,month,item.day??sd);
        const adjusted=shiftIncome?previousWorkingDay(scheduledDate):{date:scheduledDate,estimated:false};
        if(scheduledDate>=item.date) push({...item,calendarEstimated:adjusted.estimated},adjusted.date,false,scheduledDate);
      }
    }
  }
  // Same-day income first, consistently in the plan and running-balance forecast.
  return events.sort((a,b)=>a.date.localeCompare(b.date) || (a.kind==='income'?-1:1)-(b.kind==='income'?-1:1) || a.name.localeCompare(b.name));
}
function addMoney(left,right){
  const result=left+right;
  if(!Number.isSafeInteger(result))throw new Error('Сумма прогноза превышает точный диапазон расчёта в копейках');
  return result;
}
function forecast(state,start,end) {
  const events=eventsBetween(state,start,end);
  let balance=state.balance ?? 0, minimum=balance, income=0, expense=0;
  const points=[{date:start,balance}];
  for(const event of events) {
    const delta=event.kind==='income'?event.amount:-event.amount;
    balance=addMoney(balance,delta); minimum=Math.min(minimum,balance);
    if(delta>0) income=addMoney(income,delta); else expense=addMoney(expense,-delta);
    points.push({date:event.date,balance,event});
  }
  points.push({date:end,balance});
  const firstShortfall=points.find(point=>point.balance<0)??null;
  return {events,points,balance,minimum,income,expense,firstShortfall,free:Math.max(0,minimum),shortfall:Math.max(0,-minimum)};
}
function nextIncomeDate(state,start) {
  return eventsBetween(state,start,addDays(start,370)).find(e=>e.kind==='income' && e.date>start)?.date;
}
function settle(state,event,paidOn=today(),automatic=false) {
  if(!event.debt && state.completed[event.key]) throw new Error('Эта операция уже учтена');
  const debtId=event.debt?event.id:event.debtId;
  const debt=debtId?state.debts.find(d=>d.id===debtId):null;
  if(debtId && (!debt || (!automatic&&(debt.amount===null || event.amount>debt.amount)))) throw new Error('Погашение превышает текущий остаток долга');
  const debtDelta=debt?.amount==null?0:Math.min(event.amount,debt.amount);
  const completionKey=event.debt?`${event.key}:${crypto.randomUUID()}`:event.key;
  const delta=event.kind==='income'?event.amount:-event.amount;
  state.balance=addMoney(state.balance??0,delta);
  const planEvent=Object.fromEntries(['id','sourceId','incomeType','name','kind','amount','date','scheduledDate','key','debtId','loanDebtId','calendarEstimated'].filter(key=>event[key]!=null).map(key=>[key,event[key]]));
  planEvent.name=planEvent.name.slice(0,120);
  state.completed[completionKey]={delta,balanceDelta:delta,paidOn,name:event.name.slice(0,120),date:event.date,kind:event.kind,amount:event.amount,debtId:debtId||null,balanceAfter:state.balance,planEvent,...(automatic?{automatic:true,debtDelta}: {})};
  if(debt&&debt.amount!==null){debt.amount-=debtDelta;if(debt.kind==='card'&&debt.creditLimit!=null&&debt.cardBalance!=null)debt.cardBalance=addMoney(debt.cardBalance,debtDelta);}
  return completionKey;
}
function undoSettlement(state,key) {
  const entry=state.completed[key];
  if(!entry) throw new Error('Отметка не найдена');
  const debt=entry.debtId?state.debts.find(d=>d.id===entry.debtId):null;
  if(entry.debtId && !debt) throw new Error('Долг удалён. Восстанови его из резервной копии перед отменой погашения');
  state.balance=addMoney(state.balance??0,-(entry.balanceDelta??entry.delta));
  const debtDelta=entry.debtDelta??entry.amount;
  if(debt&&debtDelta){if(debt.amount===null)throw new Error('Сначала укажи текущий остаток долга');debt.amount=addMoney(debt.amount,debtDelta);if(debt.kind==='card'&&debt.creditLimit!=null&&debt.cardBalance!=null)debt.cardBalance=addMoney(debt.cardBalance,-debtDelta);}
  if(entry.automatic){
    state.autoIgnored??={};state.autoIgnored[key]=true;
  }
  delete state.completed[key];
}

// The watermark is the first calendar day whose recurring events have not been closed.
function closePastDays(state,now=today()) {
  const activated=!state.autoFromDate;
  const start=state.autoFromDate||now;
  const events=start<now?eventsBetween(state,start,addDays(now,-1)):[];
  const onceItems=[...state.transactions,...(state.incomeSources||[]).flatMap(incomeTransactions)];
  const oneOffs=onceItems.filter(item=>item.repeat==='once'&&!item.draft&&item.date&&item.date<now)
    .map(item=>{
      const linked=state.debts.find(debt=>debt.id===item.debtId);
      return {...item,...(linked?{name:`Погашение · ${linked.name}`} : {}),scheduledDate:item.date,key:`${item.id}:${item.date}`,debt:false};
    });
  const unique=new Map();
  for(const event of [...events,...oneOffs]){
    if(!state.completed[event.key]&&!state.autoIgnored?.[event.key])unique.set(event.key,event);
  }
  const pending=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='income'?-1:1)-(b.kind==='income'?-1:1)||a.name.localeCompare(b.name));
  for(const event of pending)settle(state,event,event.date,true);
  const changed=activated||start<now||pending.length>0;
  if(activated||start<now)state.autoFromDate=now;
  return {changed,count:pending.length,activated};
}

// Percentages are integer hundredths of a percent; rounding is to kopecks.
function incomeBreakdown(source) {
  if(!Number.isSafeInteger(source.amount)||source.amount<=0||source.amount>1e13)throw new Error('Укажи сумму больше нуля');
  for(const value of [source.taxRate,source.salaryShare])if(!Number.isInteger(value)||value<0||value>10000)throw new Error('Процент должен быть от 0 до 100');
  const net=Number((BigInt(source.amount)*BigInt(10000-source.taxRate)+5000n)/10000n);
  const salary=source.repeat==='once'?net:Number((BigInt(net)*BigInt(source.salaryShare)+5000n)/10000n);
  return {net,tax:source.amount-net,salary,advance:net-salary};
}
function incomeTransactions(source) {
  const amounts=incomeBreakdown(source),split=source.repeat==='monthly'&&source.salaryShare>0&&source.salaryShare<10000;
  return [
    {id:source.id,sourceId:source.id,incomeType:source.incomeType||'salary',name:source.name+(split?' · Зарплата':''),kind:'income',repeat:source.repeat,date:source.date,day:source.salaryDay,amount:amounts.salary},
    {id:source.id+'-advance',sourceId:source.id,incomeType:source.incomeType||'salary',name:source.name+' · Аванс',kind:'income',repeat:source.repeat,date:source.advanceDate,day:source.advanceDay,amount:amounts.advance}
  ].filter(t=>t.amount>0);
}
function saveIncomeSource(state,source) {
  incomeBreakdown(source);
  if(source.incomeType!=null&&!Object.hasOwn(incomeTypeNames,source.incomeType))throw new Error('Выбери тип поступления');
  if(source.incomeType!=null&&source.incomeType!=='salary'&&(source.taxRate!==0||source.salaryShare!==10000))throw new Error('Некорректные настройки поступления');
  if(!['monthly','once'].includes(source.repeat))throw new Error('Выбери периодичность');
  for(const value of [source.date,...(source.repeat==='monthly'&&source.salaryShare<10000?[source.advanceDate]:[])]){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31'||Number.isNaN(Date.parse(value))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new Error('Укажи корректные даты выплат');
  }
  if(source.repeat==='monthly'){
    for(const [field,required] of [['salaryDay',source.salaryShare>0],['advanceDay',source.salaryShare<10000]]){
      if(required && field in source && (!Number.isInteger(source[field])||source[field]<1||source[field]>31))throw new Error('Выбери число от 1 до 31');
    }
  }
  state.incomeSources??=[];
  const old=state.transactions.find(t=>t.id===source.id);
  if(old&&old.kind!=='income')throw new Error('Идентификатор занят');
  state.transactions=state.transactions.filter(t=>t.id!==source.id);
  const exists=state.incomeSources.some(s=>s.id===source.id);
  if(exists)state.incomeSources=state.incomeSources.map(s=>s.id===source.id?source:s);else state.incomeSources.push(source);
}

// Every expense in the plan has a settings row.
function paymentEntries(state,referenceDate=today()) {
  const entries=[];
  const represented=new Set();
  const loans=new Map(state.debts.filter(d=>['loan','mortgage'].includes(d.kind)).map(d=>[loanPayment(state,d)?.id,d]));
  for(const transaction of state.transactions.filter(t=>t.kind==='expense')){
    const debt=state.debts.find(d=>d.id===(transaction.debtId||transaction.loanDebtId))||loans.get(transaction.id);
    const completedRepayment=Boolean(transaction.debtId&&state.completed[`${transaction.id}:${transaction.date}`]);
    if(debt&&(!completedRepayment||debt.amount===0))represented.add(debt.id);
    entries.push({id:transaction.id,name:transaction.debtId&&debt?debt.name:transaction.name,kind:debt?.kind||'regular',amount:transaction.amount,repeat:transaction.repeat,date:transaction.date,day:transaction.day,debt,transaction});
  }
  for(const debt of state.debts){
    if(!represented.has(debt.id))entries.push({id:debt.id,name:debt.name,kind:debt.kind,amount:null,repeat:'once',date:null,debt,deadline:false});
  }
  const sortDate=entry=>{
    if(!entry.date)return '9999-12-31';
    if(entry.repeat==='once')return entry.date;
    const base=entry.date>referenceDate?entry.date:referenceDate;
    let [year,month]=base.split('-').map(Number);
    if(entry.repeat==='yearly')month=Number(entry.date.slice(5,7));
    const day=entry.day??Number(entry.date.slice(8));
    let next=occurrenceDate(year,month,day);
    if(next<base){if(entry.repeat==='yearly')year++;else if(month===12){year++;month=1;}else month++;next=occurrenceDate(year,month,day);}
    return next;
  };
  return entries.sort((a,b)=>sortDate(a).localeCompare(sortDate(b)));
}

// One editor for ordinary expenses and debt schedules; existing IDs remain stable.
function savePaymentEntry(state,{debtId=null,transactionId=null,type,name,amount=null,due=null,payments=[],creditLimit=null,cardBalance=null}) {
  if(!['regular','loan','mortgage','personal','card'].includes(type))throw new Error('Выбери тип платежа');
  if(!name.trim())throw new Error('Укажи название');
  const oldDebt=state.debts.find(d=>d.id===debtId),oldTransaction=state.transactions.find(t=>t.id===transactionId);
  const previous=oldDebt?(['loan','mortgage'].includes(oldDebt.kind)?loanPayments(state,oldDebt):state.transactions.filter(t=>t.debtId===oldDebt.id)):[oldTransaction].filter(Boolean);
  const owned=new Set(previous.map(t=>t.id));
  const draft={
    ...state,
    debts:state.debts.filter(debt=>debt.id!==debtId),
    transactions:state.transactions.filter(transaction=>{
      const linkedToEditedDebt=oldDebt && (transaction.loanDebtId===oldDebt.id || transaction.debtId===oldDebt.id);
      return !owned.has(transaction.id) && !linkedToEditedDebt;
    })
  };
  if(type==='card')amount=cardDebtAmount(creditLimit,cardBalance)??amount;
  const isDebt=type!=='regular',id=isDebt?(debtId||crypto.randomUUID()):null;
  if(isDebt){
    if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0))throw new Error('Укажи корректный остаток долга');
    draft.debts.push({id,name:name.trim(),kind:type,amount,...(type==='card'?{creditLimit,cardBalance}:{}),explicitSchedule:true,due:null});
  }
  if(type==='regular'&&!payments.length)payments=[{id:oldTransaction?.id,repeat:'once',amount:null,date:null}];
  if(type==='regular'&&payments.length!==1)throw new Error('Для категории «Услуги и покупки» доступно одно расписание');
  if(type==='mortgage'&&payments.some(p=>p.repeat!=='monthly'))throw new Error('Ипотека оплачивается ежемесячно');
  if(['loan','mortgage'].includes(type)&&payments.length>1&&payments.some(p=>p.repeat!=='once'))throw new Error('Ежемесячный платёж должен быть один');
  if(['personal','card'].includes(type)&&amount!==null&&payments.reduce((sum,p)=>sum+(!state.completed[`${p.id}:${p.date}`]&&(!p.date||p.date>=today())?(p.amount??0):0),0)>amount)throw new Error('Сумма платежей не может превышать сумму долга');
  const used=new Set();
  let scheduled=0;
  for(const p of payments){
    if(p.amount!=null&&(!Number.isSafeInteger(p.amount)||p.amount<=0))throw new Error('Сумма платежа должна быть больше нуля');
    if(!(['monthly','once'].includes(p.repeat)||type==='regular'&&p.repeat==='yearly'&&previous.some(t=>t.id===p.id&&t.repeat==='yearly')))throw new Error('Выбери периодичность платежа');
    if(p.id&&(!owned.has(p.id)||used.has(p.id)))throw new Error('Некорректная запись платежа');
    const paymentId=p.id||crypto.randomUUID();used.add(paymentId);
    const timing=(p.repeat==='once'&&!p.date)||(p.repeat==='monthly'&&p.day==null)?{date:null}:paymentTiming(p.repeat,p.day,p.date,previous.find(t=>t.id===p.id));
    const incomplete=p.amount==null||!timing.date;
    const isRepayment=['card','personal'].includes(type);
    if(isRepayment){
      if(p.repeat!=='once')throw new Error('Для погашения укажи конкретную дату');
      if(!incomplete&&!state.completed[`${p.id}:${timing.date}`]&&timing.date>=today())scheduled+=p.amount;
      if(amount!==null&&scheduled>amount)throw new Error('Сумма превышает остаток долга');
    }
    draft.transactions.push({id:paymentId,name:name.trim(),kind:'expense',amount:p.amount??null,repeat:p.repeat,...timing,...(incomplete?{draft:true}:{}),...(isDebt?(isRepayment?{debtId:id}:{loanDebtId:id}):{explicitSchedule:true})});
  }
  state.debts=draft.debts;state.transactions=draft.transactions;
}

return {today,addDays,monthEnd,parseMoney,parseBalanceExpression,cardDebtAmount,plannedRepayments,unplannedDebtAmount,scheduleRepayment,loanPayment,loanPayments,saveLoanPayments,paymentTiming,saveLoanPayment,eventsBetween,forecast,nextIncomeDate,settle,undoSettlement,closePastDays,incomeBreakdown,incomeTransactions,saveIncomeSource,paymentEntries,savePaymentEntry};
})();
