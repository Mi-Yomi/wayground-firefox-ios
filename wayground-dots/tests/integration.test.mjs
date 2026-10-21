import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';

const bundle = await readFile(process.env.WG_DOTS_RESOURCES ? path.join(process.env.WG_DOTS_RESOURCES, 'page.js') : new URL('../resources/page.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(predicate(), 'Dots did not reach the expected state');
}
function player({codex = false} = {}) {
  const {document, window} = parseHTML('<html><body><main><div data-testid="question-container"><div id="questionText">2 + 2?</div></div><div class="options-grid" role="listbox">' + ['3', '4', '5', '6'].map((label, i) => `<button role="option" data-cy="option-${i}"><span id="optionText">${label}</span></button>`).join('') + '</div></main></body></html>');
  window.top = window;
  window.innerWidth = 390; window.innerHeight = 844;
  window.visualViewport = {width: 390, height: 844, addEventListener() {}};
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [this.getBoundingClientRect()]; };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const index = [...document.querySelectorAll('[role="option"]')].indexOf(this);
    return {left: this.id === 'handle' ? 280 : 20, top: this.id === 'handle' ? 40 : index >= 0 ? 230 + index * 100 : 100, width: this.id === 'handle' ? 80 : 350, height: this.id === 'handle' ? 44 : 80};
  };
  const config = {provider: 'openai', endpoint: 'https://api.openai.com/v1/responses', model: 'fixture-model', apiKey: 'fake-fixture-key', enabled: true, images: false};
  if (codex) Object.assign(config, {provider: 'codex', endpoint: 'codex:local', apiKey: '', reasoningEffort: '', fastMode: false});
  const state = {aiConfig: config}, requests = [], nativeCommands = [];
  let selectedID = '2';
  let context;
  const native = async message => {
    if (message.op === 'chatgpt') {
      nativeCommands.push(message);
      if (message.action === 'status') return {value: {connected: true, planUsageAllowed: true, fastModeSupported: false}};
      if (message.action === 'suggest') return {value: {status: 'ready', selectedChoiceIds: [selectedID], explanation: 'Fixture ChatGPT suggestion'}};
      throw new Error('Unexpected ChatGPT command');
    }
    if (message.op === 'get') return {value: Object.fromEntries((Array.isArray(message.keys) ? message.keys : [message.keys]).filter(key => Object.hasOwn(state, key)).map(key => [key, structuredClone(state[key])]))};
    if (message.op === 'set' || message.op === 'remove') {
      const keys = message.op === 'set' ? Object.keys(message.values) : Array.isArray(message.keys) ? message.keys : [message.keys];
      const changes = {};
      for (const key of keys) {changes[key] = {oldValue: state[key], newValue: message.values?.[key]}; if (message.op === 'set') state[key] = structuredClone(message.values[key]); else delete state[key];}
      context.__wgNativeStorage(changes);
      return {value: true};
    }
    if (message.op === 'permission') return {value: true};
    if (message.op === 'cancel' || message.op === 'settings') return {value: true};
    if (message.op !== 'fetch') throw new Error('Unexpected native command');
    requests.push(message);
    let data = {};
    if (message.url === config.endpoint) data = {status: 'completed', output: [{content: [{type: 'output_text', text: JSON.stringify({status: 'ready', selectedChoiceIds: ['2'], explanation: 'Fixture suggestion'})}]}]};
    else if (message.url.includes('/quiz/')) data = {success: true, data: {quiz: {info: {name: 'Fixture public quiz', visibility: true, questions: [{type: 'MCQ', structure: {kind: 'MCQ', answer: 0, query: {text: '2 + 2?'}, options: ['4', '3', '5', '6'].map(text => ({text}))}}]}}}};
    return {value: {status: 200, headers: {'content-type': 'application/json'}, body: btoa(JSON.stringify(data))}};
  };
  window.webkit = {messageHandlers: {waygroundDots: {postMessage: native}}};
  context = vm.createContext({document, window, location: {href: 'https://wayground.com/join/game/fixture?gameType=solo', protocol: 'https:', hostname: 'wayground.com', port: '', pathname: '/join/game/fixture', search: '?gameType=solo'},
    WGNativeContext: {tabId: 7, resourceURL: 'file:///bundle/'}, URL, URLSearchParams, Headers, Response, AbortController, DOMException, Uint8Array, TextEncoder, TextDecoder, btoa, atob, crypto: webcrypto,
    navigator: {onLine: true}, setTimeout, clearTimeout, setInterval() {}, clearInterval() {}, MutationObserver: class {observe() {}}, getComputedStyle: element => ({display: element.style.display || 'block', visibility: 'visible', opacity: '1'})});
  vm.runInContext(bundle, context);
  const shadow = document.getElementById('wg-dots-extension').shadowRoot;
  return {context, state, requests, nativeCommands, select: id => {selectedID = id;}, document, window, shadow, colors: () => [...shadow.querySelectorAll('.dot')].map(element => element.className.split(' ').at(-1))};
}

test('bundled native path recognizes a mobile question, suggests AI and gives a public key priority', async () => {
  const p = player();
  await until(() => p.colors().includes('ai'));
  assert.equal(p.context.WGDom.read().diagnostics.code, 'ready');
  assert.equal(p.colors()[1], 'ai');
  const api = p.requests.filter(request => request.url === 'https://api.openai.com/v1/responses');
  assert.equal(api.length, 1);
  assert.equal(api[0].body.includes('game/fixture'), false);
  p.shadow.querySelector('#source').value = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  p.shadow.querySelector('#load').click();
  await until(() => p.colors().includes('green'));
  assert.equal(p.colors()[1], 'green');
  assert.equal(p.colors().includes('ai'), false);
  assert.equal(p.document.querySelector('[aria-selected="true"]'), null);
});

test('native panel and pointer drag work with the bundled background in the same isolated world', async () => {
  const p = player();
  await tick();
  p.context.__wgNativePanel();
  assert.equal(p.shadow.querySelector('#panel').hidden, false);
  assert.equal(p.shadow.querySelector('#advanced').hidden, false);
  p.shadow.querySelector('#ios-close').click();
  assert.equal(p.shadow.querySelector('#panel').hidden, true);
  const handle = p.shadow.querySelector('#handle');
  for (const [type, x, y] of [['pointerdown', 290, 50], ['pointermove', 100, 400], ['pointerup', 100, 400]]) {
    const event = new p.window.Event(type, {bubbles: true, cancelable: true});
    Object.assign(event, {pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y});
    handle.dispatchEvent(event);
  }
  await until(() => Boolean(p.state.widgetPosition));
  assert.ok(p.state.widgetPosition.x >= 0 && p.state.widgetPosition.x <= 1);
  assert.ok(p.state.widgetPosition.y >= 0 && p.state.widgetPosition.y <= 1);
});

test('ChatGPT uses the native contract and discards cached suggestions when the account changes', async () => {
  const p = player({codex: true});
  await until(() => p.colors()[1] === 'ai');
  await until(() => p.state['ios.ai-results.v1']?.length === 1);
  assert.equal(p.requests.length, 0, 'The ChatGPT credential path must not send a JS fetch');
  const suggestions = () => p.nativeCommands.filter(command => command.action === 'suggest');
  assert.equal(suggestions().length, 1);
  assert.equal(suggestions()[0].config.apiKey, '');
  assert.equal(JSON.stringify(suggestions()[0].input).includes('game/fixture'), false);
  p.state.aiConfig.enabled = false;
  p.context.__wgNativeStorage({aiConfig: {newValue: true}, chatgptSession: {newValue: 'fixture-second-account'}});
  await until(() => !p.colors().includes('ai'));
  await until(() => p.state['ios.ai-results.v1']?.length === 0);
  p.select('3');
  p.state.aiConfig.enabled = true;
  p.context.__wgNativeStorage({aiConfig: {newValue: true}});
  await until(() => p.colors()[2] === 'ai');
  assert.equal(suggestions().length, 2, 'The old account must not satisfy the new account from cache');
});
