import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.resolve(process.argv[2] || path.join(root, '../extension'));
const output = path.resolve(process.argv[3] || path.join(root, 'resources'));
const manifest = JSON.parse(await readFile(path.join(input, 'manifest.json'), 'utf8'));
const read = file => readFile(path.join(input, file), 'utf8');
const bridge = await readFile(path.join(root, 'src/browser-bridge.js'), 'utf8');
const background = await Promise.all(manifest.background.scripts.map(read));
const content = await Promise.all(manifest.content_scripts[0].js.filter(file => !manifest.background.scripts.includes(file)).map(read));
await mkdir(output, {recursive: true});
const common = bridge + '\n' + background.join('\n');
let page = '(() => {\nif (location.protocol !== "https:" || !["wayground.com", "www.wayground.com"].includes(location.hostname) || location.port || window !== window.top) return;\n';
page += common + '\n' + content.join('\n') + '\n})();\n';
page = page.replaceAll('через страницу дополнений Safari', 'через кнопку Dots в браузере')
  .replaceAll('значком расширения в Safari', 'кнопкой Dots в браузере')
  .replaceAll('значком расширения Safari', 'кнопкой Dots в браузере')
  .replaceAll('страницу в Safari', 'страницу в этом браузере');
await writeFile(path.join(output, 'page.js'), page);
await writeFile(path.join(output, 'settings-engine.js'), common);
let html = await read('options.html');
html = html.replace('<script src="ai-core.js"></script>', '<script src="settings-engine.js"></script>')
  .replace('локальном хранилище расширения Safari', 'системной связке ключей iOS (Keychain)')
  .replace('Открывайте Wayground в Safari. Включите расширение в настройках Safari и разрешите ему доступ к wayground.com. Панель кружков открывается через кнопку расширений Safari.', 'Открывайте Wayground в этом браузере. Кнопка Dots внизу слева открывает панель; в ней нажмите «Подключить ИИ». Перетаскивайте кружки пальцем.')
  .replaceAll('фонового процесса Safari', 'страницы браузера').replaceAll('закрытия Safari', 'закрытия браузера');
await writeFile(path.join(output, 'options.html'), html);
await copyFile(path.join(input, 'options.js'), path.join(output, 'options.js'));
await copyFile(path.join(input, 'mobile.css'), path.join(output, 'mobile.css'));
await copyFile(path.join(input, 'THIRD_PARTY_NOTICES.txt'), path.join(output, 'THIRD_PARTY_NOTICES.txt'));
console.log(`Built Firefox resources in ${output}`);
