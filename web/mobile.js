const mobileDemo = (() => {
  const tabs = [
    ['overview', 'План', '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>'],
    ['debts', 'Расход', '<path d="M6 6l12 12m-8 0h8v-8"/>'],
    ['income', 'Приход', '<path d="M6 18L18 6m-8 0h8v8"/>'],
    ['more', 'Ещё', '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01m3.99 0h.01m3.99 0h.01" stroke-width="2.5"/>'],
  ];

  function navigation() {
    return tabs.map(([key, label, path]) => `<button type="button" data-action="nav-${key}">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${label}</span>
    </button>`).join('');
  }

  function planView({state, now, end, plan, rows, dateLabel, money, esc, icon}) {
    const formatDate = date => dateLabel(date, date.slice(0, 4) !== now.slice(0, 4));
    const cash = value => value == null ? '—' : money(value);
    const balance = cash(state.balance);
    const projected = state.balance == null || plan.error ? '—' : money(plan.balance);
    const calculationDate = new Date(`${end}T00:00:00Z`).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
    const shortfall = state.balance != null && plan.firstShortfall;
    const warning = shortfall ? `<p class="mobile-warning"><span aria-hidden="true">⚠</span> Нехватка ${formatDate(shortfall.date)} · ${money(shortfall.balance)}</p>` : '';
    const days = new Map();
    for (const event of rows) {
      if (!days.has(event.date)) days.set(event.date, []);
      days.get(event.date).push(event);
    }
    const events = [...days].map(([date, events]) => `<section class="mobile-day" aria-labelledby="day-${date}">
      <h2 id="day-${date}"><time datetime="${date}">${formatDate(date)}</time></h2>
      ${events.map(event => `<button class="mobile-event" type="button" data-action="confirm-event" data-id="${esc(event.key)}"
        aria-label="${esc(event.name)}, ${event.completed ? 'выполнено' : 'запланировано'}, ${money(event.amount)}">
        <span class="mobile-event-status ${event.completed ? 'is-complete' : ''}" aria-hidden="true">${event.completed ? '✓' : ''}</span>
        <span class="mobile-event-copy"><strong>${esc(event.name)}</strong><small>Остаток: ${state.balance == null ? '—' : cash(event.running)}</small></span>
        <strong class="${event.kind === 'income' ? 'mobile-positive' : 'mobile-negative'}">${event.kind === 'income' ? '+' : '−'}${money(event.amount)}</strong>
      </button>`).join('')}
    </section>`).join('');
    const totals = plan.error ? '' : `<small class="mobile-plan-totals">
      <span class="mobile-positive">+${money(plan.income)}</span>
      <span class="mobile-negative">−${money(plan.expense)}</span>
    </small>`;
    return `<div class="mobile-view">
      <section class="mobile-card mobile-summary" aria-label="Прогноз остатка">
        <div class="mobile-cash">
          <small>Сейчас в наличии</small>
          <button type="button" class="mobile-balance" data-action="mobile-balance" aria-label="Изменить текущий остаток: ${balance}">${balance} ${icon('edit')}</button>
        </div>
        <div class="mobile-metrics">
          <div>
            <small>Дата расчёта</small>
            <label class="forecast-date mobile-date" data-date-trigger>
              <span aria-hidden="true">${calculationDate}</span>
              <input id="forecast-date" type="date" value="${end}" min="${now}" max="2100-12-31" aria-label="Дата расчёта">
            </label>
          </div>
          <div><small>Свободно на дату</small><strong class="mobile-projected">${projected}</strong></div>
        </div>
        ${warning}
      </section>
      <div class="mobile-plan-heading"><h1>План</h1>${totals}</div>
      ${events ? `<div class="mobile-card mobile-events">${events}</div>` : `<p class="mobile-card mobile-note">${plan.error ? esc(plan.error) : 'На выбранный период событий нет.'}</p>`}
    </div>`;
  }

  function entriesView({state, kindNames, dateLabel, money, esc, icon}, income) {
    const title = income ? 'Приход' : 'Расход';
    const kind = income ? 'income' : 'expense';
    const records = [
      ...(income ? state.incomeSources : state.debts).map(entry => ({entry, section: income ? 'source' : 'debt'})),
      ...state.transactions.filter(entry => entry.kind === kind).map(entry => ({entry, section: 'transaction'})),
    ];
    const cards = records.map(({entry, section}) => {
      const action = income ? 'edit-income' : section === 'debt' ? 'edit-debt' : 'edit-transaction';
      let description;
      if (section === 'debt') {
        description = `${kindNames[entry.kind] || 'Долг'} · остаток долга`;
      } else {
        const category = section === 'source' ? incomeTypeNames[entry.incomeType || 'salary'] :
          entry.debtId ? 'Погашение долга' : entry.loanDebtId ? 'Платёж по кредиту' : income ? 'Доход' : 'Расход';
        const day = entry.salaryDay ?? entry.day ?? entry.date?.slice(8);
        const schedule = entry.repeat === 'monthly' && day ? `каждый месяц, ${Number(day)} числа` :
          entry.date ? dateLabel(entry.date, true) : entry.draft ? 'черновик' : '';
        description = schedule ? `${category} · ${schedule}` : category;
      }
      return `<button class="mobile-card mobile-entry" type="button" data-action="${action}" data-id="${esc(entry.id)}" aria-label="Изменить ${esc(entry.name)}">
        <span class="mobile-entry-copy"><strong>${esc(entry.name)}</strong><small>${esc(description)}</small></span>
        <strong>${entry.amount == null ? '—' : money(entry.amount)}</strong><span class="mobile-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('');
    return `<div class="mobile-view">
      <header class="mobile-section-header"><h1>${title}</h1><button type="button" data-action="${income ? 'add-income' : 'add-payment'}" aria-label="Добавить ${income ? 'доход' : 'расход'}">${icon('plus')}</button></header>
      <div class="mobile-entries">${cards || '<p class="mobile-card mobile-note">Записей пока нет.</p>'}</div>
    </div>`;
  }

  function moreView() {
    return `<div class="mobile-view">
      <header class="mobile-section-header"><h1>Ещё</h1></header>
      <section class="mobile-card mobile-more">
        <h2>Демо FinRoad</h2>
        <p>Здесь вымышленные данные. Изменения сбрасываются при перезагрузке страницы.</p>
        <button type="button" class="mobile-primary" data-action="reset-demo">Вернуть пример</button>
      </section>
      <section class="mobile-card mobile-more">
        <h2>Импорт и экспорт</h2>
        <div class="mobile-more-actions"><button type="button" data-action="import">Импортировать</button><button type="button" data-action="export">Экспортировать</button></div>
      </section>
      <section class="mobile-card mobile-more">
        <h2>iCloud Drive</h2>
        <p>Синхронизация общего плана доступна в приложениях для Mac и iPhone.</p>
        <a href="https://github.com/Sad-Jack/FinRoad#как-установить-finroad">Как установить FinRoad</a>
      </section>
    </div>`;
  }

  return {navigation, planView, entriesView, moreView};
})();
