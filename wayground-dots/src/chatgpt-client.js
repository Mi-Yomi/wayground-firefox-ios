(() => {
  'use strict';
  WGAI.providers.codex = {label: 'ChatGPT · вход без API-ключа', endpoint: 'codex:local'};
  const config = WGAI.config;
  WGAI.config = (raw, previous = {}) => {
    if (raw?.provider !== 'codex') return config(raw, previous);
    const model = typeof raw.model === 'string' ? raw.model.trim() : '';
    const reasoningEffort = raw.reasoningEffort ?? '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,149}$/.test(model)) throw new Error('Выберите доступную модель ChatGPT');
    if (!['', ...WGAI.codexEfforts].includes(reasoningEffort)) throw new Error('Некорректное усилие модели');
    return {provider: 'codex', endpoint: 'codex:local', model, reasoningEffort, fastMode: false, apiKey: '', enabled: raw.enabled === true, images: raw.images === true};
  };
  const publicConfig = WGAI.publicConfig;
  WGAI.publicConfig = value => {
    const result = publicConfig(value);
    if (value?.provider === 'codex') result.reasoningEffort = value.reasoningEffort ?? '';
    return result;
  };
  globalThis.WGCodex = {create: browser => ({
    status: () => browser.waygroundCodex.request('status'),
    login: () => browser.waygroundCodex.request('login'),
    logout: () => browser.waygroundCodex.request('logout'),
    models: () => browser.waygroundCodex.request('models'),
    async suggest(config, input, signal) {
      return WGAI.result(await browser.waygroundCodex.request('suggest', {config, input}, signal), input);
    }
  })};
})();
