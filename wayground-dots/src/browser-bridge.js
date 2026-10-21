(() => {
  'use strict';
  const context = globalThis.WGNativeContext;
  const handler = window.webkit?.messageHandlers?.waygroundDots;
  if (!context || !handler) throw new Error('Native Dots bridge unavailable');
  const listeners = [], changes = [];
  const call = async (op, value = {}) => {
    const reply = await handler.postMessage({op, ...value});
    if (reply?.error) throw new Error(reply.error);
    return reply?.value;
  };
  const event = list => ({addListener: listener => list.push(listener)});
  const sender = () => ({id: 'wayground-dots-ios', url: location.href, tab: {id: context.tabId, url: location.href}});
  globalThis.__wgNativeStorage = value => {
    for (const listener of changes) listener(value, 'local');
  };
  globalThis.__wgNativePanel = () => {
    for (const listener of listeners) Promise.resolve(listener({type: 'WG_SHOW_PANEL'}, sender())).catch(() => {});
  };
  globalThis.browser = {
    runtime: {
      id: 'wayground-dots-ios',
      getURL: file => context.resourceURL + file,
      onMessage: event(listeners),
      async sendMessage(message) {
        for (const listener of listeners) {
          const response = listener(message, sender());
          if (response !== undefined) return response;
        }
        throw new Error('Dots message handler unavailable');
      }
    },
    storage: {
      local: {
        get: keys => call('get', {keys: keys ?? null}),
        set: values => call('set', {values}),
        remove: keys => call('remove', {keys})
      },
      onChanged: event(changes)
    },
    permissions: {
      request: value => call('permission', {origins: value.origins, request: true}),
      contains: value => call('permission', {origins: value.origins, request: false})
    },
    tabs: {
      onRemoved: {addListener() {}},
      create: ({url}) => {
        if (url !== context.resourceURL + 'options.html') return Promise.reject(new Error('Unsupported tab URL'));
        return call('settings');
      }
    },
    action: {onClicked: {addListener() {}}}
  };
  let sequence = 0;
  browser.waygroundCodex = {
    async request(action, values = {}, signal) {
      const id = ++sequence;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const abort = () => { void call('cancel', {id}).catch(() => {}); };
      signal?.addEventListener('abort', abort, {once: true});
      try {
        const value = await call('chatgpt', {...values, action, id});
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return value;
      } finally { signal?.removeEventListener('abort', abort); }
    }
  };
  globalThis.fetch = async (url, init = {}) => {
    const id = ++sequence, signal = init.signal;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const abort = () => { void call('cancel', {id}).catch(() => {}); };
    signal?.addEventListener('abort', abort, {once: true});
    try {
      const result = await call('fetch', {
        id, url: String(url), method: init.method || 'GET',
        headers: Object.fromEntries(new Headers(init.headers || {})), body: init.body ?? null
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const bytes = Uint8Array.from(atob(result.body), char => char.charCodeAt(0));
      return new Response(init.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : bytes,
        {status: result.status, headers: result.headers});
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
})();
