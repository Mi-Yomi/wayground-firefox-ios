(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {codex: 'ChatGPT', openai: 'OpenAI API', gemini: 'Google Gemini', compatible: 'Совместимый API'};
  let saved = null, account = null, busy = false, catalog = [];
  const message = async value => {
    const response = await browser.runtime.sendMessage(value);
    if (!response?.ok) throw new Error(response?.error || 'Действие не выполнено');
    return response;
  };
  function providerChanged() {
    const codex = $('provider').value === 'codex', custom = $('provider').value === 'compatible';
    $('chatgpt').hidden = !codex;
    $('api-model').hidden = codex; $('model').required = !codex;
    $('api-token').hidden = codex;
    $('custom-endpoint').hidden = !custom; $('endpoint').required = custom;
  }
  function paint(settings, initial = false) {
    saved = settings;
    if (initial) {
      $('provider').value = settings?.configured && labels[settings.provider] ? settings.provider : 'codex';
      $('model').value = settings?.provider !== 'codex' ? settings?.model || '' : '';
      $('endpoint').value = settings?.provider === 'compatible' ? settings.endpoint : '';
      $('effort').value = settings?.reasoningEffort || '';
    }
    $('enabled').checked = settings?.enabled === true;
    $('images').checked = settings?.images === true;
    $('test').disabled = !settings?.configured;
    $('current').textContent = settings?.configured ? (settings.enabled ? 'ИИ включён' : 'ИИ выключен') + ' · ' + labels[settings.provider] + ' · ' + settings.model : 'Выберите подключение и сохраните настройки.';
    providerChanged();
  }
  async function refreshAccounts(loadModels = true) {
    account = await browser.waygroundCodex.request('status');
    $('account').replaceChildren(...(account.accounts || []).map(item => {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.label + (item.connected ? '' : ' · нужен вход'); return option;
    }));
    $('account').value = account.activeID || '';
    $('account-status').textContent = !account.connected ? 'ChatGPT не подключён' : account.planUsageAllowed ? 'ChatGPT подключён · использование плана разрешено' : 'Вход выполнен, но использование плана не разрешено. Проверьте доступ в ChatGPT.';
    if (loadModels && account.planUsageAllowed) {
      const response = await browser.waygroundCodex.request('models');
      catalog = response.models || [];
      const selected = $('codex-model').value || (saved?.provider === 'codex' ? saved.model : '');
      $('codex-model').replaceChildren(...catalog.map(item => {
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.displayName; return option;
      }));
      $('codex-model').value = catalog.some(item => item.id === selected) ? selected : catalog[0]?.id || '';
      if (!catalog.length) throw new Error('OpenAI не вернул доступные модели для списка');
    } else if (!account.planUsageAllowed) { catalog = []; $('codex-model').replaceChildren(); }
  }
  async function run(job) {
    if (busy) return; busy = true;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    $('result').textContent = 'Выполняется…';
    try { $('result').textContent = await job(); }
    catch (error) { $('result').textContent = error.message; }
    finally { busy = false; for (const button of document.querySelectorAll('button')) button.disabled = false; $('test').disabled = !saved?.configured; }
  }
  $('provider').addEventListener('change', () => { providerChanged(); if ($('provider').value === 'codex') void run(async () => { await refreshAccounts(); return 'Список аккаунтов обновлён'; }); });
  for (const id of ['login', 'add-account']) $(id).addEventListener('click', () => void run(async () => {
    await browser.waygroundCodex.request('login', {newAccount: id === 'add-account'});
    paint((await message({type: 'WG_AI_STATUS'})).settings);
    await refreshAccounts();
    return 'Вход завершён. Выберите модель, включите ИИ и сохраните настройки.';
  }));
  $('account').addEventListener('change', () => void run(async () => {
    await browser.waygroundCodex.request('select', {accountID: $('account').value});
    paint((await message({type: 'WG_AI_STATUS'})).settings);
    await refreshAccounts(); return 'Аккаунт выбран. Сохраните настройки для включения ИИ.';
  }));
  $('models').addEventListener('click', () => void run(async () => { await refreshAccounts(); return 'Модели обновлены'; }));
  $('logout').addEventListener('click', () => void run(async () => {
    const result = await browser.waygroundCodex.request('logout');
    paint((await message({type: 'WG_AI_STATUS'})).settings); await refreshAccounts(false);
    return result.revoked ? 'Выход выполнен. Регистрация сохранена для следующего входа.' : 'Локальный вход удалён. Отзыв сессии на сервере не подтверждён: отключите приложение в настройках ChatGPT.';
  }));
  $('usage').addEventListener('click', () => void run(async () => { await browser.waygroundCodex.request('usage'); return 'Открыты настройки ChatGPT'; }));
  $('connection').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const provider = $('provider').value;
      let settings, origins;
      if (provider === 'codex') {
        if (!account?.planUsageAllowed) throw new Error('Войдите через ChatGPT и разрешите использование плана');
        if (!catalog.some(item => item.id === $('codex-model').value)) throw new Error('Обновите модели и выберите модель аккаунта');
        settings = {provider, model: $('codex-model').value, reasoningEffort: $('effort').value, enabled: $('enabled').checked, images: $('images').checked};
        origins = settings.images ? ['https://*.quizizz.com/*', 'https://*.wayground.com/*'] : [];
      } else {
        const endpoint = WGAI.endpoint($('endpoint').value, provider);
        settings = {provider, endpoint, model: $('model').value.trim(), apiKey: $('token').value.trim(), enabled: $('enabled').checked, images: $('images').checked};
        origins = [WGAI.originPermission(endpoint), ...(settings.images ? ['https://*.quizizz.com/*', 'https://*.wayground.com/*'] : [])];
      }
      if (!await browser.permissions.request({origins})) throw new Error('Не предоставлен доступ к API или изображениям');
      const response = await message({type: 'WG_AI_SAVE', settings}); paint(response.settings); $('token').value = '';
      return 'Настройки сохранены. Открытая страница Wayground получит их автоматически.';
    });
  });
  $('test').addEventListener('click', () => void run(async () => {
    const started = Date.now(), response = await message({type: 'WG_AI_TEST'});
    return 'Предположение ИИ: ' + response.result.indices.map(index => index + 1).join(', ') + ' · ' + ((Date.now() - started) / 1000).toFixed(1) + ' с. ' + response.result.explanation;
  }));
  $('remove').addEventListener('click', () => void run(async () => { paint((await message({type: 'WG_AI_FORGET'})).settings); return 'Настройки ИИ удалены. Для удаления входа ChatGPT отдельно нажмите «Выйти».'; }));
  void run(async () => { paint((await message({type: 'WG_AI_STATUS'})).settings, true); await refreshAccounts(); return 'Настройки загружены'; });
})();
