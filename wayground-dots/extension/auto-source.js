/* Public session/source discovery. No access to page state, cookies or sockets. */
(() => {
  'use strict';
  function signature(q){
    const part=o=>[WGDots.text(o.text),[...new Set(o.media||[])].sort()];
    const safe=o=>!o.hasMath&&!o.unsupportedMedia&&(!o.hasMedia||o.media?.length);
    if(!q.id||!safe(q)||!q.options.every(safe))return null;
    return JSON.stringify([q.id,q.type,...part(q),q.options.map(o=>JSON.stringify(part(o))).sort()]);
  }
  function sameQuiz(session,source){
    if(!session.questions.length||session.questions.length!==source.questions.length)return false;
    const a=session.questions.map(signature),b=source.questions.map(signature);
    return !a.includes(null)&&!b.includes(null)&&JSON.stringify(a.sort())===JSON.stringify(b.sort());
  }
  function sourceIds(values,limit=8){
    const ids=[];
    for(const value of Array.isArray(values)?values:[]){
      let id;try{id=WGQuiz.parseQuizId(value).toLowerCase();}catch{continue;}
      if(!ids.includes(id))ids.push(id);
      if(ids.length===limit)break;
    }
    return ids;
  }
  function create({request,load,sources,randomId=()=>crypto.randomUUID()}){
    const pending=new Map(),cache=new Map(),sessions=new Map();let generation=0;
    function assertCurrent(epoch){if(epoch!==generation){const error=new Error('Источник изменился; повторите автоматический поиск');error.code='STALE_REQUEST';throw error;}}
    async function discover(pin,epoch,{round=0,lobbyOnly=false,hints=[]}={}){
      const checked=await request('https://wayground.com/play-api/v5/checkRoom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomCode:pin})});
      assertCurrent(epoch);
      const room=checked.room;
      if(!room||!/^[a-f0-9]{24}$/i.test(room.hash||'')||room.deleted||!['waiting','running'].includes(room.state))throw new Error('Активная сессия с таким PIN не найдена');
      if(room.options?.loginRequired||room.groupIds?.length||room.groupsInfo?.hasGCL)throw new Error('Эта сессия ограничена входом или группой; автоматический публичный импорт недоступен');
      const saved=sessions.get(pin);
      const prepared=saved&&saved.roomHash===room.hash&&Date.now()-saved.time<300000?saved:null;
      if(!prepared)sessions.delete(pin);
      const finish=result=>({...result,roomState:room.state});
      if(prepared?.resolved)return finish(prepared.resolved);
      // A scheduled lobby pass must not start searches after the host begins.
      // One explicit/initial lookup during play is still allowed.
      if(lobbyOnly&&room.state!=='waiting')return finish({quiz:prepared?.quiz||null,resolved:false,lobbyEnded:true,notice:'Игра началась; фоновый поиск в лобби завершён'});
      let session=prepared?.quiz;
      let metadataSources=sourceIds([room.quizId,...(prepared?.metadataSources||[])],3);
      if(!session){
      const [info,data]=await Promise.all([
        request('https://wayground.com/_gameapi/main/public/v1/games/'+room.hash+'/quiz-info?gameState='+room.state+'&gameType='+encodeURIComponent(room.type||'')+'&fetchQuizName=true',{}),
        request('https://wayground.com/play-api/v4/getQuestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomHash:room.hash,type:room.type})})
      ]);
      assertCurrent(epoch);
      if(!data.questions||typeof data.questions!=='object'||!Object.keys(data.questions).length){
        if(room.state==='waiting')return finish({quiz:null,resolved:false,notice:'Лобби открыто; Wayground пока не предоставил вопросы'});
        throw new Error('Wayground не предоставил вопросы сессии');
      }
      const details=info.data||info;
      // Some legitimate room states include the original quiz reference.
      // Treat it as a candidate and verify public visibility and full content
      // below, just like a search result. Never change the requested game state.
      metadataSources=sourceIds([...metadataSources,details.quizId,details._id],3);
      const raw=Array.isArray(data.questions)?data.questions:Object.values(data.questions);
      session={...WGData.fromPayload({success:true,data:{quiz:{info:{name:details.name,visibility:details.visibility,questions:raw}}}},null),sourceType:'pin',sourceUrl:'',pin,roomHash:room.hash};
      if(sessions.size>=8)sessions.delete(sessions.keys().next().value);
      sessions.set(pin,{roomHash:room.hash,time:Date.now(),quiz:session,metadataSources});
      }
      const resolved=(quiz,notice)=>{
        const result={quiz:{...quiz,pin,roomHash:room.hash},resolved:true,notice};
        sessions.get(pin).resolved=result;return finish(result);
      };
      if(session.answerable===session.total)return resolved(session,'Ключи автоматически получены из публичных данных сессии');
      const tried=new Set();let transientError=null;
      async function candidate(value){
        assertCurrent(epoch);
        let id;try{id=WGQuiz.parseQuizId(value).toLowerCase();}catch{return null;}
        if(tried.has(id))return null;tried.add(id);
        try{const source=await load(id);assertCurrent(epoch);return sameQuiz(session,source)&&source.answerable>0?source:null;}catch(error){assertCurrent(epoch);if(error?.status===429)throw error;if(error?.retryable===true)transientError=error;return null;}
      }
      const known=sourceIds([...metadataSources,...sourceIds(hints,8),...await sources()],19);assertCurrent(epoch);
      // Requests have a timeout in requestJson. Limit fan-out to three and
      // consider all eight distinct learned sources before public search.
      let cursor=0,matched=null;
      await Promise.all(Array.from({length:Math.min(3,known.length)},async()=>{
        while(!matched&&cursor<known.length){
          const quiz=await candidate(known[cursor++]);
          if(quiz&&!matched)matched=quiz;
        }
      }));
      assertCurrent(epoch);
      if(matched)return resolved(matched,'Источник автоматически выбран по полному совпадению вопросов и вариантов');
      let searchFailed=false;
      // Names can change independently of questions. Verify IDs and full content
      // for at most five candidates per query, never trust a search snippet.
      const title=session.title&&session.title!=='Квиз Wayground'?session.title.slice(0,200):'';
      const questions=session.questions.filter(q=>!q.hasMath&&!q.hasMedia).map(q=>WGDots.text(q.text))
        .filter(value=>value.length>=12&&value!=='Вопрос без текстового условия').sort((a,b)=>b.length-a.length).map(value=>value.slice(0,200));
      const queries=[...new Set([title,...questions].filter(Boolean))].slice(0,8);
      // Explore other question texts on later lobby passes. The last pass
      // revisits the title/first question in case the index has caught up.
      const selected=round===4?queries.slice(0,2):queries.slice(round*2,round*2+2);
      for(const query of selected.length?selected:queries.slice(0,2)){
        try{
          const results=await request('https://wayground.com/_sserverv2/main/v3/search/public?includeCollections=false',{
            method:'POST',headers:{'Content-Type':'application/json','X-Q-Sessionid':randomId()},
            body:JSON.stringify({query,queryId:randomId(),from:0,size:5,filters:{contentTypes:['quiz']},sortBy:{key:'_score',order:'desc'},includeQuestions:false,cards:false,includeSources:['questionTypes'],internal:true,minScore:0,page:'unavailable',source:'unknown',usePremiumAlternative:false,regionWeight:2,'proj-srp-server':'unavailable'})
          });
          assertCurrent(epoch);
          const hits=results?.data?.hits===null?[]:results?.data?.hits;
          if(!results.success||!Array.isArray(hits))throw new Error('Search unavailable');
          for(const hit of hits.slice(0,5)){
            const quiz=await candidate(hit.quizId);
            if(quiz)return resolved(quiz,'Публичный источник найден автоматически; весь набор вопросов и вариантов проверен');
          }
        }catch(error){assertCurrent(epoch);if([401,403,429].includes(error?.status))throw error;if(error?.retryable===true)transientError=error;searchFailed=true;break;}
      }
      if(transientError)throw transientError;
      return finish({quiz:session,resolved:false,notice:searchFailed?'PIN принят, вопросы получены. Публичный поиск недоступен; ключей сессии недостаточно':'PIN принят, вопросы получены. Совпадающий публичный источник не найден. Старые ключи не используются'});
    }
    return {clear:()=>{generation++;cache.clear();pending.clear();sessions.clear();},resolve:async(pin,force=false,options={})=>{
      pin=WGDots.normalizePin(pin);
      if(!pin)throw new Error('Нужен PIN из 6 цифр');
      if(pending.has(pin))return pending.get(pin);
      const saved=cache.get(pin);
      const round=Number.isInteger(options.round)?Math.max(0,Math.min(4,options.round)):0;
      if(!force&&saved&&saved.round===round&&Date.now()-saved.time<60000)return saved.result;
      const epoch=generation,job=discover(pin,epoch,{...options,round});pending.set(pin,job);
      try{const result=await job;assertCurrent(epoch);if(cache.size>=8)cache.delete(cache.keys().next().value);if(!result.lobbyEnded)cache.set(pin,{time:Date.now(),round,result});return result;}finally{if(pending.get(pin)===job)pending.delete(pin);}
    }};
  }
  globalThis.WGAuto={sameQuiz,sourceIds,create};
})();
