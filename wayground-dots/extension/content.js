(() => {
  'use strict';
  if(location.protocol!=='https:'||!['wayground.com','www.wayground.com'].includes(location.hostname)||location.port)return;
  if(document.getElementById('wg-dots-extension'))return;
  const pageState=WGPageState.create(document,window);
  const host=document.createElement('div');host.id='wg-dots-extension';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{all:initial!important;position:fixed!important;display:block!important;top:var(--wg-top,max(12px,env(safe-area-inset-top)))!important;right:var(--wg-right,max(12px,env(safe-area-inset-right)))!important;left:var(--wg-left,auto)!important;bottom:auto!important;margin:0!important;padding:0!important;border:0!important;width:max-content!important;height:max-content!important;overflow:visible!important;background:transparent!important;z-index:2147483647!important;font:13px/1.45 system-ui,sans-serif!important;color:#e2e8f0!important;pointer-events:none!important;color-scheme:dark!important}
    :host::backdrop{display:none;pointer-events:none}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #60a5fa;outline-offset:3px}
    #handle{position:relative;width:max-content;max-width:calc(100vw - 24px);pointer-events:auto;touch-action:none;user-select:none;cursor:grab}#handle.dragging{cursor:grabbing}
    #toggle{display:flex;align-items:center;gap:4px;min-height:16px;border:0;border-radius:12px;padding:4px 5px;background:transparent;box-shadow:none;color:#cbd5e1;pointer-events:auto;max-width:calc(100vw - 24px);flex-wrap:wrap;margin-left:auto;cursor:inherit;transform-origin:center;transition:transform 150ms ease}
    @media(hover:hover) and (pointer:fine){#handle:hover:not(.dragging):not(.expanded) #toggle{transform:scale(.75)}}
    .dot{width:var(--wg-dot-size,6px);height:var(--wg-dot-size,6px);display:inline-grid;place-items:center;border-radius:50%;font-size:0;background:#64748b;border:0;opacity:var(--wg-dot-opacity,.08);flex-shrink:0}.green{background:#22c55e}.red{background:#ef4444}.gray{background:#64748b}
    #panel{position:absolute;right:auto;left:0;top:100%;width:min(328px,calc(100vw - 24px));padding:17px;border:1px solid #475569;border-radius:14px;background:#0b1224fa;box-shadow:0 10px 35px #0008;pointer-events:auto;max-height:calc(100dvh - 24px);overflow:auto}#panel[hidden]{display:none}h2{margin:0 0 8px;font-size:16px}p{margin:8px 0}label{display:block;margin:15px 0 6px;font-size:12px;color:#cbd5e1}input{width:100%;min-width:0;padding:9px;border:1px solid #475569;border-radius:7px;background:#020617;color:#fff}input::placeholder{color:#94a3b8}.actions{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}.actions button{padding:7px 10px;border:1px solid #475569;border-radius:7px;background:#1e293b;color:#e2e8f0}.actions button:first-child{background:#1d4ed8;border-color:#2563eb}.hint{font-size:11px;color:#94a3b8}#source-state{color:#bfdbfe;overflow-wrap:anywhere}#current-state{font-size:12px}#live-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%)}button:disabled{opacity:.5;cursor:wait}
    #cover[hidden],#advanced[hidden]{display:none!important}
    #appearance{margin:14px 0;padding:10px;border:1px solid #475569;border-radius:8px}#appearance legend{padding:0 5px;font-size:12px;color:#cbd5e1}#appearance label{display:flex;justify-content:space-between;gap:10px;margin:8px 0 4px}#appearance output{font-variant-numeric:tabular-nums;color:#e2e8f0}#appearance input[type=range]{padding:0;border:0;background:transparent;accent-color:#60a5fa;min-height:24px}#appearance .hint{margin:6px 0}
    #brand{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:0;background:transparent;color:#e2e8f0;text-align:left;font-size:18px;font-weight:700}
    #brand svg{width:34px;height:34px;flex:none}
    #theme-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:22px 0 2px;font-size:13px;color:#e2e8f0;cursor:pointer}
    #theme-toggle{appearance:none;flex:none;width:36px;height:21px;min-width:36px;margin:0;padding:2px;border:1px solid #64748b;border-radius:20px;background:#334155;cursor:pointer;transition:background 150ms}
    #theme-toggle::before{content:'';display:block;width:15px;height:15px;border-radius:50%;background:#e2e8f0;transition:transform 150ms}
    #theme-toggle:checked{background:#4f46e5;border-color:#818cf8}#theme-toggle:checked::before{transform:translateX(15px)}
    .ai{background:#fbbf24}#ai-settings{margin:14px 0;padding:10px;border:1px solid #475569;border-radius:8px}#ai-settings legend{font-size:12px;color:#fcd34d}#ai-settings label{display:flex;align-items:center;gap:8px;margin:0}#ai-enabled{width:16px;min-width:16px;accent-color:#fbbf24}#ai-status{font-size:12px;color:#fcd34d;overflow-wrap:anywhere}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
    #handle{min-width:44px;min-height:44px}#toggle{min-width:44px;min-height:44px;gap:6px;padding:10px;justify-content:center}
    #panel{width:min(360px,calc(100vw - 24px));-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #panel input{font-size:16px;min-height:44px}#panel button{min-height:44px}#panel #ai-enabled{min-height:22px;width:22px;min-width:22px;height:22px}
    #ios-close{width:100%;margin:0 0 14px;padding:10px 12px;border:1px solid #475569;border-radius:9px;background:#1e293b;color:#e2e8f0;font-size:16px}
  </style>
  <div id="handle"><div id="toggle" role="img"><span id="dots" style="display:contents"></span></div></div>
  <div id="live-status" role="status" aria-live="polite"></div>
  <section id="panel" hidden aria-label="Настройки Wayground Dark">
    <section id="cover">
      <button id="brand" type="button" aria-controls="advanced" aria-expanded="false"><svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="13" fill="#1e293b"/><path d="M34.8 29.8A15.5 15.5 0 0 1 18.2 13.2 15.5 15.5 0 1 0 34.8 29.8Z" fill="#c7d2fe"/><path d="m33 9 1.4 3.6L38 14l-3.6 1.4L33 19l-1.4-3.6L28 14l3.6-1.4Z" fill="#818cf8"/></svg><span>Wayground Dark</span></button>
      <label id="theme-setting" for="theme-toggle"><span>Тёмная тема</span><input id="theme-toggle" type="checkbox"></label>
    </section>
    <section id="advanced" hidden>
    <h2>Wayground Dots · iPhone 0.1.0</h2><p id="current-state"></p><p id="source-state"></p><p id="dom-state" class="hint" role="status"></p>
    <fieldset id="ai-settings"><legend>Screening Choice · ИИ</legend>
      <label for="ai-enabled"><input id="ai-enabled" type="checkbox">Ответы ИИ, когда нет ключа</label>
      <p id="ai-status" role="status">ИИ выключен</p>
      <div class="actions"><button id="ai-options" type="button">Подключить ИИ</button><button id="ai-retry" type="button">Повторить ИИ</button></div>
      <p class="hint">Жёлтый — предположение ИИ; зелёный — публичный ключ. ИИ может ошибаться. Запросы идут напрямую выбранному провайдеру с вашим ключом.</p>
    </fieldset>
    <fieldset id="appearance"><legend>Кружки</legend>
      <label for="dot-size">Размер <output id="dot-size-value" for="dot-size">6 px</output></label><input id="dot-size" type="range" min="3" max="24" step="1" value="6">
      <label for="dot-opacity">Видимость (непрозрачность) <output id="dot-opacity-value" for="dot-opacity">8%</output></label><input id="dot-opacity" type="range" min="0" max="100" step="1" value="8">
      <p class="hint">При 0% кружки скрыты. Панель можно открыть значком расширения в Safari.</p>
      <div class="actions"><button id="reset-appearance" type="button">Вид по умолчанию</button></div><p id="appearance-status" class="hint" role="status"></p>
    </fieldset>
    <label for="source">Публичный квиз или PIN (резервный ввод)</label><input id="source" maxlength="800" autocomplete="off" placeholder="Ссылка, ID квиза или PIN">
    <div class="actions"><button id="load" type="button">Загрузить ключи</button><button id="auto" type="button">Обновить автоисточник</button><button id="clear" type="button">Сбросить</button><button id="recheck" type="button">Проверить связь</button></div>
    <div class="actions"><button id="pause" type="button" aria-pressed="false">Приостановить наблюдение</button><button id="reset-position" type="button">Позиция по умолчанию</button></div><p id="position-status" class="hint" role="status"></p>
    <p class="hint">По PIN поиск начинается в лобби: до 5 попыток за 3 минуты, по названию и разным вопросам. Найденные ключи готовятся до старта. После старта повторы поиска по пустым результатам прекращаются. В SOLO восстанавливаются ранее открытые публичные квизы. Новый источник в другой вкладке подхватывается автоматически.</p>
    <p class="hint">Перетаскивайте индикатор мышью или пальцем. Положение сохраняется. При наведении мыши он уменьшается на 25%. Меню открывается значком расширения в Safari.</p>
    <p class="hint">Кружки идут по экрану: слева направо, затем сверху вниз. На телефоне — сверху вниз. Зелёный во время вопроса означает совпавший ключ, жёлтый — предположение ИИ, серый — неизвестный или не выбранный вариант.</p>
    <p class="hint">Вне вопроса 4 зелёных означают доступность Wayground по HTTP. Красные — связь не подтверждена. Это не проверка игрового WebSocket.</p>
    <p class="hint">PIN можно вводить с пробелом. Для игры по PIN проверяется весь набор вопросов исходного квиза. В SOLO история сопоставляется с текущим вопросом по тексту, медиа и вариантам. Если источник не найден, откройте его публичную страницу в Safari один раз — игра подхватит его автоматически. Полный экран не требуется. Картинки сравниваются по URL; формулы и ввод текста пока не поддерживаются.</p>
    </section>
  </section>`;
  const $=selector=>root.querySelector(selector);
  let bank=[],connected=false,sourceNote='Ключи ещё не загружены',version=0,autoId='',activePin='',autoToken='',lastPaint='',scanTimer,healthBusy=false,sourceLoading=false,lastObserved=null,paused=false;
  let contextPath=location.pathname,linkedSource='',suppressedPath='',contextReady=Promise.resolve(),autoState='idle',autoAttempts=0,retryAt=0,pendingRevision=false,configReady=false;
  let preparationPin='',lobbyDeadline=0,lobbyPass=0,lobbyRetryAt=0,sourceRemember=false;
  let aiSettings={configured:false,enabled:false},aiSettingsError='';
  const sessionPath=path=>/^\/join\/(?:game|pre-game)\//.test(path);
  const solo=()=>sessionPath(location.pathname)&&new URLSearchParams(location.search||'').get('gameType')==='solo';
  const lobby=()=>/^\/join\/pre-game\//.test(location.pathname)&&!solo();
  const initialPublicSource=WGDom.source();
  const publicPath=path=>/^\/(?:activity\/)?(?:join|admin)\/quiz\//.test(path);
  const gameVisible=()=>/^\/join\/game\//.test(location.pathname)||Boolean(document.querySelector('.options-grid,[role="listbox"]'));
  function mount(){
    const fullscreen=pageState.fullscreen();
    const parent=fullscreen&&fullscreen!==document.documentElement?fullscreen:document.body||document.documentElement;
    if(host.parentNode!==parent)parent.append(host);
    // A fullscreen element occupies the browser's top layer. Keep the widget
    // in that layer too, without requesting or leaving fullscreen or taking focus.
    if(fullscreen&&typeof host.showPopover==='function'){
      if(host.getAttribute('popover')!=='manual')host.setAttribute('popover','manual');
      try{if(!host.matches(':popover-open'))host.showPopover();}
      catch{host.removeAttribute('popover');}
    }else if(host.hasAttribute('popover')){
      try{if(host.matches(':popover-open'))host.hidePopover();}catch{}
      host.removeAttribute('popover');
    }
  }
  function showPanel(open){$('#panel').hidden=!open;if(!open)coverUI.reset();widget.layout();if(open)$('#ios-close')?.focus();}
  const widget=WGWidget.install(host,root,()=>showPanel(false));
  const coverUI=WGCover.install(root,{onLayout:()=>widget.layout(),onUnlock:()=>$('#source').focus()});
  const aiFallback=globalThis.WGAIFallback?.create({send:message=>browser.runtime.sendMessage(message),onChange:()=>{lastPaint='';paint();}});
  function restoreAI(settings){aiSettings=settings||{configured:false,enabled:false};aiSettingsError='';aiFallback?.reset();$('#ai-enabled').checked=aiSettings.enabled;$('#ai-enabled').disabled=!aiSettings.configured;lastPaint='';}
  async function refreshAI(){try{const response=await browser.runtime.sendMessage({type:'WG_AI_STATUS'});if(response?.ok)restoreAI(response.settings);}catch{}paint();}
  function paint(){
    mount();let observed;
    try{observed=paused?{playing:false,disconnected:false}:WGDom.read();}
    catch(error){observed={playing:gameVisible(),disconnected:false,visible:null,diagnostics:{code:'read-error',reason:'Ошибка чтения страницы: '+String(error?.message||error).slice(0,160)}};}
    lastObserved=observed;
    // During play, use the page's visible error and the browser's offline signal.
    // A separate HTTP request cannot establish whether the game socket is alive.
    const available=navigator.onLine&&(observed.playing||connected);
    const state=paused?{colors:Array(4).fill('gray'),reason:'Наблюдение приостановлено · чтение страницы и новые запросы остановлены'}:WGDots.indicators({...observed,connected:available,questions:bank});
    if(observed.playing&&!observed.disconnected&&available&&!bank.length&&observed.visible)state.reason=sourceLoading?'Загружаем ключи исходного квиза…':'Ключи не загружены. Нужна ссылка на публичный исходный квиз';
    if(observed.playing&&!observed.visible&&observed.diagnostics)state.reason=observed.diagnostics.reason;
    const useAI=Boolean(aiSettings.enabled&&configReady&&!paused&&!pageState.hidden()&&observed.playing&&!observed.disconnected&&available&&!sourceLoading&&!state.colors.includes('green'));
    const ai=aiFallback?.update(observed.visible,useAI)||{status:'idle',indices:[]};
    if(useAI&&ai.status==='ready'){state.colors=state.colors.map((_,i)=>ai.indices.includes(i)?'ai':'gray');state.reason='Предположение ИИ, не ключ автора';}
    else if(useAI&&ai.status==='working')state.reason='ИИ решает текущий вопрос…';
    const aiText=aiSettingsError||(!aiSettings.configured?'Укажите модель и API-ключ в настройках Safari':!aiSettings.enabled?'ИИ выключен':!observed.visible&&observed.playing?'ИИ не получил условие: '+(observed.diagnostics?.reason||'вопрос не распознан'):ai.status==='working'?'ИИ решает текущий вопрос…':ai.status==='ready'?'Предположение ИИ: варианты '+ai.indices.map(i=>i+1).join(', ')+'. '+ai.explanation:ai.explanation||'ИИ включён · ждём вопрос без подтверждённого ключа');
    const diagnostic=observed.diagnostics;
    const domText=diagnostic?'Распознавание: '+diagnostic.code+' · вопросы '+(diagnostic.questions??'?')+'/'+(diagnostic.questionCandidates??'?')+' · списки '+(diagnostic.grids??'?')+'/'+(diagnostic.gridCandidates??'?')+' · варианты '+(diagnostic.options??'?')+' · iframe '+(diagnostic.frames??'?'):paused?'Распознавание приостановлено':'';
    const signature=JSON.stringify([state.colors,state.reason,sourceNote,aiText,useAI,domText]);
    if(signature===lastPaint)return;lastPaint=signature;
    const dots=$('#dots');
    if(dots.children.length!==state.colors.length)dots.replaceChildren(...state.colors.map((color,i)=>{const dot=document.createElement('span');dot.className='dot '+color;dot.textContent=i+1;dot.setAttribute('aria-hidden','true');return dot;}));
    else state.colors.forEach((color,i)=>{const value='dot '+color;if(dots.children[i].className!==value)dots.children[i].className=value;});
    $('#ai-retry').disabled=!useAI||ai.status==='working';
    const description=state.reason+(observed.playing?' · '+(ai.status==='ready'&&useAI?'позиции ИИ: ':'зелёные позиции: ')+(state.colors.map((color,i)=>color==='green'||color==='ai'?i+1:null).filter(Boolean).join(', ')||'нет'):'');
    const label=description;
    if($('#toggle').getAttribute('aria-label')!==label)$('#toggle').setAttribute('aria-label',label);
    for(const [selector,value] of [['#current-state',description],['#live-status',description],['#source-state',sourceNote],['#ai-status',aiText],['#dom-state',domText]]){const element=$(selector);if(element.textContent!==value)element.textContent=value;}
    widget.layout();
  }
  function schedule(){
    if(paused||scanTimer||pageState.hidden())return;
    if(lastObserved?.playing||document.querySelector('.options-grid,[role="listbox"]')){
      for(const dot of $('#dots').children)if(dot.className!=='dot gray')dot.className='dot gray';
      lastPaint='';
    }
    scanTimer=setTimeout(()=>{scanTimer=null;scan();},120);
  }
  async function loadSource(source,remember,resetBudget=true){
    if(paused)return;
    suppressedPath='';
    const pin=WGDots.normalizePin(source);
    if(pin){activePin=pin;return loadAuto(true,true);}
    const token='source|'+source+'|'+location.pathname;
    if(resetBudget||autoToken!==token)autoAttempts=0;
    autoAttempts++;sourceRemember=remember;
    activePin='';linkedSource=source;autoState='manual';pendingRevision=false;retryAt=0;lobbyRetryAt=0;
    autoToken=token;
    const request=++version;bank=[];sourceLoading=true;sourceNote='Загружаем публичные ключи…';$('#load').disabled=true;paint();
    try{
      await contextReady;if(request!==version)return;
      const result=await browser.runtime.sendMessage({type:'WG_LOAD',source,remember});
      if(request!==version)return;
      if(!result?.ok){const error=new Error(result?.error||'Нет ответа расширения');error.retryable=result?.retryable===true;throw error;}
      bank=result.quiz.questions;sourceNote=result.quiz.title+' · ключи: '+result.quiz.answerable+' из '+result.quiz.total;
      $('#source').value=result.quiz.sourceUrl;
    }catch(error){if(request===version){
      sourceNote=error.message||'Не удалось загрузить ключи';
      if(error.retryable===true&&autoAttempts<3){retryAt=Date.now()+(autoAttempts===1?15000:45000);sourceNote+=' · повторим автоматически';}
    }}
    finally{if(request===version){sourceLoading=false;$('#load').disabled=paused;$('#auto').disabled=paused;paint();}}
  }
  async function loadAuto(force=false,resetBudget=false){
    if(paused||!activePin)return;
    suppressedPath='';
    const token=activePin+'|'+location.pathname;
    if(resetBudget||autoToken!==token)autoAttempts=0;
    if(resetBudget||preparationPin!==activePin){preparationPin=activePin;lobbyDeadline=Date.now()+180000;lobbyPass=0;}
    const round=lobby()?Math.min(lobbyPass++,4):0;
    lobbyRetryAt=0;
    autoToken=token;autoAttempts++;autoState='pending';pendingRevision=false;retryAt=0;linkedSource='';
    const request=++version;bank=[];sourceLoading=true;sourceNote='PIN '+activePin+' · определяем публичный источник…';$('#source').value='';$('#load').disabled=true;$('#auto').disabled=true;paint();
    try{
      await contextReady;if(request!==version)return;
      const result=await browser.runtime.sendMessage({type:'WG_RESOLVE',pin:activePin,force,round,lobbyOnly:lobby()&&round>0,hints:WGDom.candidates()});
      if(request!==version)return;
      if(!result?.ok||(!result.quiz&&result.roomState!=='waiting'&&!result.lobbyEnded)){const error=new Error(result?.error||'Автоисточник недоступен');error.retryable=result?.retryable===true;throw error;}
      bank=result.quiz?.questions||[];
      sourceNote='PIN '+activePin+' · '+(result.quiz?result.quiz.title+' · ключи: '+result.quiz.answerable+' из '+result.quiz.total+'. ':'')+result.notice;
      autoState=result.resolved?'resolved':'unresolved';if(result.resolved)pendingRevision=false;
      $('#source').value=result.quiz?.sourceUrl||'';
      if(!result.resolved&&result.roomState==='waiting'&&lobby()){
        const delay=[20000,30000,45000,45000][lobbyPass-1];
        if(delay&&Date.now()+delay<lobbyDeadline){
          lobbyRetryAt=Date.now()+delay;
          sourceNote+=' · лобби: попытка '+lobbyPass+'/5, следующий поиск через '+delay/1000+' с';
        }else sourceNote+=' · поиск в лобби завершён; публичный источник пока не найден';
      }
    }catch(error){if(request===version){
      autoState='error';sourceNote=error.message||'Автоисточник недоступен';
      if(error.retryable===true&&autoAttempts<3&&(!lobby()||lobbyPass<5&&Date.now()+45000<lobbyDeadline)){retryAt=Date.now()+(autoAttempts===1?15000:45000);sourceNote+=' · повторим автоматически';}
    }}
    finally{if(request===version){sourceLoading=false;$('#load').disabled=paused;$('#auto').disabled=paused;paint();if(pendingRevision)scan();}}
  }
  async function loadHistory(resetBudget=false){
    if(paused)return;
    const token='history|'+location.pathname;
    if(resetBudget||autoToken!==token)autoAttempts=0;
    autoToken=token;autoAttempts++;autoState='history';activePin='';linkedSource='';suppressedPath='';pendingRevision=false;retryAt=0;lobbyRetryAt=0;
    const request=++version;bank=[];sourceLoading=true;sourceNote='SOLO · восстанавливаем историю публичных квизов…';
    $('#source').value='';$('#load').disabled=true;$('#auto').disabled=true;paint();
    try{
      await contextReady;if(request!==version)return;
      const result=await browser.runtime.sendMessage({type:'WG_HISTORY'});
      if(request!==version)return;
      if(!result?.ok||!Array.isArray(result.quizzes)){const error=new Error(result?.error||'История источников недоступна');error.retryable=result?.retryable===true;throw error;}
      bank=result.quizzes.flatMap(quiz=>quiz.questions);
      sourceNote=result.quizzes.length
        ?'SOLO · история: '+result.quizzes.length+' публичных квизов, '+bank.filter(q=>q.answerAvailable).length+' ключей. Подсвечиваются только однозначные совпадения текущего вопроса.'+(result.failed?' Не загрузилось источников: '+result.failed:'')
        :'SOLO · история источников пуста. Откройте публичную страницу исходного квиза в Safari; ключи подхватятся автоматически. PIN не требуется.';
    }catch(error){if(request===version){
      sourceNote=error.message||'История источников недоступна';
      if(error.retryable===true&&autoAttempts<3){retryAt=Date.now()+(autoAttempts===1?15000:45000);sourceNote+=' · повторим автоматически';}
    }}
    finally{if(request===version){sourceLoading=false;$('#load').disabled=paused;$('#auto').disabled=paused;paint();if(pendingRevision)scan();}}
  }
  function changeContext(source,pin=''){
    if(!configReady)return;
    const path=location.pathname;
    if(path===contextPath)return;
    const previous=contextPath;
    aiFallback?.reset();
    // The same PIN moving from its lobby to the game keeps both ready keys
    // and an in-flight preparation. A different PIN always starts afresh.
    if(!source&&!solo()&&activePin&&(!pin||pin===activePin)&&/^\/join\/pre-game\//.test(previous)&&/^\/join\/game\//.test(path)){
      contextPath=path;lobbyRetryAt=0;retryAt=0;
      autoToken=['resolved','pending'].includes(autoState)?activePin+'|'+path:'';
      return;
    }
    const continuation=sessionPath(path)&&(/^\/join\/?$/.test(previous)||publicPath(previous)||/^\/join\/pre-game\//.test(previous));
    const keepSource=!source&&continuation&&Boolean(linkedSource);
    const keepPin=!source&&continuation&&!keepSource&&!solo();
    version++;bank=[];sourceLoading=false;autoState='idle';autoAttempts=0;retryAt=0;lobbyRetryAt=0;preparationPin='';pendingRevision=false;autoToken='';autoId='';suppressedPath='';
    if(!keepPin)activePin='';
    if(!keepSource)linkedSource='';
    contextPath=path;sourceNote='Ключи ещё не загружены';$('#source').value='';
    $('#load').disabled=paused;$('#auto').disabled=paused;
    contextReady=contextReady.then(()=>browser.runtime.sendMessage({type:'WG_CONTEXT',keepPin,keepSource})).catch(()=>{});
  }
  function scan(){
    if(paused||pageState.hidden())return;
    if(!configReady){paint();return;}
    const source=WGDom.source(),pin=WGDom.pin();changeContext(source,pin);
    if(suppressedPath===location.pathname){paint();return;}
    if(source&&source!==autoId){autoId=source;activePin='';void loadSource(source,false);}
    if(autoState==='manual'&&retryAt&&Date.now()>=retryAt&&!sourceLoading&&linkedSource)void loadSource(linkedSource,sourceRemember,false);
    if(solo())activePin='';
    if(!source&&!solo()&&pin&&pin!==activePin){activePin=pin;void contextReady.then(()=>browser.runtime.sendMessage({type:'WG_PIN',pin})).catch(()=>{});}
    if(lobbyRetryAt&&Date.now()>=lobbyDeadline){
      lobbyRetryAt=0;sourceNote=sourceNote.replace(/ · лобби: попытка.*$/,'')+' · время поиска в лобби истекло';
    }
    const lobbyDue=lobby()&&lobbyRetryAt&&Date.now()>=lobbyRetryAt;
    if(!source&&sessionPath(location.pathname)){
      if(linkedSource&&!activePin&&autoState==='idle')void loadSource(linkedSource,false);
      else if(solo()&&!linkedSource&&!sourceLoading&&(autoToken!=='history|'+location.pathname||pendingRevision||retryAt&&Date.now()>=retryAt))void loadHistory();
      else if(activePin&&!sourceLoading&&(autoToken!==activePin+'|'+location.pathname||pendingRevision||retryAt&&Date.now()>=retryAt||lobbyDue))void loadAuto(Boolean(pendingRevision||retryAt||lobbyDue));
    }
    paint();
  }
  async function health(force=false){
    if(paused||healthBusy||(!force&&gameVisible()))return;
    if(!navigator.onLine){connected=false;paint();return;}
    healthBusy=true;
    try{const result=await browser.runtime.sendMessage({type:'WG_PING',force});connected=result?.ok&&result.connected===true;}catch{connected=false;}
    finally{healthBusy=false;paint();}
  }
  $('#ai-options').addEventListener('click',()=>{void browser.runtime.sendMessage({type:'WG_OPEN_SETTINGS'}).catch(()=>{aiSettingsError='Откройте настройки Wayground Dots через страницу дополнений Safari';paint();});});
  $('#ai-enabled').addEventListener('change',async()=>{
    $('#ai-enabled').disabled=true;
    try{const response=await browser.runtime.sendMessage({type:'WG_AI_ENABLE',enabled:$('#ai-enabled').checked});if(!response?.ok)throw new Error(response?.error||'Не удалось переключить ИИ');restoreAI(response.settings);}
    catch(error){aiSettingsError=error.message;$('#ai-enabled').checked=aiSettings.enabled;}
    finally{$('#ai-enabled').disabled=!aiSettings.configured;paint();}
  });
  $('#ai-retry').addEventListener('click',()=>{aiFallback?.retry();aiSettingsError='';lastPaint='';paint();});
  $('#load').addEventListener('click',()=>{const source=$('#source').value.trim();if(source)void loadSource(source,true);else{sourceNote='Введите ссылку на публичный квиз или его ID';paint();}});
  $('#auto').addEventListener('click',()=>{
    const source=WGDom.source()||linkedSource;
    if(source){void loadSource(source,false);return;}
    if(solo()){void loadHistory(true);return;}
    const pin=WGDom.pin();if(pin)activePin=pin;
    if(activePin)void loadAuto(true,true);else{sourceNote='PIN пока не найден. Войдите через страницу /join или введите PIN в поле выше';paint();}
  });
  $('#source').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('#load').click();}});
  $('#clear').addEventListener('click',async()=>{version++;bank=[];activePin='';linkedSource='';autoToken='';autoState='idle';retryAt=0;lobbyRetryAt=0;preparationPin='';pendingRevision=false;suppressedPath=location.pathname;sourceLoading=false;sourceNote='Ключи и история источников сброшены';$('#source').value='';$('#load').disabled=paused;$('#auto').disabled=paused;paint();try{await browser.runtime.sendMessage({type:'WG_CLEAR'});}catch{sourceNote='Ключи сброшены на странице; хранилище недоступно';paint();}});
  $('#recheck').addEventListener('click',()=>void health(true));
  $('#pause').addEventListener('click',()=>{
    paused=!paused;clearTimeout(scanTimer);scanTimer=null;
    $('#pause').textContent=paused?'Возобновить наблюдение':'Приостановить наблюдение';$('#pause').setAttribute('aria-pressed',String(paused));
    $('#load').disabled=paused||sourceLoading;$('#auto').disabled=paused||sourceLoading;$('#recheck').disabled=paused;lastPaint='';
    if(paused)paint();else{scan();void health();}
  });
  root.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape')showPanel(false);});
  for(const type of ['keyup','keypress','click','pointerdown','pointerup','pointermove'])root.addEventListener(type,event=>event.stopPropagation());
  browser.runtime.onMessage.addListener(message=>{if(message?.type==='WG_SHOW_PANEL'){showPanel(true);return Promise.resolve({ok:true});}return undefined;});
  browser.storage?.onChanged?.addListener((changes,area)=>{
    if(area==='local'&&changes.aiConfig)void refreshAI();
    if(area!=='local'||!changes.sourcesRevision||suppressedPath===location.pathname)return;
    if(solo()&&!linkedSource){pendingRevision=true;scan();return;}
    if(!activePin)return;
    if(['pending','unresolved','error'].includes(autoState)){pendingRevision=true;scan();}
  });
  const targets='#questionText,[id="optionText"],.options-grid,[role="listbox"],#quiz-info-share-input,[data-testid="question-text"],[data-cy="question-text"],[data-testid="question-container-text"],.question-text';
  function relevant(node){const el=node.nodeType===1?node:node.parentElement;if(!el||el===host||host.contains(el))return false;return Boolean(el.closest?.(targets)||el.querySelector?.(targets)||/Could not connect to (?:Wayground|Quizizz)|Не удалось подключиться к (?:Wayground|Quizizz)/i.test(el.textContent?.slice(0,2000)||''));}
  new MutationObserver(records=>{
    if(paused||pageState.hidden())return;
    if(records.some(record=>record.type==='childList'
      ?Boolean(record.target!==host&&record.target.closest?.(targets))||[...(record.addedNodes||[]),...(record.removedNodes||[])].some(relevant)
      :relevant(record.target)))schedule();
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden']});
  window.addEventListener('pagehide',()=>aiFallback?.reset());window.addEventListener('pageshow',schedule);window.addEventListener('popstate',schedule);window.addEventListener('online',()=>{paint();void health();});window.addEventListener('offline',()=>{connected=false;paint();});
  pageState.watch({
    onViewport(){mount();widget.viewportChanged();schedule();},
    onVisibility(hidden){if(hidden){clearTimeout(scanTimer);scanTimer=null;aiFallback?.reset();lastPaint='';}else{schedule();void health();}}
  });
  // Observe only the join-code field; do not submit the form or alter game events.
  document.addEventListener('input',()=>{if(paused||!/^\/join\/?$/.test(location.pathname))return;changeContext(WGDom.source());const pin=WGDom.pin();if(pin&&pin!==activePin){activePin=pin;void contextReady.then(()=>browser.runtime.sendMessage({type:'WG_PIN',pin})).catch(()=>{});}},true);
  setInterval(scan,3000);setInterval(()=>{if(!pageState.hidden())void health();},30000);
  mount();scan();void health();
  const startupVersion=version;
  browser.runtime.sendMessage({type:'WG_CONFIG'}).then(result=>{
    widget.restore(result?.position);widget.restoreAppearance(result?.appearance);coverUI.restore(result?.themeEnabled);
    restoreAI(result?.ai);
    if(version!==startupVersion||autoId)return;
    if(initialPublicSource&&!activePin)linkedSource=initialPublicSource;
    else{
      if(!solo()&&!activePin)activePin=WGDots.normalizePin(result?.pin);
      if(!activePin&&result?.source&&(!solo()||result.sourceIsTab!==false))linkedSource=result.source;
    }
  }).catch(()=>{}).finally(()=>{configReady=true;scan();});
})();
