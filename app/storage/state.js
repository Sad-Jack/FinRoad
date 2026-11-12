const module_3 = (() => {
const {cardDebtAmount,today} = module_1;
// Persistent browser storage for the standalone file. No HTTP requests.
const STORAGE_KEY = 'finroad-state-v1';
function emptyState(date) {
  return {schema:1,demo:false,balance:null,balanceDate:date,autoFromDate:date,transactions:[],debts:[],incomeSources:[],completed:{}};
}
function validateState(input) {
  const state=structuredClone(input);
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const money=(value,nullable=false,signed=false)=>check(nullable&&value===null||Number.isSafeInteger(value)&&Math.abs(value)<=1e13&&(signed||value>=0),'Некорректная сумма');
  const date=value=>check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&!Number.isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value,'Некорректная дата');
  check(object(state)&&state.schema===1,'Это не резервная копия FinRoad');
  money(state.balance,true,true);date(state.balanceDate);
  if('autoFromDate' in state)date(state.autoFromDate);
  if('autoIgnored' in state){check(object(state.autoIgnored)&&Object.keys(state.autoIgnored).length<=20000,'Некорректная история');for(const [key,value] of Object.entries(state.autoIgnored))check(key.length<=160&&value===true,'Некорректная история');}
  check(typeof state.demo==='boolean','Некорректный формат данных');
  delete state.reserve;
  state.incomeSources??=[];
  const ids=new Set();
  const id=value=>{check(typeof value==='string'&&value.length>0&&value.length<=100&&!ids.has(value),'Некорректный идентификатор');ids.add(value);};
  const name=(value,max=120)=>check(typeof value==='string'&&value.trim().length>0&&value.length<=max,'Некорректное название');
  for(const collection of ['transactions','debts','incomeSources']) {
    check(Array.isArray(state[collection])&&state[collection].length<=(collection==='incomeSources'?1000:2000),'Слишком много записей или неверный формат');
    for(const row of state[collection]) {
      check(object(row),'Некорректная запись');id(row.id);name(row.name,collection==='incomeSources'?100:120);
      if(collection==='incomeSources') {
        if(row.incomeType!=null)check(Object.hasOwn(incomeTypeNames,row.incomeType),'Некорректный тип поступления');
        if(row.incomeType!=null&&row.incomeType!=='salary')check(row.taxRate===0&&row.salaryShare===10000,'Некорректные настройки поступления');
        check(!ids.has(row.id+'-advance'),'Некорректный идентификатор дохода');ids.add(row.id+'-advance');
        money(row.amount);check(row.amount>0&&['once','monthly'].includes(row.repeat),'Некорректный доход');
        for(const key of ['taxRate','salaryShare'])check(Number.isInteger(row[key])&&row[key]>=0&&row[key]<=10000,'Процент должен быть от 0 до 100');
        date(row.date);
        if(row.repeat==='monthly') {
          if(row.salaryShare<10000)date(row.advanceDate);
          for(const [key,required] of [['salaryDay',row.salaryShare>0],['advanceDay',row.salaryShare<10000]])
            if(required&&key in row)check(Number.isInteger(row[key])&&row[key]>=1&&row[key]<=31,'Выбери число выплаты от 1 до 31');
        }
        continue;
      }
      if('draft' in row)check(typeof row.draft==='boolean'&&collection==='transactions'&&row.kind==='expense','Некорректная незаполненная запись');
      const draft=collection==='transactions'&&row.draft===true;
      money(row.amount,collection==='debts'||draft);
      if(collection==='debts') {
        check(['loan','mortgage','personal','card'].includes(row.kind),'Некорректный тип долга');
        if(row.kind==='card'){
          const calculated=cardDebtAmount(row.creditLimit??null,row.cardBalance??null);
          if(calculated!==null)check(row.amount===calculated,'Остаток долга не совпадает с лимитом и балансом карты');
        }
        if(['card','personal'].includes(row.kind))row.due=null;
        else if(row.due)date(row.due);
      } else {
        check(['income','expense'].includes(row.kind)&&['once','monthly','yearly'].includes(row.repeat),'Некорректный тип операции');
        if(row.date!=null||!draft)date(row.date);
        if('day' in row)check(row.repeat==='monthly'&&Number.isInteger(row.day)&&row.day>=1&&row.day<=31,'Выбери число платежа от 1 до 31');
      }
    }
  }
  check(object(state.completed)&&Object.keys(state.completed).length<=20000,'Некорректная история');
  for(const [key,row] of Object.entries(state.completed)) {
    check(key.length<=160&&object(row),'Некорректная история');money(row.delta,false,true);date(row.paidOn);
    if('balanceDelta' in row)money(row.balanceDelta,false,true);
    if('balanceAfter' in row)money(row.balanceAfter,false,true);
    if('automatic' in row)check(typeof row.automatic==='boolean','Некорректная история');
    if('debtDelta' in row){money(row.debtDelta);check(row.debtDelta<=(row.amount??0),'Некорректная история долга');}
    if('planEvent' in row){
      const event=row.planEvent;check(object(event)&&typeof event.key==='string'&&event.key===key&&typeof event.id==='string'&&event.id.length<=108,'Некорректная запись плана');
      name(event.name);date(event.date);date(event.scheduledDate);money(event.amount);check(['income','expense'].includes(event.kind)&&event.amount===row.amount&&event.date===row.date&&event.kind===row.kind,'Некорректная запись плана');
      for(const field of ['sourceId','debtId','loanDebtId','incomeType'])if(event[field]!=null)check(typeof event[field]==='string'&&event[field].length<=100,'Некорректная запись плана');
      if('calendarEstimated' in event)check(typeof event.calendarEstimated==='boolean','Некорректная запись плана');
      check('balanceAfter' in row,'Некорректная запись плана');
    }
    if('amount' in row)money(row.amount);
    if('date' in row)date(row.date);
    if('kind' in row)check(['income','expense'].includes(row.kind),'Некорректная история');
    if('name' in row)check(typeof row.name==='string'&&row.name.length<=120,'Некорректная история');
    if(row.debtId!=null)check(typeof row.debtId==='string'&&row.debtId.length<=100&&'amount' in row,'Некорректная история долга');
  }
  const debts=new Map(state.debts.map(d=>[d.id,d])),scheduled=new Map();
  const automaticallyReducedDebts=new Set(Object.values(state.completed).filter(row=>row.automatic&&row.debtId&&row.debtDelta>0).map(row=>row.debtId));
  for(const row of state.transactions) {
    if(row.loanDebtId!=null) {
      const debt=debts.get(row.loanDebtId);
      check(debt&&['loan','mortgage'].includes(debt.kind)&&row.debtId==null&&row.kind==='expense'&&['once','monthly'].includes(row.repeat)&&(row.draft||row.amount>0),'Некорректный платёж по кредиту');
      if(row.repeat==='monthly')check(state.transactions.filter(t=>t.loanDebtId===row.loanDebtId).length===1,'У долга уже есть расписание платежей');
    }
    if(row.debtId==null)continue;
    const debt=debts.get(row.debtId);
    check(debt,'Долг для погашения не найден');
    check(row.kind==='expense'&&row.repeat==='once'&&(row.draft||row.amount>0),'Погашение должно быть разовым расходом больше нуля');
    if(Object.hasOwn(state.completed,`${row.id}:${row.date}`))continue;
    check(['card','personal'].includes(debt.kind),'Некорректное погашение долга');
    if(row.draft||row.date<today())continue;
    const amount=(scheduled.get(debt.id)||0)+row.amount;scheduled.set(debt.id,amount);
    check(debt.amount===null||amount<=debt.amount||automaticallyReducedDebts.has(debt.id),'Погашения превышают остаток долга');
  }
  return state;
}
function browserStore(storage) {
  function read() {
    const raw=storage.getItem(STORAGE_KEY);
    if(raw===null)return null;
    let record;
    try{record=JSON.parse(raw);}catch{throw new Error('Сохранённые данные повреждены. Они не были перезаписаны. Восстанови резервную копию через импорт.');}
    if(!record||!Number.isSafeInteger(record.revision)||record.revision<1)throw new Error('Неизвестный формат сохранённых данных');
    const needsDueCleanup=Array.isArray(record.state?.debts)&&record.state.debts.some(debt=>['card','personal'].includes(debt?.kind)&&debt.due!=null);
    return {revision:record.revision,state:validateState(record.state),needsDueCleanup};
  }
  function save(state,revision) {
    const latest=read();
    if((latest?.revision??0)!==revision)throw new Error('Данные изменились в другой вкладке. Обнови страницу перед сохранением.');
    const record={revision:revision+1,state:validateState(state)};
    // setItem is atomic: quota/permission errors leave the previous value intact.
    try{storage.setItem(STORAGE_KEY,JSON.stringify(record));}
    catch{throw new Error('Браузер не смог сохранить данные. Проверь доступ к хранилищу и свободное место. Изменения не сохранены.');}
    return record;
  }
  function restore(state) {
    const validated=validateState(state);
    let revision=0;
    try{revision=read()?.revision??0;}catch{}
    const record={revision:revision+1,state:validated};
    try{storage.setItem(STORAGE_KEY,JSON.stringify(record));}
    catch{throw new Error('Браузер не смог сохранить импорт. Текущие данные не заменены.');}
    return record;
  }
  return {read,save,restore,load(date){const current=read();if(!current)return save(emptyState(date),0);return current.needsDueCleanup?save(current.state,current.revision):current;}};
}

return {STORAGE_KEY,emptyState,validateState,browserStore};
})();
