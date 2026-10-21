(() => {
  'use strict';
  function create({browser,fetchImpl}){
    const jobs=new Map(),results=new Map(),rates=new Map(),intents=new Map();let revision=0,mutation=Promise.resolve();
    const ready=browser.storage.local.remove(['remoteConnection','remoteBootstrapImported']);
    const codex=globalThis.WGCodex?.create(browser);
    const settingsSender=s=>s.id===browser.runtime.id&&s.url===browser.runtime.getURL('options.html');
    function cancel(tabId,keepIntent=false){const job=jobs.get(tabId);if(job)job.controller.abort();jobs.delete(tabId);if(!keepIntent)intents.delete(tabId);}
    function clear(){revision++;for(const tabId of jobs.keys())cancel(tabId);intents.clear();results.clear();}
    async function saved(){await ready;await mutation.catch(()=>{});return (await browser.storage.local.get('aiConfig')).aiConfig||null;}
    const error=e=>({ok:false,error:e?.message||'ИИ недоступен'});
    async function permitted(config){
      const origins=[...(config.provider==='codex'?[]:[WGAI.originPermission(config.endpoint)]),...(config.images?['https://*.quizizz.com/*','https://*.wayground.com/*']:[])];
      if(!await browser.permissions.contains({origins,...(config.provider==='codex'?{permissions:['nativeMessaging']}:{})}))throw new Error('Нет разрешения Firefox на подключение к ИИ или изображениям. Сохраните настройки ИИ ещё раз');
      if(config.provider==='codex'){
        if(!codex)throw new Error('Модуль Codex недоступен');const status=await codex.status();
        if(config.fastMode===true&&status.fastModeSupported!==true)throw new Error('Для быстрого режима обновите локальный компонент: запустите INSTALL-CODEX.cmd, затем Reload дополнения');
      }
    }
    function mutate(job){const task=mutation.catch(()=>{}).then(job);mutation=task;return task;}
    async function handle(message,sender){
      const type=message.type;
      if(type?.startsWith('WG_CODEX_')){
        if(!settingsSender(sender))return {ok:false,error:'Вход Codex доступен только в настройках расширения'};
        if(!codex)throw new Error('Модуль Codex недоступен');
        if(type==='WG_CODEX_STATUS')return {ok:true,...await codex.status()};
        if(type==='WG_CODEX_MODELS'){
          try{
            const catalog=await codex.models(message.force===true);
            try{await browser.storage.local.set({codexModelsCache:{models:catalog.models,updatedAt:Date.now()}});}catch{}
            return {ok:true,...catalog};
          }catch(cause){
            const cache=(await browser.storage.local.get('codexModelsCache')).codexModelsCache;
            if(Array.isArray(cache?.models)&&cache.models.length&&cache.models.length<=400&&Date.now()-cache.updatedAt>=0&&Date.now()-cache.updatedAt<86400000)return {ok:true,models:cache.models,cached:true,warning:cause.message};
            throw cause;
          }
        }
        if(type==='WG_CODEX_LOGIN')return {ok:true,...await codex.login()};
        if(type==='WG_CODEX_LOGOUT'){
          clear();const state=await codex.logout(),config=await saved();await browser.storage.local.remove('codexModelsCache');
          if(config?.provider==='codex')await mutate(()=>browser.storage.local.set({aiConfig:{...config,enabled:false}}));
          return {ok:true,...state};
        }
        throw new Error('Неизвестная команда Codex');
      }
      if(['WG_AI_SAVE','WG_AI_FORGET','WG_AI_TEST'].includes(type)&&!settingsSender(sender))return {ok:false,error:'API-ключ настраивается только на странице настроек расширения'};
      if(type==='WG_AI_STATUS')return {ok:true,settings:WGAI.publicConfig(await saved())};
      if(type==='WG_AI_SAVE')return mutate(async()=>{
        await ready;const old=(await browser.storage.local.get('aiConfig')).aiConfig||{};
        const config=WGAI.config(message.settings,old);await permitted(config);clear();await browser.storage.local.set({aiConfig:config});return {ok:true,settings:WGAI.publicConfig(config)};
      });
      if(type==='WG_AI_FORGET')return mutate(async()=>{await ready;clear();await browser.storage.local.remove(['aiConfig','codexModelsCache']);return {ok:true,settings:WGAI.publicConfig(null)};});
      if(type==='WG_AI_ENABLE')return mutate(async()=>{
        await ready;if(typeof message.enabled!=='boolean')throw new Error('Некорректный переключатель ИИ');
        const config=(await browser.storage.local.get('aiConfig')).aiConfig;
        if(!config)throw new Error('Сначала настройте Codex или API в настройках ИИ');
        const next={...config,enabled:message.enabled};if(next.enabled)await permitted(next);clear();await browser.storage.local.set({aiConfig:next});return {ok:true,settings:WGAI.publicConfig(next)};
      });
      if(type==='WG_AI_CANCEL'){if(intents.get(sender.tab?.id)===message.requestId)cancel(sender.tab?.id);return {ok:true};}
      if(type==='WG_AI_TEST'){
        const config=await saved();if(!config)throw new Error('Сначала сохраните настройки');await permitted(config);
        const result=await WGAIProvider.suggest(config,{question:'What is 2 + 2?',options:[{id:'1',text:'3'},{id:'2',text:'4'}],multiple:false},{fetchImpl,codex});
        return {ok:true,result};
      }
      if(type!=='WG_AI_SUGGEST')throw new Error('Неизвестный запрос ИИ');
      const tabId=sender.tab?.id;
      if(!Number.isInteger(tabId)||!Number.isSafeInteger(message.requestId)||message.requestId<1)throw new Error('Некорректный запрос вопроса');
      const question=WGAI.input(message.input);intents.set(tabId,message.requestId);
      const config=await saved(),epoch=revision;
      if(!config?.enabled)throw new Error('Режим ИИ выключен');await permitted(config);if(epoch!==revision||intents.get(tabId)!==message.requestId)throw new Error('Запрос ИИ устарел');
      const key=JSON.stringify(question),previous=results.get(tabId);
      if(previous?.key===key&&!message.force)return {ok:true,result:previous.result};
      const existing=jobs.get(tabId);if(existing?.key===key){existing.requestId=message.requestId;return existing.promise;}
      const now=Date.now(),recent=(rates.get(tabId)||[]).filter(at=>now-at<60000);
      if(recent.length>=20)throw new Error('Не более 20 вопросов ИИ в минуту. Повторите позже');rates.set(tabId,[...recent,now]);
      cancel(tabId,true);const controller=new AbortController(),job={key,requestId:message.requestId,controller};
      job.promise=(async()=>{
        const result=await WGAIProvider.suggest(config,question,{fetchImpl,signal:controller.signal,codex});
        if(controller.signal.aborted||revision!==epoch||jobs.get(tabId)!==job)throw new Error('Результат ИИ устарел');
        if(results.size>=32)results.delete(results.keys().next().value);
        results.set(tabId,{key,result});return {ok:true,result};
      })().finally(()=>{if(jobs.get(tabId)===job)jobs.delete(tabId);});
      jobs.set(tabId,job);return job.promise;
    }
    browser.storage.onChanged.addListener(changes=>{if(changes.aiConfig||changes.chatgptSession)clear();});
    browser.tabs?.onRemoved?.addListener(tabId=>{cancel(tabId);results.delete(tabId);rates.delete(tabId);});
    return {handle:(message,sender)=>handle(message,sender).catch(error),publicConfig:async()=>WGAI.publicConfig(await saved())};
  }
  globalThis.WGAIBackground={create};
})();
