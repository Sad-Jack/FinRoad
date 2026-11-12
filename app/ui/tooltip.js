const module_tooltip = (() => {
function positionTooltip(anchor,box,viewport){
  const margin=8,gap=10;
  const left=Math.max(margin,Math.min(anchor.x,viewport.width-box.width-margin));
  const below=anchor.bottom+gap;
  const top=below+box.height<=viewport.height-margin?below:Math.max(margin,anchor.top-box.height-gap);
  return {left,top};
}
function initTooltips(){
  const tooltip=document.createElement('div');tooltip.id='app-tooltip';tooltip.className='app-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
  const usePopover=typeof tooltip.showPopover==='function';
  if(usePopover)tooltip.setAttribute('popover','manual');
  document.body.append(tooltip);
  let owner=null,timer=null,point=null,describedBefore=null;
  function hide(){
    clearTimeout(timer);timer=null;
    if(owner&&describedBefore!==null){if(describedBefore)owner.setAttribute('aria-describedby',describedBefore);else owner.removeAttribute('aria-describedby');}
    describedBefore=null;owner=null;point=null;
    if(usePopover&&tooltip.matches(':popover-open'))tooltip.hidePopover();
    tooltip.hidden=true;
  }
  function place(){
    if(!owner?.isConnected){hide();return;}
    const rect=owner.getBoundingClientRect(),box=tooltip.getBoundingClientRect();
    const anchor=point?{x:point.x+12,top:point.y,bottom:point.y}:{x:rect.left,top:rect.top,bottom:rect.bottom};
    const position=positionTooltip(anchor,box,{width:window.innerWidth,height:window.innerHeight});
    tooltip.style.left=position.left+'px';tooltip.style.top=position.top+'px';
  }
  function schedule(target,pointer){
    if(target===owner){if(pointer){point=pointer;if(!tooltip.hidden)place();}return;}
    hide();
    if(!target||!target.dataset.tooltip?.trim())return;
    owner=target;point=pointer;timer=setTimeout(()=>{
      if(!owner?.isConnected){hide();return;}
      tooltip.textContent=owner.dataset.tooltip;
      if(!usePopover){const dialog=owner.closest('dialog[open]');(dialog||document.body).append(tooltip);}
      tooltip.hidden=false;
      if(usePopover)tooltip.showPopover();
      describedBefore=owner.getAttribute('aria-describedby')||'';
      owner.setAttribute('aria-describedby',[describedBefore,tooltip.id].filter(Boolean).join(' '));
      place();
    },pointer?500:0);
  }
  document.addEventListener('pointerover',event=>{
    if(event.pointerType==='touch')return;
    schedule(event.target.closest('[data-tooltip]'),{x:event.clientX,y:event.clientY});
  });
  document.addEventListener('pointermove',event=>{
    if(point&&owner){point={x:event.clientX,y:event.clientY};if(!tooltip.hidden)place();}
  });
  document.addEventListener('pointerout',event=>{
    if(point&&owner&&!owner.contains(event.relatedTarget))hide();
  });
  document.addEventListener('focusin',event=>{
    if(event.target.matches(':focus-visible'))schedule(event.target.closest('[data-tooltip]'),null);
  });
  document.addEventListener('focusout',event=>{if(owner&&owner.contains(event.target)&&!point)hide();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  document.addEventListener('scroll',hide,true);
  window.addEventListener('resize',hide);
}
return {positionTooltip,initTooltips};
})();
