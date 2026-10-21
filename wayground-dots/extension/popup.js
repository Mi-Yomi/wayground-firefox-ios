(() => {
  'use strict';
  const $=id=>document.getElementById(id);let tabId=null,settings=null;
  const wayground=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.port&&['wayground.com','www.wayground.com'].includes(url.hostname);}catch{return false;}};
  function render(value){settings=value;$('ai-enabled').checked=value?.enabled===true;$('ai-enabled').disabled=!value?.configured;$('ai-state').textContent=value?.configured?(value.enabled?'ИИ включён':'ИИ выключен')+' · '+value.model:'Подключите API-провайдера в настройках ИИ.';}
  $('show-panel').addEventListener('click',async()=>{
    if(tabId===null)return;
    try{const response=await browser.tabs.sendMessage(tabId,{type:'WG_SHOW_PANEL'});if(!response?.ok)throw new Error();window.close();}
    catch{$('result').textContent='Разрешите расширение для wayground.com в меню Safari и обновите страницу.';}
  });
  $('open-settings').addEventListener('click',async()=>{
    try{await browser.tabs.create({url:browser.runtime.getURL('options.html')});window.close();}
    catch{$('result').textContent='Не удалось открыть настройки. Повторите из меню расширений Safari.';}
  });
  $('ai-enabled').addEventListener('change',async()=>{
    $('ai-enabled').disabled=true;
    try{const response=await browser.runtime.sendMessage({type:'WG_AI_ENABLE',enabled:$('ai-enabled').checked===true});if(!response?.ok)throw new Error(response?.error||'Не удалось переключить ИИ');render(response.settings);}
    catch(error){$('ai-enabled').checked=settings?.enabled===true;$('result').textContent=error.message;}
    finally{$('ai-enabled').disabled=!settings?.configured;}
  });
  void browser.tabs.query({active:true,currentWindow:true}).then(tabs=>{
    const tab=tabs.find(tab=>tab.active!==false);
    if(!tab||!wayground(tab.url)||!Number.isInteger(tab.id)){$('page-status').textContent='Откройте wayground.com в Safari и разрешите доступ расширению.';return;}
    tabId=tab.id;$('show-panel').disabled=false;$('page-status').textContent='Открыта страница Wayground.';
  }).catch(()=>{$('page-status').textContent='Safari не предоставил доступ к текущей странице.';});
  void browser.runtime.sendMessage({type:'WG_AI_STATUS'}).then(response=>{if(response?.ok)render(response.settings);else $('ai-state').textContent=response?.error||'Настройки ИИ недоступны';}).catch(()=>{$('ai-state').textContent='Фоновый процесс недоступен. Откройте расширение ещё раз.';});
})();
