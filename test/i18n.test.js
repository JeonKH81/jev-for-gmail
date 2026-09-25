const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('English and Korean locale catalogs contain the same messages', () => {
  const en = readJson('_locales/en/messages.json');
  const ko = readJson('_locales/ko/messages.json');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  for (const [key, entry] of Object.entries(en)) assert.ok(entry.message, `missing English message: ${key}`);
  for (const [key, entry] of Object.entries(ko)) assert.ok(entry.message, `missing Korean message: ${key}`);
});

test('manifest uses Chrome localization without expanding permissions', () => {
  const manifest = readJson('manifest.json');
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://mail.google.com/*', 'https://api.typesafe.ai/*']);
});

test('all interface message references exist in both catalogs', () => {
  const en = readJson('_locales/en/messages.json');
  const ko = readJson('_locales/ko/messages.json');
  const files = ['options.html', 'popup.html', 'options.js', 'popup.js', 'content.js', 'background.js'];
  const referenced = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/(?:data-i18n=["']|\bt\(["'])([A-Za-z0-9_]+)/g)) referenced.add(match[1]);
  }
  for (const key of referenced) {
    assert.ok(en[key], `missing English message: ${key}`);
    assert.ok(ko[key], `missing Korean message: ${key}`);
  }
});
