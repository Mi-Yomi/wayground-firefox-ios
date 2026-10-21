import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../../', import.meta.url)));
const keychain = await readFile(path.join(root, 'firefox-ios/Storage/RustKeychain.swift'), 'utf8');
assert.match(keychain, /public class func wipeKeychain\(\)\s*\{\s*\/\/[^\n]+\n\s*sharedClientAppContainerKeychain\.removeAllKeys\(\)\s*\}/);
assert.doesNotMatch(keychain, /deleteKeychainSecClass/);
const start = keychain.indexOf('public func removeAllKeys()');
assert.ok(start > 0);
const removal = keychain.slice(start, keychain.indexOf('\n    }', start));
assert.match(removal, /kSecAttrService as String: serviceName/);
assert.match(removal, /SecItemDelete\(keychainQueryDictionary as CFDictionary\)/);
const source = await readFile(path.join(root, 'wayground-dots/src/WaygroundDotsBridge.swift'));
const target = await readFile(path.join(root, 'firefox-ios/Client/WaygroundDotsBridge.swift'));
assert.equal(source.toString().replaceAll('\r\n', '\n'), target.toString().replaceAll('\r\n', '\n'), 'Native bridge source and app target differ');
console.log('Fork safety checks passed: Keychain cleanup is service-scoped, bridge sources match');
