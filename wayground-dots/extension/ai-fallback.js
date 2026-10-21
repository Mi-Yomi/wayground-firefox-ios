(() => {
  'use strict';
  function create({send,onChange}){
    let state={status:'idle',indices:[]},key='',sequence=0,requestId=0,nextId=0,force=false;
    function cancel(){if(requestId)void Promise.resolve(send({type:'WG_AI_CANCEL',requestId})).catch(()=>{});requestId=0;}
    function reset(){cancel();sequence++;key='';state={status:'idle',indices:[]};}
    function update(visible,allowed){
      if(!allowed||!visible){if(key)reset();return state;}
      let input;try{input=WGAI.fromVisible(visible);}catch(error){const next='invalid:'+JSON.stringify(visible);if(key!==next){reset();key=next;state={status:'unreadable',indices:[],explanation:error.message};}return state;}
      const next=JSON.stringify(input);if(key===next)return state;
      reset();key=next;const token=sequence,id=++nextId;requestId=id;
      state={status:'working',indices:[]};
      const refresh=force;force=false;
      void Promise.resolve(send({type:'WG_AI_SUGGEST',requestId:id,input,force:refresh})).then(response=>{
        if(token!==sequence||key!==next)return;
        if(!response?.ok)throw new Error(response?.error||'ИИ недоступен');
        const result=response.result;
        if(!result||!['ready','uncertain','unreadable'].includes(result.status)||!Array.isArray(result.indices)||result.indices.some(i=>!Number.isInteger(i)||i<0||i>=input.options.length)||result.status==='ready'&&!result.indices.length||result.status!=='ready'&&result.indices.length||typeof result.explanation!=='string')throw new Error('Некорректная подсказка ИИ');
        state={...result};onChange();
      }).catch(error=>{if(token===sequence&&key===next){state={status:'error',indices:[],explanation:error.message};onChange();}});
      return state;
    }
    return {update,reset,retry(){reset();force=true;},get state(){return state;}};
  }
  globalThis.WGAIFallback={create};
})();
