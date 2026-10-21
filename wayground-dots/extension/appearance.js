(() => {
  'use strict';
  const defaults=Object.freeze({size:8,opacity:60});
  const valid=value=>Boolean(value&&!Array.isArray(value)&&Number.isInteger(value.size)&&value.size>=3&&value.size<=24&&Number.isInteger(value.opacity)&&value.opacity>=0&&value.opacity<=100);
  const normalize=value=>valid(value)?{size:value.size,opacity:value.opacity}:{...defaults};
  globalThis.WGAppearance={defaults,valid,normalize};
})();
