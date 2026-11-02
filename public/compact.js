export function compactPlan(ctx) {
  const {state,now,end,plan,dateLabel,shortDate,money,esc,kindNames}=ctx;
  const rows=plan.points
    .filter(point=>point.event)
    .map(({event,balance})=>({...event,running:balance}));
  const eventName=e=>{
    if(e.kind==='income')return e.name;
    const debt=state.debts.find(d=>d.id===(e.debtId||e.loanDebtId||(e.debt?e.id:null)));
    const type=kindNames?.[debt?.kind]||'Личное';
    const rawName=(debt?.name||e.name).replace(/^Погашение\s*·\s*/i,'').trim();
    const suffix=` · ${type}`;
    const name=rawName.toLocaleLowerCase('ru').endsWith(suffix.toLocaleLowerCase('ru'))?rawName.slice(0,-suffix.length).trim():rawName;
    return `${name||e.name} · ${type}`;
  };
  const countForm=new Intl.PluralRules('ru').select(rows.length);
  const countLabel={one:'событие',few:'события',many:'событий'}[countForm] || 'событий';
  const crossesYear=now.slice(0,4)!==end.slice(0,4);
  const rangeTitle=`${dateLabel(now,crossesYear)} — ${dateLabel(end,crossesYear)}`;
  const problem=state.balance!==null ? plan.firstShortfall : null;
  const warning=problem?`<div class="plan-shortfall" role="status"><span>Уходим в минус <b>${dateLabel(problem.date,problem.date.slice(0,4)!==now.slice(0,4))}</b></span><strong>${money(problem.balance)}</strong></div>`:'';
  const empty=!state.transactions.length&&!state.debts.length&&!(state.incomeSources||[]).length;
  return `<section class="panel ledger-panel plan-panel"><div class="ledger-toolbar"><h1>${rangeTitle}</h1>${warning}</div>
  <div class="ledger-scroll"><table class="ledger plan-ledger"><thead><tr><th class="date-col">Дата</th><th>Событие</th><th class="numeric">Приход</th><th class="numeric">Расход</th><th class="numeric balance-col">Остаток</th></tr></thead><tbody>
  ${rows.length?rows.map(e=>`<tr><td title="${e.scheduledDate&&e.scheduledDate!==e.date?'Перенос с '+dateLabel(e.scheduledDate,true):''}" class="date-cell">${shortDate(e.date)}</td><td class="name-cell"><span class="row-name">${esc(eventName(e))}</span>${e.calendarEstimated?'<span class="calendar-estimate" title="Производственный календарь на этот год ещё не загружен; учтены только суббота и воскресенье">Дата предварительная</span>':''}<span class="repeat-tag">${e.debt||e.debtId?'погашение':e.repeat==='monthly'?'ежемесячно':e.repeat==='yearly'?'ежегодно':'разово'}</span></td><td class="numeric income-text" data-label="Приход">${e.kind==='income'?money(e.amount):'<span class="dash">—</span>'}</td><td class="numeric expense-text" data-label="Расход">${e.kind==='expense'?money(e.amount):'<span class="dash">—</span>'}</td><td data-label="Остаток" class="numeric running-balance ${e.running<0?'negative':''}">${state.balance===null?'—':money(e.running)}</td></tr>`).join(''):`<tr><td colspan="5"><div class="empty"><h2>${empty?'Весь денежный план — на одном экране':'На этот период событий нет'}</h2><p>${empty?'Добавь источники во вкладке «Доход» и расходы во вкладке «Платежи».':'Добавь запись во вкладке «Платежи» или «Доход».'}</p></div></td></tr>`}
  </tbody><tfoot><tr><td class="total-label" colspan="2">${rows.length} ${countLabel}</td><td class="numeric income-text" data-label="Приход">${money(plan.income)}</td><td class="numeric expense-text" data-label="Расход">${money(plan.expense)}</td><td class="numeric ${plan.balance<0?'negative':''}" data-label="Остаток">${state.balance===null?'—':money(plan.balance)}</td></tr></tfoot></table></div></section>
  `;
}

export function compactDebts(ctx) {
  const {state,money,icon,button,esc,dateLabel,kindNames,debtFilter,paymentEntries}=ctx;
  const entries=paymentEntries(state),groups=[['all','Все'],['regular','Личное'],['mortgage','Ипотека'],['loan','Кредиты'],['card','Кредитные карты'],['personal','Личные долги']];
  const filtered=entries.filter(e=>debtFilter==='all'||e.kind===debtFilter);
  return `<section class="panel ledger-panel"><div class="ledger-toolbar"><div class="debt-tabs" role="tablist" aria-label="Тип платежа">${groups.map(([kind,label])=>`<button role="tab" aria-selected="${debtFilter===kind}" class="tab ${debtFilter===kind?'active':''}" data-action="debt-filter" data-kind="${kind}">${label}<span>${entries.filter(e=>kind==='all'||e.kind===kind).length}</span></button>`).join('')}</div><div class="ledger-actions"><button class="button small subtle" data-action="import">Импорт</button><button class="button small subtle" data-action="export">Экспорт</button>${button('Добавить','add-payment',true)}</div></div>
  <div class="ledger-scroll"><table class="ledger management-ledger payment-ledger"><thead><tr><th>Платёж / кому</th><th>Тип</th><th class="numeric">Сумма платежа</th><th>Расписание</th><th class="numeric">Остаток долга</th></tr></thead><tbody>${filtered.map(e=>{
    const action=e.transaction?'edit-transaction':'edit-debt';
    const schedule=e.date?(e.repeat==='monthly'?`Ежемесячно · ${(e.day??Number(e.date.slice(8)))===31?'последний день месяца':(e.day??Number(e.date.slice(8)))+'-го'}`:dateLabel(e.date,true)+(e.repeat==='yearly'?' · ежегодно':e.deadline?' · остаток к сроку':' · разово')):'Не задано';
    return `<tr class="editable-row" tabindex="0" data-action="${action}" data-id="${esc(e.id)}" data-payment-id="${esc(e.id)}" aria-label="Изменить ${esc(e.name)}"><td class="name-cell"><button class="row-name" data-action="${action}" data-id="${esc(e.id)}">${esc(e.name)}</button></td><td data-label="Тип">${kindNames[e.kind]||'Личное'}</td><td class="numeric expense-text" data-label="Сумма платежа">${e.amount===null?'—':money(e.amount)}</td><td class="schedule-cell" data-label="Расписание">${schedule}</td><td class="numeric" data-label="Остаток долга">${e.debt?`<button class="row-name" data-action="edit-debt" data-id="${esc(e.debt.id)}" aria-label="Изменить долг ${esc(e.debt.name)}">${e.debt.amount===null?'—':money(e.debt.amount)}</button>`:'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty">В этом разделе платежей пока нет.</div></td></tr>'}</tbody></table></div></section>`;
}

export function compactIncome({state,money,icon,button,esc,dateLabel,incomeBreakdown}) {
  const sources=[...(state.incomeSources||[]).map(source=>({...source,legacy:false})),...state.transactions.filter(t=>t.kind==='income').map(({id,name,date,day,repeat,amount})=>({id,name,date,salaryDay:day,repeat,amount,taxRate:0,salaryShare:10000,legacy:true}))];
  return `<section class="panel ledger-panel"><div class="ledger-toolbar"><h1>Источники дохода</h1><div class="ledger-actions">${button('Добавить источник','add-income',true)}</div></div><div class="ledger-scroll"><table class="ledger management-ledger"><thead><tr><th>Источник</th><th class="numeric">До налога</th><th>Налог</th><th class="numeric">На руки</th><th>Выплаты</th></tr></thead><tbody>${sources.map(s=>{
    const {net,salary,advance}=s.legacy ? {net:s.amount,salary:s.amount,advance:0} : incomeBreakdown(s);
    const schedule=s.repeat==='once'?`${dateLabel(s.date,true)} · разово`:s.repeat==='yearly'?`${dateLabel(s.date)} · ежегодно`:[salary?`${s.salaryShare<10000?'Зарплата · ':''}${(s.salaryDay??Number(s.date.slice(8)))===31?'Последний день месяца':(s.salaryDay??Number(s.date.slice(8)))+'-го'} · ${money(salary)}`:'',advance?`Аванс · ${(s.advanceDay??Number(s.advanceDate.slice(8)))===31?'последний день месяца':(s.advanceDay??Number(s.advanceDate.slice(8)))+'-го'} · ${money(advance)}`:''].filter(Boolean).join('<br>');
    return `<tr class="editable-row" tabindex="0" data-action="edit-income" data-id="${esc(s.id)}" aria-label="Изменить источник ${esc(s.name)}"><td class="name-cell"><button class="row-name" data-action="edit-income" data-id="${esc(s.id)}">${esc(s.name)}</button></td><td class="numeric" data-label="До налога">${s.legacy?'—':money(s.amount)}</td><td data-label="Налог">${s.legacy?'Не задан':s.taxRate/100+'%'}</td><td class="numeric income-text" data-label="На руки">${money(net)}</td><td class="schedule-cell" data-label="Выплаты">${schedule}</td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty">Добавь первый источник дохода.</div></td></tr>'}</tbody></table></div></section>`;
}
export function headerForecast({state,now,end,plan,forecastEnd,forecast,dateLabel,money}) {
  const selected=forecastEnd || end;
  const amount=selected===end ? plan.balance : forecast(state,now,selected).balance;
  return `<div class="header-forecast-value"><span>Свободно по <label class="forecast-date" title="Выбрать дату расчёта"><span>${dateLabel(selected,selected.slice(0,4)!==now.slice(0,4))}</span><input id="forecast-date" type="date" value="${selected}" min="${now}" max="2100-12-31" aria-label="Изменить дату расчёта: ${dateLabel(selected,true)}"></label></span><strong class="${amount<0?'negative':''}" title="Остаток на конец выбранной даты с учётом поступлений и платежей">${state.balance===null?'—':money(amount)}</strong></div>`;
}
