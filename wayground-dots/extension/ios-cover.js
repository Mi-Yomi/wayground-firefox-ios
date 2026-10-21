/* The Safari toolbar opens the real settings directly. */
(() => {
  'use strict';
  globalThis.WGCover={install(root,{onLayout=()=>{}}={}){
    const cover=root.querySelector('#cover'),advanced=root.querySelector('#advanced'),panel=root.querySelector('#panel');
    cover.hidden=true;advanced.hidden=false;panel.setAttribute('aria-label','Настройки Wayground Dots для iPhone');
    const close=document.createElement('button');close.type='button';close.id='ios-close';close.textContent='Закрыть панель';
    close.addEventListener('click',()=>{panel.hidden=true;onLayout();});panel.prepend(close);
    window.visualViewport?.addEventListener('resize',onLayout);
    window.visualViewport?.addEventListener('scroll',onLayout);
    return {reset(){cover.hidden=true;advanced.hidden=false;onLayout();},restore(){}};
  }};
})();
