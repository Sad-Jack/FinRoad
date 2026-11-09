import {addDays} from './finance.js';
import {emptyState,validateState} from './storage.js';

// Synthetic dates follow the visitor's day so the example never expires.
export function demoState(date) {
  const state=emptyState(date);
  state.demo=true;
  state.balance=1800000;
  state.debts=[
    {id:'demo-loan',name:'Кредит',kind:'loan',amount:18000000,explicitSchedule:true},
    {id:'demo-card',name:'Кредитная карта',kind:'card',creditLimit:10000000,cardBalance:7000000,amount:3000000}
  ];
  state.transactions=[
    {id:'demo-rent',name:'Аренда квартиры',amount:2500000,date:addDays(date,2)},
    {id:'demo-food',name:'Продукты на неделю',amount:600000,date:addDays(date,4)},
    {id:'demo-loan-payment',name:'Кредит',amount:1200000,date:addDays(date,12),loanDebtId:'demo-loan'},
    {id:'demo-living',name:'Продукты и транспорт',amount:800000,date:addDays(date,17)},
    {id:'demo-bills',name:'Коммунальные платежи',amount:700000,date:addDays(date,25)},
    {id:'demo-card-payment',name:'Кредитная карта',amount:1000000,date:addDays(date,27),debtId:'demo-card'}
  ].map(row=>({...row,kind:'expense',repeat:'once'}));
  state.incomeSources=[
    {id:'demo-salary',name:'Зарплата',amount:6000000,date:addDays(date,8)},
    {id:'demo-advance',name:'Аванс',amount:4000000,date:addDays(date,22)}
  ].map(row=>({...row,taxRate:0,salaryShare:10000,repeat:'once'}));
  return validateState(state);
}

// The demo never reads or writes browser storage, even after editing or import.
export function demoStore(date) {
  let record={revision:1,state:demoState(date)};
  const read=()=>structuredClone(record);
  function save(state,revision) {
    if(revision!==record.revision)throw new Error('Обнови пример перед сохранением');
    record={revision:revision+1,state:validateState(state)};
    return read();
  }
  return {read,save,restore:state=>save(state,record.revision),load:read};
}
