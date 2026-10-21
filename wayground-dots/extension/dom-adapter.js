(() => {
  'use strict';
  function read(doc=document,path=location.pathname){
    const styles=new Map(),rejections=new Map();
    function isVisible(el){
      const reject=reason=>{if(el)rejections.set(el,reason);return false;};
      if(!el||!el.isConnected)return reject('элемент отсоединён');
      if(!el.getClientRects().length)return reject('нет области отрисовки');
      for(let node=el;node&&node.nodeType===1;node=node.parentElement){
        let style=styles.get(node);if(!style){style=getComputedStyle(node);styles.set(node,style);}
        const name=node.tagName+(node.id?'#'+node.id:'');
        if(node.hidden)return reject(name+': hidden');
        if(style.display==='none')return reject(name+': display:none');
        if(style.visibility==='hidden')return reject(name+': visibility:hidden');
        if(style.opacity==='0')return reject(name+': opacity:0');
      }
      return true;
    }
    function describe(area){
      const images=[...area.querySelectorAll('img,image')].filter(isVisible);
      const keys=images.map(el=>WGDots.mediaKey(el.currentSrc||el.getAttribute('src')||el.getAttribute('href')||''));
      const media=[...new Set(keys.filter(Boolean))];
      const math=[...area.querySelectorAll('annotation[encoding="application/x-tex"],[data-latex]')].map(el=>el.getAttribute('data-latex')||el.textContent).filter(Boolean);
      return {media,images:[...new Set(images.map(el=>el.currentSrc||el.getAttribute('src')||el.getAttribute('href')||'').filter(Boolean))],math,hasMedia:images.length>0,unsupportedMedia:keys.some(key=>!key)||Boolean(area.querySelector('video,audio,canvas')),hasMath:Boolean(area.querySelector('math,mjx-container,.katex,.MathJax,[data-latex]'))};
    }
    const questionSelector='#questionText,[id="optionText"],.options-grid,[data-testid="question-text"],[data-cy="question-text"],[data-testid="question-container-text"],.question-text';
    // Inspect each text node once. Reading textContent for every nested div
    // repeatedly copied whole subtrees on the game's main thread.
    let disconnected=false;
    const walker=doc.createTreeWalker(doc.body||doc.documentElement,4);
    while(!disconnected&&walker.nextNode()){
      const text=walker.currentNode;
      if(!/connect|подключ/i.test(text.nodeValue||''))continue;
      for(let el=text.parentElement,depth=0;el&&depth<3;el=el.parentElement,depth++){
        if(el.closest(questionSelector))break;
        if(/^(Could not connect to (?:Wayground|Quizizz)|Не удалось подключиться к (?:Wayground|Quizizz))\s*[.!]?$/i.test(WGDots.text(el.textContent))&&!el.querySelector(questionSelector)&&isVisible(el)){disconnected=true;break;}
      }
    }
    const optionSelector='[role="option"],button[data-cy^="option-"]';
    const rawGrids=[...doc.querySelectorAll('.options-grid,[role="listbox"]')].filter(el=>el.querySelector(optionSelector));
    const visibleGrids=rawGrids.filter(isVisible);
    const grids=visibleGrids.filter(outer=>!visibleGrids.some(inner=>{
      if(inner===outer||!outer.contains(inner))return false;
      const a=[...outer.querySelectorAll(optionSelector)],b=[...inner.querySelectorAll(optionSelector)];
      return a.length===b.length&&a.every((node,i)=>node===b[i]);
    }));
    const rawQuestions=[...doc.querySelectorAll('#questionText,[data-testid="question-text"],[data-cy="question-text"],[data-testid="question-container-text"],.question-text')];
    const visibleQuestions=rawQuestions.filter(el=>!el.closest('.options-grid,[role="listbox"]')&&isVisible(el));
    // Wrappers and their inner text element describe one rendered question.
    // Independent visible questions remain ambiguous; never guess between them.
    const questionNodes=visibleQuestions.filter(outer=>!visibleQuestions.some(inner=>inner!==outer&&outer.contains(inner)));
    const playing=/^\/join\/game\//.test(path)||grids.length>0;
    const diagnostics={questions:questionNodes.length,questionCandidates:rawQuestions.length,grids:grids.length,gridCandidates:rawGrids.length,options:0,frames:doc.querySelectorAll('iframe').length};
    const failed=(code,reason)=>({playing,visible:null,disconnected,diagnostics:{...diagnostics,code,reason}});
    if(questionNodes.length!==1){
      const rejection=rawQuestions.map(el=>rejections.get(el)).filter(Boolean)[0];
      return failed(questionNodes.length?'ambiguous-question':'missing-question',questionNodes.length?'Несколько видимых вопросов':rawQuestions.length?'Текст вопроса скрыт'+(rejection?': '+rejection:''):'Контейнер текста вопроса не найден');
    }
    if(grids.length!==1){
      const rejection=rawGrids.map(el=>rejections.get(el)).filter(Boolean)[0];
      return failed(grids.length?'ambiguous-options':'missing-options',grids.length?'Несколько независимых списков вариантов':rawGrids.length?'Варианты скрыты'+(rejection?': '+rejection:''):'Список вариантов не найден');
    }
    const grid=grids[0],query=questionNodes[0];
    const nodes=[...grid.querySelectorAll(optionSelector)].filter(isVisible);diagnostics.options=nodes.length;
    if(nodes.length<2||nodes.length>20)return failed('invalid-options','Найдено вариантов: '+nodes.length+'; нужно от 2 до 20');
    const options=nodes.map(node=>{
      const content=node.querySelector('#optionText .content-slot,#optionText,[data-testid="option-text"],[data-cy="option-text"]');
      const rect=node.getBoundingClientRect();
      return {id:node.getAttribute('data-option-id')||'',text:WGDots.text(content?.innerText??content?.textContent??''),top:rect.top,left:rect.left,...describe(node)};
    });
    let area=query;while(area.parentElement&&!area.parentElement.contains(grid)&&area.parentElement!==doc.body&&area.parentElement!==doc.documentElement)area=area.parentElement;
    const content=query.querySelector('.content-slot')||query;
    const multiple=grid.hasAttribute('aria-multiselectable')?grid.getAttribute('aria-multiselectable')==='true':null;
    return {playing:true,disconnected,diagnostics:{...diagnostics,code:'ready',reason:'Вопрос и варианты распознаны'},visible:{id:query.getAttribute('data-question-id')||query.closest('[data-quesid]')?.getAttribute('data-quesid')||'',text:WGDots.text(content.innerText??content.textContent),...describe(area),multiple,options:WGDots.visualOrder(options)}};
  }
  function source(doc=document,path=location.pathname){
    const own=path.match(/^\/(?:activity\/)?(?:join|admin)\/quiz\/([a-f0-9]{24})(?:\/|$)/i);
    if(own)return 'https://wayground.com/join/quiz/'+own[1]+'/start';
    const input=doc.querySelector('#quiz-info-share-input');
    if(input?.value){try{const u=new URL(input.value);const match=u.pathname.match(/^\/join\/quiz\/([a-f0-9]{24})(?:\/|$)/i);if(u.protocol==='https:'&&['wayground.com','www.wayground.com','quizizz.com','www.quizizz.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&match)return 'https://wayground.com/join/quiz/'+match[1]+'/start';}catch{}}
    return '';
  }
  function pin(doc=document,path=location.pathname,search=location.search||''){
    if(!/^\/join(?:\/|$)/.test(path))return '';
    const visible=el=>el&&el.getClientRects().length&&!el.closest('[hidden]')&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
    if(path==='/join'||path==='/join/'){
      const input=[...doc.querySelectorAll('input[inputmode="numeric"],input[type="tel"],input[placeholder*="code" i],input[placeholder*="код" i]')].find(el=>el.type!=='password'&&visible(el));
      const value=input?.value?.replace(/\s/g,'');
      // An edited field overrides a stale gc in the invitation URL.
      if(value)return WGDots.normalizePin(value);
    }
    // Wayground's real pre-game PIN button has a numeric aria-label and is
    // inside ordinary divs, not a semantic header/nav (observed 2026-10-20).
    const codesOnPage=[...doc.querySelectorAll('header button,nav button,button[aria-label],[data-testid="game-code"],[data-cy="game-code"]')].filter(el=>visible(el)&&!el.closest('.options-grid,[role="listbox"],[role="option"],#questionText')).map(el=>WGDots.normalizePin(el.getAttribute('aria-label')||el.textContent)).filter(Boolean);
    if(new Set(codesOnPage).size===1)return codesOnPage[0];
    const params=new URLSearchParams(search),codes=params.getAll('gc');
    return !codesOnPage.length&&codes.length===1?WGDots.normalizePin(codes[0]):'';
  }
  function candidates(doc=document,path=location.pathname){
    if(!/^\/join\/(?:pre-game|game)\//.test(path))return [];
    const urls=[];
    // Public links already displayed by the page are hints only. Background
    // verifies every question before accepting any of these as the source.
    for(const link of [...doc.querySelectorAll('a[href*="/quiz/"]')].slice(0,100)){
      if(!link.getClientRects().length||link.closest('[hidden],#wg-dots-extension'))continue;
      try{
        const url=new URL(link.getAttribute('href'),'https://wayground.com');
        const match=url.pathname.match(/^\/(?:activity\/)?(?:join|admin)\/quiz\/([a-f0-9]{24})(?:\/|$)/i);
        if(url.protocol!=='https:'||url.port||url.username||url.password||!['wayground.com','www.wayground.com','quizizz.com','www.quizizz.com'].includes(url.hostname)||!match)continue;
        const value='https://wayground.com/join/quiz/'+match[1].toLowerCase()+'/start';
        if(!urls.includes(value))urls.push(value);
        if(urls.length===8)break;
      }catch{}
    }
    return urls;
  }
  globalThis.WGDom={read,source,pin,candidates};
})();
