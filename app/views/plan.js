const module_2 = (() => {
function compactPlan(ctx) {
  const {state,now,end,plan,dateLabel,money,esc,kindNames}=ctx;
  const pending=plan.points.filter(point=>point.event).map(({event,balance})=>({...event,running:balance}));
  const completed=Object.entries(state.completed).filter(([,entry])=>entry.planEvent&&entry.date>=now&&entry.date<=end)
    .map(([key,entry])=>({...entry.planEvent,key,completed:true,delta:entry.balanceDelta??entry.delta}));
  const rows=[...pending,...completed].sort((a,b)=>a.date.localeCompare(b.date)||Number(Boolean(b.completed))-Number(Boolean(a.completed))||((a.kind==='income'?-1:1)-(b.kind==='income'?-1:1))||a.name.localeCompare(b.name));
  // Reconstruct completed balances from current cash, in display order. Stored
  // snapshots can become stale when another completion is undone or reordered.
  let completedBalance=BigInt(state.balance??0)-completed.reduce((sum,event)=>sum+BigInt(event.delta),0n);
  for(const event of rows){
    if(!event.completed)continue;
    completedBalance+=BigInt(event.delta);
    event.running=completedBalance>=BigInt(Number.MIN_SAFE_INTEGER)&&completedBalance<=BigInt(Number.MAX_SAFE_INTEGER)?Number(completedBalance):null;
  }
  const eventDetails=e=>{
    if(e.kind==='income'){
      const source=state.incomeSources?.find(item=>item.id===e.sourceId);
      for(const type of ['Зарплата','Аванс']){
        if(source&&e.name===`${source.name} · ${type}`)return {name:source.name,type};
      }
      return {name:e.name,type:source?(incomeTypeNames[source.incomeType||'salary']||'Приход'):'Приход'};
    }
    const debt=state.debts.find(d=>d.id===(e.debtId||e.loanDebtId||(e.debt?e.id:null)));
    const type=kindNames?.[debt?.kind]||'Услуги и покупки';
    const rawName=(debt?.name||e.name).replace(/^Погашение\s*·\s*/i,'').trim();
    const suffix=` · ${type}`;
    const legacySuffix=debt?.kind==='personal'?' · Личный долг':!debt?' · Личное':null;
    const existingSuffix=[suffix,legacySuffix].filter(Boolean).find(value=>rawName.toLocaleLowerCase('ru').endsWith(value.toLocaleLowerCase('ru')));
    const name=existingSuffix?rawName.slice(0,-existingSuffix.length).trim():rawName;
    return {name:name||e.name,type};
  };
  const days=[];
  for(const event of rows){
    if(days[days.length-1]?.date!==event.date)days.push({date:event.date,events:[]});
    days[days.length-1].events.push(event);
  }
  const minimumBalance=pending.reduce((minimum,e)=>Math.min(minimum,e.running),Infinity);
  const countForm=new Intl.PluralRules('ru').select(rows.length);
  const countLabel={one:'событие',few:'события',many:'событий'}[countForm] || 'событий';
  const crossesYear=now.slice(0,4)!==end.slice(0,4);
  const problem=state.balance!==null ? plan.firstShortfall : null;
  const warning=problem?`<div class="plan-shortfall" role="status"><span>Уходим в минус <b>${dateLabel(problem.date,problem.date.slice(0,4)!==now.slice(0,4))}</b></span><strong>${money(problem.balance)}</strong></div>`:'';
  const automatic=Object.entries(state.completed).filter(([,entry])=>entry.automatic&&entry.planEvent&&entry.date<now)
    .sort((a,b)=>b[1].date.localeCompare(a[1].date));
  const history=automatic.length?`<details class="auto-history"><summary>Автоматически учтено: ${automatic.length}</summary><div class="auto-history-list">${automatic.map(([key,entry])=>`<div class="auto-history-row"><time datetime="${entry.date}">${dateLabel(entry.date,entry.date.slice(0,4)!==now.slice(0,4))}</time><span class="auto-name">${esc(entry.name)}</span><strong class="${entry.kind==='income'?'income-text':'expense-text'}">${money(entry.delta,true)}</strong><button type="button" class="button small subtle" data-action="undo-auto" data-id="${esc(key)}" aria-label="Отменить автоматический учёт: ${esc(entry.name)}">Отменить</button></div>`).join('')}</div></details>`:'';
  const empty=!state.transactions.length&&!state.debts.length&&!(state.incomeSources||[]).length;
  const renderEvent=(e,index,day)=>{
    const {name,type}=eventDetails(e);
    const minimum=!e.completed&&state.balance!==null&&e.kind==='expense'&&e.running>=0&&e.running===minimumBalance;
    const balanceClass=e.running<0?'negative':minimum?'plan-minimum':'';
    const signedAmount=e.kind==='income'?money(e.amount,true):money(-e.amount).replace(/^-/,'−');
    return `<tr class="plan-event${e.completed?' completed':''}" tabindex="0" data-plan-key="${esc(e.key)}" aria-label="${esc(name)}: ${e.completed?'выполнено':'запланировано'}. Нажми Enter или дважды нажми, чтобы ${e.completed?'отменить отметку':'отметить выполнение'}" data-tooltip="Двойное нажатие — ${e.completed?'отменить выполнение':'отметить выполнение'}">${index===0?`<th scope="rowgroup" rowspan="${day.events.length}" class="plan-date"><time datetime="${day.date}">${dateLabel(day.date,crossesYear)}</time></th>`:''}<td class="plan-type" data-label="Тип">${esc(type)}</td><td class="name-cell"><span class="row-name">${esc(name)}</span>${e.scheduledDate&&e.scheduledDate!==e.date?`<span class="transfer-tag">Перенос с ${dateLabel(e.scheduledDate,e.scheduledDate.slice(0,4)!==e.date.slice(0,4))}</span>`:''}${e.calendarEstimated?'<span class="calendar-estimate" data-tooltip="Производственный календарь на этот год ещё не загружен; учтены только суббота и воскресенье">Дата предварительная</span>':''}</td><td class="numeric plan-amount ${e.kind==='income'?'income-text':'expense-text'}" data-label="Сумма">${signedAmount}</td><td data-label="Остаток" class="numeric running-balance ${balanceClass}"${e.completed?' data-tooltip="Текущий остаток с пересчётом выполненных событий в порядке таблицы"':minimum?' data-tooltip="Минимальный остаток после события за выбранный период"':''}>${state.balance===null||e.running==null?'—':money(e.running)}</td></tr>`;
  };
  return `<section class="panel ledger-panel plan-panel">${warning?`<div class="ledger-toolbar">${warning}</div>`:''}
  <div class="ledger-scroll"><table class="ledger plan-ledger"><thead><tr><th scope="col" class="plan-date-col">Дата</th><th scope="col" class="plan-type-col">Тип</th><th scope="col">Событие</th><th scope="col" class="numeric amount-col">Сумма</th><th scope="col" class="numeric balance-col">Остаток</th></tr></thead>
  ${days.length?days.map(day=>`<tbody class="plan-day-group"><tr class="plan-day"><th scope="rowgroup" colspan="5"><time datetime="${day.date}">${dateLabel(day.date,crossesYear)}</time></th></tr>${day.events.map((event,index)=>renderEvent(event,index,day)).join('')}</tbody>`).join(''):`<tbody><tr><td colspan="5"><div class="empty"><h2>${plan.error?'Не удалось рассчитать прогноз':empty?'Весь денежный план — на одном экране':'На этот период событий нет'}</h2><p>${plan.error?esc(plan.error):empty?'Добавь источники во вкладке «Приход» и расходы во вкладке «Расход» или восстанови данные из резервной копии.':'Добавь запись во вкладке «Расход» или «Приход».'}</p>${!plan.error&&empty?'<button type="button" class="button" data-action="import">Импортировать данные</button>':''}</div></td></tr></tbody>`}
  <tfoot><tr><td colspan="5"><div class="plan-totals"><span class="plan-event-count">${rows.length} ${countLabel}</span><span class="plan-total"><span data-tooltip="Только невыполненные события">Приход</span><strong class="income-text">${plan.error?'—':money(plan.income)}</strong></span><span class="plan-total"><span data-tooltip="Только невыполненные события">Расход</span><strong class="expense-text">${plan.error?'—':money(plan.expense)}</strong></span><span class="plan-total plan-final"><span>Остаток</span><strong class="${plan.balance<0?'negative':''}">${state.balance===null||plan.error?'—':money(plan.balance)}</strong></span></div></td></tr></tfoot></table></div>${history}</section>`;
}

function compactDebts(ctx) {
  const {state,money,icon,button,esc,dateLabel,kindNames,debtFilter,paymentEntries}=ctx;
  const entries=paymentEntries(state),groups=[['all','Все'],['regular','Услуги и покупки'],['personal','Частные долги'],['card','Кредитные карты'],['loan','Кредиты'],['mortgage','Ипотека']];
  const selected=entries.filter(e=>debtFilter==='all'||e.kind===debtFilter);
  const paid=entry=>Boolean((entry.debt&&entry.debt.amount===0)||(entry.transaction?.repeat==='once'&&entry.transaction.date&&state.completed[`${entry.transaction.id}:${entry.transaction.date}`]));
  const sections=[
    {label:'Регулярные',items:selected.filter(entry=>!paid(entry)&&entry.date&&entry.repeat!=='once')},
    {label:'Разовые',items:selected.filter(entry=>!paid(entry)&&entry.date&&entry.repeat==='once')},
    {label:'Без дат',items:selected.filter(entry=>!paid(entry)&&!entry.date)},
    {label:'Выплатил',items:selected.filter(paid)}
  ].filter(section=>section.items.length);
  const filtered=sections.flatMap(section=>section.items);
  const sectionStarts=new Map();
  if(sections.length>1){let index=0;for(const section of sections){if(section.label)sectionStarts.set(index,section.label);index+=section.items.length;}}
  const unpaid=filtered.filter(entry=>!paid(entry));
  const knownPayments=unpaid.filter(entry=>entry.amount!==null);
  const paymentsTotal=knownPayments.reduce((sum,entry)=>sum+BigInt(entry.amount),0n);
  const paymentsTotalLabel=unpaid.length&&!knownPayments.length?'—':paymentsTotal>BigInt(Number.MAX_SAFE_INTEGER)?'Сумма вне диапазона':money(Number(paymentsTotal));
  const debts=state.debts.filter(debt=>debtFilter==='all'||debt.kind===debtFilter);
  const known=debts.filter(debt=>debt.amount!==null),missing=debts.length-known.length;
  const total=known.reduce((sum,debt)=>sum+BigInt(debt.amount),0n);
  const totalLabel=debts.length&&!known.length?'—':total>BigInt(Number.MAX_SAFE_INTEGER)?'Сумма вне диапазона':money(Number(total));

  return `<section class="panel ledger-panel payments-panel"><div class="ledger-toolbar management-toolbar payments-toolbar"><div class="debt-tabs" role="tablist" aria-label="Тип платежа">${groups.map(([kind,label])=>`<button type="button" role="tab" aria-selected="${debtFilter===kind}" class="tab ${debtFilter===kind?'active':''}" data-action="debt-filter" data-kind="${kind}">${label}<span class="tab-count">${entries.filter(e=>kind==='all'||e.kind===kind).length}</span></button>`).join('')}</div><div class="ledger-actions"><div class="payment-transfer"><button type="button" class="button subtle" data-action="import">${icon('download')}Импорт</button><button type="button" class="button subtle" data-action="export">${icon('up')}Экспорт</button></div><div class="payment-create">${button('Добавить','add-payment',true)}</div></div></div>
  <div class="ledger-scroll"><table class="ledger management-ledger payment-ledger"><thead><tr><th scope="col">Платёж / кому</th><th scope="col">Тип</th><th scope="col">Расписание</th><th scope="col" class="numeric">Сумма платежа</th><th scope="col" class="numeric">Остаток долга</th></tr></thead><tbody>${filtered.map((e,index)=>{
    const action=e.transaction?'edit-transaction':'edit-debt';
    const pastRepayment=Boolean(e.transaction?.debtId&&e.amount!=null&&e.date&&e.date<ctx.now);
    const completedRepayment=pastRepayment&&Boolean(state.completed[`${e.id}:${e.date}`]);
    const schedule=e.date?(e.repeat==='monthly'?((e.day??Number(e.date.slice(8)))===31?'последний день месяца':(e.day??Number(e.date.slice(8)))+'-го'):dateLabel(e.date,true)+(e.repeat==='yearly'?' · ежегодно':'')):'Не задано';
    return `${sectionStarts.has(index)?`<tr class="expense-undated-heading"><td colspan="5"><strong>${sectionStarts.get(index)}</strong></td></tr>`:''}<tr class="editable-row ${!e.date?'expense-undated-row':''}${paid(e)?' expense-paid-row':''}" tabindex="0" data-action="${action}" data-id="${esc(e.id)}" data-payment-id="${esc(e.id)}" aria-label="Изменить ${esc(e.name)}"><td class="name-cell"><button class="row-name" data-action="${action}" data-id="${esc(e.id)}">${esc(e.name)}</button></td><td data-label="Тип">${kindNames[e.kind]||'Услуги и покупки'}</td><td class="schedule-cell" data-label="Расписание">${schedule}${pastRepayment?`<span class="repayment-past-tag">${completedRepayment?'Учтено':'Дата прошла'}</span>`:''}</td><td class="numeric expense-text" data-label="Сумма платежа">${e.amount===null?'<span class="dash">—</span>':money(e.amount)}</td><td class="numeric payment-debt" data-label="Остаток долга">${e.debt?`<button class="row-name" data-action="edit-debt" data-id="${esc(e.debt.id)}" aria-label="Изменить долг ${esc(e.debt.name)}">${e.debt.amount===null?'—':money(e.debt.amount)}</button>`:'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty">В этом разделе платежей пока нет.</div></td></tr>'}</tbody><tfoot><tr><td colspan="3" class="total-label">Всего${missing?`<span class="foot-muted">не заполнено ${missing}</span>`:''}</td><td class="numeric payments-total" data-label="Платежи" data-tooltip="Сумма неоплаченных платежей, включая регулярные, разовые и без даты">${paymentsTotalLabel}</td><td class="numeric debt-total" data-label="Долг">${totalLabel}</td></tr></tfoot></table></div></section>`;
}

function compactIncome({state,money,icon,button,esc,dateLabel,incomeBreakdown,incomeFilter}) {
  const sources=[...(state.incomeSources||[]).map(source=>({...source,legacy:false,incomeType:source.incomeType||'salary'})),...state.transactions.filter(t=>t.kind==='income').map(({id,name,date,day,repeat,amount})=>({id,name,date,salaryDay:day,repeat,amount,taxRate:0,salaryShare:10000,legacy:true,incomeType:'other'}))];
  const groups=[['all','Все'],...Object.entries(incomeTypeNames)];
  const filtered=sources.filter(source=>incomeFilter==='all'||source.incomeType===incomeFilter);
  const total=filtered.reduce((sum,source)=>sum+BigInt(source.legacy?source.amount:incomeBreakdown(source).net),0n);
  const totalLabel=total>BigInt(Number.MAX_SAFE_INTEGER)?'Сумма вне диапазона':money(Number(total));
  return `<section class="panel ledger-panel payments-panel income-panel"><div class="ledger-toolbar management-toolbar payments-toolbar"><div class="debt-tabs" role="tablist" aria-label="Тип поступления">${groups.map(([kind,label])=>`<button type="button" role="tab" aria-selected="${incomeFilter===kind}" class="tab ${incomeFilter===kind?'active':''}" data-action="income-filter" data-kind="${kind}">${label}<span class="tab-count">${sources.filter(source=>kind==='all'||source.incomeType===kind).length}</span></button>`).join('')}</div><div class="ledger-actions"><div class="payment-transfer"><button type="button" class="button subtle" data-action="import">${icon('download')}Импорт</button><button type="button" class="button subtle" data-action="export">${icon('up')}Экспорт</button></div><div class="payment-create">${button('Добавить','add-income',true)}</div></div></div><div class="ledger-scroll"><table class="ledger management-ledger payment-ledger income-ledger"><thead><tr><th scope="col">Источник</th><th scope="col">Тип</th><th scope="col">Расписание</th><th scope="col" class="numeric">Сумма на руки</th></tr></thead><tbody>${filtered.map(source=>{
    const {net,salary,advance}=source.legacy?{net:source.amount,salary:source.amount,advance:0}:incomeBreakdown(source);
    const schedule=source.repeat==='once'?`${dateLabel(source.date,true)} · разово`:source.repeat==='yearly'?`${dateLabel(source.date)} · ежегодно`:[salary?`${source.salaryShare<10000?'Зарплата · ':''}${(source.salaryDay??Number(source.date.slice(8)))===31?'последний день месяца':(source.salaryDay??Number(source.date.slice(8)))+'-го'} · ${money(salary)}`:'',advance?`Аванс · ${(source.advanceDay??Number(source.advanceDate.slice(8)))===31?'последний день месяца':(source.advanceDay??Number(source.advanceDate.slice(8)))+'-го'} · ${money(advance)}`:''].filter(Boolean).join('<br>');
    return `<tr class="editable-row" tabindex="0" data-action="edit-income" data-id="${esc(source.id)}" aria-label="Изменить источник ${esc(source.name)}"><td class="name-cell"><button class="row-name" data-action="edit-income" data-id="${esc(source.id)}">${esc(source.name)}</button></td><td data-label="Тип">${incomeTypeNames[source.incomeType]}</td><td class="schedule-cell" data-label="Расписание">${schedule}</td><td class="numeric income-text" data-label="Сумма на руки">${money(net)}</td></tr>`;
  }).join('')||'<tr><td colspan="4"><div class="empty">В этом разделе поступлений пока нет.</div></td></tr>'}</tbody><tfoot><tr><td colspan="3" class="total-label">Всего</td><td class="numeric income-total" data-tooltip="Сумма отображённых поступлений; регулярные и разовые сложены вместе">${totalLabel}</td></tr></tfoot></table></div></section>`;
}
function headerForecast({state,now,end,plan,forecastEnd,forecast,dateLabel,money}) {
  const selected=forecastEnd || end;
  const amount=selected===end ? plan.balance : forecast(state,now,selected).balance;
  return `<div class="header-forecast-value" data-date-trigger data-tooltip="Выбрать дату расчёта"><span>Свободно по <label class="forecast-date" data-tooltip="Выбрать дату расчёта"><span>${dateLabel(selected,selected.slice(0,4)!==now.slice(0,4))}</span><input id="forecast-date" type="date" value="${selected}" min="${now}" max="2100-12-31" aria-label="Изменить дату расчёта: ${dateLabel(selected,true)}"></label></span><strong class="${amount<0?'negative':''}" data-tooltip="Остаток на конец выбранной даты с учётом поступлений и платежей">${state.balance===null||plan.error?'—':money(amount)}</strong></div>`;
}

return {compactPlan,compactDebts,compactIncome,headerForecast};
})();
