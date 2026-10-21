/* API-only iOS policy and bounded result cache across background restarts. */
(() => {
  'use strict';
  delete WGAI.providers.codex;
  const originalConfig=WGAI.config;
  WGAI.config=(raw,previous={})=>{
    if(raw?.provider==='codex')throw new Error('Вход Codex через Windows-компонент на iPhone недоступен. Выберите API-провайдера.');
    const config=originalConfig(raw,previous);
    if(new URL(config.endpoint).protocol!=='https:')throw new Error('На iPhone для API нужен HTTPS-адрес.');
    return config;
  };
  function decorate(implementation,{browser,crypto=globalThis.crypto,now=Date.now}={}){
    const cacheKey='ios.ai-results.v1',ttl=10*60*1000;let writes=Promise.resolve(),generation=0;
    const mutate=change=>{
      const task=writes.catch(()=>{}).then(async()=>{
        const raw=(await browser.storage.local.get(cacheKey))[cacheKey];
        const records=(Array.isArray(raw)?raw:[]).filter(record=>Number.isFinite(record?.time)&&now()>=record.time&&now()-record.time<ttl);
        const next=change(records);if(next)await browser.storage.local.set({[cacheKey]:next.slice(-20)});
      });writes=task;return task;
    };
    async function fingerprint(input,config){
      const bytes=new TextEncoder().encode(JSON.stringify([input,config.provider,config.endpoint,config.model,config.apiKey,config.images,config.reasoningEffort??'']));
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    function validResult(result,input){
      if(!result||!['ready','uncertain','unreadable'].includes(result.status)||!Array.isArray(result.indices)||typeof result.explanation!=='string')return false;
      try{WGAI.result({status:result.status,selectedChoiceIds:result.indices.map(i=>Number.isInteger(i)?String(i+1):''),explanation:result.explanation},input);return true;}catch{return false;}
    }
    async function handle(message,sender){
      if(['WG_AI_SAVE','WG_AI_FORGET','WG_AI_ENABLE'].includes(message?.type)){
        const response=await implementation.handle(message,sender);
        if(response?.ok){generation++;await mutate(()=>[]).catch(()=>{});}return response;
      }
      if(message?.type!=='WG_AI_SUGGEST')return implementation.handle(message,sender);
      const tabId=sender?.tab?.id;
      if(!Number.isInteger(tabId)||!Number.isSafeInteger(message.requestId)||message.requestId<1)return implementation.handle(message,sender);
      let input,config,key;
      try{
        input=WGAI.input(message.input);const raw=(await browser.storage.local.get('aiConfig')).aiConfig;
        if(!raw?.enabled)return implementation.handle(message,sender);
        config=WGAI.config(raw);key=await fingerprint(input,config);
        const origins=[...(config.provider==='codex'?[]:[WGAI.originPermission(config.endpoint)]),...(config.images?['https://*.quizizz.com/*','https://*.wayground.com/*']:[])];
        if(!await browser.permissions.contains({origins}))return implementation.handle(message,sender);
        await writes.catch(()=>{});
        const records=(await browser.storage.local.get(cacheKey))[cacheKey];
        const cached=(Array.isArray(records)?records:[]).find(record=>record.tabId===tabId&&record.key===key&&now()>=record.time&&now()-record.time<ttl);
        if(!message.force&&cached&&validResult(cached.result,input))return {ok:true,result:cached.result,cached:true};
      }catch{return implementation.handle(message,sender);}
      const epoch=generation,response=await implementation.handle(message,sender);
      if(response?.ok&&epoch===generation&&validResult(response.result,input))
        await mutate(records=>epoch===generation?[...records.filter(record=>record.tabId!==tabId),{tabId,key,time:now(),result:response.result}]:null).catch(()=>{});
      return response;
    }
    browser.storage.onChanged.addListener(changes=>{if(changes.chatgptSession){generation++;void mutate(()=>[]).catch(()=>{});}});
    browser.tabs?.onRemoved?.addListener(tabId=>{void mutate(records=>records.filter(record=>record.tabId!==tabId)).catch(()=>{});});
    return {handle,publicConfig:()=>implementation.publicConfig()};
  }
  const create=WGAIBackground.create;
  WGAIBackground.create=options=>decorate(create(options),options);
  globalThis.WGIOSAI={decorate};
})();
