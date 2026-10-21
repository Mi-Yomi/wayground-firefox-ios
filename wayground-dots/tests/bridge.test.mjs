import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const source = await readFile(new URL('../src/browser-bridge.js', import.meta.url), 'utf8');
function bridge(post = async () => ({value: true})) {
  const calls = [];
  const window = {webkit: {messageHandlers: {waygroundDots: {postMessage: value => {calls.push(value); return post(value);}}}}};
  const context = vm.createContext({window, location: {href: 'https://wayground.com/join'},
    WGNativeContext: {tabId: 3, resourceURL: 'file:///bundle/'}, Headers, Response, Uint8Array, atob, DOMException});
  vm.runInContext(source, context);
  return {context, calls, browser: context.browser};
}
test('messages carry the isolated current sender and accept first background response', async () => {
  const {browser} = bridge();
  browser.runtime.onMessage.addListener((message, sender) => ({message, sender}));
  const response = await browser.runtime.sendMessage({type: 'WG_CONFIG'});
  assert.equal(response.sender.tab.id, 3);
  assert.equal(response.sender.url, 'https://wayground.com/join');
  assert.equal(response.sender.id, browser.runtime.id);
});
test('storage errors propagate and notifications do not expose native objects', async () => {
  const {browser, context} = bridge(async () => ({error: 'Keychain failed'}));
  await assert.rejects(browser.storage.local.set({aiConfig: {}}), /Keychain failed/);
  let change;
  browser.storage.onChanged.addListener((value, area) => {change = [value, area];});
  context.__wgNativeStorage({aiConfig: {newValue: true}});
  assert.equal(change[1], 'local');
  assert.equal(change[0].aiConfig.newValue, true);
});
test('native fetch preserves headers, bytes and HTTP errors', async () => {
  const {context, calls} = bridge(async () => ({value: {status: 429, headers: {'content-type': 'application/json'}, body: btoa('{"error":"limit"}')}}));
  const response = await context.fetch('https://api.example/v1', {method: 'POST', headers: {'Authorization': 'Bearer fake-test-key'}, body: '{}'});
  assert.equal(response.status, 429);
  assert.equal(response.ok, false);
  assert.deepEqual(await response.json(), {error: 'limit'});
  assert.equal(calls[0].headers.authorization, 'Bearer fake-test-key');
});
test('abort before dispatch sends nothing, abort during dispatch cancels native job', async () => {
  const controller = new AbortController();
  controller.abort();
  const first = bridge();
  await assert.rejects(first.context.fetch('https://example.com', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(first.calls.length, 0);
  let finish;
  const next = new AbortController();
  const second = bridge(input => input.op === 'fetch' ? new Promise(resolve => {finish = resolve;}) : Promise.resolve({value: true}));
  const promise = second.context.fetch('https://example.com', {signal: next.signal});
  next.abort();
  finish({value: {status: 200, body: '', headers: {}}});
  await assert.rejects(promise, {name: 'AbortError'});
  assert.equal(second.calls[1].op, 'cancel');
  assert.equal(second.calls[1].id, second.calls[0].id);
});
test('only bundled settings can be opened through the tabs shim', async () => {
  const {browser, calls} = bridge();
  await assert.rejects(browser.tabs.create({url: 'https://example.com'}), /Unsupported tab/);
  assert.equal(calls.length, 0);
  await browser.tabs.create({url: browser.runtime.getURL('options.html')});
  assert.equal(calls[0].op, 'settings');
});
test('panel delivery reaches the content listener after background listener', () => {
  const {browser, context} = bridge();
  let shown = false;
  browser.runtime.onMessage.addListener(() => ({ok: false}));
  browser.runtime.onMessage.addListener(message => {shown = message.type === 'WG_SHOW_PANEL';});
  context.__wgNativePanel();
  assert.equal(shown, true);
});
test('generated bundle does nothing on non-Wayground pages and subframes', async () => {
  const bundle = await readFile(process.env.WG_DOTS_RESOURCES ? path.join(process.env.WG_DOTS_RESOURCES, 'page.js') : new URL('../resources/page.js', import.meta.url), 'utf8');
  for (const hostname of ['example.com', 'wayground.com.evil.example', 'quizizz.com']) {
    const window = {}; window.top = window;
    vm.runInNewContext(bundle, {location: {protocol: 'https:', hostname, port: ''}, window});
  }
  vm.runInNewContext(bundle, {location: {protocol: 'https:', hostname: 'wayground.com', port: ''}, window: {top: {}}});
});
