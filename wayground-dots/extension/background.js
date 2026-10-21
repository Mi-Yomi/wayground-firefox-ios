(() => {
  'use strict';
  const allowed=new Set(['https://wayground.com','https://www.wayground.com']);
  const cache=new Map(),pending=new Map(),tabOperations=new Map();
  let pingPromise,lastPing=null,storageWrite=Promise.resolve(),generation=0;
  const ai=globalThis.WGAIBackground?.create({browser,fetchImpl:fetch});
  function validSender(sender){try{return allowed.has(new URL(sender.url).origin)&&sender.id===browser.runtime.id;}catch{return false;}}
  const publicFetch=(url,options)=>fetch(url,{...options,credentials:'omit',cache:'no-store'});
  const canonical=id=>'https://wayground.com/join/quiz/'+id+'/start';
  const nextRevision=value=>(Number.isSafeInteger(value)&&value>=0?value:0)+1;
  function stale(){const error=new Error('Запрос устарел после смены источника или сброса');error.code='STALE_REQUEST';return error;}
  function begin(tabId){const token=(tabOperations.get(tabId)||0)+1;tabOperations.set(tabId,token);return {tabId,token,epoch:generation};}
  function current(op){return op.epoch===generation&&tabOperations.get(op.tabId)===op.token;}
  function requireCurrent(op){if(!current(op))throw stale();}
  function write(job){const result=storageWrite.catch(()=>{}).then(job);storageWrite=result;return result;}
  function responseError(error,fallback){return {ok:false,error:error?.message||fallback,retryable:error?.code!=='STALE_REQUEST'&&error?.retryable===true,...(error?.code==='STALE_REQUEST'?{stale:true}:{})};}
  async function requestPublic(url,options){
    let status;
    try{
      return await WGQuiz.requestJson(url,options,async(endpoint,init)=>{
        const response=await publicFetch(endpoint,init);status=response.status;return response;
      });
    }catch(error){
      // requestJson maps several response errors to 502. Retain the actual HTTP
      // status here so a removed/private source cannot trigger network retries.
      error.retryable=error.status===504||(status===undefined&&error.status===502)||(status>=500&&status<=599);
      throw error;
    }
  }
  async function load(source){
    const id=WGQuiz.parseQuizId(source).toLowerCase(),epoch=generation;
    const saved=cache.get(id);
    if(saved&&Date.now()-saved.time<60000)return saved.quiz;
    if(pending.has(id))return pending.get(id);
    const job=(async()=>{
      const quiz=WGData.fromPayload(await requestPublic('https://wayground.com/_quizserver/main/v2/quiz/'+id+'?bypassProfanity=false&returnPrivileges=false&source=join',{}),id);
      if(epoch!==generation)throw stale();
      if(!cache.has(id)&&cache.size>=8)cache.delete(cache.keys().next().value);
      cache.set(id,{quiz,time:Date.now()});return quiz;
    })();
    pending.set(id,job);
    try{return await job;}finally{if(pending.get(id)===job)pending.delete(id);}
  }
  async function knownSources(){
    await storageWrite.catch(()=>{});
    const data=await browser.storage.local.get(['sources','source']);
    return WGAuto.sourceIds([...(Array.isArray(data.sources)?data.sources:[]),data.source],8);
  }
  const auto=WGAuto.create({load,request:requestPublic,sources:knownSources});
  function invalidate(){generation++;auto.clear();cache.clear();pending.clear();}
  function optionsSender(sender){
    return sender.id===browser.runtime.id&&typeof browser.runtime.getURL==='function'&&['options.html','popup.html'].some(file=>sender.url===browser.runtime.getURL(file));
  }
  async function history(op){
    const ids=await knownSources();requireCurrent(op);
    const results=new Array(ids.length);let cursor=0;
    async function worker(){
      while(cursor<ids.length){
        requireCurrent(op);
        const index=cursor++;
        try{results[index]={quiz:await load(ids[index])};}
        catch(error){results[index]={error};}
        requireCurrent(op);
      }
    }
    await Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker()));
    requireCurrent(op);
    const quizzes=results.filter(result=>result.quiz).map(result=>result.quiz);
    const errors=results.filter(result=>result.error).map(result=>result.error);
    if(!quizzes.length&&errors.length)throw errors.find(error=>error.retryable===true)||errors[0];
    return {ok:true,quizzes,failed:errors.length};
  }
  async function learn(quiz,remember,op,invalidate=true){
    return write(async()=>{
      requireCurrent(op);
      const data=await browser.storage.local.get(['sources','sourcesRevision']);
      requireCurrent(op);
      const sources=WGAuto.sourceIds([quiz.sourceUrl,...(Array.isArray(data.sources)?data.sources:[])],8).map(canonical);
      // Explicit imports and fully verified session matches teach sources;
      // rejected search candidates never do. Preserve the prepared session
      // when learning an automatic match.
      if(invalidate)auto.clear();
      if(invalidate||JSON.stringify(sources)!==JSON.stringify(data.sources))
        await browser.storage.local.set({sources,sourcesRevision:nextRevision(data.sourcesRevision),...(remember?{source:quiz.sourceUrl}:{})});
      requireCurrent(op);
    });
  }
  async function ping(force=false){
    if(!force&&lastPing&&Date.now()-lastPing.time<10000)return lastPing.ok;
    if(pingPromise)return pingPromise;
    pingPromise=(async()=>{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);let ok=false;
      try{const response=await publicFetch('https://wayground.com/join',{method:'HEAD',redirect:'error',signal:controller.signal});ok=response.ok;}catch{}finally{clearTimeout(timer);}
      lastPing={ok,time:Date.now()};return ok;
    })();
    try{return await pingPromise;}finally{pingPromise=null;}
  }
  browser.runtime.onMessage.addListener((message,sender)=>{
    if(typeof message?.type==='string'&&(message.type.startsWith('WG_AI_')||message.type.startsWith('WG_CODEX_'))){
      if(!validSender(sender)&&!optionsSender(sender))return Promise.resolve({ok:false,error:'Недопустимый источник запроса ИИ'});
      return ai?ai.handle(message,sender):Promise.resolve({ok:false,error:'Модуль ИИ недоступен'});
    }
    if(!validSender(sender))return Promise.resolve({ok:false,error:'Недопустимый источник запроса'});
    if(message?.type==='WG_OPEN_SETTINGS')return browser.tabs.create({url:browser.runtime.getURL('options.html')}).then(()=>({ok:true}));
    if(message?.type==='WG_PING')return ping(message.force===true).then(connected=>({ok:true,connected}));
    const tabId=Number.isInteger(sender.tab?.id)?sender.tab.id:null;
    const tabKey=tabId!==null?'source:'+tabId:null,pinKey=tabId!==null?'pin:'+tabId:null;
    if(message?.type==='WG_CONFIG')return (async()=>{
      await storageWrite.catch(()=>{});
      const data=await browser.storage.local.get(['source','widgetPosition','widgetAppearance','sourcesRevision','themeEnabled']);
      const session=tabKey&&WGIOSSession?await WGIOSSession.get([tabKey,pinKey]):{};
      return {ok:true,source:typeof session[tabKey]==='string'?session[tabKey]:(data.source||''),sourceIsTab:Boolean(session[tabKey]),pin:session[pinKey]||'',position:data.widgetPosition||null,appearance:WGAppearance.normalize(data.widgetAppearance),sourcesRevision:Number.isSafeInteger(data.sourcesRevision)?data.sourcesRevision:0,themeEnabled:data.themeEnabled===true,ai:ai?await ai.publicConfig():{configured:false,enabled:false}};
    })();
    if(message?.type==='WG_APPEARANCE'){
      if(!WGAppearance.valid(message.appearance))return Promise.resolve({ok:false,error:'Некорректный размер или видимость кружков'});
      const appearance=WGAppearance.normalize(message.appearance);
      return write(async()=>{await browser.storage.local.set({widgetAppearance:appearance});return {ok:true,appearance};});
    }
    if(message?.type==='WG_HISTORY')return history(begin(tabId)).catch(error=>responseError(error,'Ранее открытые публичные источники недоступны'));
    if(message?.type==='WG_THEME'){
      if(typeof message.enabled!=='boolean')return Promise.resolve({ok:false,error:'Некорректное значение темы'});
      return write(async()=>{await browser.storage.local.set({themeEnabled:message.enabled});return {ok:true,themeEnabled:message.enabled};});
    }
    if(message?.type==='WG_CONTEXT'){
      if(typeof message.keepPin!=='boolean'||typeof message.keepSource!=='boolean')return Promise.resolve({ok:false,error:'Некорректный контекст страницы',retryable:false});
      const op=begin(tabId);
      return write(async()=>{
        requireCurrent(op);
        if(tabKey&&WGIOSSession){
          if(!message.keepPin)await WGIOSSession.remove(pinKey);
          requireCurrent(op);
          // Preserve an explicit blank instead of exposing the remembered
          // global source on an unrelated game after SPA navigation.
          if(!message.keepSource)await WGIOSSession.set({[tabKey]:''});
        }
        requireCurrent(op);return {ok:true};
      }).catch(error=>responseError(error,'Не удалось сменить контекст страницы'));
    }
    if(message?.type==='WG_PIN'||message?.type==='WG_RESOLVE'){
      const pin=WGDots.normalizePin(message.pin);
      if(!pin)return Promise.resolve({ok:false,error:'Нужен PIN из 6 цифр',retryable:false});
      const op=begin(tabId);
      return (async()=>{
        try{
          await write(async()=>{
            requireCurrent(op);
            if(pinKey&&WGIOSSession)await WGIOSSession.set({[pinKey]:pin,[tabKey]:''});
          });
          requireCurrent(op);
          if(message.type==='WG_PIN')return {ok:true};
          const settings={round:message.round,lobbyOnly:message.lobbyOnly===true,hints:WGAuto.sourceIds(message.hints,8)};
          requireCurrent(op);
          const result=await auto.resolve(pin,message.force===true,settings);
          requireCurrent(op);
          if(result.resolved&&result.quiz?.sourceUrl)await learn(result.quiz,false,op,false);
          await write(async()=>{requireCurrent(op);if(tabKey&&WGIOSSession)await WGIOSSession.set({[tabKey]:result.quiz?.sourceUrl||''});});
          requireCurrent(op);
          return {ok:true,...result};
        }catch(error){return responseError(error,'Автоматический источник недоступен');}
      })();
    }
    if(message?.type==='WG_POSITION'){
      const p=message.position;
      if(p===null)return browser.storage.local.remove('widgetPosition').then(()=>({ok:true}));
      if(!p||Array.isArray(p)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)return Promise.resolve({ok:false,error:'Некорректное положение индикатора'});
      return browser.storage.local.set({widgetPosition:{x:p.x,y:p.y}}).then(()=>({ok:true}));
    }
    if(message?.type==='WG_CLEAR'){
      invalidate();
      return write(async()=>{
        const data=await browser.storage.local.get('sourcesRevision');
        await browser.storage.local.remove(['source','sources']);
        await browser.storage.local.set({sourcesRevision:nextRevision(data.sourcesRevision)});
        if(tabKey&&WGIOSSession)await WGIOSSession.remove([tabKey,pinKey]);
        return {ok:true};
      });
    }
    if(message?.type==='WG_LOAD'){
      let id;
      try{
        if(typeof message.source==='string'&&/^https:\/\/(?:www\.)?(?:wayground|quizizz)\.com\/join\/(?:pre-game|game)\//i.test(message.source))throw new WGQuiz.ImportError('Это ссылка на сессию. Нажмите «Поделиться» в Wayground или вставьте ссылку /join/quiz/…/start.');
        id=WGQuiz.parseQuizId(message.source).toLowerCase();
      }catch(error){return Promise.resolve(responseError(error,'Не удалось получить публичный квиз'));}
      const op=begin(tabId),sourceUrl=canonical(id);
      return (async()=>{
        try{
          await write(async()=>{
            requireCurrent(op);
            if(pinKey&&WGIOSSession)await WGIOSSession.remove(pinKey);
            requireCurrent(op);
            if(tabKey&&WGIOSSession)await WGIOSSession.set({[tabKey]:sourceUrl});
          });
          requireCurrent(op);
          const quiz=await load(id);requireCurrent(op);
          await learn(quiz,message.remember===true,op);requireCurrent(op);
          return {ok:true,quiz};
        }catch(error){return responseError(error,'Не удалось получить публичный квиз');}
      })();
    }
    return Promise.resolve({ok:false,error:'Неизвестный запрос'});
  });
  browser.action.onClicked.addListener(tab=>{if(tab.id!==undefined&&validSender({id:browser.runtime.id,url:tab.url}))browser.tabs.sendMessage(tab.id,{type:'WG_SHOW_PANEL'}).catch(()=>{});});
})();
