/* PIN/source context survives Safari unloading its nonpersistent background. */
(() => {
  'use strict';
  function create(storage,{now=Date.now,ttl=4*60*60*1000}={}){
    const key='ios.tab-context.v1';let writes=Promise.resolve();
    const valid=name=>/^(?:pin|source):\d+$/.test(name);
    async function read(){
      const raw=(await storage.get(key))[key],state={};
      for(const [name,entry] of Object.entries(raw&&typeof raw==='object'?raw:{}))
        if(valid(name)&&typeof entry?.value==='string'&&entry.value.length<=800&&Number.isFinite(entry.time)&&now()>=entry.time&&now()-entry.time<ttl)state[name]=entry;
      return state;
    }
    function mutate(change){const task=writes.catch(()=>{}).then(async()=>{const state=await read();change(state);await storage.set({[key]:state});});writes=task;return task;}
    return {
      async get(keys){await writes.catch(()=>{});const state=await read();return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(name=>valid(name)&&Object.hasOwn(state,name)).map(name=>[name,state[name].value]));},
      set(values){return mutate(state=>{for(const [name,value] of Object.entries(values))if(valid(name)&&typeof value==='string'&&value.length<=800)state[name]={value,time:now()};});},
      remove(keys){return mutate(state=>{for(const name of Array.isArray(keys)?keys:[keys])if(valid(name))delete state[name];});}
    };
  }
  globalThis.WGIOSSessionFactory={create};
  if(typeof browser!=='undefined'){
    globalThis.WGIOSSession=create(browser.storage.local);
    browser.tabs?.onRemoved?.addListener(tabId=>{void WGIOSSession.remove(['pin:'+tabId,'source:'+tabId]).catch(()=>{});});
  }
})();
