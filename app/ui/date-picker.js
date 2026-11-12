const module_5 = (() => {
const {monthEnd} = module_1;
// A shared, local calendar for every date field, including fields inside dialogs.
function initDatePickers(){
  const popup=document.createElement('div');
  popup.className='date-picker';popup.id='date-picker';popup.setAttribute('popover','auto');
  popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Выбрать дату');
  let input=null,shown='',cursor='';
  const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const date=value=>new Date(value+'T12:00:00');
  const today=()=>iso(new Date());
  const allowed=value=>(!input.min||value>=input.min)&&(!input.max||value<=input.max);
  const clamp=value=>input.min&&value<input.min?input.min:input.max&&value>input.max?input.max:value;
  const shiftMonth=(value,offset)=>{const d=date(value);return iso(new Date(d.getFullYear(),d.getMonth()+offset,1));};
  function position(){
    if(!input?.isConnected||!input.getClientRects().length){close(false);return;}
    const rect=(input.closest('[data-date-trigger]')||input).getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;
    const left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8));
    const top=rect.bottom+8+height<=innerHeight-8?rect.bottom+8:Math.max(8,rect.top-height-8);
    popup.style.left=left+'px';popup.style.top=top+'px';
    popup.style.maxHeight=Math.max(120,innerHeight-16)+'px';
  }
  function draw(focus=false){
    const first=date(shown+'-01'),start=new Date(first);
    start.setDate(1-(first.getDay()+6)%7);
    const label=first.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    const forecast=input.id==='forecast-date',shortcutDate=forecast?monthEnd(today()):today();
    const prev=shiftMonth(shown+'-01',-1).slice(0,7),next=shiftMonth(shown+'-01',1).slice(0,7);
    popup.innerHTML=`<div class="date-picker-heading"><strong aria-live="polite">${label}</strong><button type="button" data-month="-1" aria-label="Предыдущий месяц" ${input.min&&prev<input.min.slice(0,7)?'disabled':''}>‹</button><button type="button" data-month="1" aria-label="Следующий месяц" ${input.max&&next>input.max.slice(0,7)?'disabled':''}>›</button></div><div class="date-picker-week" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>`<span>${day}</span>`).join('')}</div><div class="date-picker-days" role="group" aria-label="Дни месяца">${Array.from({length:42},(_,i)=>{
      const d=new Date(start);d.setDate(start.getDate()+i);const value=iso(d);
      return `<button type="button" data-date="${value}" tabindex="${value===cursor?0:-1}" class="${value.slice(0,7)!==shown?'outside ':''}${value===input.value?'selected ':''}${value===today()?'today':''}" aria-label="${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}" aria-pressed="${value===input.value}" ${value===today()?'aria-current="date"':''} ${allowed(value)?'':'disabled'}>${d.getDate()}</button>`;
    }).join('')}</div><div class="date-picker-footer"><button type="button" data-shortcut ${allowed(shortcutDate)?'':'disabled'}>${forecast?'До конца месяца':'Сегодня'}</button>${!input.required&&input.id!=='forecast-date'?'<button type="button" data-clear>Очистить</button>':''}<button type="button" data-close aria-label="Закрыть календарь">Закрыть</button></div>`;
    if(popup.matches(':popover-open'))position();
    if(focus)popup.querySelector(`[data-date="${cursor}"]`)?.focus({preventScroll:true});
  }
  function close(restore=true){
    const target=input;
    if(popup.matches(':popover-open'))popup.hidePopover();
    target?.setAttribute('aria-expanded','false');
    if(restore&&target?.isConnected)target.focus({preventScroll:true});
    input=null;
  }
  function open(target){
    if(input===target&&popup.matches(':popover-open'))return;
    close(false);input=target;
    (target.closest('dialog')||document.body).append(popup);
    cursor=clamp(target.value||today());shown=cursor.slice(0,7);
    target.setAttribute('aria-haspopup','dialog');target.setAttribute('aria-controls',popup.id);target.setAttribute('aria-expanded','true');
    draw();popup.showPopover();position();
    popup.querySelector(`[data-date="${cursor}"]`)?.focus({preventScroll:true});
  }
  function select(value){
    if(value&&!allowed(value))return;
    const target=input;close();target.value=value;
    target.dispatchEvent(new Event('input',{bubbles:true}));
    target.dispatchEvent(new Event('change',{bubbles:true}));
  }
  popup.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.date)return select(button.dataset.date);
    if(button.hasAttribute('data-shortcut'))return select(input.id==='forecast-date'?monthEnd(today()):today());
    if(button.hasAttribute('data-clear'))return select('');
    if(button.hasAttribute('data-close'))return close();
    if(button.dataset.month){shown=shiftMonth(shown+'-01',Number(button.dataset.month)).slice(0,7);cursor=clamp(shown+'-01');draw();popup.querySelector(`[data-month="${button.dataset.month}"]`)?.focus({preventScroll:true});}
  });
  popup.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key==='Tab'){
      const buttons=[...popup.querySelectorAll('button:not(:disabled)')].filter(b=>b.tabIndex>=0),index=buttons.indexOf(document.activeElement);
      if((event.shiftKey&&index===0)||(!event.shiftKey&&index===buttons.length-1)){event.preventDefault();buttons[event.shiftKey?buttons.length-1:0]?.focus();}return;
    }
    if(!event.target.dataset.date)return;
    let d=date(event.target.dataset.date),day=(d.getDay()+6)%7;
    const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-day,End:6-day}[event.key];
    if(offset!==undefined)d.setDate(d.getDate()+offset);
    else if(['PageUp','PageDown'].includes(event.key)){
      const wanted=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+(event.key==='PageUp'?-1:1));d.setDate(Math.min(wanted,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
    }else return;
    event.preventDefault();cursor=clamp(iso(d));shown=cursor.slice(0,7);draw(true);
  });
  popup.addEventListener('toggle',()=>{if(!popup.matches(':popover-open'))input?.setAttribute('aria-expanded','false');});
  document.addEventListener('click',event=>{const target=event.target.closest('input[type="date"]')||event.target.closest('[data-date-trigger]')?.querySelector('input[type="date"]');if(target&&!target.disabled&&!target.readOnly){event.preventDefault();open(target);}},true);
  document.addEventListener('keydown',event=>{if(event.target.matches('input[type="date"]')&&['Enter',' ','ArrowDown'].includes(event.key)&&!event.target.disabled&&!event.target.readOnly){event.preventDefault();open(event.target);}},true);
  document.addEventListener('close',event=>{if(event.target.contains(popup))close(false);},true);
  window.addEventListener('resize',()=>{if(popup.matches(':popover-open'))position();});
  document.addEventListener('scroll',event=>{if(popup.matches(':popover-open')&&!popup.contains(event.target))position();},true);
}

return {initDatePickers};
})();
