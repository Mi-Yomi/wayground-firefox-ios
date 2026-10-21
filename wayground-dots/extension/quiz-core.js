(()=>{
'use strict';
class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function parseQuizId(source) {
  if (typeof source !== 'string' || source.length > 800) throw new ImportError('Укажите ссылку на квиз Wayground или его ID.');
  const value = source.trim();
  if (/^[a-f0-9]{24}$/i.test(value)) return value.toLowerCase();
  if (/^\d{4,10}$/.test(value)) throw new ImportError('Здесь нужна ссылка на исходный публичный квиз или его ID, а не PIN игры.');
  let url;
  try { url = new URL(value); } catch { throw new ImportError('Введите полную ссылку на квиз Wayground или ID из 24 символов.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['wayground.com','www.wayground.com','quizizz.com','www.quizizz.com'].includes(url.hostname)) {
    throw new ImportError('Поддерживаются только HTTPS-ссылки на wayground.com и quizizz.com.');
  }
  const match = url.pathname.match(/^\/(?:activity\/)?(?:join|admin)\/quiz\/([a-f0-9]{24})(?:\/|$)/i);
  if (!match) throw new ImportError('В этой ссылке нет ID квиза. Откройте конкретный квиз и скопируйте его ссылку.');
  return match[1].toLowerCase();
}

function parseSource(source) {
  const value=typeof source==='string'?source.trim():'';
  if(/^\d{6}$/.test(value))return {pin:value};
  if(value.length<=800){
    let url;try{url=new URL(value);}catch{}
    if(url&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['wayground.com','www.wayground.com','quizizz.com','www.quizizz.com'].includes(url.hostname)&&/^\/join\/?$/.test(url.pathname)){
      const pins=url.searchParams.getAll('gc');
      if(pins.length===1&&/^\d{6}$/.test(pins[0]))return {pin:pins[0]};
      throw new ImportError('В ссылке приглашения должен быть один PIN из 6 цифр (gc).');
    }
  }
  return {quizId:parseQuizId(source)};
}

function plainText(value) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',laquo:'«',raquo:'»',hellip:'…',times:'×',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”'};
  return String(value ?? '').slice(0,30000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(full,entity)=>{
      if(entity[0]==='#') { const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10); return code>0&&code<=0x10ffff?String.fromCodePoint(code):''; }
      return entities[entity.toLowerCase()] ?? full;
    }).replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function normalizeQuiz(payload, quizId) {
  const quiz = payload?.data?.quiz;
  if (!payload?.success || !quiz?.info) throw new ImportError('Wayground не предоставил данные этого квиза. Проверьте ссылку и доступность.',404);
  if(quiz.hidden===true || quiz.deleted===true || quiz.info.visibility===false) throw new ImportError('Этот квиз не опубликован для общего доступа.',403);
  const raw = quiz.info.questions;
  if(!Array.isArray(raw)||!raw.length) throw new ImportError('В ответе Wayground нет вопросов.',422);
  if(raw.length>500) throw new ImportError('Поддерживаются квизы до 500 вопросов.',422);
  const questions=raw.map((question,index)=>{
    if(!question||typeof question!=='object'||!question.structure||typeof question.structure!=='object')throw new ImportError('Wayground вернул некорректный вопрос.',502);
    const s=question?.structure??{},type=String(question?.type??s.kind??'UNKNOWN');
    const options=Array.isArray(s.options)?s.options.map((option,i)=>({id:String(option?._id??option?.id??''),index:i,text:plainText(option?.text),hasMedia:Boolean(option?.media?.length),hasMath:Boolean(option?.hasMath)})):[];
    const supported=['MCQ','MSQ'].includes(type);
    const rawIndices=type==='MCQ'&&Number.isInteger(s.answer)?[s.answer]:type==='MSQ'&&Array.isArray(s.answer)?s.answer:[];
    const validIndices=supported&&s.settings?.hasCorrectAnswer!==false&&rawIndices.length>0&&rawIndices.every(i=>Number.isInteger(i)&&i>=0&&i<options.length);
    const correctIndices=validIndices?[...new Set(rawIndices)].sort((a,b)=>a-b):[];
    return {id:String(question?._id??question?.id??''),number:index+1,type,text:plainText(s.query?.text)||'Вопрос без текстового условия',hasMedia:Boolean(s.query?.media?.length),hasMath:Boolean(s.hasMath||s.query?.hasMath),options,correctIndices,answers:correctIndices.map(i=>options[i].text||'Вариант с изображением'),answerAvailable:correctIndices.length>0,explanation:plainText(s.explain?.text),unsupportedType:!supported};
  });
  return {quizId,title:plainText(quiz.info.name)||'Квиз Wayground',sourceUrl:`https://wayground.com/join/quiz/${quizId}/start`,total:questions.length,answerable:questions.filter(q=>q.answerAvailable).length,questions,retrievedAt:new Date().toISOString()};
}

async function requestJson(endpoint, options, fetcher, timeoutMs=15000) {
  const controller=new AbortController();let reader,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new ImportError('Wayground не ответил вовремя. Повторите попытку.',504));controller.abort();void reader?.cancel().catch(()=>{});},timeoutMs);});
  const read=async()=>{
  const response=await fetcher(endpoint,{...options,headers:{Accept:'application/json',...options.headers},redirect:'manual',signal:controller.signal});
  if(response.status===401||response.status===403) throw new ImportError('Wayground требует авторизацию или ограничивает доступ к этому квизу.',403);
  if(response.status===404)throw new ImportError('Квиз не найден.',404);
  if(response.status===400)throw new ImportError('Wayground отклонил запрос. Проверьте PIN или ссылку.',400);
  if(response.status===429)throw new ImportError('Wayground ограничил частоту запросов. Попробуйте позже.',429);
  if(!response.ok)throw new ImportError('Wayground временно не предоставил данные.',502);
  if(!response.headers.get('content-type')?.includes('application/json'))throw new ImportError('Wayground вернул страницу вместо данных квиза.',502);
  reader=response.body?.getReader();
  if(!reader)throw new ImportError('Wayground вернул пустой ответ.',502);
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new ImportError('Ответ Wayground превышает допустимый размер.',422);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let payload;
  try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ImportError('Wayground вернул некорректные данные.',502);}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ImportError('Wayground вернул некорректную структуру данных.',502);
  return payload;
  };
  try{return await Promise.race([read(),timeout]);}
  catch(error){void reader?.cancel().catch(()=>{});if(error instanceof ImportError)throw error;throw new ImportError('Не удалось получить данные Wayground. Повторите попытку позже.',502);}
  finally{clearTimeout(timer);}
}

async function importPublicQuiz(source,fetcher){
 const id=parseQuizId(source);
 const data=await requestJson(`https://wayground.com/_quizserver/main/v2/quiz/${id}?bypassProfanity=false&returnPrivileges=false&source=join`,{},fetcher);
 return {...normalizeQuiz(data,id),sourceType:'link'};
}

function attachAnswerKeys(session,sourceQuiz){
 const signature=q=>JSON.stringify([q.type,q.text,q.options.map(o=>o.text).sort()]);
 const used=new Set();
 const questions=session.questions.map(question=>{
  const complex=q=>q.hasMedia||q.hasMath||q.options.some(o=>o.hasMedia||o.hasMath);
  if(complex(question))throw new ImportError('Для вопросов с медиа или формулами сопоставление ключей по ссылке пока не поддерживается.',422);
  const exact=sourceQuiz.questions.filter(q=>!used.has(q)&&!complex(q)&&signature(q)===signature(question));
  const byId=exact.filter(q=>q.id&&q.id===question.id);
  const candidate=byId.length===1?byId[0]:exact.length===1?exact[0]:null;
  if(!candidate)throw new ImportError('Вопросы сессии не совпадают с указанным исходным квизом. Ключи не подставлены.',409);
  used.add(candidate);
  const mapped=new Set();
  const optionMap=candidate.options.map(option=>{
    const byId=question.options.filter(o=>option.id&&o.id===option.id&&o.text===option.text);
    const matches=byId.length===1?byId:question.options.filter(o=>o.text===option.text);
    if(matches.length!==1||mapped.has(matches[0].index))throw new ImportError('Варианты ответа нельзя однозначно сопоставить. Ключи не подставлены.',409);
    mapped.add(matches[0].index);return matches[0].index;
  });
  const correctIndices=candidate.correctIndices.map(i=>optionMap[i]).sort((a,b)=>a-b);
  return {...question,correctIndices,answers:correctIndices.map(i=>question.options[i].text),answerAvailable:correctIndices.length>0,explanation:candidate.explanation};
 });
 return {...session,questions,answerable:questions.filter(q=>q.answerAvailable).length,sourceType:'pin+link',sourceQuizId:sourceQuiz.quizId,keySourceUrl:sourceQuiz.sourceUrl,notice:'Ключи взяты из указанного публичного квиза. Вопросы и варианты проверены; перестановка вариантов учтена.'};
}

async function importQuiz(source, fetcher = (url,options)=>globalThis.fetch(url,options), quizSource=''){
 const parsed=parseSource(source);
 if(parsed.quizId)return importPublicQuiz(parsed.quizId,fetcher);
 const value=parsed.pin;
 if(quizSource)parseQuizId(quizSource);
 const checked=await requestJson('https://wayground.com/play-api/v5/checkRoom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomCode:value})},fetcher);
 const room=checked.room;
 if(!room||!/^[a-f0-9]{24}$/i.test(room.hash??''))throw new ImportError('Активная сессия с таким PIN не найдена.',404);
 if(room.deleted||!['waiting','running'].includes(room.state))throw new ImportError('Сессия завершена или PIN истёк.',410);
 if(room.options?.loginRequired||room.groupIds?.length||room.groupsInfo?.hasGCL)throw new ImportError('Сессия требует входа или ограничена группой. Такой PIN не поддерживается.',403);
 const gameType=encodeURIComponent(String(room.type??''));
 const [info,data]=await Promise.all([
  requestJson(`https://wayground.com/_gameapi/main/public/v1/games/${room.hash}/quiz-info?gameState=${room.state}&gameType=${gameType}&fetchQuizName=true`,{},fetcher),
  requestJson('https://wayground.com/play-api/v4/getQuestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomHash:room.hash,type:room.type})},fetcher)
 ]);
 if(!data.questions||typeof data.questions!=='object')throw new ImportError('Wayground не предоставил вопросы этой сессии.',422);
 const raw=Array.isArray(data.questions)?data.questions:Object.values(data.questions);
 const quiz=normalizeQuiz({success:true,data:{quiz:{info:{name:info.data?.name??info.name??'Сессия Wayground',visibility:info.data?.visibility,questions:raw}}}},null);
 const session={...quiz,pin:value,sourceType:'pin',sourceUrl:`https://wayground.com/join?gc=${value}`,notice:quiz.answerable<quiz.total?'По этому PIN Wayground не передал все ключи ответов. Можно добавить ссылку на публичный исходный квиз.':null};
 if(quizSource)return attachAnswerKeys(session,await importPublicQuiz(quizSource,fetcher));
 return session;
}

globalThis.WGQuiz={ImportError,parseQuizId,importQuiz,requestJson,normalizeQuiz,plainText};
})();
