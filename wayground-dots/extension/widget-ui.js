(() => {
  'use strict';
  const valid=p=>p&&typeof p==='object'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  const clamp=(value,min,max)=>Math.max(min,Math.min(value,Math.max(min,max)));
  function style(element,name,value){if(element.style.getPropertyValue(name)!==value){if(value)element.style.setProperty(name,value);else element.style.removeProperty(name);}}
  function install(host,root,collapse){
    const handle=root.querySelector('#handle'),toggle=root.querySelector('#toggle'),panel=root.querySelector('#panel');
    let position=null,dirty=false,drag=null,suppressUntil=0,appearanceDirty=false,appearance=WGAppearance.normalize(),appearanceRequest=0;
    const bounds=()=>({width:window.visualViewport?.width||window.innerWidth||document.documentElement.clientWidth,height:window.visualViewport?.height||window.innerHeight||document.documentElement.clientHeight});
    function dimensions(){const rect=handle.getBoundingClientRect(),view=bounds();return {...view,w:rect.width,h:rect.height,dx:Math.max(0,view.width-rect.width-24),dy:Math.max(0,view.height-rect.height-24)};}
    function panelLayout(){
      if(panel.hidden)return;
      const rect=handle.getBoundingClientRect(),view=bounds();
      style(panel,'max-height',Math.max(0,Math.max(rect.top-20,view.height-rect.bottom-20))+'px');
      const size=panel.getBoundingClientRect();
      const left=clamp(rect.left,12,view.width-size.width-12);
      const below=rect.bottom+8;
      const top=below+size.height<=view.height-12?below:rect.top-size.height-8>=12?rect.top-size.height-8:clamp(below,12,view.height-size.height-12);
      style(panel,'left',(left-rect.left)+'px');style(panel,'top',(top-rect.top)+'px');
    }
    function layout(){
      if(position){const size=dimensions();style(host,'--wg-left',(12+position.x*size.dx)+'px');style(host,'--wg-top',(12+position.y*size.dy)+'px');style(host,'--wg-right','auto');}
      else{style(host,'--wg-left','');style(host,'--wg-top','');style(host,'--wg-right','');}
      if(handle.classList.contains('expanded')!==!panel.hidden)handle.classList.toggle('expanded',!panel.hidden);panelLayout();
    }
    function moveTo(left,top){const size=dimensions();position={x:size.dx?clamp(left-12,0,size.dx)/size.dx:0,y:size.dy?clamp(top-12,0,size.dy)/size.dy:0};layout();}
    async function save(){
      const note=root.querySelector('#position-status');
      try{const result=await browser.runtime.sendMessage({type:'WG_POSITION',position});if(!result?.ok)throw new Error();note.textContent='';}
      catch{note.textContent='Положение не сохранено; останется до обновления страницы.';}
    }
    function finish(event,cancelled=false){
      if(!drag||event.pointerId!==drag.id)return;
      const ended=drag;drag=null;handle.classList.remove('dragging');
      if(ended.moved){suppressUntil=Date.now()+400;if(cancelled){position=ended.previous;layout();}else{dirty=true;void save();}}
      try{if(toggle.hasPointerCapture?.(ended.id))toggle.releasePointerCapture(ended.id);}catch{}
    }
    function applyAppearance(value){
      if(drag)finish({pointerId:drag.id},true);
      appearance=WGAppearance.normalize(value);
      style(host,'--wg-dot-size',appearance.size+'px');
      style(host,'--wg-dot-opacity',String(appearance.opacity/100));
      for(const [selector,value] of [['#dot-size',String(appearance.size)],['#dot-opacity',String(appearance.opacity)]]){const input=root.querySelector(selector);if(input.value!==value)input.value=value;}
      for(const [selector,value] of [['#dot-size-value',appearance.size+' px'],['#dot-opacity-value',appearance.opacity+'%']]){const output=root.querySelector(selector);if(output.textContent!==value)output.textContent=value;}
      layout();
    }
    function readAppearance(){
      const value={size:Number(root.querySelector('#dot-size').value),opacity:Number(root.querySelector('#dot-opacity').value)};
      if(!WGAppearance.valid(value))return false;
      appearanceDirty=true;applyAppearance(value);return true;
    }
    async function saveAppearance(){
      const request=++appearanceRequest,note=root.querySelector('#appearance-status');
      try{const result=await browser.runtime.sendMessage({type:'WG_APPEARANCE',appearance:{...appearance}});if(!result?.ok)throw new Error();if(request===appearanceRequest)note.textContent='';}
      catch{if(request===appearanceRequest)note.textContent='Настройки не сохранены; останутся до обновления страницы.';}
    }
    for(const id of ['#dot-size','#dot-opacity']){
      root.querySelector(id).addEventListener('input',readAppearance);
      root.querySelector(id).addEventListener('change',()=>{if(readAppearance())void saveAppearance();});
    }
    root.querySelector('#reset-appearance').addEventListener('click',()=>{appearanceDirty=true;applyAppearance(WGAppearance.defaults);void saveAppearance();});
    applyAppearance(WGAppearance.defaults);
    handle.addEventListener('pointerdown',event=>{
      if(drag||event.button!==0||event.isPrimary===false)return;
      const rect=handle.getBoundingClientRect();
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,previous:position?{...position}:null,moved:false};
      try{toggle.setPointerCapture?.(event.pointerId);}catch{}
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      if(!drag.moved){drag.moved=true;handle.classList.add('dragging');collapse();}
      event.preventDefault();moveTo(drag.left+dx,drag.top+dy);
    });
    handle.addEventListener('pointerup',event=>finish(event));
    handle.addEventListener('pointercancel',event=>finish(event,true));
    toggle.addEventListener('lostpointercapture',event=>finish(event,true));
    handle.addEventListener('click',event=>{if(event.detail!==0&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    root.querySelector('#reset-position').addEventListener('click',()=>{dirty=true;position=null;layout();void save();});
    return {layout,viewportChanged(){if(drag)finish({pointerId:drag.id},true);layout();},restore(saved){if(!dirty&&!drag&&valid(saved)){position={x:saved.x,y:saved.y};layout();}},restoreAppearance(saved){if(!appearanceDirty)applyAppearance(saved);}};
  }
  globalThis.WGWidget={install};
})();
