/* Shared pure matching logic. No interaction with Wayground or extension APIs. */
(() => {
  'use strict';
  const text=value=>String(value??'').normalize('NFC').replace(/\s+/gu,' ').trim();
  function normalizePin(value){
    const compact=typeof value==='string'?value.replace(/\s/gu,''):'';
    return /^\d{6}$/.test(compact)?compact:'';
  }
  function mediaKey(value){
    try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol))return '';
      const path=decodeURIComponent(url.pathname),known=/(^|\.)(quizizz|wayground)\.com$/i.test(url.hostname);
      const asset=known&&path.match(/quizizz-media\/(quizzes|questions)\/([^/]+)/i);
      return asset?'quizizz-media/'+asset[1].toLowerCase()+'/'+asset[2]:url.origin+path+url.search;
    }catch{return '';}
  }
  const media=q=>[...new Set(q.media||[])].sort();
  const usable=q=>!q.hasMath&&!q.unsupportedMedia&&(!q.hasMedia||media(q).length>0);
  const sameMedia=(a,b)=>usable(a)&&usable(b)&&JSON.stringify(media(a))===JSON.stringify(media(b));
  const optionKey=o=>JSON.stringify([text(o.text),media(o)]);
  function visualOrder(options){
    // Group by overlapping horizontal bands, then read each row left to right.
    const ordered=[...options].sort((a,b)=>a.top-b.top||a.left-b.left);
    const rows=[];
    for(const option of ordered){
      const row=rows.at(-1);
      if(row&&Math.abs(option.top-row.top)<=8)row.items.push(option);
      else rows.push({top:option.top,items:[option]});
    }
    return rows.flatMap(row=>row.items.sort((a,b)=>a.left-b.left));
  }
  function matchVisible(visible,questions){
    const unknown=reason=>({known:false,indices:[],reason});
    if(!visible||(!visible.text&&!visible.media?.length)||!visible.options?.length)return unknown('Не удалось распознать активный вопрос');
    if(!questions.length)return unknown('Ключи не загружены. Откройте панель и укажите исходный квиз');
    if(!usable(visible)||visible.options.some(o=>!usable(o)))return unknown('Формулы или нераспознанные медиа: ключ не подставлен');
    const signature=q=>JSON.stringify(q.options.map(optionKey).sort());
    const candidates=questions.filter(q=>['MCQ','MSQ'].includes(q.type)&&text(q.text)===text(visible.text)&&sameMedia(q,visible)&&q.options.every(usable)&&signature(q)===signature(visible));
    const byId=candidates.filter(q=>visible.id&&q.id===visible.id);
    const candidate=byId.length===1?byId[0]:candidates.length===1?candidates[0]:null;
    if(!candidate)return unknown(candidates.length?'Неоднозначный вопрос':'Нет совпадения с исходным квизом');
    if(!candidate.answerAvailable)return unknown('Wayground не предоставил ключ ответа');
    const used=new Set();
    const mapping=candidate.options.map(option=>{
      const byId=visible.options.map((o,i)=>({o,i})).filter(({o})=>option.id&&o.id===option.id&&optionKey(o)===optionKey(option));
      const matches=byId.length===1?byId:visible.options.map((o,i)=>({o,i})).filter(({o})=>optionKey(o)===optionKey(option));
      if(matches.length!==1||used.has(matches[0].i))return -1;
      used.add(matches[0].i);return matches[0].i;
    });
    if(mapping.includes(-1))return unknown('Неоднозначные варианты ответа');
    const indices=candidate.correctIndices.map(i=>mapping[i]);
    if(!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=visible.options.length))return unknown('Некорректный ключ ответа');
    return {known:true,indices:[...new Set(indices)].sort((a,b)=>a-b),reason:'Ключ из публичного квиза'};
  }
  function indicators({connected,playing,visible,disconnected=false,questions=[]}){
    const count=playing?(visible?.options?.length||4):4;
    if(disconnected)return {colors:Array(count).fill('red'),reason:'Wayground сообщает о потере игрового соединения'};
    if(!connected)return {colors:Array(count).fill('red'),reason:'Нет подтверждённого соединения с Wayground'};
    if(!playing)return {colors:Array(4).fill('green'),reason:'Wayground доступен · ожидание вопроса'};
    const match=matchVisible(visible,questions);
    return {colors:Array.from({length:count},(_,i)=>match.known&&match.indices.includes(i)?'green':'gray'),reason:match.reason};
  }
  globalThis.WGDots={text,normalizePin,mediaKey,visualOrder,matchVisible,indicators};
})();
