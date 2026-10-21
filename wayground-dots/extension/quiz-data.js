(() => {
  'use strict';
  function describe(value){
    const records=Array.isArray(value)?value:[];
    const media=[...new Set(records.filter(r=>r?.type==='image').map(r=>WGDots.mediaKey(r.url)).filter(Boolean))];
    return {media,hasMedia:records.length>0,unsupportedMedia:records.some(r=>r?.type!=='image'||!WGDots.mediaKey(r.url))};
  }
  function fromPayload(payload,id){
    const quiz=WGQuiz.normalizeQuiz(payload,id),raw=payload.data.quiz.info.questions;
    quiz.questions=quiz.questions.map((q,index)=>{const s=raw[index].structure;return {...q,text:WGQuiz.plainText(s.query?.text),...describe(s.query?.media),options:q.options.map((option,i)=>({...option,...describe(s.options[i]?.media)}))};});
    return {...quiz,sourceType:'link'};
  }
  globalThis.WGData={fromPayload};
})();
