/* Read browser state for our own UI without changing the page's APIs. */
(() => {
  'use strict';
  function create(doc,win){
    function getter(name){
      for(let prototype=Object.getPrototypeOf(doc);prototype;prototype=Object.getPrototypeOf(prototype)){
        const descriptor=Object.getOwnPropertyDescriptor(prototype,name);
        if(typeof descriptor?.get==='function')return descriptor.get;
      }
      return null;
    }
    const fullscreenGetter=getter('fullscreenElement'),hiddenGetter=getter('hidden');
    function read(native,name,fallback){
      try{return native?native.call(doc):doc[name]??fallback;}catch{return fallback;}
    }
    const fullscreen=()=>read(fullscreenGetter,'fullscreenElement',null);
    const hidden=()=>Boolean(read(hiddenGetter,'hidden',false));
    function watch({onViewport=()=>{},onVisibility=()=>{}}={}){
      let previous={fullscreen:fullscreen(),hidden:hidden(),width:win.innerWidth,height:win.innerHeight};
      function check(){
        const next={fullscreen:fullscreen(),hidden:hidden(),width:win.innerWidth,height:win.innerHeight};
        const viewport=next.fullscreen!==previous.fullscreen||next.width!==previous.width||next.height!==previous.height;
        const visibility=next.hidden!==previous.hidden;
        previous=next;
        if(viewport)onViewport(next);
        if(visibility)onVisibility(next.hidden);
      }
      // Events may be suppressed by page scripts. The bounded fallback compares
      // four scalar values. It does not scan the DOM, make network requests,
      // alter focus, or synthesize page events.
      win.addEventListener('resize',check);
      doc.addEventListener('fullscreenchange',check);
      doc.addEventListener('visibilitychange',check);
      const timer=setInterval(check,500);
      return {check,stop(){clearInterval(timer);win.removeEventListener('resize',check);doc.removeEventListener('fullscreenchange',check);doc.removeEventListener('visibilitychange',check);}};
    }
    return {fullscreen,hidden,watch};
  }
  globalThis.WGPageState={create};
})();
