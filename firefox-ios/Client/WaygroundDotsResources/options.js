(() => {
  'use strict';
  const $=id=>document.getElementById(id);let saved=null,busy=false;
  const labels={openai:'OpenAI',gemini:'Google Gemini',compatible:'Совместимый API'};
  function providerChanged(){
    const custom=$('provider').value==='compatible';$('custom-endpoint').hidden=!custom;$('endpoint').required=custom;
    if(saved?.provider!==$('provider').value){$('token').value='';$('model').value='';$('endpoint').value='';}
  }
  function render(settings){
    saved=settings;
    const supported=Object.hasOwn(labels,settings?.provider);
    $('provider').value=supported?settings.provider:'openai';$('model').value=supported?settings.model||'':'';
    $('endpoint').value=supported&&settings.provider==='compatible'?settings.endpoint:'';
    $('token').value='';$('enabled').checked=settings?.enabled===true;$('images').checked=settings?.images===true;providerChanged();
    $('test').disabled=!settings?.configured||!supported;
    $('current').textContent=settings?.configured&&supported?(settings.enabled?'ИИ включён':'ИИ выключен')+' · '+labels[settings.provider]+' · '+settings.model:'Укажите модель и собственный API-ключ. ИИ по умолчанию выключен.';
  }
  async function run(job,message){
    if(busy)return;busy=true;for(const button of document.querySelectorAll('button'))button.disabled=true;
    $('result').textContent='Выполняется…';
    try{const response=await job();if(!response?.ok)throw new Error(response?.error||'Не удалось выполнить действие');if(response.settings)render(response.settings);$('result').textContent=message(response);}
    catch(error){$('result').textContent=error.message;}
    finally{busy=false;for(const button of document.querySelectorAll('button'))button.disabled=false;$('test').disabled=!saved?.configured;}
  }
  $('provider').addEventListener('change',providerChanged);
  $('connection').addEventListener('submit',event=>{
    event.preventDefault();if(busy)return;let settings,origins;
    try{
      const provider=$('provider').value,endpoint=WGAI.endpoint($('endpoint').value,provider),model=$('model').value.trim(),apiKey=$('token').value.trim();
      if(new URL(endpoint).protocol!=='https:')throw new Error('Для API на iPhone нужен HTTPS-адрес');
      if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,149}$/.test(model))throw new Error('Укажите ID модели вашего провайдера');
      if(!apiKey&&!(saved?.hasKey&&saved.provider===provider&&saved.endpoint===endpoint))throw new Error('Укажите API-ключ выбранного провайдера');
      settings={provider,endpoint,model,apiKey,enabled:$('enabled').checked===true,images:$('images').checked===true};
      origins=[WGAI.originPermission(endpoint),...(settings.images?['https://*.quizizz.com/*','https://*.wayground.com/*']:[])];
    }catch(error){$('result').textContent=error.message;return;}
    // Safari requires the permission request to originate in the user's gesture.
    const permission=browser.permissions.request({origins});
    void run(async()=>{if(!await permission)throw new Error('Safari не предоставил доступ к выбранному API');return browser.runtime.sendMessage({type:'WG_AI_SAVE',settings});},()=> 'Сохранено. Открытая страница Wayground получит настройки автоматически.');
  });
  $('test').addEventListener('click',()=>void run(async()=>{
    const started=Date.now(),response=await browser.runtime.sendMessage({type:'WG_AI_TEST'});return {...response,elapsedMs:Date.now()-started};
  },response=>(response.result.status==='ready'?'Предположение ИИ: вариант '+response.result.indices.map(i=>i+1).join(', '):'ИИ не предложил ответ')+' · '+(response.elapsedMs/1000).toFixed(1)+' с. '+response.result.explanation));
  $('remove').addEventListener('click',()=>void run(()=>browser.runtime.sendMessage({type:'WG_AI_FORGET'}),()=> 'Ключ и настройки удалены. ИИ выключен.'));
  void browser.runtime.sendMessage({type:'WG_AI_STATUS'}).then(response=>{if(!response?.ok)throw new Error(response?.error||'Настройки недоступны');render(response.settings);}).catch(error=>{$('current').textContent=error.message;});
})();
