/* Browser adaptation of Screening Choice's validated question/result contract. */
(() => {
  'use strict';
  const providers={codex:{label:'Codex · аккаунт ChatGPT',endpoint:'codex:local'},openai:{label:'OpenAI',endpoint:'https://api.openai.com/v1/responses'},gemini:{label:'Google Gemini',endpoint:'https://generativelanguage.googleapis.com/v1beta'},compatible:{label:'OpenAI-совместимый API',endpoint:''}};
  const codexEfforts=['none','minimal','low','medium','high','xhigh','max'];
  function endpoint(value,provider){
    if(!providers[provider])throw new Error('Выберите поддерживаемый протокол ИИ');
    if(provider!=='compatible')return providers[provider].endpoint;
    let url;try{url=new URL(value);}catch{throw new Error('Укажите URL совместимого API');}
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('API: нужен HTTPS или локальный HTTP без пароля и параметров в URL');
    return url.href.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  }
  function config(raw,previous={}){
    if(!raw||typeof raw!=='object'||!providers[raw.provider])throw new Error('Некорректные настройки ИИ');
    const base=endpoint(raw.endpoint,raw.provider),model=typeof raw.model==='string'?raw.model.trim():'';
    if(raw.provider==='codex'){
      if(model&&!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,149}$/.test(model))throw new Error('Некорректный ID модели Codex');
      const reasoningEffort=raw.reasoningEffort===undefined?'low':raw.reasoningEffort;
      if(!codexEfforts.includes(reasoningEffort))throw new Error('Некорректный уровень рассуждений Codex');
      if(raw.fastMode!==undefined&&typeof raw.fastMode!=='boolean')throw new Error('Некорректный быстрый режим Codex');
      return {provider:'codex',endpoint:base,model,reasoningEffort,fastMode:raw.fastMode===true,apiKey:'',enabled:raw.enabled===true,images:raw.images===true};
    }
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,149}$/.test(model))throw new Error('Введите ID модели из своего API');
    const unchanged=raw.provider===previous.provider&&base===previous.endpoint;
    const key=typeof raw.apiKey==='string'?raw.apiKey.trim():'';
    const apiKey=key||unchanged&&previous.apiKey||'';
    if(typeof apiKey!=='string'||apiKey.length>4096||/[\s\x00-\x1f\x7f]/.test(apiKey)||!apiKey&&!(raw.provider==='compatible'&&new URL(base).protocol==='http:'))throw new Error('Введите API-ключ выбранного провайдера. При смене адреса старый ключ не переносится');
    return {provider:raw.provider,endpoint:base,model,apiKey,enabled:raw.enabled===true,images:raw.images===true};
  }
  function publicConfig(value){return value?{configured:true,hasKey:Boolean(value.apiKey),provider:value.provider,endpoint:value.endpoint,model:value.model,...(value.provider==='codex'?{reasoningEffort:value.reasoningEffort||'low',fastMode:value.fastMode===true}:{}),enabled:value.enabled===true,images:value.images===true}:{configured:false,hasKey:false,provider:'openai',endpoint:providers.openai.endpoint,model:'',enabled:false,images:false};}
  const originPermission=value=>{const url=new URL(value);return url.protocol+'//'+url.hostname+'/*';};
  function image(value){
    if(typeof value!=='string'||value.length>7000000)throw new Error('Изображение слишком большое');
    if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
    let url;try{url=new URL(value);}catch{throw new Error('Не удалось прочитать изображение вопроса');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)(quizizz|wayground)\.com$/i.test(url.hostname))throw new Error('Изображение вне доменов Wayground/Quizizz не отправлено');
    return url.href;
  }
  function input(raw){
    if(!raw||typeof raw!=='object')throw new Error('Текущий вопрос не распознан');
    const text=value=>typeof value==='string'?value.trim():'';
    const question=text(raw.question);
    if(question.length>8000||!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>20)throw new Error('Поддерживаются вопросы с 2–20 вариантами');
    let imageCount=0,imageSize=0;
    function images(values){
      if(values==null)return [];
      if(!Array.isArray(values))throw new Error('Некорректные изображения');
      return [...new Set(values)].map(value=>{const safe=image(value);imageSize+=safe.length;if(++imageCount>8||imageSize>14000000)throw new Error('Слишком много изображений в вопросе');return safe;});
    }
    const questionImages=images(raw.images);
    if(!question&&!questionImages.length)throw new Error('У вопроса нет доступного текста или изображения');
    const options=raw.options.map((option,i)=>{
      const label=text(option?.text),media=images(option?.images);
      if(option?.id!==String(i+1)||label.length>3000||!label&&!media.length)throw new Error('Не удалось прочитать все варианты вопроса');
      return {id:String(i+1),text:label,images:media};
    });
    if(new Set(options.map(o=>JSON.stringify([o.text,o.images]))).size!==options.length)throw new Error('Одинаковые варианты: ИИ не сможет однозначно сопоставить ответ');
    return {question,images:questionImages,options,multiple:typeof raw.multiple==='boolean'?raw.multiple:null};
  }
  function fromVisible(visible){
    if(!visible||visible.unsupportedMedia||visible.options?.some(o=>o.unsupportedMedia))throw new Error('Видео, аудио или canvas: ИИ не получил полное условие');
    const text=o=>[o.text,...(o.math||[])].filter(Boolean).join('\n');
    for(const item of [visible,...(visible.options||[])])if(item.hasMedia&&!item.images?.length)throw new Error('Изображение вопроса не прочитано');
    return input({question:text(visible),images:visible.images,options:visible.options.map((o,i)=>({id:String(i+1),text:text(o),images:o.images})),multiple:visible.multiple});
  }
  function schema(question){return {type:'object',additionalProperties:false,required:['status','selectedChoiceIds','explanation'],properties:{status:{type:'string',enum:['ready','uncertain','unreadable']},selectedChoiceIds:{type:'array',items:{type:'string',enum:question.options.map(o=>o.id)}},explanation:{type:'string'}}};}
  function result(value,question){
    if(!value||!['ready','uncertain','unreadable'].includes(value.status)||!Array.isArray(value.selectedChoiceIds)||typeof value.explanation!=='string'||value.explanation.length>2000)throw new Error('ИИ вернул некорректный формат ответа');
    const ids=value.selectedChoiceIds;
    if(new Set(ids).size!==ids.length||ids.some(id=>!question.options.some(o=>o.id===id))||value.status==='ready'&&(!ids.length||question.multiple===false&&ids.length!==1)||value.status!=='ready'&&ids.length)throw new Error('ИИ вернул некорректные номера вариантов');
    return {status:value.status,indices:ids.map(id=>Number(id)-1).sort((a,b)=>a-b),explanation:value.explanation};
  }
  globalThis.WGAI={providers,codexEfforts,endpoint,config,publicConfig,originPermission,input,fromVisible,schema,result};
})();
